from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from croniter import croniter
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=256)
    name: str = Field(default="Personal workspace", min_length=1, max_length=120)


class TaskInput(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    content: str = Field(default="", max_length=10000)
    priority: Literal["low", "medium", "high"] = "medium"
    status: Literal["todo", "in_progress", "done", "cancelled"] = "todo"
    due_at: datetime | None = None
    extra: dict = Field(default_factory=dict)


class MemoryInput(BaseModel):
    content: str = Field(min_length=1, max_length=10000)
    category: Literal["preference", "goal", "fact", "task_context"] = "fact"
    status: Literal["pending", "confirmed"] = "pending"
    source: str = Field(default="manual", max_length=500)
    extra: dict = Field(default_factory=dict)

    @field_validator("extra")
    @classmethod
    def safe_memory_extra(cls, value):
        if set(value) - {"fact_key", "supersedes", "tags"}:
            raise ValueError("Memory extra supports only fact_key, supersedes and tags; provider metadata is server-managed")
        if "supersedes" in value and (not isinstance(value["supersedes"], list) or not all(isinstance(item, str) for item in value["supersedes"])):
            raise ValueError("supersedes must contain memory IDs")
        return value


class EventInput(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    start_at: datetime
    end_at: datetime
    content: str = Field(default="", max_length=10000)
    provider: Literal["local", "google"] = "local"
    extra: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def valid_range(self):
        if not self.start_at.tzinfo or not self.end_at.tzinfo:
            raise ValueError("Event timestamps must include a timezone")
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class AutomationInput(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    prompt: str = Field(min_length=1, max_length=10000)
    cron: str | None = Field(default="0 8 * * *", max_length=120)
    next_run_at: datetime | None = None
    timezone: str = "Asia/Shanghai"
    status: Literal["active", "paused", "cancelled", "completed"] = "active"
    extra: dict = Field(default_factory=dict)

    @field_validator("cron")
    @classmethod
    def validate_cron(cls, value):
        if value is not None and (len(value.split()) != 5 or not croniter.is_valid(value)):
            raise ValueError("Use a five-field cron expression")
        return value

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value):
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("Unknown IANA timezone") from exc
        return value


class ChatInput(BaseModel):
    message: str = Field(min_length=1, max_length=20000)
    session_id: str | None = None
    model: str | None = Field(default=None, max_length=100)


class ApprovalInput(BaseModel):
    decision: Literal["approved", "rejected"]
    version: int = Field(ge=1)


class SettingsInput(BaseModel):
    embedding_model: Literal["qwen3.7-text-embedding-flash"] | None = None
    embedding_base_url: str | None = Field(default=None, max_length=2000)
    embedding_api_key: str | None = Field(default=None, max_length=1000)
    embedding_dimensions: Literal[1024, 768, 512, 256] | None = None
    fast_model: str | None = Field(default=None, max_length=100)
    reasoning_model: str | None = Field(default=None, max_length=100)
    decision_provider: Literal["rules", "llm", "jev"] | None = None
    model: str | None = Field(default=None, max_length=100)
    base_url: str | None = Field(default=None, max_length=2000)
    api_key: str | None = Field(default=None, max_length=1000)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    memory_enabled: bool | None = None
    theme: Literal["light", "dark", "system"] | None = None
    timezone: str | None = None
    version: int = Field(ge=1)

    @field_validator("model", "base_url", "api_key", "embedding_base_url", "embedding_api_key",
                     "fast_model", "reasoning_model")
    @classmethod
    def trim_model_configuration(cls, value):
        return value.strip() if value is not None else None


class IntegrationInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    kind: Literal["mcp", "google_calendar"]
    url: str = Field(default="", max_length=2000)
    trusted: bool = False
    permissions: list[str] = Field(default_factory=list, max_length=100)
    extra: dict = Field(default_factory=dict)
