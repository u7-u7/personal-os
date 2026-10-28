import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from personalos.db import Base, utcnow


class Fields:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    extra: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class User(Fields, Base):
    __tablename__ = "users"
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(Text)
    secret_config: Mapped[str | None] = mapped_column(Text, nullable=True)
    preferences: Mapped[dict] = mapped_column(JSON, default=dict)


class AuthSession(Fields, Base):
    __tablename__ = "auth_sessions"
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class Record(Fields, Base):
    """Shared lifecycle storage for tasks, memories, events, approvals and audit records."""
    __tablename__ = "records"
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(500), default="")
    content: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(32), default="active")
    priority: Mapped[str] = mapped_column(String(16), default="medium")
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    __table_args__ = (
        Index("ix_records_owner_kind_deleted_created", "owner_id", "kind", "deleted_at", "created_at"),
        Index("ix_records_owner_kind_status_due", "owner_id", "kind", "status", "due_at"),
        Index("ix_records_owner_events_range", "owner_id", "kind", "start_at", "end_at"),
    )


class Automation(Fields, Base):
    __tablename__ = "automations"
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(500))
    prompt: Mapped[str] = mapped_column(Text)
    cron: Mapped[str | None] = mapped_column(String(120), nullable=True)
    timezone: Mapped[str] = mapped_column(String(100), default="Asia/Shanghai")
    status: Mapped[str] = mapped_column(String(24), default="active")
    next_run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    __table_args__ = (Index("ix_automation_claim", "status", "deleted_at", "next_run_at", "lease_until"),)


class Execution(Fields, Base):
    __tablename__ = "executions"
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    automation_id: Mapped[str] = mapped_column(ForeignKey("automations.id"), index=True)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    run_key: Mapped[str] = mapped_column(String(200), unique=True)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    claim_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    __table_args__ = (Index("ix_execution_claim", "status", "lease_until"),)


class Message(Fields, Base):
    __tablename__ = "messages"
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    session_id: Mapped[str] = mapped_column(ForeignKey("records.id"))
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    __table_args__ = (Index("ix_messages_owner_session_created", "owner_id", "session_id", "created_at"),)
