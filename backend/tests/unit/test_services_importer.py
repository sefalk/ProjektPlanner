"""Unit tests for the Sage ERP import service."""
from datetime import date

import pytest
from hypothesis import given, settings as h_settings
from hypothesis import strategies as st

from app.models.billing import BillingPosition
from app.models.membership import ProjectMembership
from app.models.person import Person
from app.models.project import Project
from app.models.timebooking import SagePositionMapping, SageProjectMapping, TimeBooking
from app.services.importer import (
    FUZZY_THRESHOLD,
    ImportResult,
    ParseError,
    UnmatchedPersonsError,
    UnresolvedPositionsError,
    UnresolvedProjectsError,
    fuzzy_match_persons,
    import_bookings,
    parse_rows,
    resolve_project_mappings,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_person(session, name="Max Mustermann"):
    p = Person(name=name, sage_employee_name=name, default_weekly_hours=40.0)
    session.add(p)
    session.flush()
    return p


def _make_project(session, number="P00001"):
    proj = Project(
        project_number=number,
        name=f"Project {number}",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 12, 31),
        total_budget_euros=50000.0,
        total_budget_hours=500.0,
    )
    session.add(proj)
    session.flush()
    return proj


def _make_mapping(session, sage_name, project_id):
    m = SageProjectMapping(sage_project_name=sage_name, project_id=project_id)
    session.add(m)
    session.flush()
    return m


def _csv(rows: list[dict], delimiter: str = ";", date_fmt: str = "%d.%m.%Y") -> str:
    """Build a minimal Sage CSV string from a list of row dicts."""
    header = delimiter.join([
        "Buchungsdatum", "Mitarbeiter", "Sage-Projekt",
        "Projektebene", "Nettozeit", "Dauer", "Pause",
    ])
    lines = [header]
    for r in rows:
        d = r["booking_date"]
        lines.append(delimiter.join([
            d.strftime(date_fmt),
            r["sage_employee_name"],
            r["sage_project_name"],
            r["sage_project_level"],
            str(r["net_hours"]),
            r.get("duration_raw", ""),
            r.get("break_duration", ""),
        ]))
    return "\n".join(lines)


_ROW = {
    "booking_date": date(2026, 1, 15),
    "sage_employee_name": "Max Mustermann",
    "sage_project_name": "P00001 Analytics",
    "sage_project_level": "Development",
    "net_hours": 4.5,
    "duration_raw": "4:30h",
    "break_duration": "0:30h",
}


# ---------------------------------------------------------------------------
# parse_rows — delimiter and date format
# ---------------------------------------------------------------------------


def test_parse_rows_semicolon_german_date():
    rows = parse_rows(_csv([_ROW], delimiter=";", date_fmt="%d.%m.%Y"))
    assert len(rows) == 1
    assert rows[0]["booking_date"] == date(2026, 1, 15)
    assert rows[0]["net_hours"] == 4.5


def test_parse_rows_comma_iso_date():
    rows = parse_rows(_csv([_ROW], delimiter=",", date_fmt="%Y-%m-%d"))
    assert rows[0]["booking_date"] == date(2026, 1, 15)


def test_parse_rows_bytes_with_bom():
    content = _csv([_ROW])
    rows = parse_rows(b"\xef\xbb\xbf" + content.encode("utf-8"))
    assert rows[0]["sage_employee_name"] == "Max Mustermann"


def test_parse_rows_decimal_comma():
    row = {**_ROW, "net_hours": 4.5}
    csv_str = _csv([row])
    csv_str = csv_str.replace("4.5", "4,5")
    rows = parse_rows(csv_str)
    assert rows[0]["net_hours"] == 4.5


def test_parse_rows_empty_content():
    with pytest.raises(ParseError, match="No data rows"):
        parse_rows("Buchungsdatum;Mitarbeiter;Sage-Projekt;Projektebene;Nettozeit")


def test_parse_rows_missing_required_column():
    csv_str = "Datum;Mitarbeiter;Sage-Projekt;Projektebene\n01.01.2026;Max;P1;Dev"
    with pytest.raises(ParseError, match="Missing required columns"):
        parse_rows(csv_str)


def test_parse_rows_bad_date_raises():
    csv_str = "Buchungsdatum;Mitarbeiter;Sage-Projekt;Projektebene;Nettozeit\nnot-a-date;Max;P1;Dev;4.0"
    with pytest.raises(ParseError) as exc_info:
        parse_rows(csv_str)
    assert exc_info.value.details
    assert "Cannot parse date" in exc_info.value.details[0].message


def test_parse_rows_bad_hours_raises():
    csv_str = "Buchungsdatum;Mitarbeiter;Sage-Projekt;Projektebene;Nettozeit\n01.01.2026;Max;P1;Dev;abc"
    with pytest.raises(ParseError):
        parse_rows(csv_str)


def test_parse_rows_optional_columns_default_empty():
    csv_str = "Buchungsdatum;Mitarbeiter;Sage-Projekt;Projektebene;Nettozeit\n01.01.2026;Max;P1;Dev;4.0"
    rows = parse_rows(csv_str)
    assert rows[0]["duration_raw"] == ""
    assert rows[0]["break_duration"] == ""


def test_parse_rows_english_column_names():
    csv_str = "date,employee,project,level,hours\n2026-01-15,Max Mustermann,P1,Dev,4.5"
    rows = parse_rows(csv_str)
    assert rows[0]["booking_date"] == date(2026, 1, 15)
    assert rows[0]["sage_employee_name"] == "Max Mustermann"


def test_parse_rows_multiple_rows():
    rows_data = [_ROW, {**_ROW, "booking_date": date(2026, 1, 16), "net_hours": 8.0}]
    rows = parse_rows(_csv(rows_data))
    assert len(rows) == 2


# ---------------------------------------------------------------------------
# fuzzy_match_persons
# ---------------------------------------------------------------------------


def test_fuzzy_match_exact(session):
    _make_person(session, "Max Mustermann")
    result = fuzzy_match_persons(["Max Mustermann"], session)
    assert "Max Mustermann" in result


def test_fuzzy_match_approximate(session):
    _make_person(session, "Max Mustermann")
    result = fuzzy_match_persons(["Max Musermann"], session)  # typo
    assert "Max Musermann" in result


def test_fuzzy_match_deduplicated(session):
    _make_person(session, "Max Mustermann")
    result = fuzzy_match_persons(["Max Mustermann", "Max Mustermann"], session)
    assert len(result) == 1


def test_fuzzy_match_below_threshold(session):
    _make_person(session, "Max Mustermann")
    with pytest.raises(UnmatchedPersonsError) as exc_info:
        fuzzy_match_persons(["Completely Different Name"], session)
    assert "Completely Different Name" in exc_info.value.names


def test_fuzzy_match_no_persons(session):
    with pytest.raises(UnmatchedPersonsError):
        fuzzy_match_persons(["Max Mustermann"], session)


def test_fuzzy_match_multiple_persons(session):
    _make_person(session, "Alice Wagner")
    _make_person(session, "Bob Bauer")
    result = fuzzy_match_persons(["Alice Wagner", "Bob Bauer"], session)
    assert len(result) == 2


# ---------------------------------------------------------------------------
# resolve_project_mappings
# ---------------------------------------------------------------------------


def test_resolve_known_mapping(session):
    proj = _make_project(session, "P00001")
    _make_mapping(session, "P00001 Analytics", proj.id)
    result = resolve_project_mappings(["P00001 Analytics"], session)
    assert result["P00001 Analytics"] == proj.id


def test_resolve_unknown_mapping(session):
    with pytest.raises(UnresolvedProjectsError) as exc_info:
        resolve_project_mappings(["Unknown Project"], session)
    assert "Unknown Project" in exc_info.value.names


def test_resolve_mixed_mappings(session):
    proj = _make_project(session, "P00001")
    _make_mapping(session, "P00001 Analytics", proj.id)
    with pytest.raises(UnresolvedProjectsError) as exc_info:
        resolve_project_mappings(["P00001 Analytics", "Unknown"], session)
    assert "Unknown" in exc_info.value.names
    assert "P00001 Analytics" not in exc_info.value.names


# ---------------------------------------------------------------------------
# import_bookings — happy path
# ---------------------------------------------------------------------------


def test_import_bookings_inserts_time_booking(session):
    person = _make_person(session)
    proj = _make_project(session)
    _make_mapping(session, "P00001 Analytics", proj.id)
    session.commit()

    csv_str = _csv([_ROW])
    result = import_bookings(csv_str, session, source_filename="export.csv")

    assert result.inserted == 1
    assert result.skipped == 0
    assert len(result.batch_ids) == 1

    booking = session.exec(
        __import__("sqlmodel").select(TimeBooking)
    ).first()
    assert booking is not None
    assert booking.net_hours == 4.5
    assert booking.person_id == person.id
    assert booking.project_id == proj.id


def test_import_bookings_creates_batch_with_filename(session):
    _make_person(session)
    proj = _make_project(session)
    _make_mapping(session, "P00001 Analytics", proj.id)
    session.commit()

    import_bookings(_csv([_ROW]), session, source_filename="sage_2026.csv")

    from app.models.timebooking import ImportBatch
    batch = session.exec(__import__("sqlmodel").select(ImportBatch)).first()
    assert batch.source_filename == "sage_2026.csv"
    assert batch.last_booking_date == _ROW["booking_date"]


def test_import_bookings_deduplication(session):
    _make_person(session)
    proj = _make_project(session)
    _make_mapping(session, "P00001 Analytics", proj.id)
    session.commit()

    csv_str = _csv([_ROW])
    r1 = import_bookings(csv_str, session, source_filename="f1.csv")
    r2 = import_bookings(csv_str, session, source_filename="f2.csv")

    assert r1.inserted == 1
    assert r1.skipped == 0
    assert r2.inserted == 0
    assert r2.skipped == 1


def test_import_bookings_multiple_projects(session):
    _make_person(session)
    proj1 = _make_project(session, "P00001")
    proj2 = _make_project(session, "P00002")
    _make_mapping(session, "P00001 Analytics", proj1.id)
    _make_mapping(session, "P00002 Dev", proj2.id)
    session.commit()

    row2 = {**_ROW, "sage_project_name": "P00002 Dev", "booking_date": date(2026, 2, 1)}
    csv_str = _csv([_ROW, row2])
    result = import_bookings(csv_str, session)

    assert result.inserted == 2
    assert len(result.batch_ids) == 2


def test_import_bookings_unresolved_project(session):
    _make_person(session)
    session.commit()

    with pytest.raises(UnresolvedProjectsError):
        import_bookings(_csv([_ROW]), session)


def test_import_bookings_unmatched_person(session):
    proj = _make_project(session)
    _make_mapping(session, "P00001 Analytics", proj.id)
    session.commit()

    with pytest.raises(UnmatchedPersonsError):
        import_bookings(_csv([_ROW]), session)


# ---------------------------------------------------------------------------
# import_bookings — position mode (§21 P6): level → line item linking
# ---------------------------------------------------------------------------


def _priced_position(session, project_id, number="AP1", rate=100.0):
    bp = BillingPosition(project_id=project_id, position_number=number,
                         budget_euros=10000.0, billing_rate_per_hour=rate)
    session.add(bp)
    session.flush()
    return bp


def _position_mapping(session, project_id, level, bp_id):
    m = SagePositionMapping(project_id=project_id, sage_project_level=level,
                            billing_position_id=bp_id)
    session.add(m)
    session.flush()
    return m


def test_import_links_booking_to_position(session):
    _make_person(session)
    proj = _make_project(session)
    proj.position_mode = True
    _make_mapping(session, "P00001 Analytics", proj.id)
    bp = _priced_position(session, proj.id)
    _position_mapping(session, proj.id, "Development", bp.id)  # _ROW level = Development
    session.commit()

    result = import_bookings(_csv([_ROW]), session)
    assert result.inserted == 1
    booking = session.exec(__import__("sqlmodel").select(TimeBooking)).first()
    assert booking.billing_position_id == bp.id


def test_import_flags_booking_on_unassigned_position(session):
    """WP4: MA books on a position they are not assigned to → mismatch flagged."""
    _make_person(session)
    proj = _make_project(session)
    proj.position_mode = True
    _make_mapping(session, "P00001 Analytics", proj.id)
    bp = _priced_position(session, proj.id)
    _position_mapping(session, proj.id, "Development", bp.id)
    session.commit()  # no membership on bp

    result = import_bookings(_csv([_ROW]), session)
    assert result.inserted == 1
    assert len(result.mismatches) == 1
    assert "Max Mustermann" in result.mismatches[0]
    assert bp.position_number in result.mismatches[0]


def test_import_no_mismatch_when_assigned(session):
    """WP4: no flag when the MA is assigned to the booked position."""
    person = _make_person(session)
    proj = _make_project(session)
    proj.position_mode = True
    _make_mapping(session, "P00001 Analytics", proj.id)
    bp = _priced_position(session, proj.id)
    _position_mapping(session, proj.id, "Development", bp.id)
    session.add(ProjectMembership(
        project_id=proj.id, person_id=person.id,
        from_date=date(2026, 1, 1), to_date=date(2026, 12, 31),
        weekly_capacity_hours=20.0, billing_rate_per_hour=0.0,
        billing_position_id=bp.id,
    ))
    session.commit()

    result = import_bookings(_csv([_ROW]), session)
    assert result.inserted == 1
    assert result.mismatches == []


def test_import_position_mode_missing_mapping_raises(session):
    _make_person(session)
    proj = _make_project(session)
    proj.position_mode = True
    _make_mapping(session, "P00001 Analytics", proj.id)
    _priced_position(session, proj.id)  # position mode, but no level mapping
    session.commit()

    with pytest.raises(UnresolvedPositionsError) as exc:
        import_bookings(_csv([_ROW]), session)
    assert (proj.id, "Development") in exc.value.pairs


def test_position_mapping_is_project_scoped(session):
    # Two projects with an identically-named level ("Development") must resolve to their
    # OWN position — no cross-project mixing (finding 2026-07-16).
    from app.services.importer import resolve_position_mappings

    proj_a = _make_project(session, "P00001")
    proj_a.position_mode = True
    proj_b = _make_project(session, "P00002")
    proj_b.position_mode = True
    bp_a = _priced_position(session, proj_a.id, number="A-DEV")
    bp_b = _priced_position(session, proj_b.id, number="B-DEV")
    _position_mapping(session, proj_a.id, "Development", bp_a.id)
    _position_mapping(session, proj_b.id, "Development", bp_b.id)
    session.commit()

    result = resolve_position_mappings(
        [(proj_a.id, "Development"), (proj_b.id, "Development")],
        {proj_a.id, proj_b.id},
        session,
    )
    assert result[(proj_a.id, "Development")] == bp_a.id
    assert result[(proj_b.id, "Development")] == bp_b.id
    assert bp_a.id != bp_b.id


def test_import_simple_mode_leaves_position_null(session):
    # Unpriced position → simple mode → no mapping needed, booking not linked.
    _make_person(session)
    proj = _make_project(session)
    _make_mapping(session, "P00001 Analytics", proj.id)
    session.add(BillingPosition(project_id=proj.id, position_number="X", budget_euros=5000.0))  # rate 0
    session.commit()

    result = import_bookings(_csv([_ROW]), session)
    assert result.inserted == 1
    booking = session.exec(__import__("sqlmodel").select(TimeBooking)).first()
    assert booking.billing_position_id is None


# ---------------------------------------------------------------------------
# Hypothesis: parse_rows is stable under date format variation
# ---------------------------------------------------------------------------


@given(
    day=st.integers(min_value=1, max_value=28),
    month=st.integers(min_value=1, max_value=12),
    year=st.integers(min_value=2020, max_value=2030),
)
@h_settings(max_examples=30)
def test_parse_rows_date_formats_consistent(day, month, year):
    d = date(year, month, day)
    row = {**_ROW, "booking_date": d}
    # Both date formats should parse to the same date
    rows_dmy = parse_rows(_csv([row], date_fmt="%d.%m.%Y"))
    rows_iso = parse_rows(_csv([row], date_fmt="%Y-%m-%d"))
    assert rows_dmy[0]["booking_date"] == rows_iso[0]["booking_date"] == d


# ---------------------------------------------------------------------------
# New Sage format: Datum;Mitarbeiter;Projektname;Projektebene 1;Dauer;Bemerkung
# ---------------------------------------------------------------------------

def _csv_new(rows: list[dict], delimiter: str = ";") -> str:
    """Build a new-format Sage CSV (h:mm duration)."""
    header = delimiter.join(["Datum", "Mitarbeiter", "Projektname", "Projektebene 1", "Dauer", "Bemerkung"])
    lines = [header]
    for r in rows:
        d = r["booking_date"]
        h = int(r["net_hours"])
        m = round((r["net_hours"] - h) * 60)
        duration = f"{h}:{m:02d}h"
        lines.append(delimiter.join([
            d.strftime("%d.%m.%Y"),
            r["sage_employee_name"],
            r["sage_project_name"],
            r["sage_project_level"],
            duration,
            r.get("note", ""),
        ]))
    return "\n".join(lines)


def test_new_format_semicolon():
    rows = parse_rows(_csv_new([_ROW]))
    assert rows[0]["booking_date"] == date(2026, 1, 15)
    assert rows[0]["net_hours"] == pytest.approx(4.5)
    assert rows[0]["sage_project_name"] == "P00001 Analytics"
    assert rows[0]["sage_project_level"] == "Development"


def test_new_format_tab_delimiter():
    rows = parse_rows(_csv_new([_ROW], delimiter="\t"))
    assert rows[0]["net_hours"] == pytest.approx(4.5)


def test_new_format_duration_1h30():
    row = {**_ROW, "net_hours": 1.5}
    rows = parse_rows(_csv_new([row]))
    assert rows[0]["net_hours"] == pytest.approx(1.5)


def test_new_format_duration_full_hours():
    row = {**_ROW, "net_hours": 7.0}
    rows = parse_rows(_csv_new([row]))
    assert rows[0]["net_hours"] == pytest.approx(7.0)


def test_new_format_review_sample():
    """Sample rows in the current Sage export format."""
    csv_str = (
        'Datum;Mitarbeiter;Projektname;Projektebene 1;Dauer;Bemerkung\n'
        '02.03.2026;Mustermann, Max;"PRJ-001 Analytics 2026";Analytics;1:30h;\n'
        '03.03.2026;Mustermann, Max;"PRJ-001 Analytics 2026";Analytics;7:00h;'
    )
    rows = parse_rows(csv_str)
    assert len(rows) == 2
    assert rows[0]["net_hours"] == pytest.approx(1.5)
    assert rows[1]["net_hours"] == pytest.approx(7.0)
    assert rows[0]["sage_employee_name"] == "Mustermann, Max"
    assert rows[0]["sage_project_name"] == "PRJ-001 Analytics 2026"
    assert rows[0]["sage_project_level"] == "Analytics"


def test_headerless_tab_format():
    """Tab-separated without header row — Sage copy-paste format."""
    csv_str = (
        "01.06.2026\tMustermann, Max\tPRJ-001 Analytics 2026\tAnalytics\t6:00h\t\n"
        "02.06.2026\tMustermann, Max\tPRJ-001 Analytics 2026\tAnalytics\t3:30h\t\n"
    )
    rows = parse_rows(csv_str)
    assert len(rows) == 2
    assert rows[0]["net_hours"] == pytest.approx(6.0)
    assert rows[1]["net_hours"] == pytest.approx(3.5)
    assert rows[0]["sage_employee_name"] == "Mustermann, Max"
    assert rows[0]["sage_project_name"] == "PRJ-001 Analytics 2026"
    assert rows[0]["sage_project_level"] == "Analytics"


def test_headerless_tab_trailing_empty_columns():
    """Sage copy-paste often adds trailing empty tab columns — must not crash."""
    csv_str = (
        "01.06.2026\tMustermann, Max\tPRJ-001 Analytics 2026\tAnalytics\t6:00h\t\t\n"
        "02.06.2026\tMustermann, Max\tPRJ-001 Analytics 2026\tAnalytics\t3:30h\t\t\n"
    )
    rows = parse_rows(csv_str)
    assert len(rows) == 2
    assert rows[0]["net_hours"] == pytest.approx(6.0)
    assert rows[1]["net_hours"] == pytest.approx(3.5)


def test_headerless_tab_format_with_header_row():
    """Same format but with optional header row — both variants must parse identically."""
    with_header = (
        "Datum\tMitarbeiter\tProjektname\tProjektebene 1\tDauer\tBemerkung\n"
        "01.06.2026\tMustermann, Max\tPRJ-001 Analytics 2026\tAnalytics\t6:00h\t\n"
    )
    without_header = (
        "01.06.2026\tMustermann, Max\tPRJ-001 Analytics 2026\tAnalytics\t6:00h\t\n"
    )
    rows_with = parse_rows(with_header)
    rows_without = parse_rows(without_header)
    assert rows_with[0]["net_hours"] == rows_without[0]["net_hours"]
    assert rows_with[0]["sage_project_name"] == rows_without[0]["sage_project_name"]


def test_new_format_parse_error_carries_details():
    csv_str = (
        "Datum;Mitarbeiter;Projektname;Projektebene 1;Dauer;Bemerkung\n"
        "01.01.2026;Max;P1;Dev;not-a-duration;\n"
    )
    with pytest.raises(ParseError) as exc_info:
        parse_rows(csv_str)
    assert exc_info.value.details
    assert exc_info.value.details[0].row == 2


def test_new_format_missing_column_message():
    csv_str = "Datum;Mitarbeiter;Projektname;Projektebene 1\n01.01.2026;Max;P1;Dev"
    with pytest.raises(ParseError, match="Missing required columns"):
        parse_rows(csv_str)


def test_parse_hours_decimal():
    from app.services.importer import _parse_hours
    assert _parse_hours("4.5") == pytest.approx(4.5)
    assert _parse_hours("4,5") == pytest.approx(4.5)
    assert _parse_hours("8.0") == pytest.approx(8.0)


def test_parse_hours_hhmm():
    from app.services.importer import _parse_hours
    assert _parse_hours("1:30h") == pytest.approx(1.5)
    assert _parse_hours("7:00h") == pytest.approx(7.0)
    assert _parse_hours("0:45h") == pytest.approx(0.75)
    assert _parse_hours("1:30") == pytest.approx(1.5)  # no trailing h


def test_parse_hours_invalid():
    from app.services.importer import _parse_hours
    with pytest.raises(ParseError, match="Cannot parse hours"):
        _parse_hours("not-a-number")
