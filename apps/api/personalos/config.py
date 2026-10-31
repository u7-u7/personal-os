from functools import lru_cache
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

EmbeddingModel = Literal["qwen3.7-text-embedding", "qwen3.7-text-embedding-flash"]
EmbeddingDimensions = Literal[2560, 2048, 1536, 1024, 768, 512, 256]
EMBEDDING_DIMENSIONS_BY_MODEL = {
    "qwen3.7-text-embedding": (2560, 2048, 1536, 1024, 768, 512, 256),
    "qwen3.7-text-embedding-flash": (1024, 768, 512, 256),
}


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
    embedding_model: EmbeddingModel = "qwen3.7-text-embedding-flash"
    embedding_base_url: str = ""
    embedding_api_key: str = ""
    embedding_dimensions: EmbeddingDimensions = 1024
    mcp_allowed_hosts: str = ""
    api_url: str = "http://127.0.0.1:8000"
    oauth_client_id: str = ""
    oauth_client_secret: str = ""
    oauth_redirect_uri: str = ""
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
                raise ValueError("Embedding dimensions must be a supported integer") from exc
        return value

    @property
    def oauth_callback_url(self) -> str:
        # A provider without dynamic client registration (GitHub) only accepts the
        # callback registered on its OAuth app, so it is derived from the public API URL.
        return self.oauth_redirect_uri.strip() or f"{self.api_url.rstrip('/')}/api/oauth/callback"

    @model_validator(mode="after")
    def supported_embedding_dimensions(self):
        if self.embedding_dimensions not in EMBEDDING_DIMENSIONS_BY_MODEL[self.embedding_model]:
            raise ValueError("Embedding dimensions are not supported by the selected model")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
