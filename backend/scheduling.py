"""Scheduling validation: rest breaks, lunch breaks, travel time, insurance hours."""
from datetime import datetime, timedelta
from typing import List, Tuple


def _parse(date_str: str, time_str: str) -> datetime:
    return datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")


def _duration_minutes(start: datetime, end: datetime) -> int:
    return int((end - start).total_seconds() / 60)


def validate_new_block(
    new_block: dict,
    existing_blocks_same_day: List[dict],
) -> Tuple[List[str], List[str], int]:
    """Return (errors, warnings, travel_minutes_before).

    Rules:
      - Session block cannot exceed 3.5 hr (210 min) without rest break. Enforce as warning if > 210 min.
      - Total daily work > 5 hr requires lunch break (30 min gap) somewhere in day.
      - At least 30 min travel buffer between consecutive blocks for different clients (unless adjacent same client).
      - No overlaps with existing therapist blocks.
    """
    errors: List[str] = []
    warnings: List[str] = []
    travel_minutes_before = 0

    start = _parse(new_block["date"], new_block["start_time"])
    end = _parse(new_block["date"], new_block["end_time"])
    dur = _duration_minutes(start, end)

    if dur <= 0:
        errors.append("End time must be after start time.")
        return errors, warnings, 0
    if dur > 210:
        warnings.append(f"Session is {dur} min (>3.5 hrs). A mandatory rest break is required within the session.")

    # check overlaps and travel buffer
    sorted_blocks = sorted(existing_blocks_same_day, key=lambda b: b["start_time"])
    prev_end = None
    prev_client = None
    next_start = None
    next_client = None

    for b in sorted_blocks:
        bs = _parse(b["date"], b["start_time"])
        be = _parse(b["date"], b["end_time"])
        # overlap check
        if not (end <= bs or start >= be):
            errors.append(f"Overlaps existing block {b['start_time']}-{b['end_time']}.")
        if be <= start and (prev_end is None or be > prev_end):
            prev_end = be
            prev_client = b.get("client_id")
        if bs >= end and (next_start is None or bs < next_start):
            next_start = bs
            next_client = b.get("client_id")

    # travel buffer 30 min before if different client
    if prev_end is not None:
        gap_before = _duration_minutes(prev_end, start)
        if prev_client != new_block["client_id"] and gap_before < 30:
            errors.append(f"Only {gap_before} min between previous session and this one; 30 min travel buffer required.")
        travel_minutes_before = max(0, 30 if prev_client != new_block["client_id"] else 0)

    if next_start is not None:
        gap_after = _duration_minutes(end, next_start)
        if next_client != new_block["client_id"] and gap_after < 30:
            errors.append(f"Only {gap_after} min before next session; 30 min travel buffer required.")

    # daily work hours & lunch rule
    total_minutes = dur + sum(_duration_minutes(_parse(b["date"], b["start_time"]), _parse(b["date"], b["end_time"])) for b in existing_blocks_same_day)
    if total_minutes > 300:  # more than 5 hrs
        # check for any gap >= 30 min in full day timeline
        full_day = sorted(
            existing_blocks_same_day + [new_block],
            key=lambda b: b["start_time"],
        )
        has_lunch = False
        for i in range(len(full_day) - 1):
            e = _parse(full_day[i]["date"], full_day[i]["end_time"])
            s = _parse(full_day[i + 1]["date"], full_day[i + 1]["start_time"])
            if _duration_minutes(e, s) >= 30:
                has_lunch = True
                break
        if not has_lunch:
            warnings.append(f"Daily work is {total_minutes} min (>5 hrs) with no 30+ min lunch break in schedule.")

    return errors, warnings, travel_minutes_before


def compute_session_flags(new_block: dict) -> Tuple[bool, bool]:
    start = _parse(new_block["date"], new_block["start_time"])
    end = _parse(new_block["date"], new_block["end_time"])
    dur = _duration_minutes(start, end)
    rest = dur > 210
    lunch = dur > 300
    return rest, lunch


def hours_scheduled(blocks: List[dict]) -> float:
    total = 0
    for b in blocks:
        s = _parse(b["date"], b["start_time"])
        e = _parse(b["date"], b["end_time"])
        total += _duration_minutes(s, e)
    return round(total / 60.0, 2)
