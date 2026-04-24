"""Backend test suite for Ohana Scheduler.

Covers: auth (login/register/me/logout), therapists CRUD + geocoding,
clients CRUD + geocoding, matching engine, sessions validation
(overlap/travel/rest/lunch), insurance hour tracking, RBAC, dashboard.
"""
import os
import time
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://intake-to-assignment.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@ohana.health"
ADMIN_PASSWORD = "Admin@Ohana2026"


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=20)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="session")
def created_ids():
    return {"therapists": [], "clients": [], "sessions": [], "users": []}


# ============ AUTH ============
class TestAuth:
    def test_root(self):
        r = requests.get(f"{BASE_URL}/api", timeout=10)
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_login_admin(self):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["email"] == ADMIN_EMAIL
        assert data["role"] == "admin"
        # Verify cookies set
        cookie_names = [c.name for c in s.cookies]
        assert "access_token" in cookie_names
        assert "refresh_token" in cookie_names

    def test_login_invalid_password(self):
        # use fresh session & unique ip-like identifier (we can't control IP, so keep to 1 bad try)
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong_pw_xxx"}, timeout=15)
        assert r.status_code in (401, 429)

    def test_me_endpoint(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert r.status_code == 200
        assert r.json()["role"] == "admin"

    def test_me_unauthenticated(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", timeout=10)
        assert r.status_code == 401

    def test_register_therapist_user(self, created_ids):
        email = f"test_therapist_{uuid.uuid4().hex[:8]}@ohana.health"
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "Secure@12345", "name": "Test Therapist User", "role": "therapist"
        }, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["role"] == "therapist"
        assert data["email"] == email
        created_ids["users"].append(data["id"])
        # cookie set -> can call /me
        me = s.get(f"{BASE_URL}/api/auth/me", timeout=10)
        assert me.status_code == 200
        assert me.json()["role"] == "therapist"


# ============ THERAPISTS ============
class TestTherapists:
    def test_create_therapist_with_geocode(self, admin_session, created_ids):
        payload = {
            "name": "TEST_Dr. Jane Smith",
            "email": f"jane_{uuid.uuid4().hex[:6]}@ohana.health",
            "gender": "female",
            "skill_level": "experienced",
            "skills": ["aba", "autism"],
            "home_address": "1600 Amphitheatre Parkway, Mountain View, CA",
            "capacity_hours_per_week": 30,
            "availability": [{"day": 0, "start": "09:00", "end": "17:00"},
                             {"day": 1, "start": "09:00", "end": "17:00"}],
        }
        r = admin_session.post(f"{BASE_URL}/api/therapists", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["name"] == payload["name"]
        assert t["lat"] is not None, "Geocoding failed - lat is None"
        assert t["lng"] is not None, "Geocoding failed - lng is None"
        created_ids["therapists"].append(t["id"])

    def test_list_therapists_admin(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/therapists", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        assert len(r.json()) >= 1

    def test_update_therapist_regeocode(self, admin_session, created_ids):
        assert created_ids["therapists"], "Need a created therapist"
        tid = created_ids["therapists"][0]
        # get existing
        get_r = admin_session.get(f"{BASE_URL}/api/therapists/{tid}", timeout=10)
        assert get_r.status_code == 200
        existing = get_r.json()
        new_address = "1 Infinite Loop, Cupertino, CA"
        payload = {
            "name": existing["name"],
            "email": existing["email"],
            "gender": existing["gender"],
            "skill_level": existing["skill_level"],
            "skills": existing["skills"],
            "home_address": new_address,
            "capacity_hours_per_week": existing["capacity_hours_per_week"],
            "availability": existing["availability"],
            "weekend_available": existing.get("weekend_available", False),
        }
        r = admin_session.put(f"{BASE_URL}/api/therapists/{tid}", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        # verify re-geocoded via GET
        g = admin_session.get(f"{BASE_URL}/api/therapists/{tid}", timeout=10).json()
        assert g["home_address"] == new_address
        assert g["lat"] is not None

    def test_non_admin_cannot_create_therapist(self):
        # create a client user
        email = f"client_{uuid.uuid4().hex[:6]}@ohana.health"
        s = requests.Session()
        reg = s.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "Secure@12345", "name": "Client User", "role": "client"
        }, timeout=15)
        assert reg.status_code == 200
        # try create therapist
        r = s.post(f"{BASE_URL}/api/therapists", json={
            "name": "blocked", "email": "x@x.com", "home_address": "SF, CA"
        }, timeout=15)
        assert r.status_code == 403


# ============ CLIENTS ============
class TestClients:
    def test_create_client(self, admin_session, created_ids):
        payload = {
            "name": "TEST_Little Timmy",
            "age_group": "child",
            "gender_preference": "no_preference",
            "skill_required": "experienced",
            "home_address": "1355 Market St, San Francisco, CA",
            "other_services": ["speech", "occupational"],
            "insurance": {"plan": "BlueCross", "authorized_hours_per_week": 20},
            "needed_hours_per_week": 15,
            "availability": [{"day": 0, "start": "09:00", "end": "17:00"},
                             {"day": 1, "start": "09:00", "end": "17:00"}],
        }
        r = admin_session.post(f"{BASE_URL}/api/clients", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["insurance"]["plan"] == "BlueCross"
        assert c["insurance"]["authorized_hours_per_week"] == 20
        assert "speech" in c["other_services"]
        assert c["lat"] is not None
        created_ids["clients"].append(c["id"])

    def test_list_clients(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/clients", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ============ MATCHING ============
class TestMatching:
    def test_match_returns_scored_list(self, admin_session, created_ids):
        assert created_ids["clients"], "need client"
        cid = created_ids["clients"][0]
        r = admin_session.post(f"{BASE_URL}/api/match", json={"client_id": cid, "max_results": 5}, timeout=60)
        assert r.status_code == 200, r.text
        matches = r.json()
        assert isinstance(matches, list)
        assert len(matches) >= 1
        m = matches[0]
        # all score keys exist
        for k in ("total_score", "proximity_score", "skill_score", "capacity_score", "gender_score",
                  "relationship_boost", "therapist_id", "therapist_name"):
            assert k in m, f"Missing key {k}"
        # verify weighting: total ≈ 0.4*prox + 0.25*skill + 0.15*cap + 0.10*gender + 0.10*rel
        expected = (0.40 * m["proximity_score"] + 0.25 * m["skill_score"] +
                    0.15 * m["capacity_score"] + 0.10 * m["gender_score"] +
                    0.10 * m["relationship_boost"])
        assert abs(m["total_score"] - expected) < 0.5, f"Weighting mismatch: got {m['total_score']} vs {expected}"
        # drive_minutes should be populated when both geocoded
        assert m.get("drive_minutes") is not None, "drive_minutes should be populated via Google Maps"


# ============ SESSIONS ============
class TestSessions:
    def test_create_session_and_overlap_rejection(self, admin_session, created_ids):
        tid = created_ids["therapists"][0]
        cid = created_ids["clients"][0]
        # future monday date
        import datetime as dt
        d = dt.date.today()
        # find next Monday
        while d.weekday() != 0:
            d += dt.timedelta(days=1)
        date_str = d.isoformat()

        s1 = admin_session.post(f"{BASE_URL}/api/sessions", json={
            "therapist_id": tid, "client_id": cid, "date": date_str,
            "start_time": "09:00", "end_time": "11:00"
        }, timeout=30)
        assert s1.status_code == 200, s1.text
        created_ids["sessions"].append(s1.json()["id"])

        # Overlap — should 400
        s2 = admin_session.post(f"{BASE_URL}/api/sessions", json={
            "therapist_id": tid, "client_id": cid, "date": date_str,
            "start_time": "10:00", "end_time": "12:00"
        }, timeout=30)
        assert s2.status_code == 400, s2.text
        body = s2.json()
        assert "detail" in body and "errors" in body["detail"]

    def test_long_session_flags_rest_break(self, admin_session, created_ids):
        tid = created_ids["therapists"][0]
        cid = created_ids["clients"][0]
        import datetime as dt
        d = dt.date.today()
        while d.weekday() != 2:  # wednesday to avoid monday conflict
            d += dt.timedelta(days=1)
        r = admin_session.post(f"{BASE_URL}/api/sessions", json={
            "therapist_id": tid, "client_id": cid, "date": d.isoformat(),
            "start_time": "09:00", "end_time": "13:00"  # 4 hrs
        }, timeout=30)
        assert r.status_code == 200, r.text
        sb = r.json()
        assert sb["rest_break_required"] is True, "4hr session should require rest break (>3.5h)"
        created_ids["sessions"].append(sb["id"])

    def test_list_sessions_with_filter(self, admin_session, created_ids):
        tid = created_ids["therapists"][0]
        r = admin_session.get(f"{BASE_URL}/api/sessions?therapist_id={tid}&start_date=2025-01-01&end_date=2030-01-01", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert all(s["therapist_id"] == tid for s in data)

    def test_client_scheduled_hours_updated(self, admin_session, created_ids):
        cid = created_ids["clients"][0]
        r = admin_session.get(f"{BASE_URL}/api/clients/{cid}", timeout=15)
        assert r.status_code == 200
        c = r.json()
        assert c["scheduled_hours_per_week"] > 0, "scheduled_hours_per_week should be >0 after creating sessions"


# ============ DASHBOARD ============
class TestDashboard:
    def test_stats(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/dashboard/stats", timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ("therapists", "clients", "upcoming_sessions", "unassigned_clients"):
            assert k in d
        assert d["therapists"] >= 1
        assert d["clients"] >= 1


# ============ CLEANUP ============
class TestZZCleanup:
    """Runs last — delete test data."""
    def test_cleanup(self, admin_session, created_ids):
        for sid in created_ids["sessions"]:
            admin_session.delete(f"{BASE_URL}/api/sessions/{sid}", timeout=10)
        for tid in created_ids["therapists"]:
            admin_session.delete(f"{BASE_URL}/api/therapists/{tid}", timeout=10)
        for cid in created_ids["clients"]:
            admin_session.delete(f"{BASE_URL}/api/clients/{cid}", timeout=10)
