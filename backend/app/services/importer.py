"""Sage ERP CSV import service.

Workflow:
  1. parse_rows()         — decode CSV, detect delimiter, normalize column names, coerce types
  2. fuzzy_match_persons() — match employee names to Person.sage_employee_name
  3. resolve_project_mappings() — look up SageProjectMapping rows
  4. import_bookings()    — create ImportBatch + TimeBooking records; dedup via savepoints

Supported Sage export format (current / "echtes" Sage format):
    Datum;Mitarbeiter;Projektname;Projektebene 1;Dauer;Bemerkung
    02.03.2026;Mustermann, Max;"PRJ-001 Analytics 2026";Qlik/Python;1:30h;

Duration field "Dauer" is parsed as h:mm (e.g. "1:30h" → 1.5 h).
Legacy column names (Buchungsdatum, Nettozeit, Sage-Projekt, …) are still accepted
for backward compatibility. Delimiters: semicolon, tab, or comma (auto-detected).
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select
from thefuzz import process as fuzz_process

from app.models.person import Person
from app.models.timebooking import ImportBatch, SageProjectMapping, TimeBooking

FUZZY_THRESHOLD = 80

# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


@dataclass
class ParseErrorDetail:
    row: int
    column: str | None
    message: str


class ParseError(Exception):
    """Raised when the file content cannot be parsed."""

    def __init__(self, message: str, details: list[ParseErrorDetail] | None = None) -> None:
        self.details: list[ParseErrorDetail] = details or []
        super().__init__(message)


class UnmatchedPersonsError(Exception):
    """Raised when employee names cannot be fuzzy-matched to any Person."""

    def __init__(self, names: list[str]) -> None:
        self.names = names
        super().__init__(f"Could not match persons: {names}")


class UnresolvedProjectsError(Exception):
    """Raised when sage_project_names have no SageProjectMapping entry."""

    def __init__(self, names: list[str]) -> None:
        self.names = names
        super().__init__(f"Unresolved Sage project names: {names}")


# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------


@dataclass
class ImportResult:
    batch_ids: list[int] = field(default_factory=list)
    inserted: int = 0
    skipped: int = 0


# ---------------------------------------------------------------------------
# CSV parsing
# ---------------------------------------------------------------------------

# Maps canonical field names to lists of accepted (lowercase) column header variants.
# Priority: first matching alias wins per canonical key.
_COLUMN_ALIASES: dict[str, list[str]] = {
    "booking_date": [
        "datum", "buchungsdatum", "date", "booking date", "booking_date",
    ],
    "sage_employee_name": [
        "mitarbeiter", "employee", "person", "name", "sage_employee_name",
    ],
    "sage_project_name": [
        "projektname", "sage-projekt", "sage projekt", "projekt", "project",
        "sage_project_name", "sageprojekt",
    ],
    "sage_project_level": [
        "projektebene 1", "projektebene", "level", "ebene", "project level",
        "sage_project_level",
    ],
    # "Dauer" (new format, h:mm) is listed first so it takes priority over
    # legacy "Nettozeit" when only the new format columns are present.
    # When both appear (old format), whichever is last in the row wins —
    # _parse_hours handles both decimal and h:mm gracefully.
    "net_hours": [
        "dauer", "nettozeit", "net hours", "nethours", "nettostunden",
        "stunden", "hours", "net_hours",
    ],
    "duration_raw": ["duration", "duration_raw"],
    "break_duration": ["pause", "break", "break duration", "break_duration"],
    "note": ["bemerkung", "note", "comment"],
}

_REQUIRED_COLUMNS = {
    "booking_date", "sage_employee_name", "sage_project_name",
    "sage_project_level", "net_hours",
}


def _detect_delimiter(sample: str) -> str:
    counts: dict[str, int] = {
        ";": sample.count(";"),
        "\t": sample.count("\t"),
        ",": sample.count(","),
    }
    return max(counts, key=lambda k: counts[k])


def _build_key_map(header_keys: list[str]) -> dict[str, str]:
    """Map original header names to canonical names based on _COLUMN_ALIASES."""
    lower_to_orig = {k.lower(): k for k in header_keys}
    key_map: dict[str, str] = {}
    for canonical, aliases in _COLUMN_ALIASES.items():
        for alias in aliases:
            if alias in lower_to_orig:
                key_map[lower_to_orig[alias]] = canonical
                break
    return key_map


def _parse_date(value: str) -> date:
    for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            pass
    raise ParseError(f"Cannot parse date: {value!r}")


def _parse_hours(value: str) -> float:
    """Parse hours from decimal ('4.5', '4,5') or h:mm format ('1:30h', '1:30').

    Raises ParseError on unrecognisable input.
    """
    v = value.strip().rstrip("h").strip()
    if ":" in v:
        parts = v.split(":", 1)
        try:
            return int(parts[0]) + int(parts[1]) / 60
        except ValueError:
            raise ParseError(f"Cannot parse hours: {value!r}") from None
    try:
        return float(v.replace(",", "."))
    except ValueError:
        raise ParseError(f"Cannot parse hours: {value!r}") from None


def parse_rows(content: str | bytes) -> list[dict[str, Any]]:
    """Parse a Sage ERP CSV export into canonical row dicts with typed values.

    Supports semicolon, tab, and comma delimiters; UTF-8 BOM; DD.MM.YYYY and
    ISO date formats; German and English column headers; and both decimal and
    h:mm duration formats.

    Raises ParseError on missing required columns or unparseable values.
    The exception carries a `details` list with per-row context when available.
    """
    if isinstance(content, bytes):
        content = content.decode("utf-8-sig")  # strip BOM if present

    delimiter = _detect_delimiter(content[:2000])
    reader = csv.DictReader(io.StringIO(content), delimiter=delimiter)

    raw_rows: list[dict[str, str]] = [
        {k.strip(): (v or "").strip() for k, v in row.items()}
        for row in reader
    ]

    if not raw_rows:
        raise ParseError("No data rows found.")

    key_map = _build_key_map(list(raw_rows[0].keys()))
    missing = _REQUIRED_COLUMNS - set(key_map.values())
    if missing:
        raise ParseError(
            f"Missing required columns: {sorted(missing)}. "
            f"Expected columns (Sage format): Datum, Mitarbeiter, Projektname, "
            f"Projektebene 1, Dauer"
        )

    result: list[dict[str, Any]] = []
    errors: list[ParseErrorDetail] = []

    for i, raw in enumerate(raw_rows, start=2):
        row: dict[str, Any] = {}
        for orig_key, value in raw.items():
            canonical = key_map.get(orig_key, orig_key)
            row[canonical] = value

        try:
            result.append({
                "booking_date": _parse_date(row["booking_date"]),
                "sage_employee_name": row["sage_employee_name"],
                "sage_project_name": row["sage_project_name"],
                "sage_project_level": row.get("sage_project_level", ""),
                "net_hours": _parse_hours(row["net_hours"]),
                "duration_raw": row.get("duration_raw", ""),
                "break_duration": row.get("break_duration", ""),
            })
        except ParseError as exc:
            col = "Dauer" if "hours" in str(exc).lower() else "Datum"
            errors.append(ParseErrorDetail(row=i, column=col, message=str(exc)))

    if errors:
        raise ParseError(
            f"{len(errors)} row(s) could not be parsed.",
            details=errors,
        )

    return result


# ---------------------------------------------------------------------------
# Person fuzzy matching
# ---------------------------------------------------------------------------


def fuzzy_match_persons(raw_names: list[str], session: Session) -> dict[str, int]:
    """Return mapping raw_employee_name -> person_id.

    Uses fuzzy string matching with a threshold of FUZZY_THRESHOLD (0–100).
    Raises UnmatchedPersonsError for names that fall below the threshold.
    """
    persons = session.exec(select(Person)).all()
    if not persons:
        raise UnmatchedPersonsError(list(set(raw_names)))

    sage_names = [p.sage_employee_name for p in persons]
    id_by_name = {p.sage_employee_name: p.id for p in persons}

    result: dict[str, int] = {}
    unmatched: list[str] = []

    for name in set(raw_names):
        best = fuzz_process.extractOne(name, sage_names)
        if best is None:
            unmatched.append(name)
            continue
        match, score = best[0], best[1]
        if score >= FUZZY_THRESHOLD:
            result[name] = id_by_name[match]  # type: ignore[index]
        else:
            unmatched.append(name)

    if unmatched:
        raise UnmatchedPersonsError(sorted(unmatched))

    return result


# ---------------------------------------------------------------------------
# Project mapping resolution
# ---------------------------------------------------------------------------


def resolve_project_mappings(
    sage_project_names: list[str], session: Session
) -> dict[str, int]:
    """Return mapping sage_project_name -> project_id using SageProjectMapping.

    Raises UnresolvedProjectsError for names with no mapping entry.
    """
    result: dict[str, int] = {}
    unresolved: list[str] = []

    for name in set(sage_project_names):
        mapping = session.exec(
            select(SageProjectMapping).where(SageProjectMapping.sage_project_name == name)
        ).first()
        if mapping:
            result[name] = mapping.project_id
        else:
            unresolved.append(name)

    if unresolved:
        raise UnresolvedProjectsError(sorted(unresolved))

    return result


# ---------------------------------------------------------------------------
# Main import entry point
# ---------------------------------------------------------------------------


def import_bookings(
    content: str | bytes,
    session: Session,
    source_filename: str | None = None,
) -> ImportResult:
    """Parse a Sage CSV export and persist time bookings.

    Creates one ImportBatch per distinct project found in the file.
    Duplicate bookings (matching the UNIQUE constraint) are silently skipped.

    Raises:
        ParseError: malformed file content (carries .details list for row-level errors)
        UnmatchedPersonsError: employee names with no fuzzy match
        UnresolvedProjectsError: sage_project_names with no SageProjectMapping
    """
    rows = parse_rows(content)

    person_map = fuzzy_match_persons(
        [r["sage_employee_name"] for r in rows], session
    )
    project_map = resolve_project_mappings(
        [r["sage_project_name"] for r in rows], session
    )

    # Compute last booking date per project for the ImportBatch records.
    last_dates: dict[int, date] = {}
    for row in rows:
        pid = project_map[row["sage_project_name"]]
        if pid not in last_dates or row["booking_date"] > last_dates[pid]:
            last_dates[pid] = row["booking_date"]

    import_time = datetime.utcnow()
    batches: dict[int, int] = {}  # project_id -> batch_id
    for project_id, last_date in last_dates.items():
        batch = ImportBatch(
            project_id=project_id,
            imported_at=import_time,
            source_filename=source_filename,
            last_booking_date=last_date,
        )
        session.add(batch)
        session.flush()
        batches[project_id] = batch.id  # type: ignore[assignment]

    result = ImportResult(batch_ids=list(batches.values()))

    for row in rows:
        project_id = project_map[row["sage_project_name"]]
        booking = TimeBooking(
            booking_date=row["booking_date"],
            person_id=person_map[row["sage_employee_name"]],
            project_id=project_id,
            import_batch_id=batches[project_id],
            sage_project_name=row["sage_project_name"],
            sage_project_level=row["sage_project_level"],
            net_hours=row["net_hours"],
            duration_raw=row["duration_raw"],
            break_duration=row["break_duration"],
        )
        try:
            with session.begin_nested():  # SAVEPOINT for per-row dedup
                session.add(booking)
                session.flush()
            result.inserted += 1
        except IntegrityError:
            result.skipped += 1

    session.commit()
    return result
