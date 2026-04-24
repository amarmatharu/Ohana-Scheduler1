"""Ohana Scheduler — FastAPI main server."""
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import FastAPI, APIRouter, Depends, HTTPException, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient

from models import (
    TherapistCreate, Therapist,
    ClientCreate, Client,
    SessionBlockCreate, SessionBlock,
    MatchRequest, MatchScore,
    UserPublic,
)
from auth import build_auth_router, seed_admin, hash_password
from maps_service import geocode
from matching import match_therapists_for_client
from scheduling import validate_new_block, compute_session_flags, hours_scheduled


# ---- DB ----
mongo_url = os.environ["MONGO_URL"]
mongo_client = AsyncIOMotorClient(mongo_url)
db = mongo_client[os.environ["DB_NAME"]]


app = FastAPI(title="Ohana Scheduler")

# Frontend URL for CORS credentials
_frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[_frontend_url, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

auth_router, get_current_user, require_role = build_auth_router(db)
app.include_router(auth_router)

api = APIRouter(prefix="/api")


# ---- Utility ----
def _clean(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


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
    return docs


@api.get("/therapists/{therapist_id}", response_model=Therapist)
async def get_therapist(therapist_id: str, user: dict = Depends(get_current_user)):
    if user["role"] not in ("admin", "therapist"):
        raise HTTPException(status_code=403, detail="Forbidden")
    doc = await db.therapists.find_one({"id": therapist_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Therapist not found")
    return doc


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
    return docs


@api.get("/clients/{client_id}", response_model=Client)
async def get_client(client_id: str, user: dict = Depends(get_current_user)):
    if user["role"] not in ("admin", "client", "therapist"):
        raise HTTPException(status_code=403)
    doc = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Client not found")
    return doc


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


# ================= Matching =================
@api.post("/match", response_model=List[MatchScore])
async def match_for_client(body: MatchRequest, user: dict = Depends(require_role("admin"))):
    client = await db.clients.find_one({"id": body.client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return await match_therapists_for_client(db, client, body.max_results)


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
async def link_profile(user_id: str, profile_id: str, profile_type: str, admin: dict = Depends(require_role("admin"))):
    if profile_type not in ("therapist", "client"):
        raise HTTPException(status_code=400, detail="profile_type must be therapist or client")
    await db.users.update_one({"id": user_id}, {"$set": {"linked_profile_id": profile_id}})
    return {"ok": True}


@api.get("/users", response_model=List[UserPublic])
async def list_users(admin: dict = Depends(require_role("admin"))):
    docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
    return docs


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


app.include_router(api)


# ================= Startup =================
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ohana")


@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.therapists.create_index("id", unique=True)
    await db.clients.create_index("id", unique=True)
    await db.sessions.create_index("id", unique=True)
    await db.sessions.create_index([("therapist_id", 1), ("date", 1)])
    await db.sessions.create_index([("client_id", 1), ("date", 1)])
    await seed_admin(db)
    logger.info("Ohana Scheduler startup complete")


@app.on_event("shutdown")
async def on_shutdown():
    mongo_client.close()


@app.get("/api")
async def root():
    return {"service": "Ohana Scheduler", "ok": True}
