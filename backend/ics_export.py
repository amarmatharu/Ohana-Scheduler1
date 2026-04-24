"""ICS calendar export utilities."""
from datetime import datetime
from typing import List
import uuid


def _fmt_dt(date_str: str, time_str: str) -> str:
    """YYYY-MM-DD + HH:MM -> YYYYMMDDTHHMMSS (local floating)."""
    dt = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
    return dt.strftime("%Y%m%dT%H%M%S")


def _esc(s: str) -> str:
    if not s:
        return ""
    return s.replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")


def build_ics(calendar_name: str, sessions: List[dict], therapist_lookup: dict, client_lookup: dict) -> str:
    """Build an iCalendar (.ics) feed."""
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Ohana Scheduler//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_esc(calendar_name)}",
    ]
    now_stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    for s in sessions:
        therapist_name = therapist_lookup.get(s.get("therapist_id"), "Therapist")
        client_name = client_lookup.get(s.get("client_id"), "Client")
        summary = f"{client_name} ↔ {therapist_name}"
        desc_parts = []
        if s.get("rest_break_required"):
            desc_parts.append("Mandatory rest break required (>3.5 hrs)")
        if s.get("lunch_break_required"):
            desc_parts.append("Lunch break required")
        if s.get("travel_minutes_before"):
            desc_parts.append(f"{s['travel_minutes_before']} min travel buffer before")
        if s.get("notes"):
            desc_parts.append(s["notes"])
        description = " | ".join(desc_parts)
        uid = f"{s.get('id', uuid.uuid4().hex)}@ohana.scheduler"
        lines.extend([
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{now_stamp}",
            f"DTSTART:{_fmt_dt(s['date'], s['start_time'])}",
            f"DTEND:{_fmt_dt(s['date'], s['end_time'])}",
            f"SUMMARY:{_esc(summary)}",
            f"DESCRIPTION:{_esc(description)}",
            f"STATUS:{'CANCELLED' if s.get('status') == 'cancelled' else 'CONFIRMED'}",
            "END:VEVENT",
        ])
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"
