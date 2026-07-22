"""Central owner-based row filter — multi-user isolation (doc 25, WP3).

Every ownable row carries an ``owner_id``. Instead of hand-writing
``.where(Model.owner_id == current_user)`` on every query (error-prone, one
forgotten filter = a data leak), the owner is bound ONCE to the SQLAlchemy
``Session`` (``session.info["owner"]``) and two global event listeners enforce
it for the whole session:

* ``do_orm_execute`` — appends ``with_loader_criteria(owner_id == uid)`` to every
  ORM SELECT, so reads only ever return the current owner's rows.
* ``before_flush`` — stamps ``owner_id`` on freshly-inserted ownable rows, so
  callers never set it by hand and can't accidentally set someone else's.

Why ``session.info`` and not a ``ContextVar``: FastAPI runs sync endpoints and
their ``yield`` dependencies in a threadpool, and a ContextVar set inside one
threadpool task does not reliably propagate to the task running the endpoint.
The Session, by contrast, is the exact object every query runs on — binding the
owner to it is leak-proof by construction.

Superusers (admins) bypass the read filter and see everything. Sessions with no
owner bound (startup seeding, auth lookups, maintenance scripts) are unfiltered;
the actual access boundary for owned data is the ``owner_context`` dependency
that guards every CRUD router (``app/auth/deps.py``).
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass

from sqlalchemy import event
from sqlalchemy.orm import Session as SASession, with_loader_criteria
from sqlalchemy.orm.attributes import get_history

from app.models.billing import BillingPosition
from app.models.invoice import InvoicePersonEntry, MonthlyInvoice
from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.person import Person, PersonAbsence, VacationContingent
from app.models.program import Program
from app.models.project import Project
from app.models.timebooking import ImportBatch, SagePositionMapping, SageProjectMapping, TimeBooking

# Every table=True model carrying an owner_id column. The filter is applied for
# each of these on every SELECT; SQLAlchemy silently ignores the ones not present
# in a given statement, so listing all is safe (and keeps this the single source
# of truth for "what is ownable"). Setting is added here in WP3 step 3b.
OWNABLE_MODELS: tuple[type, ...] = (
    Program,
    Project,
    Person,
    VacationContingent,
    PersonAbsence,
    BillingPosition,
    Milestone,
    MilestonePersonBudget,
    ProjectMembership,
    MonthlyInvoice,
    InvoicePersonEntry,
    ImportBatch,
    SageProjectMapping,
    SagePositionMapping,
    TimeBooking,
)

_INFO_KEY = "owner"
_BYPASS_KEY = "owner_filter_bypass"


@dataclass(frozen=True)
class OwnerContext:
    """The identity a Session acts on behalf of."""

    user_id: int
    is_superuser: bool = False


def bind_owner(session: SASession, user_id: int, is_superuser: bool = False) -> None:
    """Bind an owner to this session for the remainder of its life."""
    session.info[_INFO_KEY] = OwnerContext(user_id=user_id, is_superuser=is_superuser)


def clear_owner(session: SASession) -> None:
    session.info.pop(_INFO_KEY, None)


def get_owner(session: SASession) -> OwnerContext | None:
    return session.info.get(_INFO_KEY)


@contextmanager
def bypass_owner_filter(session: SASession):
    """Temporarily run unfiltered queries on an owner-bound session.

    For rare maintenance/admin code that must see across owners on a session
    that already has an owner bound. Restores the previous state on exit.
    """
    previous = session.info.get(_BYPASS_KEY, False)
    session.info[_BYPASS_KEY] = True
    try:
        yield
    finally:
        session.info[_BYPASS_KEY] = previous


@event.listens_for(SASession, "do_orm_execute")
def _apply_owner_filter(state) -> None:
    """Scope every ORM SELECT to the session's owner (unless superuser/unbound)."""
    if not state.is_select:
        return
    # Relationship/column lazy-loads fetch attributes of an already-loaded (thus
    # already-authorized) parent row; re-filtering them is both unnecessary and
    # can raise on entities that don't carry owner_id.
    if state.is_relationship_load or state.is_column_load:
        return
    session = state.session
    if session.info.get(_BYPASS_KEY):
        return
    owner: OwnerContext | None = session.info.get(_INFO_KEY)
    if owner is None or owner.is_superuser:
        return
    uid = owner.user_id
    for model in OWNABLE_MODELS:
        state.statement = state.statement.options(
            with_loader_criteria(model, model.owner_id == uid, include_aliases=True)
        )


@event.listens_for(SASession, "before_flush")
def _enforce_owner_on_write(session: SASession, _flush_context, _instances) -> None:
    """Enforce the owner invariant on writes: owner_id is server-controlled.

    * INSERT — every new ownable row is stamped with the session owner, ignoring
      any owner_id the client may have sent (these models double as request
      bodies, so a payload could otherwise smuggle one in).
    * UPDATE — owner_id is never editable via CRUD. If a flush would change it
      (notably: ``model_dump(exclude_unset=True)`` on a ValidatedSQLModel re-marks
      every field as "set", so an update re-sends owner_id=None and would blank
      it), the original value is restored. Without this, an updated row would
      silently fall out of its owner's view.
    """
    if session.info.get(_BYPASS_KEY):
        return
    owner: OwnerContext | None = session.info.get(_INFO_KEY)
    if owner is None:
        return
    for obj in session.new:
        if isinstance(obj, OWNABLE_MODELS):
            obj.owner_id = owner.user_id
    for obj in session.dirty:
        if isinstance(obj, OWNABLE_MODELS):
            history = get_history(obj, "owner_id")
            # history.deleted holds the pre-flush value when owner_id was changed.
            if history.deleted and history.deleted[0] is not None:
                obj.owner_id = history.deleted[0]
