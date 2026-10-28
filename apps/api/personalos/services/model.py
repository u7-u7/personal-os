"""Per-user chat configuration and bounded, server-owned provider clients."""
import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException
from openai import APIConnectionError, APIResponseValidationError, APIStatusError, APITimeoutError, AsyncOpenAI

from personalos.config import get_settings
from personalos.models import User
from personalos.security import decrypt_config
from personalos.services.network import validate_public_url


def endpoint_key(private: dict, key_name: str, endpoint: str, default_endpoint: str, default_key: str) -> str:
    # Clearing a personal key is authoritative. A server credential must never
    # follow a user's endpoint override to another provider or workspace.
    if key_name in private:
        return private[key_name].strip()
    return default_key.strip() if endpoint.rstrip("/") == default_endpoint.strip().rstrip("/") else ""


@dataclass(frozen=True)
class ChatConfiguration:
    model: str
    base_url: str
    api_key: str = field(repr=False)
    source: str = "missing"

    @classmethod
    def for_user(cls, user: User, requested_model: str | None = None):
        settings = get_settings()
        private = decrypt_config(user.secret_config)
        endpoint = private.get("base_url", settings.openai_base_url).strip().rstrip("/")
        key = endpoint_key(private, "api_key", endpoint, settings.openai_base_url, settings.openai_api_key)
        model = (requested_model or user.preferences.get("model", settings.openai_model)).strip()
        source = ("personal" if private.get("api_key") else "server_default") if key else "missing"
        return cls(model=model, base_url=endpoint, api_key=key, source=source)

    @property
    def missing_fields(self) -> list[str]:
        return [name for name, value in (("model", self.model), ("base_url", self.base_url), ("api_key", self.api_key)) if not value]

    @property
    def configured(self) -> bool:
        return not self.missing_fields

    def parameters(self) -> dict:
        if not self.configured:
            raise HTTPException(503, "Complete the chat model, Base URL and API key in Settings before using AI")
        host = urlparse(self.base_url).hostname or ""
        extra = {"extra_body": {"thinking": {"type": "disabled"}}} if host == "api.deepseek.com" else {}
        return {**extra, "api_key": self.api_key, "base_url": self.base_url, "model": self.model,
                "timeout": 60, "max_retries": 0, "streaming": True}

    def public_settings(self) -> dict:
        return {"model": self.model, "base_url": self.base_url, "api_key_configured": bool(self.api_key),
                "chat_configured": self.configured,
                "chat_config_source": self.source if self.configured else "missing"}


async def validate_chat_endpoint(base_url: str) -> None:
    # Administrators may deliberately host a trusted local compatible model.
    # User overrides never inherit that network trust, even with a personal key.
    default = get_settings().openai_base_url.strip().rstrip("/")
    if base_url.strip().rstrip("/") != default:
        await validate_public_url(base_url)


@asynccontextmanager
async def chat_model_parameters(parameters: dict, *, timeout: float | None = None):
    await validate_chat_endpoint(parameters["base_url"])
    if parameters.get("http_async_client") is not None:
        # Injected clients belong to server composition/protocol fixtures, not
        # user preferences. Their lifecycle remains with the injecting owner.
        yield parameters
        return
    async with httpx.AsyncClient(timeout=timeout if timeout is not None else parameters.get("timeout", 60),
                                 follow_redirects=False) as client:
        yield {**parameters, "http_async_client": client}


async def test_chat_connection(configuration: ChatConfiguration) -> dict:
    parameters = configuration.parameters()
    # The official SDK preserves compatible providers' max_tokens field. The
    # LangChain wrapper rewrites it to max_completion_tokens unconditionally.
    host = urlparse(configuration.base_url).hostname or ""
    reasoning = configuration.model.startswith(("o1", "o3", "o4", "gpt-5"))
    budget = {"max_completion_tokens": 512} if host == "api.openai.com" and reasoning else {"max_tokens": 32}
    try:
        # HTTPX's read timeout resets for every chunk; this outer deadline also
        # bounds DNS and a provider that keeps sending tiny response fragments.
        async with asyncio.timeout(20):
            async with chat_model_parameters(parameters, timeout=20) as prepared:
                async with AsyncOpenAI(api_key=configuration.api_key, base_url=configuration.base_url,
                                       max_retries=0, timeout=20, http_client=prepared["http_async_client"]) as client:
                    response = await client.chat.completions.create(
                        model=configuration.model, messages=[{"role": "user", "content": "Reply exactly OK."}],
                        stream=False, **budget, **({"extra_body": parameters["extra_body"]} if "extra_body" in parameters else {}))
        if not response.choices or not response.choices[0].message.content or not response.choices[0].message.content.strip():
            raise HTTPException(502, "Chat provider returned no text; verify model access and compatibility")
    except (TimeoutError, APITimeoutError, APIConnectionError) as exc:
        raise HTTPException(502, "Chat provider timed out or could not be reached; check Base URL and network") from exc
    except APIStatusError as exc:
        raise HTTPException(429 if exc.status_code == 429 else 502,
                            f"Chat provider rejected the request (HTTP {exc.status_code}); check model and credentials") from exc
    except (APIResponseValidationError, ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(502, "Chat provider returned an invalid response") from exc
    return {"status": "ok", "model": configuration.model}
