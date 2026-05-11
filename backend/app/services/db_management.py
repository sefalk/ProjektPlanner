"""Database path management.

The active database URL is stored in a small JSON pointer file
(data_config.json, always in the backend/ directory) that is separate
from the database itself. This avoids a bootstrap paradox: we need to
know WHERE the database is before we can open it to read settings.

Lifecycle:
  - On first run: data_config.json does not exist → DATABASE_URL env var
    (or pydantic default) is used, data_config.json is created on first
    path-change.
  - On path change via UI: the current DB file is copied to the new
    directory, data_config.json is updated with the new URL, and the
    caller receives restart_required=True.
  - On every subsequent startup: db.py calls resolve_db_url() which reads
    data_config.json.

The data_config.json file must NOT be placed inside the user-configurable
data directory, because it would become unreachable if that directory moves.
It lives at backend/data_config.json (next to the app/ package directory).
"""

from __future__ import annotations

import json
import shutil
import time
from pathlib import Path

# Fixed location: backend/data_config.json — always relative to this file's
# parent.parent (i.e. the backend/ directory).
_CONFIG_FILE: Path = Path(__file__).parent.parent.parent / "data_config.json"

# Directories on network shares or cloud-sync folders can cause SQLite locking
# issues. These substrings in the path trigger an informational warning.
_CLOUD_PATH_HINTS = ("onedrive", "dropbox", "google drive", "nextcloud", "sharepoint")


def resolve_db_url() -> str:
    """Return the database URL to use on this startup.

    Priority:
      1. data_config.json (written by set_db_directory)
      2. DATABASE_URL env var / pydantic settings default

    Retries the file read 3 times with 100 ms gaps to survive transient
    file locks (e.g. cloud-sync or antivirus briefly holding the file).
    """
    if _CONFIG_FILE.exists():
        for attempt in range(3):
            try:
                data = json.loads(_CONFIG_FILE.read_text(encoding="utf-8"))
                url = data.get("database_url", "").strip()
                if url:
                    return url
                break  # file readable but no URL → fall through to default
            except Exception:
                if attempt < 2:
                    time.sleep(0.1)
    from app.config import settings  # import here to avoid circular at module level
    return settings.database_url


def _live_db_path() -> Path:
    """Return the absolute path of the currently open database file.

    Uses SQLite's PRAGMA database_list so the result is always correct
    regardless of the working directory or how the URL was specified.
    Falls back to resolving the URL string if the engine is unavailable.
    """
    try:
        from sqlalchemy import text
        from app.db import engine
        with engine.connect() as conn:
            rows = conn.execute(text("PRAGMA database_list")).fetchall()
            for row in rows:
                if row[1] == "main" and row[2]:
                    return Path(row[2]).resolve()
    except Exception:
        pass
    # Fallback: resolve URL string relative to this file's package root
    url = resolve_db_url()
    raw = url.replace("sqlite:///", "")
    p = Path(raw)
    if not p.is_absolute():
        # Resolve relative to backend/ directory
        p = Path(__file__).parent.parent.parent / p
    return p.resolve()


def get_db_info() -> dict:
    """Return display info about the current database location."""
    url = resolve_db_url()
    abs_path = str(_live_db_path())
    lower = abs_path.lower()
    cloud_warning = any(hint in lower for hint in _CLOUD_PATH_HINTS)
    return {
        "url": url,
        "path": abs_path,
        "config_source": "data_config.json" if _CONFIG_FILE.exists() else "env/default",
        "cloud_warning": cloud_warning,
    }


def set_db_directory(new_directory: str) -> dict:
    """Copy the active database to new_directory and update the pointer file.

    Returns a dict with:
      new_path       — absolute path of the copied database file
      restart_required — always True (engine cannot be hot-swapped)
      cloud_warning  — True if the path looks like a cloud-sync folder

    Raises:
      ValueError  — if new_directory is empty or the same as the current dir
      OSError     — if the copy fails (disk full, permissions, etc.)
    """
    if not new_directory or not new_directory.strip():
        raise ValueError("Neues Verzeichnis darf nicht leer sein.")

    current_path = _live_db_path()

    new_dir = Path(new_directory).resolve()
    new_db_path = new_dir / current_path.name

    if new_db_path == current_path:
        raise ValueError("Das neue Verzeichnis ist identisch mit dem aktuellen.")

    # Create target directory if it doesn't exist
    new_dir.mkdir(parents=True, exist_ok=True)

    # Copy the main database file
    shutil.copy2(current_path, new_db_path)

    # Copy WAL and SHM sidecar files if present (SQLite WAL mode)
    for suffix in ("-wal", "-shm"):
        sidecar = Path(str(current_path) + suffix)
        if sidecar.exists():
            shutil.copy2(sidecar, Path(str(new_db_path) + suffix))

    # Write new URL to config file
    new_url = f"sqlite:///{new_db_path}"
    _CONFIG_FILE.write_text(
        json.dumps({"database_url": new_url}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    lower = str(new_db_path).lower()
    cloud_warning = any(hint in lower for hint in _CLOUD_PATH_HINTS)

    return {
        "new_path": str(new_db_path),
        "restart_required": True,
        "cloud_warning": cloud_warning,
    }
