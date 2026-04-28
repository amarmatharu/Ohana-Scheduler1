"""Ohana Scheduler — FastAPI main server."""
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import sys
import uuid
import logging
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from fastapi import FastAPI, APIRouter, Depends, HTTPException, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import certifi
from motor.motor_asyncio import AsyncIOMotorClient

from models import (
    TherapistCreate, Therapist,
    ClientCreate, Client,
    EndAssignmentRequest,
    SessionBlockCreate, SessionBlock,
    MatchRequest, MatchScore,
    UserPublic,
)
from auth import (
    build_auth_router,
    seed_admin,
    hash_password,
    CSRF_COOKIE_NAME,
)
from maps_service import geocode, places_autocomplete
from matching import match_therapists_for_client
from smart_matching import smart_match
from scheduling import validate_new_block, compute_session_flags, hours_scheduled
from ics_export import build_ics
from fastapi.responses import JSONResponse, Response as FastResponse


# ---- Logging (JSON in prod, plain text locally) ----
def _configure_logging() -> logging.Logger:
    log_level = os.environ.get("LOG_LEVEL", "INFO").upper()
    log_format = os.environ.get("LOG_FORMAT", "text").lower()
    handler = logging.StreamHandler(sys.stdout)
    if log_format == "json":
        try:
            from pythonjsonlogger import jsonlogger
            handler.setFormatter(
                jsonlogger.JsonFormatter(
                    "%(asctime)s %(levelname)s %(name)s %(message)s",
                    rename_fields={"asctime": "ts", "levelname": "level"},
                )
            )
        except ImportError:
            handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(log_level)
    return logging.getLogger("ohana")


logger = _configure_logging()


# ---- DB ----
# We pass certifi's CA bundle to pymongo because the slim Python image ships an
# older OpenSSL trust store that fails the TLS handshake against MongoDB Atlas
# on Python 3.12 (TLSV1_ALERT_INTERNAL_ERROR). Forcing the Mozilla bundle is the
# documented workaround and is explicitly safe — it's the same trust anchor
# `certifi` uses everywhere else.
mongo_url = os.environ["MONGO_URL"]
_mongo_kwargs = {}
# Only force the certifi CA bundle on Atlas-style (mongodb+srv://) URLs. Plain
# `mongodb://` connections (e.g. local dev `mongodb://127.0.0.1:27017`) usually
# don't want TLS at all — and just passing tlsCAFile implicitly enables TLS,
# which would fail against an unencrypted local mongod.
if mongo_url.startswith("mongodb+srv://") and "tlsCAFile" not in mongo_url:
    _mongo_kwargs["tlsCAFile"] = certifi.where()
mongo_client = AsyncIOMotorClient(mongo_url, **_mongo_kwargs)
db = mongo_client[os.environ["DB_NAME"]]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.therapists.create_index("id", unique=True)
    await db.clients.create_index("id", unique=True)
    await db.sessions.create_index("id", unique=True)
    await db.sessions.create_index([("therapist_id", 1), ("date", 1)])
    await db.sessions.create_index([("client_id", 1), ("date", 1)])
    # TTL index — Mongo reaps stale brute-force counter entries automatically
    # once the per-document `expires_at` Date passes.
    await db.login_attempts.create_index("expires_at", expireAfterSeconds=0)
    await seed_admin(db)
    logger.info("Ohana Scheduler startup complete")
    yield
    mongo_client.close()


app = FastAPI(title="Ohana Scheduler", lifespan=lifespan)


# ---- CORS (env-driven) ----
_origins_raw = os.environ.get(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:3002,"
    "http://127.0.0.1:3000,http://127.0.0.1:3002",
)
_allowed_origins = [o.strip() for o in _origins_raw.split(",") if o.strip()]
_allowed_origin_regex = os.environ.get("CORS_ALLOWED_ORIGIN_REGEX") or None
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_origin_regex=_allowed_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Access-Token", "X-Request-ID"],
)


# ---- Request ID middleware ----
class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        rid = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = rid
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        return response


app.add_middleware(RequestIDMiddleware)


# ---- CSRF (double-submit cookie) ----
# Enforced on state-changing methods. Exempt:
#   - safe methods (GET/HEAD/OPTIONS)
#   - bootstrap endpoints that establish the session (login/register/refresh)
#   - non-/api paths (none today, but keeps the surface tight)
_CSRF_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
_CSRF_EXEMPT_PATHS = {
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/refresh",
}


class CSRFMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if (
            request.method not in _CSRF_SAFE_METHODS
            and request.url.path.startswith("/api")
            and request.url.path not in _CSRF_EXEMPT_PATHS
        ):
            cookie = request.cookies.get(CSRF_COOKIE_NAME)
            header = request.headers.get("X-CSRF-Token")
            if not cookie or not header or not secrets.compare_digest(cookie, header):
                return JSONResponse(
                    status_code=403,
                    content={"detail": "CSRF token missing or invalid"},
                )
        return await call_next(request)


if os.environ.get("CSRF_ENABLED", "true").lower() == "true":
    app.add_middleware(CSRFMiddleware)

auth_router, get_current_user, require_role = build_auth_router(db)
app.include_router(auth_router)

api = APIRouter(prefix="/api")


# ---- Utility ----
def _clean(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


# ---- Schema-drift adapters --------------------------------------------------
# Background: the pilot Mongo cluster contains a small amount of legacy seed
# data from a previous (BCBA/RBT-flavored) iteration of the app. Those docs
# nest the address inside `location: {address, latitude, longitude}` and use
# `parent_email`, `phone_number`, `assigned_rbt_id`, etc. — none of which line
# up with the current Pydantic models. Rather than wipe the data (destructive
# and surprising for the user) we translate known legacy fields into the
# current shape on read. Every mapping is conditional on the target field
# being absent, so this is a safe no-op for current docs.
#
# Anything we genuinely can't coerce is dropped from list responses (with a
# warning log) by `_safe_validate` below, so a single bad doc never 500s the
# whole endpoint.
def _normalize_client_doc(doc: dict) -> dict:
    if not isinstance(doc, dict):
        return doc
    loc = doc.get("location") if isinstance(doc.get("location"), dict) else {}
    if "home_address" not in doc and loc.get("address"):
        doc["home_address"] = loc["address"]
    if doc.get("lat") is None and loc.get("latitude") is not None:
        doc["lat"] = loc["latitude"]
    if doc.get("lng") is None and loc.get("longitude") is not None:
        doc["lng"] = loc["longitude"]
    if not doc.get("email") and doc.get("parent_email"):
        doc["email"] = doc["parent_email"]
    if not doc.get("phone") and doc.get("phone_number"):
        doc["phone"] = doc["phone_number"]
    # Derive needed hours from legacy sessions_per_week × session_duration_minutes
    # when the current field is missing/zero.
    if not doc.get("needed_hours_per_week"):
        spw = doc.get("sessions_per_week")
        sdm = doc.get("session_duration_minutes")
        if isinstance(spw, (int, float)) and isinstance(sdm, (int, float)) and spw > 0 and sdm > 0:
            doc["needed_hours_per_week"] = round(spw * sdm / 60.0, 2)
    if not doc.get("assigned_therapist_ids") and doc.get("assigned_rbt_id"):
        doc["assigned_therapist_ids"] = [doc["assigned_rbt_id"]]
    return doc


def _normalize_therapist_doc(doc: dict) -> dict:
    if not isinstance(doc, dict):
        return doc
    loc = doc.get("location") if isinstance(doc.get("location"), dict) else {}
    if "home_address" not in doc and loc.get("address"):
        doc["home_address"] = loc["address"]
    if doc.get("lat") is None and loc.get("latitude") is not None:
        doc["lat"] = loc["latitude"]
    if doc.get("lng") is None and loc.get("longitude") is not None:
        doc["lng"] = loc["longitude"]
    if not doc.get("phone") and doc.get("phone_number"):
        doc["phone"] = doc["phone_number"]
    if not doc.get("therapist_role"):
        doc["therapist_role"] = "bt"
    return doc


def _safe_validate_list(docs, Model, normalizer, label: str) -> list:
    """Validate a list of Mongo docs against `Model`, dropping (and logging)
    any that still fail after normalization. This keeps a single corrupt or
    legacy document from 500'ing the whole list endpoint."""
    out = []
    for d in docs:
        try:
            normalized = normalizer(d)
            out.append(Model.model_validate(normalized).model_dump())
        except Exception as e:
            logger.warning(
                "skipping invalid %s doc id=%s: %s",
                label, (d or {}).get("id"), e,
            )
    return out


# ================= ADMIN: Therapists =================
@api.post("/therapists", response_model=Therapist)
async def create_therapist(body: TherapistCreate, user: dict = Depends(require_role("admin"))):
    t = Therapist(**body.model_dump())
    coords = await geocode(db, t.home_address)
    if coords:
        t.lat, t.lng = coords
    doc = t.model_dump()
    await db.therapists.insert_one(doc.copy())
    return t


@api.get("/therapists", response_model=List[Therapist])
async def list_therapists(user: dict = Depends(require_role("admin"))):
    docs = await db.therapists.find({}, {"_id": 0}).to_list(1000)
    return _safe_validate_list(docs, Therapist, _normalize_therapist_doc, "therapist")


@api.get("/therapists/{therapist_id}", response_model=Therapist)
async def get_therapist(therapist_id: str, user: dict = Depends(get_current_user)):
    if user["role"] not in ("admin", "therapist"):
        raise HTTPException(status_code=403, detail="Forbidden")
    doc = await db.therapists.find_one({"id": therapist_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Therapist not found")
    try:
        return Therapist.model_validate(_normalize_therapist_doc(doc)).model_dump()
    except Exception as e:
        logger.warning("therapist %s failed validation: %s", therapist_id, e)
        raise HTTPException(status_code=409, detail="Therapist record is in a legacy/invalid shape")


@api.put("/therapists/{therapist_id}", response_model=Therapist)
async def update_therapist(therapist_id: str, body: TherapistCreate, user: dict = Depends(require_role("admin"))):
    existing = await db.therapists.find_one({"id": therapist_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Therapist not found")
    updates = body.model_dump()
    # re-geocode if address changed
    if updates.get("home_address") != existing.get("home_address"):
        coords = await geocode(db, updates["home_address"])
        updates["lat"], updates["lng"] = (coords if coords else (None, None))
    await db.therapists.update_one({"id": therapist_id}, {"$set": updates})
    merged = {**existing, **updates}
    return merged


@api.delete("/therapists/{therapist_id}")
async def delete_therapist(therapist_id: str, user: dict = Depends(require_role("admin"))):
    await db.therapists.delete_one({"id": therapist_id})
    await db.sessions.delete_many({"therapist_id": therapist_id})
    return {"ok": True}


# ================= ADMIN: Clients =================
@api.post("/clients", response_model=Client)
async def create_client(body: ClientCreate, user: dict = Depends(require_role("admin"))):
    c = Client(**body.model_dump())
    coords = await geocode(db, c.home_address)
    if coords:
        c.lat, c.lng = coords
    await db.clients.insert_one(c.model_dump())
    return c


@api.get("/clients", response_model=List[Client])
async def list_clients(user: dict = Depends(require_role("admin"))):
    docs = await db.clients.find({}, {"_id": 0}).to_list(1000)
    return _safe_validate_list(docs, Client, _normalize_client_doc, "client")


@api.get("/clients/{client_id}", response_model=Client)
async def get_client(client_id: str, user: dict = Depends(get_current_user)):
    if user["role"] not in ("admin", "client", "therapist"):
        raise HTTPException(status_code=403)
    doc = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Client not found")
    try:
        return Client.model_validate(_normalize_client_doc(doc)).model_dump()
    except Exception as e:
        logger.warning("client %s failed validation: %s", client_id, e)
        raise HTTPException(status_code=409, detail="Client record is in a legacy/invalid shape")


@api.put("/clients/{client_id}", response_model=Client)
async def update_client(client_id: str, body: ClientCreate, user: dict = Depends(require_role("admin"))):
    existing = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Client not found")
    updates = body.model_dump()
    if updates.get("home_address") != existing.get("home_address"):
        coords = await geocode(db, updates["home_address"])
        updates["lat"], updates["lng"] = (coords if coords else (None, None))
    await db.clients.update_one({"id": client_id}, {"$set": updates})
    return {**existing, **updates}


@api.delete("/clients/{client_id}")
async def delete_client(client_id: str, user: dict = Depends(require_role("admin"))):
    await db.clients.delete_one({"id": client_id})
    await db.sessions.delete_many({"client_id": client_id})
    return {"ok": True}


@api.post("/clients/{client_id}/end-assignment")
async def end_client_assignment(
    client_id: str,
    body: EndAssignmentRequest,
    user: dict = Depends(require_role("admin")),
):
    """Drop assignment between client and therapist; cancel future scheduled sessions for that pair."""
    tid = body.therapist_id
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    assigned = client.get("assigned_therapist_ids") or []
    if tid not in assigned:
        raise HTTPException(status_code=400, detail="Client is not assigned to this therapist")
    therapist = await db.therapists.find_one({"id": tid}, {"_id": 0})
    if not therapist:
        raise HTTPException(status_code=404, detail="Therapist not found")

    today = datetime.now(timezone.utc).date().isoformat()
    cancel_res = await db.sessions.update_many(
        {
            "client_id": client_id,
            "therapist_id": tid,
            "date": {"$gte": today},
            "status": {"$ne": "cancelled"},
        },
        {"$set": {"status": "cancelled"}},
    )
    await db.clients.update_one({"id": client_id}, {"$pull": {"assigned_therapist_ids": tid}})
    await db.therapists.update_one({"id": tid}, {"$pull": {"active_client_ids": client_id}})

    all_t = await db.sessions.find({"therapist_id": tid, "status": {"$ne": "cancelled"}}, {"_id": 0}).to_list(500)
    weekly_t = hours_scheduled(all_t) / 4.0 if all_t else 0
    await db.therapists.update_one({"id": tid}, {"$set": {"current_caseload_hours": round(weekly_t, 2)}})
    all_c = await db.sessions.find({"client_id": client_id, "status": {"$ne": "cancelled"}}, {"_id": 0}).to_list(500)
    weekly_c = hours_scheduled(all_c) / 4.0 if all_c else 0
    await db.clients.update_one({"id": client_id}, {"$set": {"scheduled_hours_per_week": round(weekly_c, 2)}})

    return {
        "ok": True,
        "sessions_marked_cancelled": cancel_res.modified_count,
    }


# ================= Matching =================
@api.post("/match", response_model=List[MatchScore])
async def match_for_client(body: MatchRequest, user: dict = Depends(require_role("admin"))):
    client = await db.clients.find_one({"id": body.client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return await match_therapists_for_client(db, client, body.max_results)


@api.post("/match/smart")
async def match_smart(body: MatchRequest, user: dict = Depends(require_role("admin"))):
    client = await db.clients.find_one({"id": body.client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return await smart_match(db, client)


@api.post("/match/confirm")
async def match_confirm(payload: dict, user: dict = Depends(require_role("admin"))):
    """Apply a smart-match option: create session blocks for each proposed_blocks entry.

    Body: {client_id, week_start_date (YYYY-MM-DD), proposed_blocks: [{therapist_id, day, start, end}, ...]}
    """
    client_id = payload.get("client_id")
    week_start = payload.get("week_start_date")
    proposed = payload.get("proposed_blocks") or []
    if not client_id or not week_start or not proposed:
        raise HTTPException(status_code=400, detail="client_id, week_start_date, and proposed_blocks are required.")
    try:
        ws = datetime.strptime(week_start, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="week_start_date must be YYYY-MM-DD")
    # Proposed block `day` is 0=Mon … 6=Sun; session_date = week_start + day must align to real weekdays.
    if ws.weekday() != 0:
        raise HTTPException(
            status_code=400,
            detail="week_start_date must be a Monday (proposed blocks use Mon=0 … Sun=6).",
        )

    created = []
    skipped = []
    therapist_ids = set()
    for blk in proposed:
        try:
            day = int(blk["day"])
            session_date = (ws + timedelta(days=day)).isoformat()
            therapist_id = blk["therapist_id"]
            new_block = {
                "therapist_id": therapist_id,
                "client_id": client_id,
                "date": session_date,
                "start_time": blk["start"],
                "end_time": blk["end"],
                "notes": blk.get("notes"),
            }
            existing = await db.sessions.find(
                {"therapist_id": therapist_id, "date": session_date, "status": {"$ne": "cancelled"}},
                {"_id": 0},
            ).to_list(100)
            errors, warnings, travel = validate_new_block(new_block, existing)
            if errors:
                skipped.append({"block": new_block, "errors": errors})
                continue
            rest, lunch = compute_session_flags(new_block)
            block = SessionBlock(
                **new_block,
                rest_break_required=rest,
                lunch_break_required=lunch,
                travel_minutes_before=travel,
            )
            await db.sessions.insert_one(block.model_dump())
            therapist_ids.add(therapist_id)
            created.append(block.model_dump())
        except Exception as e:
            skipped.append({"block": blk, "errors": [str(e)]})

    # update relationships
    for tid in therapist_ids:
        await db.therapists.update_one(
            {"id": tid},
            {"$addToSet": {"active_client_ids": client_id}},
        )
    if therapist_ids:
        await db.clients.update_one(
            {"id": client_id},
            {"$addToSet": {"assigned_therapist_ids": {"$each": list(therapist_ids)}}},
        )
    # recompute caseload hours
    for tid in therapist_ids:
        all_t = await db.sessions.find({"therapist_id": tid, "status": {"$ne": "cancelled"}}, {"_id": 0}).to_list(500)
        weekly = hours_scheduled(all_t) / 4.0 if all_t else 0
        await db.therapists.update_one({"id": tid}, {"$set": {"current_caseload_hours": round(weekly, 2)}})
    all_c = await db.sessions.find({"client_id": client_id, "status": {"$ne": "cancelled"}}, {"_id": 0}).to_list(500)
    cw = hours_scheduled(all_c) / 4.0 if all_c else 0
    await db.clients.update_one({"id": client_id}, {"$set": {"scheduled_hours_per_week": round(cw, 2)}})

    return {"created": len(created), "skipped": skipped, "sessions": created}


# ================= Sessions / Schedule =================
@api.post("/sessions", response_model=SessionBlock)
async def create_session(body: SessionBlockCreate, user: dict = Depends(require_role("admin"))):
    # fetch existing blocks for therapist same day
    existing = await db.sessions.find(
        {"therapist_id": body.therapist_id, "date": body.date, "status": {"$ne": "cancelled"}},
        {"_id": 0},
    ).to_list(100)
    new_block_dict = body.model_dump()
    errors, warnings, travel = validate_new_block(new_block_dict, existing)
    if errors:
        raise HTTPException(status_code=400, detail={"errors": errors, "warnings": warnings})
    rest, lunch = compute_session_flags(new_block_dict)

    # insurance authorized hours check
    client = await db.clients.find_one({"id": body.client_id}, {"_id": 0})
    if client and client.get("insurance", {}).get("authorized_hours_per_week", 0) > 0:
        # compute current week hours for this client
        client_blocks = await db.sessions.find({"client_id": body.client_id, "status": {"$ne": "cancelled"}}, {"_id": 0}).to_list(500)
        existing_hours = hours_scheduled(client_blocks)
        new_hours = hours_scheduled([new_block_dict])
        authorized = client["insurance"]["authorized_hours_per_week"]
        projected_weekly = (existing_hours + new_hours)
        if projected_weekly > authorized * 4:  # simple guard: sum all vs 4 wks
            warnings.append(f"Scheduled hours ({projected_weekly}) approaching/exceeding 4 weeks of authorized hours ({authorized * 4}).")

    block = SessionBlock(
        **new_block_dict,
        rest_break_required=rest,
        lunch_break_required=lunch,
        travel_minutes_before=travel,
    )
    await db.sessions.insert_one(block.model_dump())

    # update caseloads / assigned lists
    await db.therapists.update_one(
        {"id": body.therapist_id},
        {"$addToSet": {"active_client_ids": body.client_id}},
    )
    await db.clients.update_one(
        {"id": body.client_id},
        {"$addToSet": {"assigned_therapist_ids": body.therapist_id}},
    )
    # recompute caseload hours
    all_t_blocks = await db.sessions.find({"therapist_id": body.therapist_id, "status": {"$ne": "cancelled"}}, {"_id": 0}).to_list(500)
    weekly_hours = hours_scheduled(all_t_blocks) / 4.0 if all_t_blocks else 0  # assume 4 wks window average
    await db.therapists.update_one({"id": body.therapist_id}, {"$set": {"current_caseload_hours": round(weekly_hours, 2)}})
    all_c_blocks = await db.sessions.find({"client_id": body.client_id, "status": {"$ne": "cancelled"}}, {"_id": 0}).to_list(500)
    c_weekly = hours_scheduled(all_c_blocks) / 4.0 if all_c_blocks else 0
    await db.clients.update_one({"id": body.client_id}, {"$set": {"scheduled_hours_per_week": round(c_weekly, 2)}})

    return block


@api.get("/sessions", response_model=List[SessionBlock])
async def list_sessions(
    therapist_id: Optional[str] = None,
    client_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    query: dict = {}
    if user["role"] == "therapist":
        query["therapist_id"] = user.get("linked_profile_id") or "__none__"
    elif user["role"] == "client":
        query["client_id"] = user.get("linked_profile_id") or "__none__"
    else:
        if therapist_id:
            query["therapist_id"] = therapist_id
        if client_id:
            query["client_id"] = client_id
    if start_date and end_date:
        query["date"] = {"$gte": start_date, "$lte": end_date}
    docs = await db.sessions.find(query, {"_id": 0}).sort("date", 1).to_list(1000)
    return docs


@api.delete("/sessions/{session_id}")
async def delete_session(session_id: str, user: dict = Depends(require_role("admin"))):
    await db.sessions.delete_one({"id": session_id})
    return {"ok": True}


# ================= Link user to profile =================
@api.post("/users/{user_id}/link-profile")
async def link_profile(user_id: str, body: dict, admin: dict = Depends(require_role("admin"))):
    profile_id = body.get("profile_id")
    profile_type = body.get("profile_type")
    if profile_type not in ("therapist", "client", None):
        raise HTTPException(status_code=400, detail="profile_type must be therapist, client, or null")
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if profile_id:
        coll = db.therapists if profile_type == "therapist" else db.clients
        prof = await coll.find_one({"id": profile_id}, {"_id": 0})
        if not prof:
            raise HTTPException(status_code=404, detail=f"{profile_type} profile not found")
        # Sanity: role should match profile_type (warn but don't reject; admin role can link to either)
    await db.users.update_one({"id": user_id}, {"$set": {"linked_profile_id": profile_id}})
    return {"ok": True, "user_id": user_id, "linked_profile_id": profile_id}


@api.get("/users", response_model=List[UserPublic])
async def list_users(admin: dict = Depends(require_role("admin"))):
    docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
    return docs


@api.post("/users", response_model=UserPublic)
async def admin_create_user(body: dict, admin: dict = Depends(require_role("admin"))):
    """Admin creates a login account with optional immediate profile link."""
    from auth import hash_password as _hash
    import uuid as _u
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    name = (body.get("name") or "").strip()
    role = body.get("role") or "client"
    profile_id = body.get("linked_profile_id")
    if not email or not password or not name:
        raise HTTPException(status_code=400, detail="email, password, and name are required")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if role not in ("admin", "therapist", "client"):
        raise HTTPException(status_code=400, detail="Invalid role")
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    if profile_id:
        coll = db.therapists if role == "therapist" else db.clients if role == "client" else None
        if coll is None:
            raise HTTPException(status_code=400, detail="Cannot link admin to a profile")
        prof = await coll.find_one({"id": profile_id}, {"_id": 0})
        if not prof:
            raise HTTPException(status_code=404, detail=f"{role} profile not found")
    user_id = str(_u.uuid4())
    await db.users.insert_one({
        "id": user_id,
        "email": email,
        "name": name,
        "role": role,
        "password_hash": _hash(password),
        "linked_profile_id": profile_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return UserPublic(id=user_id, email=email, name=name, role=role, linked_profile_id=profile_id)


# ================= Dashboard =================
@api.get("/dashboard/stats")
async def dashboard_stats(admin: dict = Depends(require_role("admin"))):
    therapists_count = await db.therapists.count_documents({})
    clients_count = await db.clients.count_documents({})
    today = datetime.now(timezone.utc).date().isoformat()
    upcoming = await db.sessions.count_documents({"date": {"$gte": today}, "status": "scheduled"})
    unassigned = await db.clients.count_documents({"assigned_therapist_ids": {"$size": 0}})
    return {
        "therapists": therapists_count,
        "clients": clients_count,
        "upcoming_sessions": upcoming,
        "unassigned_clients": unassigned,
    }


# ================= Map (locations) =================
@api.get("/places/autocomplete")
async def places_autocomplete_endpoint(input: str = "", user: dict = Depends(get_current_user)):
    """Address typeahead — admin/therapist/client all permitted (auth-gated)."""
    if not input or len(input) < 3:
        return {"suggestions": []}
    suggestions = await places_autocomplete(input)
    return {"suggestions": suggestions}


@api.get("/locations")
async def locations(admin: dict = Depends(require_role("admin"))):
    """Return therapist + client geocoded locations for the map view."""
    therapists = await db.therapists.find({}, {"_id": 0, "id": 1, "name": 1, "lat": 1, "lng": 1, "skill_level": 1, "home_address": 1, "current_caseload_hours": 1, "capacity_hours_per_week": 1}).to_list(1000)
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1, "lat": 1, "lng": 1, "age_group": 1, "home_address": 1, "needed_hours_per_week": 1, "scheduled_hours_per_week": 1, "assigned_therapist_ids": 1}).to_list(1000)
    return {
        "therapists": [t for t in therapists if t.get("lat") is not None],
        "clients": [c for c in clients if c.get("lat") is not None],
    }


# ================= ICS Calendar Export =================
async def _ics_response(filename: str, sessions: list):
    therapists = await db.therapists.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)
    t_lookup = {t["id"]: t["name"] for t in therapists}
    c_lookup = {c["id"]: c["name"] for c in clients}
    ics = build_ics("Ohana Scheduler", sessions, t_lookup, c_lookup)
    return FastResponse(
        content=ics,
        media_type="text/calendar",
        headers={"Content-Disposition": f'attachment; filename="{filename}.ics"'},
    )


@api.get("/sessions/export.ics")
async def export_sessions_ics(
    therapist_id: Optional[str] = None,
    client_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    query: dict = {}
    if user["role"] == "therapist":
        query["therapist_id"] = user.get("linked_profile_id") or "__none__"
        filename = f"ohana-therapist-{user.get('linked_profile_id', 'me')}"
    elif user["role"] == "client":
        query["client_id"] = user.get("linked_profile_id") or "__none__"
        filename = f"ohana-client-{user.get('linked_profile_id', 'me')}"
    else:
        if therapist_id:
            query["therapist_id"] = therapist_id
            filename = f"ohana-therapist-{therapist_id}"
        elif client_id:
            query["client_id"] = client_id
            filename = f"ohana-client-{client_id}"
        else:
            filename = "ohana-all-sessions"
    sessions = await db.sessions.find(query, {"_id": 0}).sort("date", 1).to_list(2000)
    return await _ics_response(filename, sessions)


app.include_router(api)


# ================= Health & Root =================
# IMPORTANT: these MUST stay above the SPA catch-all below — FastAPI matches
# routes in registration order, and `/{full_path:path}` would otherwise shadow
# every /api/* route that isn't on the `api` router.
@app.get("/api")
async def root():
    return {"service": "Ohana Scheduler", "ok": True}


@app.get("/api/health")
async def health():
    """Liveness + DB ping. Used by ALB / EB health checks."""
    try:
        await db.command("ping")
        db_ok = True
    except Exception as e:
        db_ok = False
        logger.warning("health check db ping failed: %s", e)
    status_code = 200 if db_ok else 503
    return JSONResponse(
        status_code=status_code,
        content={"status": "UP" if db_ok else "DOWN", "db": db_ok},
    )


# ================= SPA static hosting (single-image deploy) =================
# When STATIC_DIR points at the React production build, the same FastAPI
# process serves the SPA on `/` with a deep-link fallback to index.html.
# Disabled when unset, so local dev (frontend on :3000 / :3002) is unaffected.
_static_dir = os.environ.get("STATIC_DIR")
if _static_dir:
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles

    _STATIC_PATH = Path(_static_dir).resolve()
    _INDEX_FILE = _STATIC_PATH / "index.html"

    if not _INDEX_FILE.is_file():
        logger.warning("STATIC_DIR=%s set but index.html missing; SPA hosting disabled", _static_dir)
    else:
        app.mount(
            "/static",
            StaticFiles(directory=str(_STATIC_PATH / "static")),
            name="spa-static",
        )

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa_fallback(full_path: str):
            # Never let the SPA shadow API routes or the OpenAPI docs.
            if full_path.startswith(("api", "docs", "redoc", "openapi.json")):
                raise HTTPException(status_code=404)
            candidate = (_STATIC_PATH / full_path).resolve()
            # Path-traversal guard: must stay inside the static root.
            try:
                candidate.relative_to(_STATIC_PATH)
            except ValueError:
                raise HTTPException(status_code=404)
            if candidate.is_file():
                return FileResponse(str(candidate))
            return FileResponse(str(_INDEX_FILE))


