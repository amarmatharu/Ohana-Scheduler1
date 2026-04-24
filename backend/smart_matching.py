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
    """Convert list of {day,start,end,hours?} to dict {day: {windows:[(s,e)], target_hours: float|None}}.
    target_hours is the sum of explicit hours per block on that day; None if no block specified hours."""
    by_day = {i: {"windows": [], "target_hours": None} for i in range(7)}
    for a in av_list or []:
        d = int(a.get("day", 0))
        s, e = _to_min(a["start"]), _to_min(a["end"])
        by_day[d]["windows"].append((s, e))
        h = a.get("hours")
        if h is not None and h != "":
            try:
                hf = float(h)
                if hf > 0:
                    by_day[d]["target_hours"] = (by_day[d]["target_hours"] or 0) + hf
            except (TypeError, ValueError):
                pass
    return by_day


def _windows_only(av_list):
    """Backward-compat helper: returns simple {day: [(s,e)]} for therapists."""
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
    """Return dict {day: {"blocks": [(start_min, end_min)], "target_hours": float|None}}.
    target_hours is the client's per-day target (may be None if not specified -> falls back to total)."""
    client_av = _availability_by_day(client.get("availability"))
    therapist_av = _windows_only(therapist.get("availability"))
    booked = _existing_blocks_by_day(existing_sessions)
    free = {}
    for day in range(7):
        if not therapist.get("weekend_available", False) and day >= 5:
            continue
        if not client.get("weekend_available", False) and day >= 5:
            continue
        c_av = client_av.get(day, {}).get("windows", [])
        t_av = therapist_av.get(day, [])
        if not c_av or not t_av:
            continue
        overlap = _intersect_intervals(c_av, t_av)
        free_day = _subtract_intervals(overlap, booked.get(day, []))
        if free_day:
            free[day] = {
                "blocks": _split_to_blocks(free_day),
                "target_hours": client_av.get(day, {}).get("target_hours"),
            }
    return free


async def smart_match(db, client: dict):
    """Return single-therapist options + multi-therapist options.

    Per-day targets: if client availability rows specify `hours`, the matcher
    tries to satisfy that exact daily target. Otherwise it greedily fills
    `needed_hours_per_week` across all available days.
    """
    needed_hours = float(client.get("needed_hours_per_week") or 0)
    # compute per-day targets from client availability
    client_av = _availability_by_day(client.get("availability"))
    daily_targets = {d: client_av[d]["target_hours"] for d in range(7) if client_av[d]["target_hours"] is not None}
    # If user provided per-day hours, prefer their sum as the source of truth
    if daily_targets:
        explicit_total = sum(daily_targets.values())
        if explicit_total > 0:
            needed_hours = explicit_total

    therapists = await db.therapists.find({}, {"_id": 0}).to_list(500)

    candidates = []
    for t in therapists:
        if not _therapist_meets_filters(t, client):
            continue
        sessions = await db.sessions.find({"therapist_id": t["id"], "status": {"$ne": "cancelled"}}, {"_id": 0}).to_list(500)
        free = _free_blocks_for_therapist(t, client, sessions)
        free_hours = sum((e - s) for d in free.values() for s, e in d["blocks"]) / 60.0
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
        proposed = _allocate_single_therapist(c["free"], needed_hours, daily_targets)
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
            "daily_targets": {DAYS[d]: h for d, h in daily_targets.items()} if daily_targets else None,
        })

    # Sort: fully covered first, then score
    single_options.sort(key=lambda o: (-int(o["fully_covered"]), -o["score"]))

    # ---------- Multi-therapist combinations ----------
    multi_options = []
    fully_covered_single = any(o["fully_covered"] for o in single_options)
    if not fully_covered_single and len(candidates) >= 2 and needed_hours > 0:
        multi_options = _build_multi_options(candidates, needed_hours, daily_targets)

    return {
        "client_id": client["id"],
        "client_name": client["name"],
        "needed_hours": needed_hours,
        "daily_targets": {DAYS[d]: h for d, h in daily_targets.items()} if daily_targets else None,
        "single_options": single_options[:6],
        "multi_options": multi_options[:4],
    }


def _allocate_single_therapist(free_by_day, total_needed, daily_targets):
    """If daily_targets is non-empty, allocate per day target. Otherwise greedy across days."""
    chosen = []  # (day, start, end)
    if daily_targets:
        for day, target in daily_targets.items():
            blocks = (free_by_day.get(day) or {}).get("blocks", [])
            if not blocks:
                continue
            day_chosen = _allocate_within_day(blocks, target)
            chosen.extend([(day, s, e) for s, e in day_chosen])
    else:
        # greedy across all days
        all_blocks = []
        for d, info in free_by_day.items():
            for s, e in info["blocks"]:
                all_blocks.append((d, s, e))
        chosen = _allocate_with_days(all_blocks, total_needed)
    chosen.sort(key=lambda b: (b[0], b[1]))
    return chosen


def _allocate_within_day(blocks, target_hours):
    """Allocate ~target_hours within a single day's free blocks (longest first, may split into 2)."""
    target_min = int(target_hours * 60)
    sorted_blocks = sorted(blocks, key=lambda b: -(b[1] - b[0]))
    chosen = []
    total = 0
    for s, e in sorted_blocks:
        if total >= target_min:
            break
        chunk = min(e - s, target_min - total)
        chosen.append((s, s + chunk))
        total += chunk
    chosen.sort()
    return chosen


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


def _build_multi_options(candidates, needed_hours, daily_targets=None):
    """Greedy combination: pick top-coverage candidate, fill gap from next-best, etc.
    If daily_targets is set, allocate per day; otherwise greedy across days."""
    options = []
    ranked = sorted(
        candidates,
        key=lambda c: (-(c["free_hours"]), c["meta"]["drive_minutes"] or 999),
    )
    for seed_idx in range(min(3, len(ranked))):
        used_days = {}  # day -> [(s, e)]
        team = []
        order = [seed_idx] + [i for i in range(len(ranked)) if i != seed_idx]

        if daily_targets:
            # Per-day mode: for each day, allocate that day's target across therapists
            day_remaining = dict(daily_targets)
            therapist_blocks = {i: [] for i in order}
            for i in order:
                if not any(v > 0.01 for v in day_remaining.values()):
                    break
                cand = ranked[i]
                for day, target in list(day_remaining.items()):
                    if target <= 0.01:
                        continue
                    free_today_blocks = (cand["free"].get(day) or {}).get("blocks", [])
                    used = used_days.get(day, [])
                    avail = _subtract_intervals(free_today_blocks, used)
                    if not avail:
                        continue
                    chunks = _allocate_within_day(avail, target)
                    if not chunks:
                        continue
                    covered = sum(e - s for s, e in chunks) / 60.0
                    therapist_blocks[i].extend([(day, s, e) for s, e in chunks])
                    used_days.setdefault(day, []).extend(chunks)
                    day_remaining[day] = max(0.0, target - covered)
            # build team objects
            for i in order:
                if not therapist_blocks[i]:
                    continue
                cand = ranked[i]
                blocks = therapist_blocks[i]
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
                    for d, s, e in blocks
                ]
                covered_min = sum(e - s for _, s, e in blocks)
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
            total_min = sum(sum(e - s for _, s, e in therapist_blocks[i]) for i in order)
        else:
            # Greedy mode (no per-day targets)
            target_min = int(needed_hours * 60)
            total_min = 0
            for i in order:
                if total_min >= target_min:
                    break
                cand = ranked[i]
                cand_blocks = []
                for day, info in cand["free"].items():
                    used = used_days.get(day, [])
                    free_today = _subtract_intervals(info["blocks"], used)
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
        coverage_pct = coverage_hours / needed_hours if needed_hours > 0 else 0
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
