"""Consent-controlled memory. Relational facts remain separate from conversation state."""
from fastapi import HTTPException
import hashlib
import json
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from personalos.db import utcnow
from personalos.models import Record, User
from personalos.services.records import audit, cas_update, create_record, owned


class MemoryService:
    def __init__(self, db: Session, owner_id: str, store=None, hy_memory=None):
        self.db, self.owner_id, self.store, self.hy_memory = db, owner_id, store, hy_memory

    async def propose(self, content: str, category: str, source: str) -> Record:
        user = self.db.get(User, self.owner_id)
        if not user.preferences.get("memory_enabled", True):
            raise HTTPException(403, "Memory proposals are disabled in privacy settings")
        return create_record(self.db, self.owner_id, "memory", {
            "content": content, "category": category, "source": source, "status": "pending"})

    async def recall(self, query: str, limit: int = 8) -> list[dict]:
        rows = self.db.scalars(select(Record).where(Record.owner_id == self.owner_id,
                               Record.kind == "memory", Record.status == "confirmed",
                               Record.deleted_at.is_(None)).order_by(Record.updated_at.desc()).limit(500)).all()
        # Canonical consent/deletion filtering is always applied before a retrieved item can enter prompts.
        terms = set(query.lower().split())
        scored = sorted(rows, key=lambda r: sum(t in r.content.lower() for t in terms), reverse=True)
        return [{"id": row.id, "content": row.content, "source": row.data.get("source")} for row in scored[:limit]]

    async def confirm(self, memory_id: str, version: int) -> Record:
        row = owned(self.db, Record, self.owner_id, memory_id)
        if row.kind != "memory":
            raise HTTPException(404, "Memory not found")
        # A correction with the same explicit fact key supersedes rather than silently retaining conflicting facts.
        fact_key = row.extra.get("fact_key")
        if fact_key:
            if self.db.bind.dialect.name == "postgresql":
                lock_key = int.from_bytes(hashlib.sha256(f"{self.owner_id}:{fact_key}".encode()).digest()[:8], "big", signed=True)
                self.db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})
            others = self.db.scalars(select(Record).where(Record.owner_id == self.owner_id,
                                    Record.kind == "memory", Record.status == "confirmed",
                                    Record.deleted_at.is_(None), Record.id != row.id)).all()
            conflicts = [item for item in others if item.extra.get("fact_key") == fact_key]
            if conflicts and set(row.extra.get("supersedes", [])) != {item.id for item in conflicts}:
                raise HTTPException(409, {"message": "Confirm which existing fact this replaces", "conflicts": [c.id for c in conflicts]})
            for old in conflicts:
                if old.id in row.extra.get("supersedes", []):
                    old.status = "superseded"
                    old.version += 1
        row = cas_update(self.db, Record, self.owner_id, memory_id, version, {"status": "confirmed"})
        audit(self.db, self.owner_id, "memory.confirmed", memory_id)
        self.db.commit()
        if self.store:
            try:
                await self.store.aput((self.owner_id, "memories"), row.id, {"content": row.content, "source": row.data.get("source")})
            except Exception as exc:
                row.extra = {**row.extra, "index_state": "pending"}
                audit(self.db, self.owner_id, "memory.index_failed", memory_id, {"error_type": type(exc).__name__}, status="failed")
                self.db.commit()
                raise HTTPException(503, "Memory saved locally; long-term index update is pending") from exc
        return row

    async def delete(self, memory_id: str, version: int) -> dict:
        row = owned(self.db, Record, self.owner_id, memory_id)
        if row.kind != "memory":
            raise HTTPException(404, "Memory not found")
        provider_id = row.extra.get("hy_memory_id")
        erased_content = row.content
        # Legacy proposal audits may contain a raw fact; retain the audit event
        # but remove copied personal content before returning the deletion receipt.
        if erased_content:
            audits = self.db.scalars(select(Record).where(Record.owner_id == self.owner_id, Record.kind == "activity")).all()
            for event in audits:
                if erased_content in json.dumps(event.data, ensure_ascii=False):
                    event.data = {"action": event.data.get("action", "memory.audit_redacted"),
                                  "target_id": event.data.get("target_id", ""),
                                  "details": {"redacted_for_memory_id": memory_id}}
                    event.version += 1
        row = cas_update(self.db, Record, self.owner_id, memory_id, version, {
            "deleted_at": utcnow(), "content": "", "status": "deletion_pending" if provider_id else "deleted",
            "data": {"source": "deleted"}, "extra": {**row.extra, "deletion": "provider_pending" if provider_id else "local_complete"}})
        self.db.commit()
        if self.store:
            await self.store.adelete((self.owner_id, "memories"), memory_id)
        if provider_id:
            if not self.hy_memory:
                audit(self.db, self.owner_id, "memory.deletion_pending", memory_id, status="blocked")
                self.db.commit()
                return {"deleted": True, "provider_purge_verified": False, "status": "deletion_pending"}
            receipt = await self.hy_memory.delete(self.owner_id, provider_id)
            audit(self.db, self.owner_id, "memory.provider_delete", memory_id, {"receipt": str(receipt)})
        audit(self.db, self.owner_id, "memory.deleted", memory_id)
        self.db.commit()
        return {"deleted": True, "provider_purge_verified": not bool(provider_id), "status": row.status}
