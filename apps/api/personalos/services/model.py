"""Per-user chat configuration and bounded, server-owned provider clients."""
import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Literal
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException
from openai import APIConnectionError, APIResponseValidationError, APIStatusError, APITimeoutError, AsyncOpenAI
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

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

    def with_draft(self, draft: dict):
        endpoint = draft.get("base_url", self.base_url).strip().rstrip("/")
        # A blank explicitly supplied key clears it. Omission can reuse the saved
        # credential only for the same endpoint, never a new host or path.
        key = draft.get("api_key", self.api_key if endpoint == self.base_url else "")
        return ChatConfiguration(model=draft.get("model", self.model), base_url=endpoint, api_key=key,
                                 source="personal" if "api_key" in draft and key else self.source)

    @property
    def missing_fields(self) -> list[str]:
        return [name for name, value in (("model", self.model), ("base_url", self.base_url), ("api_key", self.api_key)) if not value]

    @property
    def configured(self) -> bool:
        return not self.missing_fields

    def parameters(self) -> dict:
        if not self.configured:
            raise HTTPException(503, "Complete the chat model, Base URL and API key in Settings before using AI")
        try:
            host = urlparse(self.base_url).hostname or ""
        except ValueError as exc:
            raise HTTPException(422, "Service URL is invalid") from exc
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


class ProviderModel(BaseModel):
    model_config = ConfigDict(strict=True)
    id: str = Field(min_length=1, max_length=200)
    owned_by: str = Field(default="", max_length=200)
    name: str | None = Field(default=None, max_length=300)

    @field_validator("id")
    @classmethod
    def nonempty_model_id(cls, value):
        if not value.strip():
            raise ValueError("Model ID is empty")
        return value


class ProviderModelList(BaseModel):
    model_config = ConfigDict(strict=True)
    object: Literal["list"]
    data: list[ProviderModel] = Field(max_length=1000)


class BalanceInfo(BaseModel):
    model_config = ConfigDict(strict=True)
    currency: Literal["CNY", "USD"]
    total_balance: str = Field(max_length=44, pattern=r"^-?\d{1,24}(?:\.\d{1,18})?$")
    granted_balance: str = Field(max_length=44, pattern=r"^-?\d{1,24}(?:\.\d{1,18})?$")
    topped_up_balance: str = Field(max_length=44, pattern=r"^-?\d{1,24}(?:\.\d{1,18})?$")

    @field_validator("total_balance", "granted_balance", "topped_up_balance")
    @classmethod
    def finite_amount(cls, value):
        if not Decimal(value).is_finite():
            raise ValueError("Balance must be finite")
        return value


class ProviderBalance(BaseModel):
    model_config = ConfigDict(strict=True)
    is_available: bool
    balance_infos: list[BalanceInfo] = Field(max_length=10)


def chat_provider(configuration: ChatConfiguration) -> str:
    try:
        parsed = urlparse(configuration.base_url)
        official = (parsed.scheme == "https" and parsed.hostname == "api.deepseek.com"
                    and parsed.port in {None, 443} and not parsed.username and not parsed.password
                    and not parsed.query and not parsed.fragment and parsed.path.rstrip("/") in {"", "/v1"})
    except ValueError:
        official = False
    return "deepseek" if official else "openai_compatible"


class ProviderResponseError(Exception):
    """Only fixed local error messages cross the provider exception boundary."""


class BoundedProviderTransport(httpx.AsyncBaseTransport):
    def __init__(self):
        # Delegate through a public client so HTTPX retains environment proxy
        # support. The outer SDK client owns this transport and its delegate.
        self.client = httpx.AsyncClient(timeout=20, follow_redirects=False)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        request.headers["accept-encoding"] = "identity"
        response = await self.client.send(request, stream=True)
        try:
            # Reject unexpected compression before invoking any decoder: a raw
            # compressed chunk could otherwise expand beyond the memory bound.
            if response.headers.get("content-encoding", "identity").strip().lower() not in {"", "identity"}:
                raise ProviderResponseError("Provider returned unsupported response compression")
            body = bytearray()
            async for chunk in response.aiter_raw():
                if len(body) + len(chunk) > 1024 * 1024:
                    raise ProviderResponseError("Provider response exceeds the 1 MiB size limit")
                body.extend(chunk)
            headers = [(name, value) for name, value in response.headers.multi_items()
                       if name.lower() not in {"content-encoding", "content-length", "transfer-encoding"}]
            return httpx.Response(response.status_code, headers=headers, content=bytes(body),
                                  request=request, extensions=response.extensions)
        finally:
            await response.aclose()

    async def aclose(self):
        await self.client.aclose()


@asynccontextmanager
async def provider_client(configuration: ChatConfiguration, *, base_url: str | None = None):
    if not configuration.base_url or not configuration.api_key:
        raise HTTPException(503, "Complete the Base URL and API key in Settings before querying the provider")
    endpoint = base_url or configuration.base_url
    try:
        async with asyncio.timeout(20):
            await validate_chat_endpoint(endpoint)
            async with httpx.AsyncClient(timeout=20, follow_redirects=False, transport=BoundedProviderTransport()) as http:
                async with AsyncOpenAI(api_key=configuration.api_key, base_url=endpoint,
                                       max_retries=0, timeout=20, http_client=http) as client:
                    yield client
    except (TimeoutError, APITimeoutError, APIConnectionError) as exc:
        if isinstance(exc.__cause__, ProviderResponseError):
            raise HTTPException(502, str(exc.__cause__)) from exc
        raise HTTPException(502, "Provider timed out or could not be reached; check Base URL and network") from exc
    except APIStatusError as exc:
        # Keep provider authentication failures distinct from our own login 401.
        messages = {401: "Provider authentication failed; check the API key",
                    402: "Provider balance is insufficient; top up the provider account",
                    403: "Provider denied access; check API key permissions",
                    404: "Provider endpoint was not found; check Base URL and API support",
                    429: "Provider rate limit reached; try again later"}
        raise HTTPException(429 if exc.status_code == 429 else 502,
                            messages.get(exc.status_code, f"Provider rejected the request (HTTP {exc.status_code})")) from exc
    except (APIResponseValidationError, ValidationError, ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(502, "Provider returned an invalid response") from exc


async def list_chat_models(configuration: ChatConfiguration) -> dict:
    async with provider_client(configuration) as client:
        page = await client.models.list()
        response = ProviderModelList.model_validate(page.model_dump(warnings=False))
        # Query only this bounded page; SDK pagination links from a third-party
        # server must not cause additional authenticated requests to arbitrary URLs.
        models = {item.id: item.model_dump(exclude_none=True) for item in response.data}
    return {"provider": chat_provider(configuration), "models": list(models.values())}


async def chat_balance(configuration: ChatConfiguration) -> dict:
    provider = chat_provider(configuration)
    if provider != "deepseek":
        return {"provider": provider, "supported": False}
    # Balance is a root API, independent of a compatible chat /v1 prefix.
    async with provider_client(configuration, base_url="https://api.deepseek.com") as client:
        raw = await client.get("/user/balance", cast_to=httpx.Response)
        response = ProviderBalance.model_validate(raw.json())
    return {"provider": provider, "supported": True, **response.model_dump()}
