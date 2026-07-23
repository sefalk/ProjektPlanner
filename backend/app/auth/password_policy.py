"""Password policy (doc 25, #53).

Single source of truth for the backend password rules. Enforced authoritatively
in ``UserManager.validate_password``; the frontend mirrors the SAME rules in
``src/lib/passwordPolicy.ts`` for a live checklist (keep both in sync).

Policy: length first, plus the four character classes the user asked for
(min length gives most of the entropy; the classes are a floor against trivial
passwords). Adjust ``PASSWORD_MIN_LENGTH`` / the checks here and mirror them.
"""

from __future__ import annotations

import re

PASSWORD_MIN_LENGTH = 12


def password_problems(password: str) -> list[str]:
    """Return the unmet requirements (German fragments), empty if the password is OK."""
    problems: list[str] = []
    if len(password) < PASSWORD_MIN_LENGTH:
        problems.append(f"mindestens {PASSWORD_MIN_LENGTH} Zeichen")
    if not (re.search(r"[a-z]", password) and re.search(r"[A-Z]", password)):
        problems.append("Groß- und Kleinbuchstaben")
    if not re.search(r"\d", password):
        problems.append("eine Ziffer")
    if not re.search(r"[^A-Za-z0-9]", password):
        problems.append("ein Sonderzeichen")
    return problems


def is_password_valid(password: str) -> bool:
    return not password_problems(password)
