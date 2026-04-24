"""Smart matching: availability-based, tries single therapist first then multi-therapist combos."""
from typing import List, Optional
from datetime import datetime, timedelta, date
from maps_service import distance_matrix, haversine_km

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MAX_BLOCK_HOURS = 3.5  # max length without rest break
TRAVEL_BUFFER_MIN = 30


def _to_min(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def _to_hhmm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def _intersect_intervals(a, b):
    """Intersect two lists of (start_min, end_min). Returns merged list."""
    result = []
    for s1, e1 in a:
        for s2, e2 in b:
            s, e = max(s1, s2), min(e1, e2)
            if e - s >= 60:  # min 60-min usable interval
                result.append((s, e))
    return result


def _subtract_intervals(intervals, blocks):
    """Subtract blocks (with travel buffer) from intervals."""
    out = []
    for s, e in intervals:
        cur = [(s, e)]
        for bs, be in blocks:
            bs_buf = bs - TRAVEL_BUFFER_MIN
            be_buf = be + TRAVEL_BUFFER_MIN
            new = []
            for cs, ce in cur:
                if be_buf <= cs or bs_buf >= ce:
                    new.append((cs, ce))
                else:
                    if bs_buf > cs:
                        new.append((cs, bs_buf))
                    if be_buf < ce:
                        new.append((be_buf, ce))
            cur = new
        out.extend([(cs, ce) for cs, ce in cur if ce - cs >= 60])
    return out


def _split_to_blocks(intervals, max_hours=MAX_BLOCK_HOURS):
    """Split intervals into blocks no longer than max_hours."""
    max_min = int(max_hours * 60)
    blocks = []
    for s, e in intervals:
        cur = s
        while cur < e:
            chunk_end = min(cur + max_min, e)
            blocks.append((cur, chunk_end))
            cur = chunk_end
    return blocks


def _allocate(blocks, hours_needed):
    """Pick blocks adding up to hours_needed (fewer/larger blocks preferred)."""
    target_min = int(hours_needed * 60)
    sorted_blocks = sorted(blocks, key=lambda b: -(b[1] - b[0]))  # longest first
    chosen = []
    total = 0
    for b in sorted_blocks:
        if total >= target_min:
            break
        chunk = min(b[1] - b[0], target_min - total)
        chosen.append((b[0], b[0] + chunk))
        total += chunk
    return chosen, total


def _availability_by_day(av_list):
    """Convert list of {day,start,end} to dict {day: [(start_min, end_min)]}"""
    by_day = {i: [] for i in range(7)}
    for a in av_list or []:
        d = int(a.get("day", 0))
        by_day.setdefault(d, []).append((_to_min(a["start"]), _to_min(a["end"])))
    return by_day


def _existing_blocks_by_day(sessions, week_start_date: Optional[date] = None):
    """Group existing therapist sessions by day-of-week (0..6)."""
    by_day = {i: [] for i in range(7)}
    for s in sessions:
        if s.get("status") == "cancelled":
            continue
        try:
            sd = datetime.strptime(s["date"], "%Y-%m-%d").date()
        except Exception:
            continue
        # Filter to current week if specified
        if week_start_date is not None:
            if sd < week_start_date or sd >= week_start_date + timedelta(days=7):
                continue
        wd = sd.weekday()
        by_day.setdefault(wd, []).append((_to_min(s["start_time"]), _to_min(s["end_time"])))
    return by_day


SKILL_ORDER = {"entry": 1, "intermediate": 2, "experienced": 3}


def _therapist_meets_filters(therapist, client) -> bool:
    """Hard filters: skill level adequate + gender preference."""
    req_skill = SKILL_ORDER.get(client.get("skill_required", "intermediate"), 2)
    act_skill = SKILL_ORDER.get(therapist.get("skill_level", "intermediate"), 2)
    if act_skill < req_skill:
        return False
    pref = client.get("gender_preference", "no_preference")
    if pref and pref != "no_preference" and therapist.get("gender") not in (pref, "no_preference"):
        return False
    return True


async def _therapist_score_meta(db, therapist, client):
    """Compute drive_minutes, distance_km, relationship boost, etc."""
    drive_min, distance_km = None, None
    if client.get("lat") and client.get("lng") and therapist.get("lat") and therapist.get("lng"):
        dm = await distance_matrix(db, (therapist["lat"], therapist["lng"]), (client["lat"], client["lng"]))
        if dm:
            drive_min = dm["duration_minutes"]
            distance_km = dm["distance_km"]
        else:
            distance_km = haversine_km((therapist["lat"], therapist["lng"]), (client["lat"], client["lng"]))
            drive_min = distance_km * 1.8
    is_existing = client["id"] in (therapist.get("active_client_ids") or [])
    return {"drive_minutes": drive_min, "distance_km": distance_km, "is_existing_relationship": is_existing}


def _compose_score(coverage_pct: float, drive_min: Optional[float], is_existing: bool, gender_match: bool) -> float:
    cov = max(0.0, min(1.0, coverage_pct))
    prox = 1.0 if drive_min is None else max(0.0, 1.0 - max(0, drive_min - 5) / 55.0)
    rel = 1.0 if is_existing else 0.0
    gen = 1.0 if gender_match else 0.6
    # weights — coverage is the primary driver now
    return round((cov * 0.55 + prox * 0.20 + rel * 0.15 + gen * 0.10) * 100, 1)


def _free_blocks_for_therapist(therapist, client, existing_sessions):
    """Return dict {day: [(start_min, end_min)]} of free blocks where client+therapist availability overlap."""
    client_av = _availability_by_day(client.get("availability"))
    therapist_av = _availability_by_day(therapist.get("availability"))
    booked = _existing_blocks_by_day(existing_sessions)
    free = {}
    for day in range(7):
        if not therapist.get("weekend_available", False) and day >= 5:
            continue
        if not client.get("weekend_available", False) and day >= 5:
            continue
        c_av = client_av.get(day, [])
        t_av = therapist_av.get(day, [])
        if not c_av or not t_av:
            continue
        overlap = _intersect_intervals(c_av, t_av)
        free_day = _subtract_intervals(overlap, booked.get(day, []))
        if free_day:
            free[day] = _split_to_blocks(free_day)
    return free


async def smart_match(db, client: dict):
    """Return single-therapist options + multi-therapist options.

    Each option contains:
      - therapist_id, therapist_name (single) or list of therapists (multi)
      - proposed_blocks: list of {day, day_label, start, end, hours, therapist_id, therapist_name}
      - coverage_hours, gap_hours, score, drive_minutes, skill_match, gender_match, is_existing_relationship
    """
    needed_hours = float(client.get("needed_hours_per_week") or 0)
    therapists = await db.therapists.find({}, {"_id": 0}).to_list(500)

    candidates = []
    for t in therapists:
        if not _therapist_meets_filters(t, client):
            continue
        sessions = await db.sessions.find({"therapist_id": t["id"], "status": {"$ne": "cancelled"}}, {"_id": 0}).to_list(500)
        free = _free_blocks_for_therapist(t, client, sessions)
        free_hours = sum((e - s) for day_blocks in free.values() for s, e in day_blocks) / 60.0
        if free_hours <= 0:
            continue
        meta = await _therapist_score_meta(db, t, client)
        gender_match = (
            client.get("gender_preference", "no_preference") == "no_preference"
            or t.get("gender") == client.get("gender_preference")
        )
        candidates.append({
            "therapist": t,
            "free": free,
            "free_hours": free_hours,
            "meta": meta,
            "gender_match": gender_match,
        })

    # ---------- Single therapist options ----------
    single_options = []
    for c in candidates:
        # Allocate up to needed_hours from this therapist's free blocks
        all_blocks = []
        # Sort by day to allocate earliest days first
        for day in sorted(c["free"].keys()):
            for s, e in c["free"][day]:
                all_blocks.append((day, s, e))
        proposed = _allocate_with_days(all_blocks, needed_hours)
        coverage_min = sum(e - s for _, s, e in proposed)
        coverage_hours = coverage_min / 60.0
        if coverage_hours <= 0:
            continue
        coverage_pct = coverage_hours / needed_hours if needed_hours > 0 else 1.0
        score = _compose_score(coverage_pct, c["meta"]["drive_minutes"], c["meta"]["is_existing_relationship"], c["gender_match"])
        single_options.append({
            "type": "single",
            "therapists": [{
                "therapist_id": c["therapist"]["id"],
                "therapist_name": c["therapist"]["name"],
                "skill_level": c["therapist"].get("skill_level"),
                "gender": c["therapist"].get("gender"),
                "drive_minutes": c["meta"]["drive_minutes"],
                "distance_km": c["meta"]["distance_km"],
                "is_existing_relationship": c["meta"]["is_existing_relationship"],
                "available_hours": round(c["free_hours"], 1),
                "covered_hours": round(coverage_hours, 1),
            }],
            "proposed_blocks": [
                {
                    "therapist_id": c["therapist"]["id"],
                    "therapist_name": c["therapist"]["name"],
                    "day": d,
                    "day_label": DAYS[d],
                    "start": _to_hhmm(s),
                    "end": _to_hhmm(e),
                    "hours": round((e - s) / 60.0, 2),
                }
                for d, s, e in proposed
            ],
            "coverage_hours": round(coverage_hours, 2),
            "needed_hours": needed_hours,
            "gap_hours": round(max(0.0, needed_hours - coverage_hours), 2),
            "fully_covered": coverage_hours >= needed_hours - 0.01,
            "score": score,
            "tags": _tags(c, coverage_hours >= needed_hours - 0.01),
        })

    # Sort: fully covered first, then score
    single_options.sort(key=lambda o: (-int(o["fully_covered"]), -o["score"]))

    # ---------- Multi-therapist combinations ----------
    multi_options = []
    fully_covered_single = any(o["fully_covered"] for o in single_options)
    if not fully_covered_single and len(candidates) >= 2 and needed_hours > 0:
        multi_options = _build_multi_options(candidates, needed_hours)

    return {
        "client_id": client["id"],
        "client_name": client["name"],
        "needed_hours": needed_hours,
        "single_options": single_options[:6],
        "multi_options": multi_options[:4],
    }


def _allocate_with_days(blocks_with_day, hours_needed):
    """Allocate (day, start, end) blocks until hours_needed satisfied, longest first."""
    target_min = int(hours_needed * 60)
    sorted_blocks = sorted(blocks_with_day, key=lambda b: -(b[2] - b[1]))
    chosen = []
    total = 0
    for d, s, e in sorted_blocks:
        if total >= target_min:
            break
        chunk = min(e - s, target_min - total)
        chosen.append((d, s, s + chunk))
        total += chunk
    # Sort chronologically by day then start
    chosen.sort(key=lambda b: (b[0], b[1]))
    return chosen


def _tags(c, fully_covered):
    tags = []
    if fully_covered:
        tags.append("Full coverage")
    else:
        tags.append("Partial coverage")
    if c["meta"]["is_existing_relationship"]:
        tags.append("Existing relationship")
    if c["gender_match"]:
        tags.append("Gender preference match")
    if c["meta"]["drive_minutes"] is not None and c["meta"]["drive_minutes"] <= 15:
        tags.append("Nearby")
    return tags


def _build_multi_options(candidates, needed_hours):
    """Greedy combination: pick top-coverage candidate, fill gap from next-best, etc."""
    options = []
    # Sort candidates by free_hours desc + proximity
    ranked = sorted(
        candidates,
        key=lambda c: (-(c["free_hours"]), c["meta"]["drive_minutes"] or 999),
    )
    # Try a few seed combinations
    for seed_idx in range(min(3, len(ranked))):
        used_days = {}  # day -> list of (start, end)
        team = []
        target_min = int(needed_hours * 60)
        total_min = 0
        # Try adding therapists one by one
        order = [seed_idx] + [i for i in range(len(ranked)) if i != seed_idx]
        for i in order:
            if total_min >= target_min:
                break
            cand = ranked[i]
            # collect cand's blocks excluding days already saturated
            cand_blocks = []
            for day, blocks in cand["free"].items():
                used = used_days.get(day, [])
                free_today = _subtract_intervals(blocks, used)
                for s, e in free_today:
                    cand_blocks.append((day, s, e))
            chosen = _allocate_with_days(cand_blocks, (target_min - total_min) / 60.0)
            if not chosen:
                continue
            blocks_assigned = [
                {
                    "therapist_id": cand["therapist"]["id"],
                    "therapist_name": cand["therapist"]["name"],
                    "day": d,
                    "day_label": DAYS[d],
                    "start": _to_hhmm(s),
                    "end": _to_hhmm(e),
                    "hours": round((e - s) / 60.0, 2),
                }
                for d, s, e in chosen
            ]
            covered_min = sum(e - s for _, s, e in chosen)
            total_min += covered_min
            for d, s, e in chosen:
                used_days.setdefault(d, []).append((s, e))
            team.append({
                "therapist_id": cand["therapist"]["id"],
                "therapist_name": cand["therapist"]["name"],
                "skill_level": cand["therapist"].get("skill_level"),
                "gender": cand["therapist"].get("gender"),
                "drive_minutes": cand["meta"]["drive_minutes"],
                "distance_km": cand["meta"]["distance_km"],
                "is_existing_relationship": cand["meta"]["is_existing_relationship"],
                "covered_hours": round(covered_min / 60.0, 2),
                "blocks": blocks_assigned,
            })
        if not team or len(team) < 2:
            continue
        coverage_hours = total_min / 60.0
        coverage_pct = coverage_hours / needed_hours
        # Combined score: coverage + best therapist's proximity
        avg_drive = sum((t["drive_minutes"] or 30) for t in team) / len(team)
        prox = max(0.0, 1.0 - max(0, avg_drive - 5) / 55.0)
        any_existing = any(t["is_existing_relationship"] for t in team)
        score = round((min(coverage_pct, 1.0) * 0.55 + prox * 0.20 + (1.0 if any_existing else 0.0) * 0.15 + 1.0 * 0.10) * 100, 1)
        all_blocks = []
        for tm in team:
            all_blocks.extend(tm["blocks"])
        all_blocks.sort(key=lambda b: (b["day"], b["start"]))
        options.append({
            "type": "multi",
            "therapists": [{k: v for k, v in t.items() if k != "blocks"} for t in team],
            "proposed_blocks": all_blocks,
            "coverage_hours": round(coverage_hours, 2),
            "needed_hours": needed_hours,
            "gap_hours": round(max(0.0, needed_hours - coverage_hours), 2),
            "fully_covered": coverage_hours >= needed_hours - 0.01,
            "score": score,
            "tags": (["Full coverage" if coverage_hours >= needed_hours - 0.01 else "Partial coverage"]
                    + (["Existing relationship"] if any_existing else [])
                    + [f"{len(team)} therapists"]),
        })
    # de-dup by therapist set
    seen = set()
    unique = []
    for o in options:
        key = tuple(sorted(t["therapist_id"] for t in o["therapists"]))
        if key in seen:
            continue
        seen.add(key)
        unique.append(o)
    unique.sort(key=lambda o: (-int(o["fully_covered"]), -o["score"]))
    return unique
