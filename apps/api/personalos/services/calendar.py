import hashlib
import secrets
from datetime import timedelta
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from personalos.config import get_settings
from personalos.db import utcnow
from personalos.models import Record
from personalos.security import decrypt_config, encrypt_config
from personalos.services.records import audit

GOOGLE_SCOPES = "https://www.googleapis.com/auth/calendar.events"


def oauth_start(db: Session, owner_id: str) -> str:
    config = get_settings()
    if not config.google_client_id or not config.google_client_secret:
        raise HTTPException(503, "Google Calendar OAuth is not configured on this server")
    state = secrets.token_urlsafe(32)
    db.add(Record(owner_id=owner_id, kind="oauth_state", title=hashlib.sha256(state.encode()).hexdigest(),
                  due_at=utcnow() + timedelta(minutes=10)))
    db.commit()
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({
        "client_id": config.google_client_id, "redirect_uri": config.google_redirect_uri,
        "response_type": "code", "scope": GOOGLE_SCOPES, "state": state,
        "access_type": "offline", "prompt": "consent"})


async def oauth_complete(db: Session, owner_id: str, state: str, code: str) -> None:
    record = db.scalar(select(Record).where(Record.owner_id == owner_id, Record.kind == "oauth_state",
                       Record.title == hashlib.sha256(state.encode()).hexdigest(),
                       Record.status == "active", Record.due_at > utcnow(), Record.deleted_at.is_(None)))
    if not record:
        raise HTTPException(400, "OAuth state expired or invalid")
    # Consume before exchange; callback replay must not exchange credentials twice.
    claimed = db.execute(update(Record).where(Record.id == record.id, Record.status == "active").values(status="consumed", version=record.version + 1))
    if claimed.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "OAuth callback has already been consumed")
    db.commit()
    config = get_settings()
    async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
        response = await client.post("https://oauth2.googleapis.com/token", data={
            "code": code, "client_id": config.google_client_id, "client_secret": config.google_client_secret,
            "redirect_uri": config.google_redirect_uri, "grant_type": "authorization_code"})
    if response.is_error:
        raise HTTPException(502, "Google OAuth token exchange failed")
    tokens = response.json()
    integrations = db.scalars(select(Record).where(Record.owner_id == owner_id, Record.kind == "integration", Record.deleted_at.is_(None))).all()
    existing = next((row for row in integrations if row.data.get("kind") == "google_calendar"), None)
    row = existing or Record(owner_id=owner_id, kind="integration", title="Google Calendar")
    row.status = "connected"
    row.data = {"kind": "google_calendar", "permissions": [GOOGLE_SCOPES], "trusted": True}
    row.extra = {"encrypted_tokens": encrypt_config(tokens),
                 "expires_at": (utcnow() + timedelta(seconds=tokens.get("expires_in", 3600))).isoformat()}
    db.add(row)
    audit(db, owner_id, "calendar.oauth_connected")
    db.commit()


async def calendar_token(db: Session, owner_id: str, *, commit: bool = True) -> str:
    integrations = db.scalars(select(Record).where(Record.owner_id == owner_id, Record.kind == "integration",
                             Record.status == "connected", Record.deleted_at.is_(None))).all()
    row = next((r for r in integrations if r.data.get("kind") == "google_calendar"), None)
    if not row:
        raise HTTPException(409, "Connect Google Calendar with OAuth first")
    tokens = decrypt_config(row.extra.get("encrypted_tokens"))
    from datetime import datetime
    if row.extra.get("expires_at") and datetime.fromisoformat(row.extra["expires_at"]) <= utcnow():
        if not tokens.get("refresh_token"):
            raise HTTPException(401, "Reconnect Google Calendar to refresh authorization")
        config = get_settings()
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            response = await client.post("https://oauth2.googleapis.com/token", data={
                "client_id": config.google_client_id, "client_secret": config.google_client_secret,
                "refresh_token": tokens["refresh_token"], "grant_type": "refresh_token"})
        if response.is_error:
            raise HTTPException(502, "Google Calendar token refresh failed")
        tokens.update(response.json())
        row.extra = {"encrypted_tokens": encrypt_config(tokens),
                     "expires_at": (utcnow() + timedelta(seconds=tokens.get("expires_in", 3600))).isoformat()}
        if commit:
            db.commit()
    return tokens["access_token"]


async def list_google_events(db: Session, owner_id: str, start: str, end: str, *, commit_token: bool = True) -> list[dict]:
    token = await calendar_token(db, owner_id, commit=commit_token)
    async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
        response = await client.get("https://www.googleapis.com/calendar/v3/calendars/primary/events",
                                    headers={"Authorization": f"Bearer {token}"},
                                    params={"timeMin": start, "timeMax": end, "singleEvents": "true", "maxResults": 250})
    if response.is_error:
        raise HTTPException(502, "Google Calendar query failed")
    return response.json().get("items", [])


async def write_google_event(db: Session, owner_id: str, args: dict) -> dict:
    from datetime import datetime
    from personalos.services.records import ensure_no_conflict
    ensure_no_conflict(db, owner_id, datetime.fromisoformat(args["start_at"]), datetime.fromisoformat(args["end_at"]))
    await ensure_google_no_conflict(db, owner_id, args["start_at"], args["end_at"])
    token = await calendar_token(db, owner_id)
    payload = {"summary": args["title"], "description": args.get("content", ""),
               "start": {"dateTime": args["start_at"]}, "end": {"dateTime": args["end_at"]}}
    # Google accepts a caller-supplied stable event ID, preventing duplicate creation after an ambiguous response.
    if args.get("external_id"):
        payload["id"] = args["external_id"]
    async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
        response = await client.post("https://www.googleapis.com/calendar/v3/calendars/primary/events",
                                    headers={"Authorization": f"Bearer {token}"}, json=payload)
    if response.is_error:
        raise HTTPException(502, "Google Calendar write failed; inspect execution before retrying")
    result = response.json()
    from datetime import datetime
    from personalos.services.records import create_record
    create_record(db, owner_id, "event", {"title": args["title"], "content": args.get("content", ""),
                  "start_at": datetime.fromisoformat(args["start_at"]), "end_at": datetime.fromisoformat(args["end_at"]),
                  "provider": "google", "external_id": result["id"], "external_etag": result.get("etag")})
    return {"external_id": result["id"], "html_link": result.get("htmlLink"), "undo_supported": True}


async def get_google_event(db: Session, owner_id: str, event_id: str) -> dict:
    import re
    if not re.fullmatch(r"[a-zA-Z0-9_@.\-]{1,300}", event_id):
        raise HTTPException(422, "Invalid Google event ID")
    token = await calendar_token(db, owner_id)
    async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
        response = await client.get(f"https://www.googleapis.com/calendar/v3/calendars/primary/events/{event_id}",
                                    headers={"Authorization": f"Bearer {token}"})
    if response.status_code == 404:
        raise HTTPException(404, "Google event was not found")
    if response.is_error:
        raise HTTPException(502, "Google Calendar query failed")
    return response.json()


async def modify_google_event(db: Session, owner_id: str, args: dict, *, delete: bool = False) -> dict:
    if not delete:
        from datetime import datetime
        from personalos.services.records import ensure_no_conflict
        mirrors = db.scalars(select(Record).where(Record.owner_id == owner_id, Record.kind == "event", Record.deleted_at.is_(None))).all()
        own_mirror = next((r for r in mirrors if r.data.get("external_id") == args["external_id"]), None)
        ensure_no_conflict(db, owner_id, datetime.fromisoformat(args["start_at"]), datetime.fromisoformat(args["end_at"]), own_mirror.id if own_mirror else "")
        await ensure_google_no_conflict(db, owner_id, args["start_at"], args["end_at"], args["external_id"])
    from urllib.parse import quote
    from personalos.services.records import audit
    token = await calendar_token(db, owner_id)
    event_id = args["external_id"]
    url = f"https://www.googleapis.com/calendar/v3/calendars/primary/events/{quote(event_id, safe='')}"
    headers = {"Authorization": f"Bearer {token}", "If-Match": args["etag"]}
    async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
        if delete:
            response = await client.delete(url, headers=headers)
        else:
            response = await client.patch(url, headers=headers, json={
                "summary": args["title"], "description": args.get("content", ""),
                "start": {"dateTime": args["start_at"]}, "end": {"dateTime": args["end_at"]}})
    if response.status_code == 412:
        raise HTTPException(409, "Google event changed since approval was requested; request fresh approval")
    if response.is_error:
        raise HTTPException(502, "Google Calendar operation failed; reconcile before retrying")
    mirrors = db.scalars(select(Record).where(Record.owner_id == owner_id, Record.kind == "event", Record.deleted_at.is_(None))).all()
    mirror = next((row for row in mirrors if row.data.get("external_id") == event_id), None)
    if mirror:
        if delete:
            mirror.deleted_at = utcnow()
        else:
            from datetime import datetime
            mirror.title = args["title"]
            mirror.content = args.get("content", "")
            mirror.start_at = datetime.fromisoformat(args["start_at"])
            mirror.end_at = datetime.fromisoformat(args["end_at"])
        mirror.version += 1
    audit(db, owner_id, "calendar.deleted" if delete else "calendar.updated", event_id)
    db.commit()
    return {"deleted": True, "external_id": event_id} if delete else response.json()


async def disconnect_google(db: Session, owner_id: str, integration_id: str, *, commit: bool = True) -> dict:
    from personalos.services.records import owned
    row = owned(db, Record, owner_id, integration_id)
    if row.kind != "integration" or row.data.get("kind") != "google_calendar":
        raise HTTPException(404, "Google Calendar connection not found")
    tokens = decrypt_config(row.extra.get("encrypted_tokens"))
    token = tokens.get("refresh_token") or tokens.get("access_token")
    if token:
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            response = await client.post("https://oauth2.googleapis.com/revoke", data={"token": token})
        # Do not destroy the only revocation credential after an ambiguous/failed remote request.
        if response.status_code != 200:
            raise HTTPException(502, "Google authorization revocation could not be verified")
    row.extra = {}
    row.data = {"kind": "google_calendar", "trusted": False, "permissions": []}
    row.status = "disconnected"
    row.deleted_at = utcnow()
    row.version += 1
    audit(db, owner_id, "calendar.disconnected", row.id)
    if commit:
        db.commit()
    return {"disconnected": True, "authorization_revoked": True}


async def ensure_google_no_conflict(db: Session, owner_id: str, start: str, end: str, exclude_id: str = "") -> None:
    events = await list_google_events(db, owner_id, start, end, commit_token=False)
    conflicts = [event for event in events if event.get("id") != exclude_id and event.get("status") != "cancelled" and event.get("transparency") != "transparent"]
    if conflicts:
        raise HTTPException(409, {"message": "Google Calendar conflict", "event_ids": [item["id"] for item in conflicts]})
