"""Durable, approval-bound erasure of canonical memory and framework state."""
import asyncio

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from personalos.db import utcnow
from personalos.models import Record
from personalos.services.accounts import assert_account_writable
from personalos.services.records import audit, cas_update

JOURNAL_KEY = "memory_deletion"
RECOVERABLE = {"failed", "executing", "outcome_unknown", "cleanup_pending"}


def _legacy_candidates(db: Session, owner_id: str, ids: set[str]) -> list[Record]:
    if not ids:
        return []
    return list(db.scalars(select(Record).where(
        Record.owner_id == owner_id, Record.kind == "approval", Record.deleted_at.is_(None),
        Record.status.in_([*RECOVERABLE, "approved"]), Record.data["tool"].as_string() == "memory.delete",
        Record.data["arguments"]["id"].as_string().in_(ids),
    )).all())


def _legacy_allowed(memory: Record, approval_id: str, version: int, candidates: list[Record]) -> bool:
    if not isinstance(version, int) or isinstance(version, bool):
        return False
    matches = [item for item in candidates if item.data.get("arguments", {}) == {"id": memory.id, "version": version}]
    return (len(matches) == 1 and matches[0].id == approval_id and memory.version == version + 1
            and not memory.content and memory.status in {"deleted", "deletion_pending"}
            and memory.extra.get("deletion") in {"local_complete", "provider_pending"})


def cleanup_view(memory: Record | None) -> dict | None:
    if memory is None or memory.deleted_at is None:
        return None
    progress = memory.extra.get(JOURNAL_KEY, {})
    return {"canonical_erased": True, "state": progress.get("state", "unknown"),
            **{stage: progress.get(stage, "unknown") for stage in ("store", "checkpoints", "provider")},
            "last_error_type": progress.get("last_error_type")}


def approval_views(db: Session, owner_id: str, rows: list[Record]) -> list[dict]:
    from personalos.services.records import serialize
    ids = {row.data.get("arguments", {}).get("id") for row in rows if row.data.get("tool") == "memory.delete"}
    memories = {row.id: row for row in db.scalars(select(Record).where(
        Record.owner_id == owner_id, Record.kind == "memory", Record.id.in_(ids),
    )).all()} if ids else {}
    legacy = _legacy_candidates(db, owner_id, {item.id for item in memories.values()
                                              if item.deleted_at and not item.extra.get(JOURNAL_KEY)})
    result = []
    for row in rows:
        view = serialize(row)
        if row.data.get("tool") == "memory.delete":
            memory = memories.get(row.data.get("arguments", {}).get("id"))
            cleanup = cleanup_view(memory)
            legacy_pending = row.status == "approved" and row.data.get("result", {}).get("status") == "deletion_pending"
            args = row.data.get("arguments", {})
            journal = memory.extra.get(JOURNAL_KEY) if memory else None
            valid = False
            if memory is not None:
                if memory.deleted_at is not None:
                    valid = (_legacy_allowed(memory, row.id, args.get("version"), legacy) if journal is None else
                             journal.get("approval_id") == row.id and journal.get("requested_version") == args.get("version"))
                else:
                    valid = memory.version == args.get("version") and (row.due_at is None or row.due_at >= utcnow())
            # A crash may occur after the final journal commit but before the
            # approval result commit. That executing approval still needs resume.
            view.update(cleanup=cleanup, can_resume=valid and (row.status in RECOVERABLE or legacy_pending))
        result.append(view)
    return result


def _contains_fact(value, fact: str) -> bool:
    if isinstance(value, str):
        return fact in value
    if isinstance(value, dict):
        return any(_contains_fact(key, fact) or _contains_fact(item, fact) for key, item in value.items())
    if isinstance(value, list):
        return any(_contains_fact(item, fact) for item in value)
    return False


class MemoryDeletion:
    def __init__(self, db: Session, owner_id: str, store, saver=None, provider=None):
        self.db, self.owner_id = db, owner_id
        self.store, self.saver, self.provider = store, saver, provider

    def _target(self, memory_id: str) -> Record:
        row = self.db.scalar(select(Record).where(Record.id == memory_id, Record.owner_id == self.owner_id,
                                                 Record.kind == "memory"))
        if row is None:
            raise HTTPException(404, "Memory not found")
        return row

    def _redact_audits(self, fact: str) -> None:
        if not fact:
            return
        rows = self.db.scalars(select(Record).where(Record.owner_id == self.owner_id,
                                                   Record.kind == "activity")).yield_per(200)
        for event in rows:
            if _contains_fact([event.data, event.extra, event.title, event.content], fact):
                event.data = {"action": "memory.audit_redacted", "target_id": self.row.id,
                              "details": {"redacted_for_memory_id": self.row.id}}
                event.title, event.content, event.extra = "memory.audit_redacted", "", {}
                event.version += 1
                event.updated_at = utcnow()

    def _legacy_binding(self, approval_id: str, version: int) -> None:
        # Old releases did not persist an operation ID. Only an unambiguous,
        # exact-version legacy tombstone can be adopted; never guess a target.
        candidates = _legacy_candidates(self.db, self.owner_id, {self.row.id})
        if not _legacy_allowed(self.row, approval_id, version, candidates):
            raise HTTPException(409, "Legacy deletion cannot be safely matched to this approval")

    def _begin(self, memory_id: str, version: int, approval_id: str) -> None:
        self.row = self._target(memory_id)
        journal = self.row.extra.get(JOURNAL_KEY)
        if journal:
            if (journal.get("approval_id") != approval_id or journal.get("requested_version") != version
                    or self.row.deleted_at is None):
                raise HTTPException(409, "Memory deletion belongs to a different approved operation")
            self.progress = dict(journal)
            return
        if self.row.deleted_at is not None:
            self._legacy_binding(approval_id, version)
        elif self.row.version != version:
            raise HTTPException(409, "Memory changed after approval; request fresh approval")
        provider_id = self.row.extra.get("hy_memory_id")
        self.progress = {"approval_id": approval_id, "requested_version": version, "state": "pending",
                         "store": "pending", "checkpoints": "pending", "checkpoint_cursor": "",
                         "provider": "authorization_required" if provider_id else "not_required"}
        extra = {JOURNAL_KEY: self.progress, "deletion": "pending"}
        if provider_id:
            extra["hy_memory_id"] = provider_id
        self._redact_audits(self.row.content)
        if self.row.deleted_at is None:
            self.row = cas_update(self.db, Record, self.owner_id, memory_id, version, {
                "deleted_at": utcnow(), "title": "", "content": "", "status": "deletion_pending",
                "data": {"source": "deleted"}, "extra": extra})
            self.db.commit()
        else:
            self.row.extra = extra
            self._save()

    def _save(self, **stages) -> None:
        assert_account_writable(self.db, self.owner_id)
        self.progress = {**self.progress, **stages}
        self.row.extra = {**self.row.extra, JOURNAL_KEY: self.progress}
        self.row.status = "deleted" if self.progress["state"] == "complete" else "deletion_pending"
        self.row.updated_at = utcnow()
        self.row.version += 1
        self.db.commit()

    async def _clear_store(self) -> None:
        if self.progress["store"] == "complete":
            return
        if self.store is None:
            raise HTTPException(503, "Memory Store cleanup is unavailable")
        async with asyncio.timeout(30):
            await self.store.adelete((self.owner_id, "memories"), self.row.id)
            if await self.store.aget((self.owner_id, "memories"), self.row.id) is not None:
                raise RuntimeError("Memory Store deletion readback was not empty")
        self._save(store="complete", last_error_type=None)

    async def _clear_checkpoints(self) -> None:
        if self.progress["checkpoints"] == "complete":
            return
        if self.saver is None:
            raise HTTPException(503, "Conversation state cleanup is unavailable")
        while True:
            # Keyset pagination includes soft-deleted sessions and has no total
            # cap. The exclusive lease prevents Agent checkpoint writes here.
            ids = list(self.db.scalars(select(Record.id).where(
                Record.owner_id == self.owner_id, Record.kind == "chat_session",
                Record.id > self.progress["checkpoint_cursor"],
            ).order_by(Record.id).limit(100)).all())
            if not ids:
                self._save(checkpoints="complete", last_error_type=None)
                return
            async with asyncio.timeout(30):
                for session_id in ids:
                    thread = f"{self.owner_id}:{session_id}"
                    await self.saver.adelete_thread(thread)
                    if await self.saver.aget_tuple({"configurable": {"thread_id": thread}}) is not None:
                        raise RuntimeError("Conversation deletion readback was not empty")
            self._save(checkpoint_cursor=ids[-1], last_error_type=None)

    async def _clear_provider(self) -> None:
        if self.progress["provider"] in {"not_required", "verified"}:
            return
        if self.provider is None:
            self._save(provider="authorization_required")
            return
        async with asyncio.timeout(30):
            receipt = await self.provider.delete(self.owner_id, self.row.extra["hy_memory_id"])
        verified = all(getattr(receipt, key, False) for key in (
            "record_absent", "sdk_success", "index_cleanup_verified", "cache_cleanup_verified"))
        self._save(provider="verified" if verified else "unverified")

    def receipt(self) -> dict:
        return {"deleted": True, "canonical_data_erased": True, "cleanup_complete": self.progress["state"] == "complete",
                "provider_purge_verified": self.progress["provider"] in {"not_required", "verified"},
                "checkpoint_state_cleared": self.progress["checkpoints"] == "complete",
                "conversation_history_retained": True, "status": self.row.status,
                "cleanup": cleanup_view(self.row)}

    async def run(self, memory_id: str, version: int, approval_id: str) -> dict:
        self._begin(memory_id, version, approval_id)
        if self.progress["state"] == "complete":
            return self.receipt()
        try:
            await self._clear_store()
            await self._clear_checkpoints()
            await self._clear_provider()
        except Exception as exc:
            self.db.rollback()
            self.row = self._target(memory_id)
            self.progress = dict(self.row.extra[JOURNAL_KEY])
            self._save(last_error_type=type(exc).__name__)
            audit(self.db, self.owner_id, "memory.cleanup_interrupted", memory_id,
                  {"error_type": type(exc).__name__}, status="failed")
            self.db.commit()
            raise HTTPException(503, "Memory cleanup interrupted; resume the original approval in Activity") from exc
        complete = self.progress["provider"] in {"not_required", "verified"}
        if self.progress["provider"] == "verified":
            self.row.extra = {key: value for key, value in self.row.extra.items() if key != "hy_memory_id"}
        self._save(state="complete" if complete else "pending", last_error_type=None)
        audit(self.db, self.owner_id, "memory.deleted" if complete else "memory.deletion_pending", memory_id,
              status="succeeded" if complete else "blocked")
        self.db.commit()
        return self.receipt()
