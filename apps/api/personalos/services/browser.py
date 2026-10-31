"""Read-only HTTP reading for the agent, with the SSRF guard applied to every hop."""
import asyncio
import json
import time
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
from fastapi import HTTPException
from langchain_core.tools import BaseTool, tool
from sqlalchemy.orm import Session

from personalos.services.network import validate_public_url

USER_AGENT = "PersonalOS/1.0 (+personal assistant; read-only fetch)"
FETCH_TIMEOUT_SECONDS = 15.0
MAX_REDIRECTS = 5
MAX_BODY_BYTES = 2 * 1024 * 1024
MAX_TEXT_CHARS = 8000
MAX_LINKS = 200
MAX_LABEL_CHARS = 120
ACTIONS = frozenset({"read", "links", "meta"})
TEXT_CONTENT_TYPES = frozenset({"text/html", "application/xhtml+xml", "text/plain", "application/json"})
HTML_CONTENT_TYPES = frozenset({"text/html", "application/xhtml+xml"})
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
SKIPPED_TAGS = frozenset({"script", "style", "noscript", "svg", "iframe"})
BLOCK_TAGS = frozenset({
    "address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt", "figcaption", "figure",
    "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p",
    "pre", "section", "table", "td", "th", "tr", "ul"})


class FetchError(Exception):
    """Carries only the fixed fields a tool result may expose."""

    def __init__(self, error: str, status: int | None = None, reason: str | None = None):
        super().__init__(reason or error)
        self.payload: dict = {"error": error, "status": status}
        if reason:
            self.payload["reason"] = reason


@dataclass
class Page:
    status_code: int
    final_url: str
    redirects: list[str]
    content_type: str
    charset: str | None
    body: bytes
    body_truncated: bool
    elapsed_ms: int


def _client() -> httpx.AsyncClient:
    # A fresh client per call means no cookie jar and no connection state can
    # survive into a later fetch.
    return httpx.AsyncClient(timeout=httpx.Timeout(FETCH_TIMEOUT_SECONDS), follow_redirects=False,
                             headers={"user-agent": USER_AGENT, "accept": "*/*",
                                      "accept-encoding": "identity"})


async def _guard(url: str) -> None:
    try:
        await validate_public_url(url)
    except HTTPException as exc:
        raise FetchError("BlockedURL", exc.status_code, str(exc.detail)) from None
    except Exception as exc:
        # Fail closed: a guard that cannot decide must not let a fetch through.
        raise FetchError("BlockedURL", None, "URL could not be validated") from exc


def _strip_fragment(url: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))


def _content_type(response: httpx.Response) -> str:
    return response.headers.get("content-type", "").split(";", 1)[0].strip().lower()


async def _read_body(response: httpx.Response) -> tuple[bytes, bool]:
    body = bytearray()
    async for chunk in response.aiter_bytes():
        remaining = MAX_BODY_BYTES - len(body)
        if len(chunk) > remaining:
            body.extend(chunk[:remaining])
            return bytes(body), True
        body.extend(chunk)
    return bytes(body), False


async def _fetch(url: str) -> Page:
    started = time.monotonic()
    redirects: list[str] = []
    target = url
    async with asyncio.timeout(FETCH_TIMEOUT_SECONDS):
        async with _client() as client:
            for hop in range(MAX_REDIRECTS + 1):
                await _guard(target)
                response = await client.send(client.build_request("GET", target), stream=True)
                client.cookies.clear()
                try:
                    if response.status_code in REDIRECT_STATUSES:
                        location = response.headers.get("location", "").strip()
                        if not location:
                            raise FetchError("InvalidRedirect", response.status_code,
                                             "Redirect response has no Location header")
                        if hop >= MAX_REDIRECTS:
                            raise FetchError("TooManyRedirects", response.status_code,
                                             f"Redirect limit of {MAX_REDIRECTS} hops exceeded")
                        target = _strip_fragment(urljoin(target, location))
                        redirects.append(target)
                        continue
                    content_type = _content_type(response)
                    if content_type not in TEXT_CONTENT_TYPES:
                        raise FetchError("UnsupportedContentType", response.status_code,
                                         f"Content type {content_type or 'unknown'} is not readable text")
                    body, truncated = await _read_body(response)
                    return Page(status_code=response.status_code, final_url=str(response.url),
                                redirects=redirects, content_type=content_type,
                                charset=response.charset_encoding, body=body, body_truncated=truncated,
                                elapsed_ms=int((time.monotonic() - started) * 1000))
                finally:
                    await response.aclose()
    raise FetchError("TooManyRedirects", None, f"Redirect limit of {MAX_REDIRECTS} hops exceeded")


def _collapse(parts: list[str]) -> str:
    lines = [" ".join(line.split()) for line in "".join(parts).split("\n")]
    return "\n".join(line for line in lines if line)


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title_parts: list[str] = []
        self.text_parts: list[str] = []
        self.links: list[tuple[str, str]] = []
        self._skip = 0
        self._in_title = False
        self._href: str | None = None
        self._label: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in SKIPPED_TAGS:
            self._skip += 1
            return
        if self._skip:
            return
        if tag == "title":
            self._in_title = True
        elif tag == "a":
            self._href = dict(attrs).get("href")
            self._label = []
        if tag in BLOCK_TAGS:
            self.text_parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in SKIPPED_TAGS:
            self._skip = max(0, self._skip - 1)
            return
        if self._skip:
            return
        if tag == "title":
            self._in_title = False
        elif tag == "a":
            if self._href is not None:
                self.links.append((self._href, _collapse(self._label)))
            self._href = None
            self._label = []
        if tag in BLOCK_TAGS:
            self.text_parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip:
            return
        if self._in_title:
            self.title_parts.append(data)
            return
        self.text_parts.append(data)
        if self._href is not None:
            self._label.append(data)


def _document(page: Page) -> PageParser:
    parser = PageParser()
    try:
        text = page.body.decode(page.charset or "utf-8", errors="replace")
    except LookupError:
        text = page.body.decode("utf-8", errors="replace")
    if page.content_type in HTML_CONTENT_TYPES:
        parser.feed(text)
        parser.close()
    else:
        parser.text_parts.append(text)
    return parser


def _readable(page: Page, parser: PageParser) -> dict:
    text = _collapse(parser.text_parts)
    return {"title": _collapse(parser.title_parts), "text": text[:MAX_TEXT_CHARS],
            "truncated": page.body_truncated or len(text) > MAX_TEXT_CHARS, "url": page.final_url}


def _absolute(base: str, href: str) -> str | None:
    try:
        parts = urlsplit(urljoin(base, href.strip()))
    except ValueError:
        return None
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        return None
    # Fragments are dropped so a returned link stays acceptable to the URL guard.
    return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))


def _link_list(page: Page, parser: PageParser) -> dict:
    found: dict[str, str] = {}
    for href, label in parser.links:
        url = _absolute(page.final_url, href)
        if url is None:
            continue
        if url not in found:
            found[url] = label[:MAX_LABEL_CHARS]
        elif not found[url] and label:
            found[url] = label[:MAX_LABEL_CHARS]
    links = [{"text": text, "url": url} for url, text in list(found.items())[:MAX_LINKS]]
    return {"links": links, "truncated": len(found) > MAX_LINKS, "url": page.final_url}


def _meta(page: Page) -> dict:
    return {"status_code": page.status_code, "final_url": page.final_url, "redirects": page.redirects,
            "content_type": page.content_type, "bytes": len(page.body),
            "elapsed_ms": page.elapsed_ms, "truncated": page.body_truncated}


def make_browser_tool(db: Session, owner_id: str) -> BaseTool:
    @tool
    async def browse_web(action: str, url: str, params: dict | None = None) -> str:
        """Read a public HTTPS page without a browser, using GET only.

        action="read" returns the page title and readable text (8000 characters
        max); action="links" returns absolute outbound links; action="meta"
        returns status, final URL, redirect chain, content type, size and
        timing. Private, local and reserved network destinations are refused.
        params is reserved and currently ignored.
        """
        if action not in ACTIONS:
            return json.dumps({"error": "InvalidAction", "status": None,
                               "reason": "action must be read, links or meta"}, ensure_ascii=False)
        try:
            page = await _fetch(url)
        except FetchError as exc:
            return json.dumps(exc.payload, ensure_ascii=False)
        except TimeoutError:
            return json.dumps({"error": "TimeoutError", "status": None,
                               "reason": f"Fetch exceeded {int(FETCH_TIMEOUT_SECONDS)} seconds"},
                              ensure_ascii=False)
        except httpx.HTTPError as exc:
            # Only the class name crosses the boundary; the message may echo the URL.
            return json.dumps({"error": type(exc).__name__, "status": None,
                               "reason": "Network request failed"}, ensure_ascii=False)
        if action == "meta":
            return json.dumps(_meta(page), ensure_ascii=False)
        parser = _document(page)
        result = _readable(page, parser) if action == "read" else _link_list(page, parser)
        return json.dumps(result, ensure_ascii=False)

    return browse_web
