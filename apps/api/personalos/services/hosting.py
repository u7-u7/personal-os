"""Code hosting reads and approval-gated writes for GitHub and Gitee.

Endpoint map (paths are relative to the provider base URL):

    action        GitHub                                   Gitee
    ------------  ---------------------------------------  ---------------------------------------
    repo_file     GET /repos/{o}/{r}/contents/{path}        GET /repos/{o}/{r}/contents/{path}
    repo_tree     GET /repos/{o}/{r}/git/trees/HEAD         GET /repos/{o}/{r}/git/trees/HEAD
    search repos  GET /search/repositories                  GET /search/repositories
    search code   GET /search/code                          not published by API v5
    list_issues   GET /repos/{o}/{r}/issues                 GET /repos/{o}/{r}/issues
    get_issue     GET /repos/{o}/{r}/issues/{n}             GET /repos/{o}/{r}/issues/{n}
    list_prs      GET /repos/{o}/{r}/pulls                  GET /repos/{o}/{r}/pulls
    get_pr        GET /repos/{o}/{r}/pulls/{n}              GET /repos/{o}/{r}/pulls/{n}
    pr_files      GET /repos/{o}/{r}/pulls/{n}/files        GET /repos/{o}/{r}/pulls/{n}/files
    create_issue  POST /repos/{o}/{r}/issues                POST /repos/{o}/issues, repo in the body
    comment       POST /repos/{o}/{r}/issues/{n}/comments   POST /repos/{o}/{r}/issues/{n}/comments

Provider differences this module has to absorb:

* Gitee creates an issue on an owner-scoped route and takes the repository name in
  the request body; GitHub keeps the repository in the path.
* Gitee API v5 publishes no code search endpoint, so ``search`` with ``kind=code``
  returns an explicit ``unsupported_action`` result instead of an invented answer.
* Gitee issue states add ``progressing``/``rejected``; Gitee pull states add ``merged``.
* Gitee documents ``access_token`` as a request parameter and registers no security
  scheme, so the credential travels in the query string there, while GitHub uses the
  ``Authorization: Bearer`` header.

``repo_tree`` walks the recursive git tree of the default branch (both providers
resolve ``HEAD``) and treats ``path`` as a prefix filter, because neither API exposes
a recursive walk scoped to a subdirectory. Credentials are read from
``GITHUB_TOKEN``/``GITEE_TOKEN`` on every call; a missing token is an error result,
never a fallback. No result, error message or log line contains a token.
"""
import asyncio
import base64
import json
import os
import re
from collections.abc import Callable
from typing import Any

import httpx
from fastapi import HTTPException
from langchain_core.tools import BaseTool, tool
from sqlalchemy.orm import Session

from personalos.services.tools import request_approval

BASE_URL = {"github": "https://api.github.com", "gitee": "https://gitee.com/api/v5"}
TOKEN_ENV = {"github": "GITHUB_TOKEN", "gitee": "GITEE_TOKEN"}

TIMEOUT_SECONDS = 20
MAX_BODY_BYTES = 2 * 1024 * 1024
MAX_TEXT_CHARS = 100_000
MAX_PATCH_CHARS = 4_000
MAX_TREE_ENTRIES = 2_000
MAX_LIST_ITEMS = 20
PAGE_SIZE = "20"
MAX_NUMBER = 1_000_000_000

ISSUE_STATES = {"github": {"open", "closed", "all"},
                "gitee": {"open", "progressing", "closed", "rejected", "all"}}
PULL_STATES = {"github": {"open", "closed", "all"}, "gitee": {"open", "closed", "merged", "all"}}

ACTION_PARAMS: dict[str, tuple[set[str], set[str]]] = {
    "repo_file": ({"owner", "repo", "path", "ref"}, {"owner", "repo", "path"}),
    "repo_tree": ({"owner", "repo", "path"}, {"owner", "repo"}),
    "search": ({"q", "kind"}, {"q", "kind"}),
    "list_issues": ({"owner", "repo", "state"}, {"owner", "repo"}),
    "get_issue": ({"owner", "repo", "number"}, {"owner", "repo", "number"}),
    "list_prs": ({"owner", "repo", "state"}, {"owner", "repo"}),
    "get_pr": ({"owner", "repo", "number"}, {"owner", "repo", "number"}),
    "pr_files": ({"owner", "repo", "number"}, {"owner", "repo", "number"}),
    "create_issue": ({"owner", "repo", "title", "body"}, {"owner", "repo", "title"}),
    "comment": ({"owner", "repo", "number", "body"}, {"owner", "repo", "number", "body"}),
}
WRITE_ACTIONS = {"create_issue", "comment"}

_NAME_RE = re.compile(r"[A-Za-z0-9._][A-Za-z0-9._-]*")
_PATH_RE = re.compile(r"[A-Za-z0-9._/-]+")
_REF_RE = re.compile(r"[A-Za-z0-9._/-]+")
_CONTROL = frozenset(chr(code) for code in (*range(0, 9), *range(11, 32), 127))


class HostingError(Exception):
    """A structured, token-free failure that becomes the tool result or an approval error."""

    def __init__(self, error: str, *, status: int | None = None, message: str = "", **extra: Any):
        super().__init__(error)
        self.error = error
        self.status = status
        self.message = message
        self.extra = extra

    def payload(self) -> dict[str, Any]:
        data: dict[str, Any] = {"error": self.error}
        if self.status is not None:
            data["status"] = self.status
        if self.message:
            data["message"] = self.message
        return {**data, **self.extra}

    def scrub(self, secret: str) -> "HostingError":
        if secret:
            self.message = self.message.replace(secret, "[redacted]")
            self.error = self.error.replace(secret, "[redacted]")
        return self


def _string(value: Any, field: str, limit: int) -> str:
    if not isinstance(value, str):
        raise HostingError("invalid_params", message=f"{field} must be a string")
    text = value.strip()
    if not text:
        raise HostingError("invalid_params", message=f"{field} must not be empty")
    if len(text) > limit:
        raise HostingError("invalid_params", message=f"{field} must be at most {limit} characters")
    return text


def _name(value: Any, field: str) -> str:
    text = _string(value, field, 100)
    if not _NAME_RE.fullmatch(text) or ".." in text:
        raise HostingError("invalid_params", message=f"{field} contains unsupported characters")
    return text


def _repo_path(value: Any, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str):
        raise HostingError("invalid_params", message="path must be a string")
    text = value.strip()
    if not text:
        if allow_empty:
            return ""
        raise HostingError("invalid_params", message="path must not be empty")
    if len(text) > 300:
        raise HostingError("invalid_params", message="path must be at most 300 characters")
    if text.startswith("/"):
        raise HostingError("invalid_params", message="path must be relative to the repository root")
    text = text.rstrip("/")
    if ".." in text or not _PATH_RE.fullmatch(text) or any(part in {"", "."} for part in text.split("/")):
        raise HostingError("invalid_params", message="path must be a plain relative repository path")
    return text


def _ref(value: Any) -> str:
    text = _string(value, "ref", 200)
    if (".." in text or not _REF_RE.fullmatch(text) or text.startswith("/") or text.endswith("/")
            or "@{" in text):
        raise HostingError("invalid_params", message="ref contains unsupported characters")
    return text


def _number(value: Any) -> int:
    if isinstance(value, bool):
        raise HostingError("invalid_params", message="number must be a positive integer")
    if isinstance(value, int):
        number = value
    elif isinstance(value, str) and value.strip().isdigit():
        number = int(value.strip())
    else:
        raise HostingError("invalid_params", message="number must be a positive integer")
    if not 1 <= number <= MAX_NUMBER:
        raise HostingError("invalid_params", message=f"number must be between 1 and {MAX_NUMBER}")
    return number


def _free_text(value: Any, field: str, limit: int) -> str:
    text = _string(value, field, limit)
    if _CONTROL.intersection(text):
        raise HostingError("invalid_params", message=f"{field} contains control characters")
    return text


def _state(platform: str, action: str, value: Any) -> str:
    allowed = PULL_STATES[platform] if action == "list_prs" else ISSUE_STATES[platform]
    if not isinstance(value, str) or value.strip().lower() not in allowed:
        raise HostingError("invalid_params", message="state must be one of: " + ", ".join(sorted(allowed)))
    return value.strip().lower()


def _normalize(platform: str, action: str, field: str, value: Any) -> Any:
    if field in {"owner", "repo"}:
        return _name(value, field)
    if field == "path":
        return _repo_path(value, allow_empty=action == "repo_tree")
    if field == "ref":
        return _ref(value)
    if field == "number":
        return _number(value)
    if field == "state":
        return _state(platform, action, value)
    if field == "kind":
        if not isinstance(value, str) or value.strip().lower() not in {"repos", "code"}:
            raise HostingError("invalid_params", message="kind must be repos or code")
        return value.strip().lower()
    if field == "q":
        return _free_text(value, "q", 200)
    if field == "title":
        return _free_text(value, "title", 200)
    if field == "body":
        return _free_text(value, "body", 20_000)
    raise HostingError("unknown_params", unknown=[field])


def _validate_params(platform: str, action: str, raw: Any) -> dict[str, Any]:
    allowed, required = ACTION_PARAMS[action]
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise HostingError("invalid_params", message="params must be an object")
    unknown = sorted(set(raw) - allowed)
    if unknown:
        raise HostingError("unknown_params", unknown=unknown, allowed=sorted(allowed))
    missing = sorted(required - set(raw))
    if missing:
        raise HostingError("missing_params", missing=missing, allowed=sorted(allowed))
    return {key: _normalize(platform, action, key, value) for key, value in raw.items()}


def _credentials(platform: str) -> tuple[str, dict[str, str], dict[str, str]]:
    name = TOKEN_ENV[platform]
    token = (os.environ.get(name) or "").strip()
    if not token:
        raise HostingError("missing_credential", platform=platform,
                           message=f"{name} is not configured on the server")
    if platform == "github":
        return token, {"authorization": f"Bearer {token}"}, {}
    return token, {}, {"access_token": token}


def _provider_reason(payload: Any, text: str) -> str:
    if isinstance(payload, dict):
        for key in ("message", "error", "error_description"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()[:300]
        errors = payload.get("errors")
        if isinstance(errors, list) and errors:
            return json.dumps(errors, ensure_ascii=False)[:300]
    stripped = text.strip()
    return stripped[:200] if stripped and len(stripped) < 8_192 else ""


async def _read_body(response: httpx.Response) -> tuple[bytes, bool]:
    buffer = bytearray()
    async for chunk in response.aiter_raw():
        if len(buffer) + len(chunk) > MAX_BODY_BYTES:
            buffer.extend(chunk[: MAX_BODY_BYTES - len(buffer)])
            return bytes(buffer), True
        buffer.extend(chunk)
    return bytes(buffer), False


def _decode(status: int, body: bytes, truncated: bool) -> Any:
    text = body.decode("utf-8", "replace")
    payload: Any = None
    if not truncated:
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            payload = None
    if not 200 <= status < 300:
        raise HostingError(_provider_reason(payload, text) or "http_error", status=status)
    if truncated:
        raise HostingError("response_too_large", status=status, truncated=True, byte_limit=MAX_BODY_BYTES,
                           message=f"response exceeded {MAX_BODY_BYTES} bytes and was dropped")
    if payload is None:
        raise HostingError("invalid_json", status=status, message="provider returned no JSON body")
    return payload


async def _exchange(platform: str, method: str, path: str, headers: dict[str, str],
                    auth_params: dict[str, str], params: dict[str, str] | None,
                    json_body: dict[str, Any] | None) -> tuple[int, bytes, bool]:
    request_headers = {**headers, "accept": "application/json", "accept-encoding": "identity",
                       "user-agent": "personal-os-code-hosting"}
    # The outer deadline also bounds DNS and a provider that keeps sending fragments.
    async with asyncio.timeout(TIMEOUT_SECONDS):
        async with httpx.AsyncClient(timeout=httpx.Timeout(TIMEOUT_SECONDS),
                                     follow_redirects=False) as client:
            async with client.stream(method, BASE_URL[platform] + path, json=json_body,
                                     params={**(params or {}), **auth_params},
                                     headers=request_headers) as response:
                status = response.status_code
                # Both APIs answer JSON in place; compression or a redirect means the
                # response did not come from the expected endpoint.
                encoding = response.headers.get("content-encoding", "identity").strip().lower()
                if encoding not in {"", "identity"}:
                    raise HostingError("unsupported_content_encoding", status=status)
                if 300 <= status < 400:
                    raise HostingError("unexpected_redirect", status=status,
                                       message=f"provider answered with a {status} redirect")
                body, truncated = await _read_body(response)
    return status, body, truncated


async def _send(platform: str, method: str, path: str, *, params: dict[str, str] | None = None,
                json_body: dict[str, Any] | None = None) -> Any:
    token, headers, auth_params = _credentials(platform)
    try:
        # Provider text can echo the request URL, so decoding stays inside the scrub guard.
        status, body, truncated = await _exchange(platform, method, path, headers, auth_params,
                                                  params, json_body)
        return _decode(status, body, truncated)
    except HostingError as exc:
        raise exc.scrub(token) from None


def _clip(text: Any, limit: int) -> tuple[str, bool]:
    value = text if isinstance(text, str) else ""
    return (value[:limit], False) if len(value) <= limit else (value[:limit], True)


def _login(user: Any) -> str | None:
    if isinstance(user, dict):
        login = user.get("login") or user.get("name") or user.get("full_name")
        return login if isinstance(login, str) else None
    return user if isinstance(user, str) else None


def _ref_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {"ref": value.get("ref"), "sha": value.get("sha")}
    return value if isinstance(value, str) else None


def _label_names(labels: Any) -> list[str]:
    names = []
    for label in labels if isinstance(labels, list) else []:
        name = label.get("name") if isinstance(label, dict) else label
        if isinstance(name, str):
            names.append(name)
    return names[:50]


def _issue_view(item: Any, *, with_body: bool = False) -> dict[str, Any]:
    if not isinstance(item, dict):
        return {"unexpected_item": True}
    view = {"number": item.get("number"), "title": item.get("title"), "state": item.get("state"),
            "author": _login(item.get("user")), "comments": item.get("comments"),
            "labels": _label_names(item.get("labels")), "created_at": item.get("created_at"),
            "html_url": item.get("html_url")}
    if "pull_request" in item:
        view["is_pull_request"] = True
    if with_body:
        view["body"], view["body_truncated"] = _clip(item.get("body") or "", MAX_PATCH_CHARS)
    return view


def _pull_view(item: Any, *, with_body: bool = False) -> dict[str, Any]:
    if not isinstance(item, dict):
        return {"unexpected_item": True}
    view = {"number": item.get("number"), "title": item.get("title"), "state": item.get("state"),
            "author": _login(item.get("user")), "head": _ref_value(item.get("head")),
            "base": _ref_value(item.get("base")), "merged_at": item.get("merged_at"),
            "mergeable": item.get("mergeable"), "created_at": item.get("created_at"),
            "html_url": item.get("html_url")}
    if with_body:
        view["body"], view["body_truncated"] = _clip(item.get("body") or "", MAX_PATCH_CHARS)
    return view


def _diff_view(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict):
        return {"unexpected_item": True}
    patch, truncated = _clip(item.get("patch") or "", MAX_PATCH_CHARS)
    return {"filename": item.get("filename"), "status": item.get("status"),
            "additions": item.get("additions"), "deletions": item.get("deletions"),
            "patch": patch, "patch_truncated": truncated}


def _items(payload: Any) -> list[Any]:
    if not isinstance(payload, list):
        raise HostingError("invalid_response", message="provider returned an unexpected shape")
    return payload


def _file_view(payload: Any) -> dict[str, Any]:
    if isinstance(payload, list):
        raise HostingError("path_is_directory", message="path is a directory; use repo_tree instead")
    if not isinstance(payload, dict):
        raise HostingError("invalid_response", message="provider returned an unexpected shape")
    if payload.get("type") not in {None, "file"}:
        raise HostingError("not_a_file", message=f"path is a {payload.get('type')}; use repo_tree instead")
    raw = payload.get("content") or ""
    if payload.get("encoding") != "base64" or not raw:
        # GitHub inlines content only below 1 MB; larger files come back with no body.
        raise HostingError("file_content_not_inlined", message="provider did not inline this file's content",
                           size=payload.get("size"), sha=payload.get("sha"))
    try:
        decoded = base64.b64decode(raw)
    except (ValueError, TypeError):
        raise HostingError("invalid_response", message="provider returned undecodable content") from None
    content, truncated = _clip(decoded.decode("utf-8", "replace"), MAX_TEXT_CHARS)
    return {"path": payload.get("path"), "sha": payload.get("sha"), "size": payload.get("size"),
            "content": content, "truncated": truncated}


def _tree_view(payload: Any, prefix: str) -> dict[str, Any]:
    entries = payload.get("tree") if isinstance(payload, dict) else None
    if not isinstance(entries, list):
        raise HostingError("invalid_response", message="provider returned an unexpected tree shape")
    selected = [entry for entry in entries if isinstance(entry, dict) and isinstance(entry.get("path"), str)
                and (not prefix or entry["path"] == prefix or entry["path"].startswith(prefix + "/"))]
    views = [{"path": entry["path"], "type": entry.get("type"), "size": entry.get("size")}
             for entry in selected[:MAX_TREE_ENTRIES]]
    return {"path": prefix, "entries": views, "count": len(views),
            "truncated": len(selected) > MAX_TREE_ENTRIES or bool(payload.get("truncated"))}


def _code_search_item(item: dict[str, Any]) -> dict[str, Any]:
    return {"path": item.get("path"), "repository": _login(item.get("repository")),
            "html_url": item.get("html_url")}


def _repo_search_item(item: dict[str, Any]) -> dict[str, Any]:
    return {"full_name": item.get("full_name"), "html_url": item.get("html_url"),
            "description": _clip(item.get("description") or "", 500)[0],
            "stars": item.get("stargazers_count", item.get("stars_count")),
            "language": item.get("language"), "updated_at": item.get("updated_at")}


def _search_view(payload: Any, kind: str) -> dict[str, Any]:
    items = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        raise HostingError("invalid_response", message="provider returned an unexpected search shape")
    view = _code_search_item if kind == "code" else _repo_search_item
    views = [view(item) for item in items[:MAX_LIST_ITEMS] if isinstance(item, dict)]
    return {"kind": kind, "total_count": payload.get("total_count"), "items": views,
            "truncated": len(items) > MAX_LIST_ITEMS}


def _paged(payload: Any, view: Callable[[Any], dict[str, Any]]) -> dict[str, Any]:
    items = _items(payload)
    views = [view(item) for item in items[:MAX_LIST_ITEMS]]
    return {"items": views, "count": len(views), "truncated": len(items) > MAX_LIST_ITEMS}


async def _read_file(platform: str, params: dict[str, Any]) -> dict[str, Any]:
    path = f"/repos/{params['owner']}/{params['repo']}/contents/{params['path']}"
    query = {"ref": params["ref"]} if params.get("ref") else {}
    return _file_view(await _send(platform, "GET", path, params=query))


async def _read_tree(platform: str, params: dict[str, Any]) -> dict[str, Any]:
    path = f"/repos/{params['owner']}/{params['repo']}/git/trees/HEAD"
    return _tree_view(await _send(platform, "GET", path, params={"recursive": "1"}), params.get("path") or "")


async def _search(platform: str, params: dict[str, Any]) -> dict[str, Any]:
    kind = params["kind"]
    if kind == "code" and platform == "gitee":
        raise HostingError("unsupported_action", platform=platform, action="search", kind=kind,
                           message="Gitee API v5 publishes no code search endpoint; use kind=repos")
    endpoint = "/search/code" if kind == "code" else "/search/repositories"
    payload = await _send(platform, "GET", endpoint, params={"q": params["q"], "per_page": PAGE_SIZE})
    return _search_view(payload, kind)


async def _read_issues(platform: str, action: str, params: dict[str, Any]) -> dict[str, Any]:
    path = f"/repos/{params['owner']}/{params['repo']}/issues"
    if action == "get_issue":
        payload = await _send(platform, "GET", f"{path}/{params['number']}")
        return _issue_view(payload, with_body=True)
    query = {"state": params.get("state", "open"), "per_page": PAGE_SIZE}
    return _paged(await _send(platform, "GET", path, params=query), _issue_view)


async def _read_pulls(platform: str, action: str, params: dict[str, Any]) -> dict[str, Any]:
    path = f"/repos/{params['owner']}/{params['repo']}/pulls"
    if action == "list_prs":
        query = {"state": params.get("state", "open"), "per_page": PAGE_SIZE}
        return _paged(await _send(platform, "GET", path, params=query), _pull_view)
    if action == "get_pr":
        payload = await _send(platform, "GET", f"{path}/{params['number']}")
        return _pull_view(payload, with_body=True)
    payload = await _send(platform, "GET", f"{path}/{params['number']}/files")
    items = _items(payload)
    views = [_diff_view(item) for item in items[:MAX_LIST_ITEMS]]
    return {"files": views, "count": len(views), "truncated": len(items) > MAX_LIST_ITEMS}


async def _read(platform: str, action: str, params: dict[str, Any]) -> dict[str, Any]:
    if action == "repo_file":
        return await _read_file(platform, params)
    if action == "repo_tree":
        return await _read_tree(platform, params)
    if action == "search":
        return await _search(platform, params)
    if action in {"list_issues", "get_issue"}:
        return await _read_issues(platform, action, params)
    return await _read_pulls(platform, action, params)


def _write_request(platform: str, action: str, params: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
    owner, repo = params["owner"], params["repo"]
    if action == "create_issue":
        body: dict[str, Any] = {"title": params["title"]}
        if params.get("body"):
            body["body"] = params["body"]
        if platform == "github":
            return "POST", f"/repos/{owner}/{repo}/issues", body
        return "POST", f"/repos/{owner}/issues", {"repo": repo, **body}
    return "POST", f"/repos/{owner}/{repo}/issues/{params['number']}/comments", {"body": params["body"]}


async def _dispatch(db: Session, owner_id: str, platform: Any, action: Any,
                    raw_params: Any) -> dict[str, Any]:
    platform = platform.strip().lower() if isinstance(platform, str) else ""
    if platform not in BASE_URL:
        raise HostingError("unsupported_platform", message="platform must be github or gitee")
    action = action.strip().lower() if isinstance(action, str) else ""
    if action not in ACTION_PARAMS:
        raise HostingError("unsupported_action", allowed=sorted(ACTION_PARAMS))
    params = _validate_params(platform, action, raw_params)
    if action not in WRITE_ACTIONS:
        return await _read(platform, action, params)
    approval = request_approval(db, owner_id, "code_hosting.write",
                                {"platform": platform, "action": action, "params": params},
                                f"Code hosting write: {action}")
    return {"approval_required": True, "approval_id": approval.id}


def make_code_hosting_tool(db: Session, owner_id: str) -> BaseTool:
    @tool
    async def code_hosting(platform: str, action: str, params: dict | None = None) -> str:
        """Read a GitHub or Gitee repository, or request human approval for a write.

        platform is "github" or "gitee". Read actions run immediately:
        repo_file(owner, repo, path, ref?), repo_tree(owner, repo, path?),
        search(q, kind="repos"|"code"), list_issues(owner, repo, state?),
        get_issue(owner, repo, number), list_prs(owner, repo, state?),
        get_pr(owner, repo, number), pr_files(owner, repo, number).
        Write actions never execute here; they create an approval and return
        approval_id: create_issue(owner, repo, title, body?), comment(owner, repo, number, body).
        """
        try:
            result = await _dispatch(db, owner_id, platform, action, params)
        except HostingError as exc:
            result = exc.payload()
        except HTTPException as exc:
            result = {"error": "approval_unavailable", "status": exc.status_code, "message": str(exc.detail)}
        except (TimeoutError, httpx.HTTPError):
            result = {"error": "network_error", "message": "The code hosting provider could not be reached"}
        return json.dumps(result, ensure_ascii=False, default=str)

    return code_hosting


_APPROVAL_STATUS = {"missing_credential": 503, "unsupported_platform": 400, "unsupported_action": 403}


def _approval_error(exc: HostingError) -> HTTPException:
    if exc.status is not None:
        detail = (f"Code hosting write was rejected by the provider (HTTP {exc.status}): "
                  f"{exc.message or 'no reason given'}")
        return HTTPException(502, detail)
    detail = f"Code hosting write refused: {exc.message or exc.error}"
    return HTTPException(_APPROVAL_STATUS.get(exc.error, 422), detail)


async def execute_code_hosting_write(db: Session, owner_id: str, args: dict) -> dict:
    """Execute an approved code hosting write.

    db and owner_id are part of the approval wiring contract; the write itself is a
    single provider call. Failures raise so the approval is never reported as a success,
    and transport errors are left to propagate so the caller can record an unknown outcome.
    """
    platform = args.get("platform") if isinstance(args, dict) else None
    if not isinstance(platform, str) or platform.strip().lower() not in BASE_URL:
        raise HTTPException(422, "Approval does not name a supported code hosting platform")
    platform = platform.strip().lower()
    action = args.get("action")
    if not isinstance(action, str) or action not in WRITE_ACTIONS:
        raise HTTPException(403, "Unsupported code hosting write action")
    try:
        params = _validate_params(platform, action, args.get("params"))
        method, path, body = _write_request(platform, action, params)
        payload = await _send(platform, method, path, json_body=body)
    except HostingError as exc:
        raise _approval_error(exc) from None
    if not isinstance(payload, dict):
        raise HTTPException(502, "Code hosting provider returned an unexpected write result")
    result = {key: payload[key] for key in ("id", "number", "title", "state", "html_url") if payload.get(key)}
    return {"platform": platform, "action": action, **result}
