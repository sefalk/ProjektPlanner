"""ValidatedSQLModel — base class that enforces Pydantic Field constraints on construction.

SQLModel table=True models bypass Pydantic validation when constructed via __init__
because SQLAlchemy instruments the init. This base class re-runs validation via
model_post_init, using a reentrancy guard to prevent infinite recursion.
"""

import threading
from typing import Any

from sqlmodel import SQLModel

_validating = threading.local()


class ValidatedSQLModel(SQLModel):
    """SQLModel base that runs Pydantic field validation on direct construction."""

    def model_post_init(self, __context: Any) -> None:
        if getattr(_validating, "active", False):
            return
        _validating.active = True
        try:
            data = {k: getattr(self, k, None) for k in type(self).model_fields}
            type(self).__pydantic_validator__.validate_python(data, self_instance=self)
        finally:
            _validating.active = False
