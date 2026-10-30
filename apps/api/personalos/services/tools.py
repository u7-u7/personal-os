import asyncio
import hashlib
import uuid
from datetime import timedelta

from fastapi import HTTPException
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from sqlalchemy.orm import Session

from personalos.config import get_settings
from personalos.db import utcnow
from personalos.models import Record
from personalos.services.network import validate_public_url
from personalos.services.accounts import account_lease, assert_account_writable
from personalos.services.records import audit, owned


async def mcp_tools(db: Session, owner_id: str, integration_id: str) -> list[dict]:
    row = owned(db, Record, owner_id, integration_id)
    await require_mcp_trust(row)
    async with asyncio.timeout(30):
        async with streamablehttp_client(row.data["url"]) as (read, write, _):
            async with ClientSession(read, write) as client:
                await client.initialize()
                result = await client.list_tools()
    return [tool.model_dump(mode="json") for tool in result.tools]


async def require_mcp_trust(row: Record) -> None:
    if row.kind != "integration" or row.data.get("kind") != "mcp" or not row.data.get("trusted"):
        raise HTTPException(403, "Explicitly trust this MCP connection before calling tools")
    allowed = {host.strip() for host in get_settings().mcp_allowed_hosts.split(",") if host.strip()}
    await validate_public_url(row.data.get("url", ""), allowed)


async def mcp_call(db: Session, owner_id: str, integration_id: str, tool: str, arguments: dict, *, expected_version: int, expected_fingerprint: str) -> dict:
    row = owned(db, Record, owner_id, integration_id)
    fingerprint = hashlib.sha256(row.data.get("url", "").encode()).hexdigest()
    if row.version != expected_version or fingerprint != expected_fingerprint:
        raise HTTPException(409, "MCP connection changed after approval; request fresh approval")
    await require_mcp_trust(row)
    if tool not in row.data.get("permissions", []):
        raise HTTPException(403, "Tool permission has not been granted")
    async with asyncio.timeout(30):
        async with streamablehttp_client(row.data["url"]) as (read, write, _):
            async with ClientSession(read, write) as client:
                await client.initialize()
                result = await client.call_tool(tool, arguments)
    if result.isError:
        raise HTTPException(502, "MCP tool returned an error")
    return result.model_dump(mode="json")


def request_approval(db: Session, owner_id: str, tool: str, arguments: dict, title: str) -> Record:
    assert_account_writable(db, owner_id)
    if tool == "mcp.call":
        connection = owned(db, Record, owner_id, arguments["integration_id"])
        if connection.kind != "integration" or connection.data.get("kind") != "mcp" or not connection.data.get("trusted") or arguments["tool"] not in connection.data.get("permissions", []):
            raise HTTPException(403, "MCP tool permission is not granted")
        arguments = {**arguments, "integration_version": connection.version,
                     "server_fingerprint": hashlib.sha256(connection.data.get("url", "").encode()).hexdigest()}
    row = Record(owner_id=owner_id, kind="approval", title=title, status="pending",
                 due_at=utcnow() + timedelta(hours=24),
                 data={"tool": tool, "arguments": arguments, "request_id": str(uuid.uuid4())})
    db.add(row)
    db.flush()
    audit(db, owner_id, "approval.requested", row.id, {"tool": tool}, status="pending")
    db.commit()
    return row


async def execute_approval(db: Session, owner_id: str, row: Record) -> dict:
    if row.data.get("tool") == "account.delete":
        return await _execute_approval(db, owner_id, row)
    with account_lease(db, owner_id, exclusive=row.data.get("tool") == "memory.delete"):
        return await _execute_approval(db, owner_id, row)


async def _execute_approval(db: Session, owner_id: str, row: Record) -> dict:
    from personalos.services.memory import MemoryService
    from personalos.services.records import cas_update
    tool, args = row.data["tool"], row.data["arguments"]
    if tool == "account.delete":
        from personalos.services.privacy import delete_account
        return await delete_account(db, owner_id, row.id)
    if tool == "mcp.call":
        return await mcp_call(db, owner_id, args["integration_id"], args["tool"], args["arguments"], expected_version=args["integration_version"], expected_fingerprint=args["server_fingerprint"])
    if tool == "code_hosting.write":
        from personalos.services.hosting import execute_code_hosting_write
        return await execute_code_hosting_write(db, owner_id, args)
    if tool == "memory.delete":
        from personalos.services.agent import durable_graph_resources
        async with durable_graph_resources() as (saver, store):
            return await MemoryService(db, owner_id, store=store).delete(
                args["id"], args["version"], approval_id=row.id, saver=saver)
    if tool == "record.delete":
        target = owned(db, Record, owner_id, args["id"])
        if target.kind not in {"task", "event", "integration"}:
            raise HTTPException(403, "Unsupported deletion target")
        target = cas_update(db, Record, owner_id, target.id, args["version"], {"deleted_at": utcnow()})
        if target.kind == "integration":
            target.extra = {}
        db.commit()
        return {"deleted": True, "id": target.id}
    raise HTTPException(403, "Tool is not in the executable allowlist")
