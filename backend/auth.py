"""Auth module: JWT httpOnly cookies + bcrypt + role-based access + admin seed.

Cookie flags are environment-driven:
  COOKIE_SAMESITE  one of {lax, strict, none}     default: lax
  COOKIE_SECURE    "true" / "false"               default: true
  COOKIE_DOMAIN    optional shared parent domain  default: unset (host-only)

CSRF defense uses the double-submit cookie pattern:
  - On login/register/refresh, the server sets a non-httpOnly `csrf_token` cookie.
  - The frontend reads that cookie and echoes it in the `X-CSRF-Token` header on
    state-changing requests. The server middleware (in server.py) verifies them.
"""
import os
import secrets
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, Request, Response, HTTPException, Depends

from models import RegisterRequest, LoginRequest, UserPublic

JWT_ALGORITHM = "HS256"
ACCESS_TTL_SECONDS = 60 * 60          # 1 hour
REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60  # 7 days
CSRF_COOKIE_NAME = "csrf_token"
ACCESS_COOKIE_NAME = "access_token"
REFRESH_COOKIE_NAME = "refresh_token"


def _secret() -> str:
    return os.environ["JWT_SECRET"]


def _cookie_flags() -> dict:
    samesite = os.environ.get("COOKIE_SAMESITE", "lax").lower()
    if samesite not in ("lax", "strict", "none"):
        samesite = "lax"
    secure = os.environ.get("COOKIE_SECURE", "true").lower() == "true"
    flags = {"samesite": samesite, "secure": secure, "path": "/"}
    domain = os.environ.get("COOKIE_DOMAIN")
    if domain:
        flags["domain"] = domain
    return flags


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(seconds=ACCESS_TTL_SECONDS),
        "type": "access",
    }
    return jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(seconds=REFRESH_TTL_SECONDS),
        "type": "refresh",
    }
    return jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)


def _new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def _set_session_cookies(resp: Response, access: str, refresh: str, csrf: str):
    flags = _cookie_flags()
    resp.set_cookie(ACCESS_COOKIE_NAME, access, httponly=True, max_age=ACCESS_TTL_SECONDS, **flags)
    resp.set_cookie(REFRESH_COOKIE_NAME, refresh, httponly=True, max_age=REFRESH_TTL_SECONDS, **flags)
    # CSRF cookie must be readable by JS so the SPA can echo it as a header.
    csrf_flags = {**flags, "httponly": False}
    resp.set_cookie(CSRF_COOKIE_NAME, csrf, max_age=REFRESH_TTL_SECONDS, **csrf_flags)


def _clear_session_cookies(resp: Response):
    flags = _cookie_flags()
    # delete_cookie supports path/domain/samesite/secure to ensure the right cookie is targeted.
    for name in (ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME, CSRF_COOKIE_NAME):
        resp.delete_cookie(name, path="/", domain=flags.get("domain"))


def build_auth_router(db):
    router = APIRouter(prefix="/api/auth", tags=["auth"])

    async def _brute_force_check(identifier: str):
        rec = await db.login_attempts.find_one({"_id": identifier})
        if rec and rec.get("count", 0) >= 5:
            last = rec.get("last_at")
            if last:
                last_dt = datetime.fromisoformat(last)
                if datetime.now(timezone.utc) - last_dt < timedelta(minutes=15):
                    raise HTTPException(
                        status_code=429,
                        detail="Too many failed attempts. Try again in 15 minutes.",
                    )
                else:
                    await db.login_attempts.delete_one({"_id": identifier})

    async def _log_failed(identifier: str):
        # `expires_at` is a real Date so the Mongo TTL index (created in server.py
        # startup) reaps stale entries even if no one ever retries.
        now = datetime.now(timezone.utc)
        await db.login_attempts.update_one(
            {"_id": identifier},
            {
                "$inc": {"count": 1},
                "$set": {
                    "last_at": now.isoformat(),
                    "expires_at": now + timedelta(minutes=15),
                },
            },
            upsert=True,
        )

    async def _log_audit(user_id: Optional[str], action: str, meta: dict):
        await db.audit_logs.insert_one({
            "user_id": user_id,
            "action": action,
            "meta": meta,
            "at": datetime.now(timezone.utc).isoformat(),
        })

    async def get_current_user(request: Request) -> dict:
        token = request.cookies.get(ACCESS_COOKIE_NAME)
        if not token:
            auth = request.headers.get("Authorization", "")
            if auth.startswith("Bearer "):
                token = auth[7:]
        if not token:
            # ?token= is allowed only for read-only file downloads (ICS export); the
            # CSRF middleware blocks state-changing requests that arrive this way.
            token = request.query_params.get("token")
        if not token:
            raise HTTPException(status_code=401, detail="Not authenticated")
        try:
            payload = jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
            if payload.get("type") != "access":
                raise HTTPException(status_code=401, detail="Invalid token")
            user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
            if not user:
                raise HTTPException(status_code=401, detail="User not found")
            return user
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token expired")
        except jwt.InvalidTokenError:
            raise HTTPException(status_code=401, detail="Invalid token")

    def require_role(*roles: str):
        async def dep(user: dict = Depends(get_current_user)):
            if user["role"] not in roles:
                raise HTTPException(status_code=403, detail="Insufficient permissions")
            return user
        return dep

    @router.post("/register", response_model=UserPublic)
    async def register(body: RegisterRequest, response: Response):
        email = body.email.lower()
        existing = await db.users.find_one({"email": email})
        if existing:
            raise HTTPException(status_code=409, detail="Email already registered")
        import uuid as _u
        user_id = str(_u.uuid4())
        doc = {
            "id": user_id,
            "email": email,
            "name": body.name,
            "role": body.role,
            "password_hash": hash_password(body.password),
            "linked_profile_id": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.users.insert_one(doc)
        access = create_access_token(user_id, email, body.role)
        refresh = create_refresh_token(user_id)
        csrf = _new_csrf_token()
        _set_session_cookies(response, access, refresh, csrf)
        response.headers["X-Access-Token"] = access
        await _log_audit(user_id, "register", {"role": body.role})
        return UserPublic(id=user_id, email=email, name=body.name, role=body.role)

    @router.post("/login", response_model=UserPublic)
    async def login(body: LoginRequest, request: Request, response: Response):
        email = body.email.lower()
        ip = request.client.host if request.client else "unknown"
        identifier = f"{ip}:{email}"
        await _brute_force_check(identifier)
        user = await db.users.find_one({"email": email})
        if not user or not verify_password(body.password, user["password_hash"]):
            await _log_failed(identifier)
            raise HTTPException(status_code=401, detail="Invalid email or password")
        await db.login_attempts.delete_one({"_id": identifier})
        access = create_access_token(user["id"], user["email"], user["role"])
        refresh = create_refresh_token(user["id"])
        csrf = _new_csrf_token()
        _set_session_cookies(response, access, refresh, csrf)
        response.headers["X-Access-Token"] = access
        await _log_audit(user["id"], "login", {"ip": ip})
        return UserPublic(
            id=user["id"],
            email=user["email"],
            name=user["name"],
            role=user["role"],
            linked_profile_id=user.get("linked_profile_id"),
        )

    @router.post("/logout")
    async def logout(response: Response, user: dict = Depends(get_current_user)):
        _clear_session_cookies(response)
        await _log_audit(user["id"], "logout", {})
        return {"ok": True}

    @router.get("/me", response_model=UserPublic)
    async def me(user: dict = Depends(get_current_user)):
        return UserPublic(
            id=user["id"],
            email=user["email"],
            name=user["name"],
            role=user["role"],
            linked_profile_id=user.get("linked_profile_id"),
        )

    @router.post("/refresh")
    async def refresh(request: Request, response: Response):
        token = request.cookies.get(REFRESH_COOKIE_NAME)
        if not token:
            raise HTTPException(status_code=401, detail="No refresh token")
        try:
            payload = jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
            if payload.get("type") != "refresh":
                raise HTTPException(status_code=401, detail="Invalid token")
            user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
            if not user:
                raise HTTPException(status_code=401, detail="User not found")
            access = create_access_token(user["id"], user["email"], user["role"])
            new_refresh = create_refresh_token(user["id"])
            csrf = _new_csrf_token()
            _set_session_cookies(response, access, new_refresh, csrf)
            response.headers["X-Access-Token"] = access
            return {"ok": True}
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Refresh token expired")
        except jwt.InvalidTokenError:
            raise HTTPException(status_code=401, detail="Invalid token")

    return router, get_current_user, require_role


async def seed_admin(db):
    """Seed the bootstrap admin from env vars.

    SAFETY: in production set ADMIN_PASSWORD to a unique secret. The fallback
    here exists only so a fresh dev container boots cleanly.
    """
    email = os.environ.get("ADMIN_EMAIL", "admin@ohana.health").lower()
    password = os.environ.get("ADMIN_PASSWORD", "Admin@Ohana2026")
    existing = await db.users.find_one({"email": email})
    if existing is None:
        import uuid as _u
        await db.users.insert_one({
            "id": str(_u.uuid4()),
            "email": email,
            "name": "Ohana Admin",
            "role": "admin",
            "password_hash": hash_password(password),
            "linked_profile_id": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    elif not verify_password(password, existing["password_hash"]):
        await db.users.update_one(
            {"email": email}, {"$set": {"password_hash": hash_password(password)}}
        )
