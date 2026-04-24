"""Google Maps geocoding + Distance Matrix with MongoDB cache."""
import os
import httpx
import hashlib
from typing import Optional, Tuple


def _key() -> str:
    return os.environ.get("GOOGLE_MAPS_API_KEY", "")


def _hash(s: str) -> str:
    return hashlib.sha1(s.strip().lower().encode("utf-8")).hexdigest()


async def geocode(db, address: str) -> Optional[Tuple[float, float]]:
    """Return (lat, lng) for an address. Cached."""
    if not address or not _key():
        return None
    h = _hash(address)
    cached = await db.geocode_cache.find_one({"_id": h})
    if cached and cached.get("lat") is not None:
        return cached["lat"], cached["lng"]
    url = "https://maps.googleapis.com/maps/api/geocode/json"
    params = {"address": address, "key": _key()}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, params=params)
            data = r.json()
        if data.get("status") == "OK" and data.get("results"):
            loc = data["results"][0]["geometry"]["location"]
            lat, lng = loc["lat"], loc["lng"]
            await db.geocode_cache.update_one(
                {"_id": h},
                {"$set": {"address": address, "lat": lat, "lng": lng}},
                upsert=True,
            )
            return lat, lng
    except Exception as e:
        print(f"[geocode] error: {e}")
    return None


async def distance_matrix(db, origin: Tuple[float, float], destination: Tuple[float, float]) -> Optional[dict]:
    """Return {distance_km, duration_minutes} for driving. Cached."""
    if not _key():
        return None
    o_str = f"{origin[0]:.5f},{origin[1]:.5f}"
    d_str = f"{destination[0]:.5f},{destination[1]:.5f}"
    key = f"{o_str}|{d_str}"
    h = _hash(key)
    cached = await db.distance_cache.find_one({"_id": h})
    if cached and cached.get("distance_km") is not None:
        return {"distance_km": cached["distance_km"], "duration_minutes": cached["duration_minutes"]}
    url = "https://maps.googleapis.com/maps/api/distancematrix/json"
    params = {
        "origins": o_str,
        "destinations": d_str,
        "mode": "driving",
        "units": "metric",
        "key": _key(),
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, params=params)
            data = r.json()
        rows = data.get("rows", [])
        if rows and rows[0].get("elements"):
            el = rows[0]["elements"][0]
            if el.get("status") == "OK":
                distance_km = el["distance"]["value"] / 1000.0
                duration_minutes = el["duration"]["value"] / 60.0
                await db.distance_cache.update_one(
                    {"_id": h},
                    {"$set": {"distance_km": distance_km, "duration_minutes": duration_minutes}},
                    upsert=True,
                )
                return {"distance_km": distance_km, "duration_minutes": duration_minutes}
    except Exception as e:
        print(f"[distance_matrix] error: {e}")
    return None


def haversine_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    """Straight-line distance in km as fallback."""
    from math import radians, sin, cos, asin, sqrt
    lat1, lon1, lat2, lon2 = map(radians, [a[0], a[1], b[0], b[1]])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    aa = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * 6371.0 * asin(sqrt(aa))
