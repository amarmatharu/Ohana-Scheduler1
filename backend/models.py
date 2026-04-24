"""Pydantic models for Ohana Scheduler."""
from pydantic import BaseModel, Field, EmailStr, ConfigDict
from typing import Optional, List, Literal
from datetime import datetime, timezone
import uuid


def _now():
    return datetime.now(timezone.utc).isoformat()


def _uid():
    return str(uuid.uuid4())


Role = Literal["admin", "therapist", "client"]
SkillLevel = Literal["entry", "intermediate", "experienced"]
Gender = Literal["male", "female", "nonbinary", "no_preference"]
AgeGroup = Literal["child", "adolescent", "adult", "senior"]


# ---------- Auth / User ----------
class UserPublic(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    email: EmailStr
    name: str
    role: Role
    linked_profile_id: Optional[str] = None  # therapist_id or client_id if role matches


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str
    role: Role = "client"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


# ---------- Therapist ----------
class AvailabilityBlock(BaseModel):
    """Weekly recurring availability. day: 0=Mon..6=Sun. Times are 'HH:MM'."""
    day: int = Field(ge=0, le=6)
    start: str
    end: str


class TherapistCreate(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = None
    gender: Gender = "no_preference"
    skill_level: SkillLevel = "intermediate"
    skills: List[str] = Field(default_factory=list)
    home_address: str
    capacity_hours_per_week: float = 30.0
    availability: List[AvailabilityBlock] = Field(default_factory=list)
    weekend_available: bool = False
    notes: Optional[str] = None


class Therapist(TherapistCreate):
    id: str = Field(default_factory=_uid)
    lat: Optional[float] = None
    lng: Optional[float] = None
    current_caseload_hours: float = 0.0
    active_client_ids: List[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=_now)


# ---------- Client ----------
class InsuranceInfo(BaseModel):
    plan: str = ""
    authorized_hours_per_week: float = 0.0
    authorization_start: Optional[str] = None  # ISO date
    authorization_end: Optional[str] = None


class ClientCreate(BaseModel):
    name: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    date_of_birth: Optional[str] = None
    age_group: AgeGroup = "child"
    gender_preference: Gender = "no_preference"
    skill_required: SkillLevel = "intermediate"
    home_address: str
    availability: List[AvailabilityBlock] = Field(default_factory=list)
    weekend_available: bool = False
    other_services: List[str] = Field(default_factory=list)  # ["speech","occupational"]
    insurance: InsuranceInfo = Field(default_factory=InsuranceInfo)
    needed_hours_per_week: float = 10.0
    notes: Optional[str] = None


class Client(ClientCreate):
    id: str = Field(default_factory=_uid)
    lat: Optional[float] = None
    lng: Optional[float] = None
    assigned_therapist_ids: List[str] = Field(default_factory=list)
    scheduled_hours_per_week: float = 0.0
    created_at: str = Field(default_factory=_now)


# ---------- Sessions / Blocks ----------
class SessionBlockCreate(BaseModel):
    therapist_id: str
    client_id: str
    date: str  # YYYY-MM-DD
    start_time: str  # HH:MM
    end_time: str
    notes: Optional[str] = None


class SessionBlock(SessionBlockCreate):
    id: str = Field(default_factory=_uid)
    status: Literal["scheduled", "completed", "cancelled"] = "scheduled"
    rest_break_required: bool = False
    lunch_break_required: bool = False
    travel_minutes_before: int = 0
    created_at: str = Field(default_factory=_now)


# ---------- Matching ----------
class MatchRequest(BaseModel):
    client_id: str
    max_results: int = 10


class MatchScore(BaseModel):
    therapist_id: str
    therapist_name: str
    total_score: float
    proximity_score: float
    skill_score: float
    capacity_score: float
    gender_score: float
    relationship_boost: float
    distance_km: Optional[float] = None
    drive_minutes: Optional[float] = None
    available_hours: float
    skill_level: str
    reasons: List[str] = Field(default_factory=list)
