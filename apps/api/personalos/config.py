from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://personalos:personalos@127.0.0.1:54329/personalos"
    redis_url: str = "redis://localhost:6379/0"
    app_url: str = "http://localhost:3000"
    web_origin: str = "http://localhost:3000"
    app_secret: str = ""
    encryption_key: str = ""
    cookie_secure: bool = False
    session_days: int = 14
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4.1-mini"
    embedding_model: Literal["qwen3.7-text-embedding-flash"] = "qwen3.7-text-embedding-flash"
    embedding_base_url: str = ""
    embedding_api_key: str = ""
    embedding_dimensions: Literal[1024, 768, 512, 256] = 1024
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:3000/api/calendar/oauth/callback"
    mcp_allowed_hosts: str = ""
    hy_memory_enabled: bool = False
    typesafe_api_key: str = ""
    decision_provider: str = "rules"

    @field_validator("embedding_dimensions", mode="before")
    @classmethod
    def embedding_dimensions_from_environment(cls, value):
        # Literal[int] does not coerce dotenv strings. Convert before enforcing
        # the official dimension choices so a freshly bootstrapped .env starts.
        if isinstance(value, str):
            try:
                return int(value)
            except ValueError as exc:
                raise ValueError("Embedding dimensions must be 1024, 768, 512 or 256") from exc
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
