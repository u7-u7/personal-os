import hashlib
import json
import logging
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

logger = logging.getLogger(__name__)

password_hasher = PasswordHash.recommended()
COOKIE_NAME = "personalos_session"


def fernet() -> Fernet:
    """Build the cipher for stored credentials, refusing a misconfigured key.

    A Fernet key is exactly 32 random bytes encoded as 44 url-safe base64
    characters. A plain ``secrets.token_urlsafe(32)`` value is 43 characters
    and must be rejected here: letting the constructor raise would surface as an
    opaque 500 on every settings save instead of an actionable setup error.
    """
    key = get_settings().encryption_key.strip()
    if not key:
        raise HTTPException(503, "Server encryption is unavailable: set ENCRYPTION_KEY before storing credentials")
    try:
        return Fernet(key.encode())
    except (ValueError, TypeError) as exc:
        logger.error("invalid_encryption_key length=%s", len(key))
        raise HTTPException(503, "ENCRYPTION_KEY is not a valid Fernet key. Set it to 32 random bytes "
                                 "encoded as url-safe base64, then restart the API") from exc


def encrypt_config(data: dict) -> str:
    return fernet().encrypt(json.dumps(data).encode()).decode()


def decrypt_config(value: str | None) -> dict:
    if not value:
        return {}
    cipher = fernet()
    try:
        return json.loads(cipher.decrypt(value.encode()))
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
