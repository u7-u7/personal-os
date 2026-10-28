"""Server-owned Qwen embeddings through the official OpenAI-compatible SDK.

Configuring a provider does not activate or rebuild the optional Hy indexes.
The same configuration supplies the SDK client and the Hy embedder boundary.
"""
import asyncio
from dataclasses import dataclass, field
import hashlib
import json
import math
from pathlib import Path
import re
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException
from openai import APIConnectionError, APIResponseValidationError, APIStatusError, APITimeoutError, AsyncOpenAI

from personalos.config import get_settings
from personalos.models import User
from personalos.security import decrypt_config
from personalos.services.model import endpoint_key

MODEL = "qwen3.7-text-embedding-flash"
DIMENSIONS = {1024, 768, 512, 256}


@dataclass(frozen=True)
class EmbeddingConfiguration:
    model: str = MODEL
    base_url: str = ""
    api_key: str = field(default="", repr=False)
    dimensions: int = 1024

    def __post_init__(self):
        if self.model != MODEL or type(self.dimensions) is not int or self.dimensions not in DIMENSIONS:
            raise HTTPException(422, "Qwen3.7 Embedding Flash supports 1024, 768, 512 or 256 dimensions")

    @classmethod
    def for_user(cls, user: User):
        settings = get_settings()
        private = decrypt_config(user.secret_config)
        endpoint = private.get("embedding_base_url", settings.embedding_base_url).strip().rstrip("/")
        return cls(
            model=user.preferences.get("embedding_model", settings.embedding_model),
            base_url=endpoint,
            api_key=endpoint_key(private, "embedding_api_key", endpoint, settings.embedding_base_url, settings.embedding_api_key),
            dimensions=user.preferences.get("embedding_dimensions", settings.embedding_dimensions),
        )

    def with_draft(self, draft: dict):
        endpoint = draft.get("embedding_base_url", self.base_url).strip().rstrip("/")
        key = draft.get("embedding_api_key", self.api_key if endpoint == self.base_url else "")
        return EmbeddingConfiguration(model=draft.get("embedding_model", self.model), base_url=endpoint,
                                      api_key=key, dimensions=draft.get("embedding_dimensions", self.dimensions))

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.base_url)

    @property
    def index_namespace(self) -> str:
        # Equal dimensions alone do not imply equal vector spaces. Endpoint,
        # model and dimensions all identify an index; key rotation does not.
        identity = json.dumps([self.model, self.base_url.rstrip("/"), self.dimensions])
        return "embedding-" + hashlib.sha256(identity.encode()).hexdigest()[:24]

    def hy_embedder_config(self) -> dict:
        return {"provider": "openai", "model": self.model, "api_key": self.api_key,
                "base_url": self.base_url, "embedding_dims": self.dimensions}

    def hy_index_configuration(self, owner_id: str, storage_root: Path) -> dict:
        """Build official SDK fields without starting an unauthorized Hy runtime."""
        if not owner_id.strip():
            raise ValueError("An authenticated owner is required")
        owner_namespace = hashlib.sha256(owner_id.encode()).hexdigest()[:20]
        namespace = f"{owner_namespace}-{self.index_namespace}"
        directory = storage_root / namespace
        return {"embedder": {**self.hy_embedder_config(), "max_retries": 0, "timeout": 20},
                "vector_store": {"provider": "chroma", "collection_name": namespace,
                                 "tag_index_collection_name": f"{namespace}_tags",
                                 "persist_directory": str(directory / "vectors"),
                                 "embedding_dims": self.dimensions, "on_disk": True},
                "graph_store": {"db_path": str(directory / "graph")},
                "cache": {"backend": "sqlite", "db_path": str(directory / "cache.db")},
                "history": {"db_path": str(directory / "history.db")},
                "coding": {"db_path": str(directory / "coding.db")}}

    def public_settings(self) -> dict:
        return {"embedding_model": self.model, "embedding_base_url": self.base_url,
                "embedding_dimensions": self.dimensions, "embedding_api_key_configured": bool(self.api_key),
                "embedding_configured": self.configured, "embedding_index_namespace": self.index_namespace,
                "embedding_index_status": "hy_not_enabled"}


async def validate_embedding_url(url: str) -> None:
    try:
        parsed = urlparse(url)
        port = parsed.port
    except ValueError as exc:
        raise HTTPException(422, "Embedding Base URL is invalid") from exc
    if (parsed.scheme != "https" or parsed.username or parsed.password
            or parsed.query or parsed.fragment or "{" in url or "}" in url
            or parsed.path.rstrip("/") != "/compatible-mode/v1" or port not in {None, 443}):
        raise HTTPException(422, "Use the real Beijing workspace compatible-mode/v1 Base URL from Model Studio")
    host = parsed.hostname or ""
    # This preset is confirmed in Beijing only. Restrict the credential to its
    # chosen provider instead of forwarding a Bailian key to arbitrary hosts.
    suffix = ".cn-beijing.maas.aliyuncs.com"
    workspace = host.removesuffix(suffix)
    if not host.endswith(suffix) or not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", workspace):
        raise HTTPException(422, "Qwen3.7 Embedding Flash requires a Beijing workspace endpoint")
    # This is a single, provider-owned DNS suffix, not arbitrary user URLs.
    # Save can work offline and behind DNS proxies; the explicit probe performs
    # real DNS/TLS verification. Never accept IPs, userinfo or another provider.


class EmbeddingService:
    def __init__(self, config: EmbeddingConfiguration, *, transport: httpx.AsyncBaseTransport | None = None):
        self.config, self.transport = config, transport

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not isinstance(texts, list) or not texts or len(texts) > 20 or any(not isinstance(text, str) or not text.strip() for text in texts):
            raise HTTPException(422, "Provide between 1 and 20 nonempty texts")
        # Bound application IO without pretending to implement Qwen tokenization.
        if any(len(text.encode("utf-8")) > 128000 for text in texts):
            raise HTTPException(422, "Each text exceeds the application's 128000-byte input bound")
        if not self.config.configured:
            raise HTTPException(503, "Add the Beijing workspace Base URL and a separate Bailian embedding API key in Settings")
        await validate_embedding_url(self.config.base_url)
        try:
            async with asyncio.timeout(20):
                async with httpx.AsyncClient(timeout=20, follow_redirects=False, transport=self.transport) as http:
                    async with AsyncOpenAI(api_key=self.config.api_key, base_url=self.config.base_url,
                                           max_retries=0, timeout=20, http_client=http) as client:
                        response = await client.embeddings.create(model=self.config.model, input=texts,
                                                                 dimensions=self.config.dimensions, encoding_format="float")
        except (TimeoutError, APITimeoutError, APIConnectionError) as exc:
            raise HTTPException(502, "Embedding provider timed out or could not be reached; no vectors were saved") from exc
        except APIStatusError as exc:
            status = 429 if exc.status_code == 429 else 502
            raise HTTPException(status, f"Embedding provider rejected the request (HTTP {exc.status_code}); check workspace access and credentials") from exc
        except (APIResponseValidationError, ValueError) as exc:
            raise HTTPException(502, "Embedding provider returned an invalid response") from exc
        try:
            data = sorted(response.data, key=lambda item: item.index)
            if len(data) != len(texts) or [item.index for item in data] != list(range(len(texts))):
                raise HTTPException(502, "Embedding provider returned an incomplete or misindexed batch")
            vectors = [item.embedding for item in data]
            if any(len(vector) != self.config.dimensions or not all(math.isfinite(value) for value in vector) for vector in vectors):
                raise HTTPException(502, "Embedding provider returned invalid vectors or a mismatched dimension")
            return vectors
        except (TypeError, AttributeError, ValueError) as exc:
            raise HTTPException(502, "Embedding provider returned an invalid response") from exc

    async def test_connection(self) -> dict:
        # Probe content is constant, never a user's actual memory or conversation.
        await self.embed(["PersonalOS embedding connection check"])
        return {"status": "ok", "provider": "dashscope", "model": self.config.model,
                "dimensions": self.config.dimensions}
