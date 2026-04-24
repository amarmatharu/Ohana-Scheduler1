"""Matching engine: score therapists for a given client."""
from typing import List
from models import MatchScore
from maps_service import distance_matrix, haversine_km


SKILL_ORDER = {"entry": 1, "intermediate": 2, "experienced": 3}


def _skill_score(required: str, actual: str) -> float:
    req = SKILL_ORDER.get(required, 2)
    act = SKILL_ORDER.get(actual, 2)
    if act >= req:
        # exact match perfect; higher ok but slightly less ideal (overqualified)
        if act == req:
            return 1.0
        return 0.8
    # underqualified
    return 0.3


def _proximity_score(drive_minutes: float) -> float:
    # 0 min=1.0, 60+min=0.0
    if drive_minutes is None:
        return 0.0
    if drive_minutes <= 5:
        return 1.0
    if drive_minutes >= 60:
        return 0.0
    return max(0.0, 1.0 - (drive_minutes - 5) / 55.0)


def _capacity_score(available_hours: float, needed: float) -> float:
    if needed <= 0:
        return 0.5
    if available_hours <= 0:
        return 0.0
    if available_hours >= needed:
        return 1.0
    return available_hours / needed


def _gender_score(pref: str, actual: str) -> float:
    if pref == "no_preference" or pref is None:
        return 1.0
    if pref == actual:
        return 1.0
    return 0.4


async def match_therapists_for_client(db, client: dict, max_results: int = 10) -> List[MatchScore]:
    therapists = await db.therapists.find({}, {"_id": 0}).to_list(500)
    results: List[MatchScore] = []

    client_loc = None
    if client.get("lat") is not None and client.get("lng") is not None:
        client_loc = (client["lat"], client["lng"])

    for t in therapists:
        reasons = []
        # proximity
        drive_min = None
        distance_km = None
        if client_loc and t.get("lat") is not None and t.get("lng") is not None:
            t_loc = (t["lat"], t["lng"])
            dm = await distance_matrix(db, t_loc, client_loc)
            if dm:
                drive_min = dm["duration_minutes"]
                distance_km = dm["distance_km"]
            else:
                distance_km = haversine_km(t_loc, client_loc)
                drive_min = distance_km * 1.8  # rough estimate
        prox = _proximity_score(drive_min) if drive_min is not None else 0.3

        # skill
        skill = _skill_score(client.get("skill_required", "intermediate"), t.get("skill_level", "intermediate"))

        # capacity
        cap_total = float(t.get("capacity_hours_per_week", 0))
        cap_used = float(t.get("current_caseload_hours", 0))
        available = max(0.0, cap_total - cap_used)
        cap = _capacity_score(available, float(client.get("needed_hours_per_week", 0)))

        # gender
        gen = _gender_score(client.get("gender_preference", "no_preference"), t.get("gender", "no_preference"))

        # existing relationship boost
        rel_boost = 1.0 if client["id"] in t.get("active_client_ids", []) else 0.0
        if rel_boost:
            reasons.append("Existing therapist-client relationship")

        if prox >= 0.8:
            reasons.append("Nearby location")
        if skill >= 1.0:
            reasons.append("Skill level match")
        if cap >= 1.0:
            reasons.append("Full capacity available")
        elif cap >= 0.5:
            reasons.append("Partial capacity available")
        if gen >= 1.0 and client.get("gender_preference", "no_preference") != "no_preference":
            reasons.append("Gender preference match")

        total = (
            prox * 0.40
            + skill * 0.25
            + cap * 0.15
            + gen * 0.10
            + rel_boost * 0.10
        )

        results.append(MatchScore(
            therapist_id=t["id"],
            therapist_name=t["name"],
            total_score=round(total * 100, 1),
            proximity_score=round(prox * 100, 1),
            skill_score=round(skill * 100, 1),
            capacity_score=round(cap * 100, 1),
            gender_score=round(gen * 100, 1),
            relationship_boost=round(rel_boost * 100, 1),
            distance_km=round(distance_km, 2) if distance_km is not None else None,
            drive_minutes=round(drive_min, 1) if drive_min is not None else None,
            available_hours=round(available, 1),
            skill_level=t.get("skill_level", "intermediate"),
            reasons=reasons,
        ))

    results.sort(key=lambda x: x.total_score, reverse=True)
    return results[:max_results]
