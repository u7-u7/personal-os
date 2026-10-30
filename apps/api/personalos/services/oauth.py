"""MCP OAuth 2.1 protocol layer: discovery, dynamic registration, PKCE and tokens.

No database access and no routes: the caller persists the PKCE verifier and the state value,
renders the authorization URL and stores the tokens it gets back.

Every URL requested here passes the shared SSRF guard first, because the resource URL is
attacker-influenced and it chooses the authorization server, which in turn publishes the
endpoints used later. Requests never follow redirects, carry a hard 20s deadline and cap the
body at 256 KiB. Codes, verifiers, secrets and tokens never reach an exception message.
"""

import asyncio
import base64
import hashlib
import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlsplit

import httpx
from fastapi import HTTPException

from personalos.services.network import validate_public_url

TIMEOUT_SECONDS = 20
MAX_BODY_BYTES = 256 * 1024
MAX_MESSAGE_CHARS = 200


class OAuthError(Exception):
    """Machine-readable OAuth failure; carries no credential material."""

    def __init__(self, error: str, status: int | None = None, message: str | None = None):
        self.error = error
        self.status = status
        self.message = message
        super().__init__(error)

    def payload(self) -> dict:
        fields = {"error": self.error, "status": self.status, "message": self.message}
        return {key: value for key, value in fields.items() if value is not None}


@dataclass(frozen=True)
class Discovery:
    resource: str
    authorization_servers: list[str]
    scopes_supported: list[str]
    authorization_endpoint: str
    token_endpoint: str
    registration_endpoint: str | None
    resource_name: str | None


def _scrub(text: str | None, *sensitive: str | None) -> str | None:
    """Remove credential values from any remote text before it can reach a caller."""
    if text is None:
        return None
    for value in sensitive:
        if value:
            text = text.replace(value, "[redacted]")
    return text[:MAX_MESSAGE_CHARS]


def _remote_error(status: int, document: dict, *, fallback: str, sensitive: tuple[str, ...]) -> OAuthError:
    """Translate a provider error document without letting our secrets through."""
    code = _scrub(_optional_str(document.get("error")) or fallback, *sensitive) or fallback
    return OAuthError(code, status, _scrub(_optional_str(document.get("error_description")), *sensitive))


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str) and item]


def _optional_str(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


async def _guard(url: str) -> None:
    """Guard every hop: the metadata we just read chose this URL."""
    try:
        await validate_public_url(url)
    except HTTPException as exc:
        raise OAuthError("blocked_url", exc.status_code, str(exc.detail)) from exc


async def _bounded_body(response: httpx.Response) -> bytes:
    body = bytearray()
    async for chunk in response.aiter_bytes():
        if len(body) + len(chunk) > MAX_BODY_BYTES:
            raise OAuthError("response_too_large", None, "OAuth endpoint response exceeds the size limit")
        body.extend(chunk)
    return bytes(body)


async def _send(method: str, url: str, *, form: dict[str, str] | None = None,
                document: dict | None = None) -> tuple[int, bytes]:
    """One guarded, redirect-free, size-bounded request; returns (status, body)."""
    await _guard(url)
    body = {"data": form} if form is not None else {"json": document}
    try:
        async with asyncio.timeout(TIMEOUT_SECONDS):
            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, follow_redirects=False,
                                         headers={"accept": "application/json"}) as client:
                async with client.stream(method, url, **body) as response:
                    return response.status_code, await _bounded_body(response)
    except (TimeoutError, httpx.HTTPError) as exc:
        raise OAuthError("network_error", None, "The OAuth endpoint could not be reached") from exc


def _json_object(body: bytes) -> dict | None:
    try:
        value = json.loads(body)
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


async def _probe_json(url: str) -> dict | None:
    """Fetch a metadata document; a non-200 or non-JSON answer is simply a miss."""
    status, body = await _send("GET", url)
    return _json_object(body) if status == 200 else None


def _resource_metadata_urls(resource_url: str) -> list[str]:
    """RFC 9728 probes: the path-suffixed document wins over the bare one."""
    parts = urlsplit(resource_url)
    origin = f"{parts.scheme}://{parts.netloc}"
    path = parts.path.rstrip("/")
    urls = [f"{origin}/.well-known/oauth-protected-resource{path}"]
    if path:
        urls.append(f"{origin}/.well-known/oauth-protected-resource")
    return urls


def _authorization_server_metadata_urls(issuer: str) -> list[str]:
    """RFC 8414, then OIDC discovery; GitHub answers only the second form."""
    parts = urlsplit(issuer)
    base = f"{parts.scheme}://{parts.netloc}{parts.path.rstrip('/')}"
    return [f"{base}/.well-known/oauth-authorization-server",
            f"{base}/.well-known/openid-configuration"]


async def _token_request(discovery: Discovery, form: dict[str, str]) -> dict:
    """POST a form-encoded grant to the token endpoint and normalise the answer."""
    status, body = await _send("POST", discovery.token_endpoint, form=form)
    document = _json_object(body) or {}
    if status != 200:
        raise _remote_error(status, document, fallback="token_request_failed",
                            sensitive=(form.get("code"), form.get("code_verifier"),
                                       form.get("client_secret"), form.get("refresh_token")))
    return _token_payload(document)


def _token_payload(document: dict) -> dict:
    access_token = _optional_str(document.get("access_token"))
    if access_token is None:
        raise OAuthError("invalid_token_response", None,
                         "The token endpoint response carried no access token")
    return {"access_token": access_token,
            "token_type": _optional_str(document.get("token_type")) or "Bearer",
            "refresh_token": _optional_str(document.get("refresh_token")),
            "expires_at": _expires_at(document.get("expires_in")),
            "scope": _optional_str(document.get("scope"))}


def _expires_at(expires_in: object) -> str | None:
    """Absolute UTC expiry from `expires_in`; None when the provider omits the lifetime.

    Providers send an int, a float or a numeric string, so all three are accepted. The
    keyword itself is deprecated in OAuth 2.1 and many providers (GitHub) never send it.
    """
    if isinstance(expires_in, str):
        try:
            expires_in = float(expires_in.strip())
        except ValueError:
            return None
    if isinstance(expires_in, bool) or not isinstance(expires_in, (int, float)) or expires_in < 0:
        return None
    expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
    return expiry.replace(microsecond=0).isoformat()


async def discover(resource_url: str) -> Discovery:
    """Resolve protected resource metadata, then the first authorization server's metadata."""
    resource_metadata: dict | None = None
    for url in _resource_metadata_urls(resource_url):
        candidate = await _probe_json(url)
        if candidate is not None and _string_list(candidate.get("authorization_servers")):
            resource_metadata = candidate
            break
    if resource_metadata is None:
        raise OAuthError("no_resource_metadata", None,
                         "The MCP server does not publish OAuth protected resource metadata")
    servers = _string_list(resource_metadata.get("authorization_servers"))
    server_metadata: dict | None = None
    for url in _authorization_server_metadata_urls(servers[0]):
        candidate = await _probe_json(url)
        if (candidate is not None and _optional_str(candidate.get("authorization_endpoint"))
                and _optional_str(candidate.get("token_endpoint"))):
            server_metadata = candidate
            break
    if server_metadata is None:
        raise OAuthError("no_authorization_server_metadata", None,
                         "The authorization server does not publish usable endpoint metadata")
    return Discovery(
        resource=_optional_str(resource_metadata.get("resource")) or resource_url,
        authorization_servers=servers,
        scopes_supported=(_string_list(server_metadata.get("scopes_supported"))
                          or _string_list(resource_metadata.get("scopes_supported"))),
        authorization_endpoint=_optional_str(server_metadata["authorization_endpoint"]),
        token_endpoint=_optional_str(server_metadata["token_endpoint"]),
        registration_endpoint=_optional_str(server_metadata.get("registration_endpoint")),
        resource_name=_optional_str(resource_metadata.get("resource_name")),
    )


def new_pkce() -> tuple[str, str]:
    """(code_verifier, code_challenge) for S256, well inside the RFC 7636 alphabet."""
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return verifier, base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def new_state() -> str:
    return secrets.token_urlsafe(32)


def authorization_url(discovery: Discovery, *, client_id: str, redirect_uri: str, scope: list[str],
                      state: str, challenge: str) -> str:
    """The browser redirect URL; the caller keeps the verifier until the code comes back."""
    query = {"response_type": "code", "client_id": client_id, "redirect_uri": redirect_uri,
             "state": state, "code_challenge": challenge, "code_challenge_method": "S256"}
    if scope:
        query["scope"] = " ".join(scope)
    if discovery.resource:
        query["resource"] = discovery.resource  # RFC 8707 audience for the issued token.
    endpoint = discovery.authorization_endpoint
    return f"{endpoint}{'&' if urlsplit(endpoint).query else '?'}{urlencode(query)}"


async def register_client(discovery: Discovery, *, redirect_uri: str,
                          client_name: str = "PersonalOS") -> dict:
    """RFC 7591 registration; public clients ask for no authentication method."""
    endpoint = discovery.registration_endpoint
    if not endpoint:
        # GitHub style: the server publishes no registration endpoint, so the caller must
        # fall back to a client it registered by hand. Never guess a registration URL.
        raise OAuthError("dcr_unsupported", None,
                         "The authorization server does not support dynamic client registration")
    status, body = await _send("POST", endpoint, document={
        "client_name": client_name,
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    })
    created = _json_object(body) or {}
    client_id = _optional_str(created.get("client_id"))
    if status not in {200, 201} or client_id is None:
        raise _remote_error(status, created, fallback="registration_failed",
                            sensitive=(redirect_uri, client_name))
    return {"client_id": client_id,
            "client_secret": _optional_str(created.get("client_secret")),
            "token_endpoint_auth_method": _optional_str(created.get("token_endpoint_auth_method")) or "none"}


async def exchange_code(discovery: Discovery, *, client_id: str, client_secret: str | None, code: str,
                        redirect_uri: str, verifier: str) -> dict:
    """Redeem the authorization code; a public client (no secret) authenticates with PKCE only."""
    form = {"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri,
            "client_id": client_id, "code_verifier": verifier}
    if client_secret is not None:
        form["client_secret"] = client_secret
    if discovery.resource:
        form["resource"] = discovery.resource
    return await _token_request(discovery, form)


async def refresh(discovery: Discovery, *, client_id: str, client_secret: str | None,
                  refresh_token: str) -> dict:
    """Renew an access token; a rotation the provider omits stays the caller's old token."""
    form = {"grant_type": "refresh_token", "refresh_token": refresh_token, "client_id": client_id}
    if client_secret is not None:
        form["client_secret"] = client_secret
    if discovery.resource:
        form["resource"] = discovery.resource
    return await _token_request(discovery, form)
