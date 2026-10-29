"""Consent-controlled memory. Relational facts remain separate from conversation state."""
from fastapi import HTTPException
import asyncio
import hashlib
from heapq import nlargest
from itertools import chain
from sqlalchemy import select, text
from sqlalchemy.engine import RowMapping
from sqlalchemy.orm import Session

from personalos.models import Record, User
from personalos.services.records import audit, cas_update, create_record, owned
from personalos.services.accounts import account_lease


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
        if limit <= 0:
            return []
        terms = set(query.lower().split())
        candidates = select(Record.id, Record.content, Record.data).where(
            Record.owner_id == self.owner_id, Record.kind == "memory", Record.status == "confirmed",
            Record.deleted_at.is_(None),
        ).order_by(Record.updated_at.desc(), Record.id.desc())
        if not terms:
            candidates = candidates.limit(limit)

        def relevance(row: RowMapping) -> int:
            content = row["content"].lower()
            return sum(term in content for term in terms)

        # Rank every canonical, consented fact before applying the result limit.
        # A server cursor and bounded heap avoid loading all ORM entities or
        # generating a large SQL expression for long, many-word requests.
        # Stable input order also preserves recent-first ties and zero-hit fallback.
        rows: list[RowMapping] = []
        async with asyncio.timeout(30):
            with self.db.execute(candidates.execution_options(yield_per=200)) as result:
                for batch in result.mappings().partitions(200):
                    rows = nlargest(limit, chain(rows, batch), key=relevance)
                    # Let deadlines/cancellation run between batches; a stopped
                    # request closes its cursor and never returns partial recall.
                    await asyncio.sleep(0)
        return [{"id": row["id"], "content": row["content"], "source": row["data"].get("source")} for row in rows]

    async def confirm(self, memory_id: str, version: int) -> Record:
        with account_lease(self.db, self.owner_id):
            return await self._confirm(memory_id, version)

    async def _confirm(self, memory_id: str, version: int) -> Record:
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
            saved_version, saved_extra = row.version, dict(row.extra)
            try:
                await self.store.aput((self.owner_id, "memories"), row.id, {"content": row.content, "source": row.data.get("source")})
            except Exception as exc:
                row.extra = {**row.extra, "index_state": "pending"}
                audit(self.db, self.owner_id, "memory.index_failed", memory_id, {"error_type": type(exc).__name__}, status="failed")
                self.db.commit()
                raise HTTPException(503, "Memory saved locally; long-term index update is pending") from exc
            # Resolve only this Store marker. CAS fences concurrent edits and
            # account erasure after the async write; Hy indexes remain separate.
            if saved_extra.get("index_state") == "pending":
                row = cas_update(self.db, Record, self.owner_id, memory_id, saved_version,
                                 {"extra": {key: value for key, value in saved_extra.items() if key != "index_state"}})
                self.db.commit()
        return row

    async def delete(self, memory_id: str, version: int, *, approval_id: str | None = None, saver=None) -> dict:
        from personalos.services.memory_deletion import MemoryDeletion
        with account_lease(self.db, self.owner_id, exclusive=True):
            return await MemoryDeletion(self.db, self.owner_id, self.store, saver, self.hy_memory).run(
                memory_id, version, approval_id or f"direct:{memory_id}:{version}")
