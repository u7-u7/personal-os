"""Account lifecycle fences shared by HTTP requests, Agent runs and erasure."""
import hashlib
import logging
from contextlib import contextmanager
from contextvars import ContextVar

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from personalos.models import Record, User

logger = logging.getLogger(__name__)
_leases: ContextVar[dict[str, str]] = ContextVar("personalos_account_leases", default={})


def assert_account_writable(db: Session, owner_id: str) -> None:
    # Fresh SQL deliberately avoids the identity cache of a request/Worker that
    # started before an approved erasure. SHARE conflicts with the erasure lock.
    try:
        active = db.scalar(select(User.id).where(User.id == owner_id, User.deleted_at.is_(None))
                           .with_for_update(read=True, nowait=True))
    except DBAPIError as exc:
        if getattr(exc.orig, "sqlstate", None) == "55P03":
            db.rollback()
            raise HTTPException(409, "Account data is being changed. Refresh and retry") from exc
        raise
    if active is None:
        raise HTTPException(410, "Account has been deleted; operation refused")


@contextmanager
def account_lease(db: Session, owner_id: str, *, exclusive: bool = False):
    """Nonblocking session advisory fence; never queue a writer behind an active stream.

    A dedicated connection holds the lease across commits on the business session.
    Nested provider/Agent calls reuse their current lease rather than exhausting
    the pool. The final assistant-message commit must stay inside the outer lease.
    """
    existing = _leases.get().get(owner_id)
    if existing:
        if exclusive and existing != "exclusive":
            raise HTTPException(409, "Stop active Agent execution before deleting the account")
        yield
        return
    key = int.from_bytes(hashlib.sha256(f"personalos-account:{owner_id}".encode()).digest()[:8], "big", signed=True)
    connection = db.get_bind().connect()
    lock_function = "pg_try_advisory_lock" if exclusive else "pg_try_advisory_lock_shared"
    unlock_function = "pg_advisory_unlock" if exclusive else "pg_advisory_unlock_shared"
    acquired = False
    token = None
    try:
        acquired = bool(connection.scalar(text(f"SELECT {lock_function}(:key)"), {"key": key}))
        if not acquired:
            raise HTTPException(409, "Account has an active execution or deletion. Stop it and request a new approval")
        active = connection.scalar(select(User.id).where(User.id == owner_id, User.deleted_at.is_(None)))
        connection.commit()
        if active is None:
            raise HTTPException(410, "Account has been deleted; operation refused")
        if not exclusive:
            # An interrupted checkpoint sweep resumes by cursor. New Agent or
            # confirmation writes must not refill an already swept prefix.
            unfinished = connection.scalar(select(Record.id).where(
                Record.owner_id == owner_id, Record.kind == "memory", Record.deleted_at.is_not(None),
                Record.extra["memory_deletion"]["state"].as_string() == "pending",
                ((Record.extra["memory_deletion"]["store"].as_string() != "complete") |
                 (Record.extra["memory_deletion"]["checkpoints"].as_string() != "complete")),
            ).limit(1))
            connection.commit()
            if unfinished:
                raise HTTPException(409, "Memory cleanup is pending. Resume it in Activity before starting AI")
        token = _leases.set({**_leases.get(), owner_id: "exclusive" if exclusive else "shared"})
        yield
    finally:
        if token is not None:
            _leases.reset(token)
        try:
            connection.rollback()
            if acquired:
                connection.execute(text(f"SELECT {unlock_function}(:key)"), {"key": key})
                connection.commit()
        except Exception:
            # Never return a session-level lock to a pooled live connection.
            connection.invalidate()
            logger.warning("account_lease_connection_invalidated owner_id=%s", owner_id)
        finally:
            connection.close()
