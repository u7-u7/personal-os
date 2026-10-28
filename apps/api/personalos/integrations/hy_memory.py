"""Optional official Hy Memory adapter; no model credentials leave the server.

The SQL memory ledger owns consent, provenance and indexing state. Calling this
adapter must happen only after the ledger transaction has confirmed consent.
"""
from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import dataclass
from typing import Any, Literal


class IntegrationUnavailable(RuntimeError):
    pass


class MemoryWriteOutcomeUnknown(TimeoutError):
    def __init__(self, request_id: str, operation_id: str):
        self.request_id = request_id
        self.operation_id = operation_id
        super().__init__(f"Hy Memory write outcome unknown; reconcile request_id={request_id} before retry")


class MemoryNotFound(LookupError):
    pass


@dataclass(frozen=True)
class DeleteReceipt:
    memory_id: str
    record_absent: bool
    sdk_success: bool
    index_cleanup_verified: bool = False
    cache_cleanup_verified: bool = False
    reason: str = "Exact ID readback only; auxiliary indexes, history and caches need storage-level verification."


class HyMemoryService:
    """Chat and Working Memory behind one owner-scoped service boundary.

    Deliberately no local fake/implicit fallback. Timeouts on writes have an
    unknown outcome: the caller must reconcile against its durable ledger,
    rather than immediately replaying a write.
    """

    def __init__(self, config: dict[str, Any], timeout_seconds: float = 30):
        self.config = config
        self.timeout_seconds = timeout_seconds
        self._client: Any = None
        self._init_task: asyncio.Task | None = None

    def _get_client(self) -> Any:
        if self._client is None:
            if not self.config.get("llm", {}).get("api_key") or not self.config.get("embedder", {}).get("api_key"):
                raise IntegrationUnavailable("Hy Memory requires configured LLM and embedding credentials")
            try:
                from hy_memory import HyMemoryClient
                self._client = HyMemoryClient.from_config({**self.config, "mode": "pro"})
            except ImportError as exc:
                raise IntegrationUnavailable("Install the optional hy-memory==2.0.7 dependency") from exc
        return self._client

    async def _ready(self) -> Any:
        # SDK construction starts its own loop and performs synchronous setup.
        # Keep it off the ASGI loop; retain the task if a caller times out so
        # another caller cannot create a second client/storage writer.
        if self._client is not None:
            return self._client
        if self._init_task is None:
            self._init_task = asyncio.create_task(asyncio.to_thread(self._get_client))
        try:
            return await asyncio.shield(self._init_task)
        except Exception:
            if self._init_task.done():
                self._init_task = None
            raise

    @staticmethod
    def _owner(owner_id: str) -> None:
        if not owner_id or not owner_id.strip():
            raise ValueError("A nonempty authenticated owner ID is required")

    async def add_confirmed(self, owner_id: str, messages: str | list[dict[str, Any]], *, source_id: str,
                            scene: Literal["chat", "working"] = "chat", consent: bool = False,
                            operation_id: str | None = None) -> dict[str, Any]:
        self._owner(owner_id)
        if consent is not True:
            raise PermissionError("Memory consent must be recorded before indexing")
        if not source_id:
            raise ValueError("Memory provenance source_id is required")
        if scene not in {"chat", "working"}:
            raise ValueError("Unsupported memory scene")
        if scene == "working" and (not isinstance(messages, list) or not any(
            item.get("role") == "tool" or item.get("tool_calls") for item in messages
        )):
            raise ValueError("Working memory requires a real tool execution trace")
        operation_id = operation_id or str(uuid.uuid4())
        request_id = str(uuid.uuid5(uuid.NAMESPACE_URL, json.dumps([owner_id, operation_id], separators=(",", ":"))))
        try:
            async with asyncio.timeout(self.timeout_seconds):
                client = await self._ready()
                return await client.async_add(
                    messages, user_id=owner_id, scene=scene, source="personalos", session_id=source_id,
                    request_id=request_id, meta={"source_id": source_id, "consent": True},
                )
        except TimeoutError as exc:
            raise MemoryWriteOutcomeUnknown(request_id, operation_id) from exc

    async def write_outcome(self, owner_id: str, operation_id: str) -> dict[str, Any] | None:
        """Look up a caller-owned durable operation without resubmitting it."""
        self._owner(owner_id)
        request_id = str(uuid.uuid5(uuid.NAMESPACE_URL, json.dumps([owner_id, operation_id], separators=(",", ":"))))
        async with asyncio.timeout(self.timeout_seconds):
            client = await self._ready()
            return await client.async_get_write_outcome(request_id)

    async def search(self, owner_id: str, query: str, *, scene: Literal["chat", "working"] = "chat",
                     limit: int = 10) -> dict[str, Any]:
        self._owner(owner_id)
        if scene not in {"chat", "working"} or not 1 <= limit <= 100:
            raise ValueError("Unsupported scene or search limit")
        async with asyncio.timeout(self.timeout_seconds):
            client = await self._ready()
            return await client.async_search(query, user_ids=[owner_id], scene=scene, limit=limit)

    async def get(self, owner_id: str, memory_id: str) -> dict[str, Any]:
        self._owner(owner_id)
        async with asyncio.timeout(self.timeout_seconds):
            client = await self._ready()
            record = await client.async_get(memory_id)
        # SDK ID CRUD does not authorize ownership. Fail closed, including on
        # records where the provider omits user_id.
        if not record or record.get("user_id") != owner_id:
            raise MemoryNotFound(memory_id)
        return record

    async def update(self, owner_id: str, memory_id: str, content: str) -> dict[str, Any]:
        record = await self.get(owner_id, memory_id)
        if not content.strip():
            raise ValueError("Memory content cannot be empty")
        async with asyncio.timeout(self.timeout_seconds):
            client = await self._ready()
            return await client.async_update(
                memory_id, content, kind=record["kind"], variant=record.get("variant"),
            )

    async def delete(self, owner_id: str, memory_id: str) -> DeleteReceipt:
        record = await self.get(owner_id, memory_id)
        async with asyncio.timeout(self.timeout_seconds):
            client = await self._ready()
            result = await client.async_delete(
                memory_id, kind=record["kind"], variant=record.get("variant"),
            )
            remaining = await client.async_get(
                memory_id, kind=record["kind"], variant=record.get("variant"),
            )
        return DeleteReceipt(memory_id, remaining is None, bool(result.get("success")) and not result.get("partial", False))

    async def close(self) -> None:
        if self._client:
            await asyncio.to_thread(self._client.close)
            self._client = None
            self._init_task = None
