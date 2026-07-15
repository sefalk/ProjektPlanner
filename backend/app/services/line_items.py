"""Projektposten (line-item / BillingPosition) budget consistency — doc 21 §P3.

Pure helpers for the Σ-invariant so the router and tests share one rule set:
  Ziel-Zustand:  Σ Posten-Budget(€) == Project.total_budget_euros
  Einrichtung:   temporäres offenes Restbudget erlaubt (Σ < Gesamt) → Warnung
  Blockiert:     Überschreiten (Σ > Gesamt)
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

# Money comparisons use a cent-scale epsilon; budgets are stored as floats.
_EPS = 1e-6


@dataclass(frozen=True)
class PositionBudgetState:
    total_budget_euros: float
    allocated_euros: float  # Σ of all position budgets
    open_euros: float       # total − allocated; >0 = unallocated remainder, <0 = overshoot
    is_over: bool           # Σ > total → blocked
    is_complete: bool       # Σ == total → fully configured


def position_budget_state(
    total_budget_euros: float, position_budgets: Iterable[float]
) -> PositionBudgetState:
    """Aggregate the €-budget state of a project's line items."""
    allocated = sum(position_budgets)
    open_euros = total_budget_euros - allocated
    return PositionBudgetState(
        total_budget_euros=total_budget_euros,
        allocated_euros=allocated,
        open_euros=open_euros,
        is_over=allocated > total_budget_euros + _EPS,
        is_complete=abs(open_euros) <= _EPS,
    )


def default_new_position_budget(total_budget_euros: float, existing_budgets: Iterable[float]) -> float:
    """Default budget for a newly added position = the open (unallocated) difference,
    never negative (P3: new positions default to the open difference)."""
    open_euros = total_budget_euros - sum(existing_budgets)
    return max(0.0, open_euros)


def would_overshoot(
    total_budget_euros: float, other_budgets: Iterable[float], new_budget: float
) -> bool:
    """True if setting one position to new_budget pushes Σ above the project total (blocked).
    other_budgets = budgets of all OTHER positions (excluding the one being set)."""
    return sum(other_budgets) + new_budget > total_budget_euros + _EPS
