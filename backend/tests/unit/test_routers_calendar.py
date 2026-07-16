"""Tests for GET /calendar — verifies person budgets and booked hours in response."""


def _setup(client):
    """Create project (Jan 2026), person, membership, milestones; return (project_id, person_id)."""
    proj = client.post("/projects", json={
        "project_number": "CAL001",
        "name": "Calendar Test Project",
        "start_date": "2026-01-01",
        "end_date": "2026-01-31",
        "total_budget_euros": 16000.0,
        "total_budget_hours": 160.0,
    }).json()
    person = client.post("/persons", json={
        "name": "Cal Person",
        "sage_employee_name": "Cal Person",
        "default_weekly_hours": 40.0,
    }).json()
    client.post(f"/projects/{proj['id']}/memberships", json={
        "person_id": person["id"],
        "from_date": "2026-01-01",
        "to_date": "2026-01-31",
        "weekly_capacity_hours": 40.0,
        "billing_rate_per_hour": 90.0,
    })
    r_init = client.post(f"/projects/{proj['id']}/milestones/initialize")
    assert r_init.status_code == 201, f"Milestone init failed: {r_init.text}"
    return proj["id"], person["id"]


def test_calendar_milestone_has_budgets_field(client):
    """GET /calendar must return milestones with a budgets list."""
    _setup(client)
    r = client.get("/calendar?year=2026&month=1")
    assert r.status_code == 200
    data = r.json()
    assert "milestones" in data
    assert len(data["milestones"]) >= 1
    ms = data["milestones"][0]
    assert "budgets" in ms, "milestones[].budgets must be present (needed by frontend calendar)"
    assert isinstance(ms["budgets"], list)


def test_calendar_milestone_budgets_contain_person_hours(client):
    """Each budget entry must have person_id, current_hours, and booked_hours."""
    proj_id, person_id = _setup(client)
    r = client.get("/calendar?year=2026&month=1")
    assert r.status_code == 200
    milestones = r.json()["milestones"]
    ms = next((m for m in milestones if m["project_id"] == proj_id), None)
    assert ms is not None, f"No milestone found for project {proj_id}"
    assert len(ms["budgets"]) >= 1, "Milestone must have at least one person budget after init with member"
    budget = ms["budgets"][0]
    assert "person_id" in budget
    assert "current_hours" in budget
    assert "booked_hours" in budget
    assert isinstance(budget["current_hours"], float)
    assert isinstance(budget["booked_hours"], float)
    assert budget["person_id"] == person_id


def test_calendar_milestone_budgets_hours_positive(client):
    """Budget current_hours must be > 0 for an active member."""
    proj_id, _ = _setup(client)
    r = client.get("/calendar?year=2026&month=1")
    ms = next(m for m in r.json()["milestones"] if m["project_id"] == proj_id)
    assert ms["budgets"][0]["current_hours"] > 0


def test_calendar_milestone_booked_hours_zero_without_bookings(client):
    """booked_hours must be 0.0 when no time bookings exist."""
    proj_id, _ = _setup(client)
    r = client.get("/calendar?year=2026&month=1")
    ms = next(m for m in r.json()["milestones"] if m["project_id"] == proj_id)
    assert ms["budgets"][0]["booked_hours"] == 0.0


def test_calendar_no_milestones_returns_empty_list(client):
    """When no milestones exist for a month, milestones list is empty."""
    r = client.get("/calendar?year=2026&month=1")
    assert r.status_code == 200
    assert r.json()["milestones"] == []


# ── Year view (absence calendar) ──────────────────────────────────────────────

def test_calendar_year_returns_persons_and_default_region(client):
    """GET /calendar/year returns all persons and defaults the region to DE/BY."""
    person = client.post("/persons", json={
        "name": "Year Person",
        "sage_employee_name": "Year Person",
        "default_weekly_hours": 40.0,
    }).json()
    r = client.get("/calendar/year?year=2026")
    assert r.status_code == 200
    data = r.json()
    assert data["year"] == 2026
    assert data["country"] == "DE"
    assert data["state"] == "BY"
    assert isinstance(data["holidays"], list)
    assert any(p["id"] == person["id"] for p in data["persons"])


def test_calendar_year_includes_overlapping_absence(client):
    """An absence within the year appears on the person; one outside does not."""
    person = client.post("/persons", json={
        "name": "Abs Person",
        "sage_employee_name": "Abs Person",
        "default_weekly_hours": 40.0,
    }).json()
    # Absence inside 2026 (spanning a month boundary)
    client.post(f"/persons/{person['id']}/absences", json={
        "start_date": "2026-01-28",
        "end_date": "2026-02-03",
        "absence_type": "vacation",
        "status": "confirmed",
        "note": "",
    })
    # Absence entirely in 2025 — must not appear in the 2026 view
    client.post(f"/persons/{person['id']}/absences", json={
        "start_date": "2025-03-01",
        "end_date": "2025-03-05",
        "absence_type": "vacation",
        "status": "confirmed",
        "note": "",
    })
    r = client.get("/calendar/year?year=2026")
    assert r.status_code == 200
    p = next(p for p in r.json()["persons"] if p["id"] == person["id"])
    starts = {a["start_date"] for a in p["absences"]}
    assert "2026-01-28" in starts
    assert "2025-03-01" not in starts


def test_calendar_year_region_override_via_query(client):
    """Region query params override the resolved default."""
    r = client.get("/calendar/year?year=2026&country=DE&state=BW")
    assert r.status_code == 200
    data = r.json()
    assert data["country"] == "DE"
    assert data["state"] == "BW"


def test_calendar_year_region_reads_settings(client, session):
    """Without query params, the region comes from the Setting store."""
    from app.models.setting import Setting

    session.add(Setting(key="holiday_state", value="BW"))
    session.commit()
    r = client.get("/calendar/year?year=2026")
    assert r.status_code == 200
    assert r.json()["state"] == "BW"


def test_calendar_year_injects_active_extra_holiday(client, session):
    """An activated optional local holiday appears in the holiday list."""
    from app.models.setting import Setting

    session.add(Setting(key="holiday_extra", value="mariae_himmelfahrt"))
    session.commit()
    r = client.get("/calendar/year?year=2026")
    assert r.status_code == 200
    dates = {h["holiday_date"] for h in r.json()["holidays"]}
    assert "2026-08-15" in dates


def test_calendar_year_ignores_unknown_extra_key(client, session):
    """Unknown extra keys are ignored (no crash, no bogus holiday)."""
    from app.models.setting import Setting

    session.add(Setting(key="holiday_extra", value="not_a_real_holiday"))
    session.commit()
    r = client.get("/calendar/year?year=2026")
    assert r.status_code == 200
