"""
Seed the database with fictional demo data.
Uses entirely made-up names, project numbers, and billing figures.

Usage:
    python scripts/seed.py [--base-url http://localhost:8000]
"""
import argparse
import sys
import httpx

# Force UTF-8 output on Windows
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default="http://localhost:8000")
args = parser.parse_args()
BASE = args.base_url.rstrip("/")

client = httpx.Client(base_url=BASE, timeout=10)


def post(path: str, data: dict) -> dict | None:
    r = client.post(path, json=data)
    if r.status_code in (200, 201):
        return r.json()
    if r.status_code in (409, 422):
        try:
            detail = r.json().get("detail", r.text)
        except Exception:
            detail = r.text
        print(f"  [skip] POST {path} -> {r.status_code} ({detail})")
        return None
    print(f"  ERROR {r.status_code} on POST {path}: {r.text}", file=sys.stderr)
    sys.exit(1)


def info(msg: str) -> None:
    print(f"  {msg}")


print("\n=== ProjektPlanner Seed ===\n")

# Persons
print("Personen...")
p1 = post("/persons", {"name": "Anna Bauer", "sage_employee_name": "Bauer, Anna", "default_weekly_hours": 40})
if p1:
    info(f"Person #{p1['id']}: {p1['name']}")

p2 = post("/persons", {"name": "Thomas Schmidt", "sage_employee_name": "Schmidt, Thomas", "default_weekly_hours": 30})
if p2:
    info(f"Person #{p2['id']}: {p2['name']}")

# Fetch persons list to get IDs even if already existed
persons_resp = client.get("/persons").json()
p1 = next((p for p in persons_resp if p["sage_employee_name"] == "Bauer, Anna"), None)
p2 = next((p for p in persons_resp if p["sage_employee_name"] == "Schmidt, Thomas"), None)
if not p1 or not p2:
    print("ERROR: Required persons not found after creation.", file=sys.stderr)
    sys.exit(1)

# Programs
print("\nProgramme...")
prog = post("/programs", {"program_number": "PRG-001", "name": "Acme Analytics Program", "customer": "Acme Corp"})
if prog:
    info(f"Programm #{prog['id']}: {prog['program_number']}")
progs = client.get("/programs").json()
prog = next((p for p in progs if p["program_number"] == "PRG-001"), None)
if not prog:
    print("ERROR: Program PRG-001 not found.", file=sys.stderr)
    sys.exit(1)

# Projects
print("\nProjekte...")
r = post("/projects", {
    "project_number": "PRJ-001",
    "name": "Acme Analytics 2026a",
    "description": "Development and analysis of the analytics platform (phase 2026a)",
    "start_date": "2026-04-01",
    "end_date": "2026-09-30",
    "total_budget_hours": 600,
    "total_budget_euros": 54000,
    "holiday_country": "DE",
    "holiday_state": "BY",
    "status": "active",
    "program_id": prog["id"],
})
if r:
    info(f"Projekt #{r['id']}: {r['project_number']}")

r2 = post("/projects", {
    "project_number": "PRJ-002",
    "name": "Acme Analytics 2025b",
    "description": "Development and analysis of the analytics platform (phase 2025b)",
    "start_date": "2025-07-01",
    "end_date": "2025-12-31",
    "total_budget_hours": 480,
    "total_budget_euros": 43200,
    "holiday_country": "DE",
    "holiday_state": "BY",
    "status": "completed",
    "program_id": prog["id"],
})
if r2:
    info(f"Projekt #{r2['id']}: {r2['project_number']}")

projects_resp = client.get("/projects").json()
proj = next((p for p in projects_resp if p["project_number"] == "PRJ-001"), None)
proj2 = next((p for p in projects_resp if p["project_number"] == "PRJ-002"), None)
if not proj or not proj2:
    print("ERROR: Projects not found after creation.", file=sys.stderr)
    sys.exit(1)

# Memberships
print("\nMitgliedschaften...")
m = post(f"/projects/{proj['id']}/memberships", {
    "person_id": p1["id"],
    "from_date": "2026-04-01",
    "to_date": "2026-09-30",
    "weekly_capacity_hours": 28,
    "billing_rate_per_hour": 90.0,
})
if m:
    info(f"  {p1['name']} -> PRJ-001 (28h/Woche, 90 EUR/h)")

m = post(f"/projects/{proj['id']}/memberships", {
    "person_id": p2["id"],
    "from_date": "2026-05-01",
    "to_date": "2026-09-30",
    "weekly_capacity_hours": 12,
    "billing_rate_per_hour": 80.0,
})
if m:
    info(f"  {p2['name']} -> PRJ-001 (12h/Woche, 80 EUR/h)")

m = post(f"/projects/{proj2['id']}/memberships", {
    "person_id": p1["id"],
    "from_date": "2025-07-01",
    "to_date": "2025-12-31",
    "weekly_capacity_hours": 28,
    "billing_rate_per_hour": 90.0,
})
if m:
    info(f"  {p1['name']} -> PRJ-002 (28h/Woche, 90 EUR/h)")

# Billing Positions
print("\nAbrechnungspositionen...")
bp1 = post(f"/projects/{proj['id']}/billing-positions", {
    "position_number": "PSP-001",
    "description": "Engineering & Entwicklung",
    "budget_euros": 50000.0,
})
if bp1:
    info(f"  {bp1['position_number']} - {bp1['description']}")

bp2 = post(f"/projects/{proj['id']}/billing-positions", {
    "position_number": "PSP-002",
    "description": "Analyse & Konzeption",
    "budget_euros": 4000.0,
})
if bp2:
    info(f"  {bp2['position_number']} - {bp2['description']}")

# Sage Mappings
print("\nSage-Mappings...")
sm = post("/sage-project-mappings", {
    "sage_project_name": "PRJ-001 Acme Analytics 2026a",
    "project_id": proj["id"],
})
if sm:
    info(f"  '{sm['sage_project_name']}' -> #{proj['id']}")

sm = post("/sage-project-mappings", {
    "sage_project_name": "PRJ-002 Acme Analytics 2025b",
    "project_id": proj2["id"],
})
if sm:
    info(f"  '{sm['sage_project_name']}' -> #{proj2['id']}")

# Milestones
print("\nMeilensteine initialisieren...")
ms = client.post(f"/projects/{proj['id']}/milestones/initialize")
if ms.status_code == 201:
    info(f"  {len(ms.json())} Meilensteine erstellt fuer PRJ-001")
else:
    info(f"  Hinweis: {ms.status_code} (bereits initialisiert?)")

print("\nSeed abgeschlossen.\n")
