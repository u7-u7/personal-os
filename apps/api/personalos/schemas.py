from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from croniter import croniter
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from personalos.config import EmbeddingDimensions, EmbeddingModel


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=256)
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


class CalendarCreateInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    color: str = Field(default="blue", max_length=20)


class CalendarPatchInput(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    color: str | None = Field(default=None, max_length=20)
    position: int | None = Field(default=None, ge=0)
    visible: bool | None = None


class EventOverrideInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=1, max_length=500)
    content: str | None = Field(default=None, max_length=10000)
    location: str | None = Field(default=None, max_length=500)
    all_day: bool | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None


class EventInput(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    start_at: datetime
    end_at: datetime
    content: str = Field(default="", max_length=10000)
    # Only local events exist; the field stays so stored rows keep a uniform shape.
    provider: Literal["local"] = "local"
    calendar_id: str | None = Field(default=None, max_length=36)
    location: str = Field(default="", max_length=500)
    all_day: bool = False
    timezone: str = Field(default="Asia/Shanghai", max_length=100)
    rrule: str | None = Field(default=None, max_length=500)
    exdates: list[datetime] = Field(default_factory=list, max_length=500)
    overrides: dict[str, EventOverrideInput] = Field(default_factory=dict, max_length=500)
    reminders: list[int] = Field(default_factory=list, max_length=5)
    extra: dict = Field(default_factory=dict)

    @field_validator("timezone")
    @classmethod
    def validate_event_timezone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("Unknown IANA timezone") from exc
        return value

    @field_validator("rrule")
    @classmethod
    def validate_rrule(cls, value):
        from personalos.services.recurrence import RecurrenceError, parse_rrule, rule_text

        try:
            parts = parse_rrule(value)
        except RecurrenceError as exc:
            raise ValueError(str(exc)) from exc
        return rule_text(parts) or None

    @field_validator("reminders")
    @classmethod
    def validate_reminders(cls, value):
        if any(not isinstance(item, int) or isinstance(item, bool) or item < 0 or item > 10080 for item in value):
            raise ValueError("Reminders are lead times in minutes between 0 and 10080")
        return sorted(set(value))

    @model_validator(mode="after")
    def valid_range(self):
        if not self.start_at.tzinfo or not self.end_at.tzinfo:
            raise ValueError("Event timestamps must include a timezone")
        if self.end_at < self.start_at or (self.end_at == self.start_at and not self.all_day):
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


class ChatConfigurationInput(BaseModel):
    model: str | None = Field(default=None, max_length=100)
    base_url: str | None = Field(default=None, max_length=2000)
    api_key: str | None = Field(default=None, max_length=1000, repr=False)

    @field_validator("model", "base_url", "api_key")
    @classmethod
    def trim_chat_configuration(cls, value):
        return value.strip() if value is not None else None


class EmbeddingConfigurationInput(BaseModel):
    embedding_model: EmbeddingModel | None = None
    embedding_base_url: str | None = Field(default=None, max_length=2000)
    embedding_api_key: str | None = Field(default=None, max_length=1000, repr=False)
    embedding_dimensions: EmbeddingDimensions | None = None

    @field_validator("embedding_base_url", "embedding_api_key")
    @classmethod
    def trim_embedding_configuration(cls, value):
        return value.strip() if value is not None else None


class ChatDiagnosticsInput(ChatConfigurationInput):
    model_config = ConfigDict(extra="forbid")
    version: int | None = Field(default=None, ge=1)


class EmbeddingDiagnosticsInput(EmbeddingConfigurationInput):
    model_config = ConfigDict(extra="forbid")
    version: int | None = Field(default=None, ge=1)


class SettingsInput(ChatConfigurationInput, EmbeddingConfigurationInput):
    fast_model: str | None = Field(default=None, max_length=100)
    reasoning_model: str | None = Field(default=None, max_length=100)
    decision_provider: Literal["rules", "llm", "jev"] | None = None
    name: str | None = Field(default=None, min_length=1, max_length=120)
    memory_enabled: bool | None = None
    theme: Literal["light", "dark", "system"] | None = None
    timezone: str | None = None
    version: int = Field(ge=1)

    @field_validator("fast_model", "reasoning_model")
    @classmethod
    def trim_model_configuration(cls, value):
        return value.strip() if value is not None else None


class IntegrationInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    kind: Literal["mcp"]
    url: str = Field(default="", max_length=2000)
    trusted: bool = False
    permissions: list[str] = Field(default_factory=list, max_length=100)
    extra: dict = Field(default_factory=dict)


class ResumeApprovalInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(ge=1, strict=True)
