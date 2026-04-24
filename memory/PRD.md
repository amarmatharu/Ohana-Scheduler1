# Ohana Scheduler — PRD

## Problem Statement
A HIPAA-conscious therapist-client scheduling platform that matches clinical staff to clients by proximity, skill, capacity, and gender preference while enforcing mandatory rest breaks, lunch breaks, and travel-time buffers. Three roles: Admin, Therapist, Client.

## Architecture
- **Backend**: FastAPI (modular) + MongoDB (Motor async). Auth: JWT in httpOnly cookies + bcrypt + brute-force lockout. Real Google Maps integration (Geocoding + Distance Matrix) with MongoDB caching.
- **Frontend**: React 19 + React Router 7 + shadcn/ui + Tailwind. Earthy forest-green palette (Outfit headings, Manrope body, JetBrains Mono for times).
- **Services**: supervisor-managed `backend` (8001) + `frontend` (3000).

## User Personas
1. **Admin** — clinical coordinator who onboards clients/therapists, runs matching, builds schedules, monitors insurance authorization.
2. **Therapist** — views only their own weekly schedule.
3. **Client** — views their own appointments.

## Core Requirements (Static)
- Collect: client availability/demographics/insurance + therapist capacity/skills/home location.
- Enforce: rest break if session > 3.5 hr; lunch break if daily work > 5 hr; 30-min travel buffer between different clients.
- Prioritize existing therapist-client relationships over theoretical efficiency.
- Manual updates only (no external calendar sync).
- HIPAA-conscious: httpOnly cookies, bcrypt, audit logs, brute-force guard.

## Implemented (2026-02-15)
- [x] JWT auth with admin seeding, login/register/logout/refresh, RBAC decorator, brute-force (5 attempts / 15 min)
- [x] Therapist CRUD + Google Maps geocoding (lat/lng auto-populated)
- [x] Client CRUD + insurance authorization + concurrent services + availability grid
- [x] Matching engine: weighted scoring (prox 40%, skill 25%, capacity 15%, gender 10%, relationship 10%) using real driving time
- [x] Session builder with overlap/rest/lunch/travel validation
- [x] Admin dashboard (stats + upcoming sessions)
- [x] Weekly schedule grid (CSS grid, 30-min accurate blocks, flags for rest/lunch/travel)
- [x] Insurance authorization tracker with utilization bars
- [x] Therapist portal (my schedule) & Client portal (my appointments)

## P1 Backlog
- Admin UI to link user accounts ↔ therapist/client profiles (API exists; UI pending)
- Google Maps visual view with markers for therapist homes & clients
- Audit log viewer for admins
- Email/SMS notifications for new session assignments
- Bulk CSV import for initial therapist/client data

## P2 Backlog
- Calendar export (ICS download)
- Shift templates (block schedules like 3-5pm / 5:30-7:30pm)
- Per-week (rolling window) insurance utilization view
- Therapist day-of-week caseload heatmap
- Multi-tenant support for multiple clinics

## Known Constraints
- MongoDB Atlas (user-provided) SSL handshake fails from the pod IP (whitelist 0.0.0.0/0 or the pod egress IP in Atlas Network Access). Currently running against local MongoDB. Switch back by updating `backend/.env MONGO_URL` once Atlas access is granted.
- Google Maps Distance Matrix is called per-therapist per match; distances are cached by rounded lat/lng pair in `distance_cache` collection.
