"""Explicit, approved account erasure across canonical and framework stores."""
import uuid

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from personalos.db import utcnow
from personalos.models import AuthSession, Automation, Execution, Message, Record, User
from personalos.services.calendar import disconnect_google
from personalos.services.records import list_records
from personalos.services.accounts import account_lease


async def delete_account(db: Session, owner_id: str, approval_id: str) -> dict:
    with account_lease(db, owner_id, exclusive=True):
        return await _delete_account(db, owner_id, approval_id)


async def _delete_account(db: Session, owner_id: str, approval_id: str) -> dict:
    user = db.scalar(select(User).where(User.id == owner_id, User.deleted_at.is_(None)).with_for_update())
    if user is None:
        from fastapi import HTTPException
        raise HTTPException(410, "Account has already been deleted")
    # Revoke provider authorization before erasing the sole encrypted refresh token.
    integrations = list_records(db, owner_id, "integration", 10000)
    for row in integrations:
        if row.data.get("kind") == "google_calendar":
            await disconnect_google(db, owner_id, row.id, commit=False)
    sessions = db.scalars(select(Record.id).where(Record.owner_id == owner_id, Record.kind == "chat_session")).all()
    memory_ids = db.scalars(select(Record.id).where(Record.owner_id == owner_id, Record.kind == "memory")).all()
    # Refuse a false full-purge receipt when external Hy entries exist without a configured purge adapter.
    external = [row for row in db.scalars(select(Record).where(Record.owner_id == owner_id, Record.kind == "memory")).all() if row.extra.get("hy_memory_id")]
    if external:
        from fastapi import HTTPException
        raise HTTPException(409, "Delete and verify external Hy Memory entries before deleting the account")
    from personalos.services.agent import durable_graph_resources
    async with durable_graph_resources() as (saver, store):
        for session_id in sessions:
            await saver.adelete_thread(f"{owner_id}:{session_id}")
        for memory_id in memory_ids:
            await store.adelete((owner_id, "memories"), memory_id)
    now = utcnow()
    db.execute(update(Message).where(Message.owner_id == owner_id).values(content="", deleted_at=now, extra={}, version=Message.version + 1))
    db.execute(update(Record).where(Record.owner_id == owner_id, Record.id != approval_id).values(
        title="", content="", data={}, extra={}, deleted_at=now, version=Record.version + 1))
    db.execute(update(Automation).where(Automation.owner_id == owner_id).values(
        title="", prompt="", status="cancelled", extra={}, deleted_at=now, version=Automation.version + 1))
    db.execute(update(Execution).where(Execution.owner_id == owner_id).values(
        result={}, error=None, extra={}, status="cancelled", claim_token=None, lease_until=None, deleted_at=now, version=Execution.version + 1))
    db.execute(update(AuthSession).where(AuthSession.owner_id == owner_id).values(deleted_at=now, extra={}, version=AuthSession.version + 1))
    db.execute(update(User).where(User.id == owner_id).values(
        email=f"deleted-{owner_id}@invalid.local", name="Deleted account", password_hash=uuid.uuid4().hex,
        secret_config=None, preferences={}, extra={}, deleted_at=now, version=User.version + 1))
    db.commit()
    return {"deleted": True, "canonical_data_erased": True, "graph_state_erased": True,
            "provider_authorizations_revoked": True, "backup_retention": "Operator backups expire under the deployment retention policy"}
