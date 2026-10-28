import asyncio
import ipaddress
from urllib.parse import urlparse

from fastapi import HTTPException


async def validate_public_url(url: str, allowed_hosts: set[str] | None = None) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(422, "Only public HTTPS URLs without credentials are allowed")
    if parsed.fragment:
        raise HTTPException(422, "URL fragments are not supported")
    if allowed_hosts is not None and parsed.hostname not in allowed_hosts:
        raise HTTPException(403, "Server host has not been allowlisted by the administrator")
    try:
        addresses = await asyncio.get_running_loop().getaddrinfo(parsed.hostname, parsed.port or 443)
    except OSError as exc:
        raise HTTPException(422, "Cannot resolve service host") from exc
    if not addresses or any(not ipaddress.ip_address(address[4][0]).is_global for address in addresses):
        raise HTTPException(403, "Private, local and reserved network destinations are prohibited")
    return url
