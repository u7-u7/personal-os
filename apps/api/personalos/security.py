import hashlib
import json
import secrets
from datetime import timedelta

from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, HTTPException, Request, Response
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.orm import Session

from personalos.config import get_settings
from personalos.db import get_db, utcnow
from personalos.models import AuthSession, User

password_hasher = PasswordHash.recommended()
COOKIE_NAME = "personalos_session"


def encrypt_config(data: dict) -> str:
    key = get_settings().encryption_key
    if not key:
        raise HTTPException(503, "Set ENCRYPTION_KEY on the server before storing credentials")
    return Fernet(key.encode()).encrypt(json.dumps(data).encode()).decode()


def decrypt_config(value: str | None) -> dict:
    if not value:
        return {}
    key = get_settings().encryption_key
    if not key:
        raise HTTPException(503, "Server encryption is unavailable")
    try:
        return json.loads(Fernet(key.encode()).decrypt(value.encode()))
    except (ValueError, InvalidToken) as exc:
        raise HTTPException(503, "Stored credentials cannot be decrypted") from exc


def new_session(db: Session, user: User, response: Response) -> None:
    from personalos.services.accounts import assert_account_writable
    assert_account_writable(db, user.id)
    token = secrets.token_urlsafe(48)
    days = get_settings().session_days
    db.add(AuthSession(owner_id=user.id, token_hash=hashlib.sha256(token.encode()).hexdigest(),
                       expires_at=utcnow() + timedelta(days=days)))
    db.commit()
    response.set_cookie(COOKIE_NAME, token, httponly=True, secure=get_settings().cookie_secure,
                        samesite="lax", max_age=days * 86400, path="/")


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(401, "Sign in to your PersonalOS account")
    session = db.scalar(select(AuthSession).where(
        AuthSession.token_hash == hashlib.sha256(token.encode()).hexdigest(),
        AuthSession.expires_at > utcnow(), AuthSession.deleted_at.is_(None)))
    if not session:
        raise HTTPException(401, "Your session has expired")
    user = db.get(User, session.owner_id)
    if not user or user.deleted_at:
        raise HTTPException(401, "Account is unavailable")
    return user
