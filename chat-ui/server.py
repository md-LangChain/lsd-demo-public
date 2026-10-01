#!/usr/bin/env python3
"""Local chat UI for a LangGraph Agent Server.

Serves the static UI and proxies Agent Server API calls, injecting
LANGSMITH_API_KEY from the repo .env so the key never reaches the browser.

Supports JSON responses and SSE streaming (for /runs/stream).

  python3 chat-ui/server.py
"""

from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
ALLOWED_HOST_SUFFIXES = (".langgraph.app",)
ALLOWED_HOSTS = {
    "127.0.0.1",
    "localhost",
    "api.host.langchain.com",
}
DEFAULT_CONTROL_PLANE = "https://api.host.langchain.com"


def load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        if key:
            os.environ.setdefault(key, value)


def boot_env() -> None:
    load_dotenv(Path.cwd() / ".env")
    load_dotenv(ROOT.parent / ".env")
    load_dotenv(ROOT / ".env")


def key_status() -> str:
    return "set" if os.environ.get("LANGSMITH_API_KEY") else "unset"


def default_server_url() -> str:
    return (
        os.environ.get("LANGGRAPH_API_URL")
        or os.environ.get("AGENT_SERVER_URL")
        or ""
    ).rstrip("/")


def control_plane_host() -> str:
    return (
        os.environ.get("LANGSMITH_CONTROL_PLANE_HOST")
        or os.environ.get("CONTROL_PLANE_HOST")
        or DEFAULT_CONTROL_PLANE
    ).rstrip("/")


def workspace_id() -> str:
    return (
        os.environ.get("LANGSMITH_WORKSPACE_ID")
        or os.environ.get("LANGSMITH_TENANT_ID")
        or os.environ.get("LANGCHAIN_TENANT_ID")
        or ""
    ).strip()


def langsmith_headers() -> dict[str, str]:
    api_key = os.environ.get("LANGSMITH_API_KEY")
    if not api_key:
        raise RuntimeError("LANGSMITH_API_KEY is unset")
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Api-Key": api_key,
    }
    tenant = workspace_id()
    if tenant:
        headers["X-Tenant-Id"] = tenant
    return headers


def http_json(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    body: dict | None = None,
    timeout: float = 60,
) -> tuple[int, object]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        url, data=data, headers=headers or {}, method=method
    )
    try:
        with urllib.request.urlopen(
            request, timeout=timeout, context=ssl.create_default_context()
        ) as resp:
            raw = resp.read()
            if not raw:
                return resp.status, None
            return resp.status, json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as err:
        raw = err.read()
        detail: object
        try:
            detail = json.loads(raw.decode("utf-8")) if raw else {"error": err.reason}
        except Exception:
            detail = {"error": raw.decode("utf-8", errors="replace") or err.reason}
        return err.code, detail


def list_control_plane_deployments() -> list[dict]:
    host = control_plane_host()
    headers = langsmith_headers()
    resources: list[dict] = []
    offset = 0
    while True:
        query = urlencode({"limit": 100, "offset": offset})
        status, payload = http_json(
            "GET", f"{host}/v2/deployments?{query}", headers=headers
        )
        if status >= 400:
            raise RuntimeError(
                f"Control plane list failed ({status}): {json.dumps(payload)[:400]}"
            )
        if not isinstance(payload, dict):
            raise RuntimeError("Unexpected control plane response")
        batch = payload.get("resources") or []
        if not isinstance(batch, list):
            raise RuntimeError("Unexpected control plane resources payload")
        resources.extend(item for item in batch if isinstance(item, dict))
        if len(batch) < 100:
            break
        offset += len(batch)
    return resources


def normalize_deployments(resources: list[dict]) -> list[dict]:
    out: list[dict] = []
    for item in resources:
        url = (item.get("url") or "").rstrip("/")
        if not url:
            continue
        status = item.get("status") or "UNKNOWN"
        # Prefer ready deployments; still include others so the UI can show why.
        out.append(
            {
                "id": item.get("id"),
                "name": item.get("display_name") or item.get("name") or url,
                "url": url,
                "status": status,
                "ready": status == "READY",
            }
        )
    out.sort(key=lambda d: (not d["ready"], str(d["name"]).lower()))
    return out


def search_assistants(agent_url: str) -> list[dict]:
    origin = allowed_target(agent_url)
    if not origin:
        raise ValueError("Invalid Agent Server URL")
    headers = langsmith_headers()
    headers["X-Auth-Scheme"] = "langsmith-api-key"
    status, payload = http_json(
        "POST",
        f"{origin}/assistants/search",
        headers=headers,
        body={"limit": 100, "offset": 0},
    )
    if status >= 400:
        raise RuntimeError(
            f"Assistants search failed ({status}): {json.dumps(payload)[:400]}"
        )
    items = payload if isinstance(payload, list) else []
    if isinstance(payload, dict):
        for key in ("assistants", "items", "results"):
            if isinstance(payload.get(key), list):
                items = payload[key]
                break
    out: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        assistant_id = item.get("assistant_id") or item.get("id")
        if not assistant_id:
            continue
        graph_id = item.get("graph_id") or ""
        name = item.get("name") or graph_id or str(assistant_id)
        out.append(
            {
                "assistant_id": assistant_id,
                "graph_id": graph_id or None,
                "name": name,
            }
        )
    return out


def content_type_for(path: Path) -> str:
    return {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
    }.get(path.suffix, "application/octet-stream")


def allowed_target(url: str) -> str | None:
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("https", "http"):
        return None
    if parsed.scheme == "http" and parsed.hostname not in {"127.0.0.1", "localhost"}:
        return None
    host = (parsed.hostname or "").lower()
    if host in ALLOWED_HOSTS or any(host.endswith(sfx) for sfx in ALLOWED_HOST_SUFFIXES):
        return f"{parsed.scheme}://{parsed.netloc}"
    return None


class Handler(BaseHTTPRequestHandler):
    server_version = "chat-ui/0.1"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def do_GET(self) -> None:
        self._dispatch()

    def do_POST(self) -> None:
        self._dispatch()

    def do_PATCH(self) -> None:
        self._dispatch()

    def do_PUT(self) -> None:
        self._dispatch()

    def do_DELETE(self) -> None:
        self._dispatch()

    def _dispatch(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path or "/"
        query = parse_qs(parsed.query)

        if path == "/health":
            self._json(
                200,
                {
                    "ok": True,
                    "api_key": key_status(),
                    "default_url": default_server_url() or None,
                    "workspace_id": "set" if workspace_id() else "unset",
                },
            )
            return
        if path == "/meta":
            self._json(
                200,
                {
                    "api_key": key_status(),
                    "default_url": default_server_url() or None,
                    "auth_scheme": "langsmith-api-key",
                    "workspace_id": "set" if workspace_id() else "unset",
                    "control_plane": control_plane_host(),
                },
            )
            return
        if path == "/deployments" and self.command == "GET":
            self._list_deployments()
            return
        if path == "/deployments/assistants" and self.command == "GET":
            self._list_assistants(query)
            return
        if path == "/" or path.startswith("/static/"):
            self._static(path)
            return

        self._proxy(path, parsed.query)

    def _list_deployments(self) -> None:
        if not os.environ.get("LANGSMITH_API_KEY"):
            self._json(503, {"error": "LANGSMITH_API_KEY is unset"})
            return
        try:
            resources = list_control_plane_deployments()
            deployments = normalize_deployments(resources)
            self._json(
                200,
                {
                    "deployments": deployments,
                    "workspace_id": "set" if workspace_id() else "unset",
                    "control_plane": control_plane_host(),
                },
            )
        except Exception as err:
            self._json(
                502,
                {
                    "error": "Failed to list LangSmith deployments",
                    "detail": str(err),
                    "hint": (
                        "Set LANGSMITH_WORKSPACE_ID if your API key requires a "
                        "workspace, or LANGSMITH_CONTROL_PLANE_HOST for EU/APAC/AWS."
                    ),
                },
            )

    def _list_assistants(self, query: dict[str, list[str]]) -> None:
        if not os.environ.get("LANGSMITH_API_KEY"):
            self._json(503, {"error": "LANGSMITH_API_KEY is unset"})
            return
        urls = query.get("url") or []
        if not urls or not urls[0].strip():
            self._json(400, {"error": "Query param url is required"})
            return
        try:
            assistants = search_assistants(urls[0].strip())
            self._json(200, {"assistants": assistants, "url": urls[0].rstrip("/")})
        except ValueError as err:
            self._json(400, {"error": str(err)})
        except Exception as err:
            self._json(
                502,
                {
                    "error": "Failed to list assistants for deployment",
                    "detail": str(err),
                },
            )

    def _static(self, path: str) -> None:
        rel = "index.html" if path in ("/", "/index.html") else path.removeprefix("/static/").lstrip("/")
        target = (STATIC / rel).resolve()
        try:
            target.relative_to(STATIC.resolve())
        except ValueError:
            self.send_error(403)
            return
        if not target.is_file():
            self.send_error(404)
            return
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type_for(target))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return b""
        return self.rfile.read(length)

    def _json(self, status: int, payload: dict) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _proxy(self, path: str, query: str) -> None:
        api_key = os.environ.get("LANGSMITH_API_KEY")
        if not api_key:
            self._json(503, {"error": "LANGSMITH_API_KEY is unset"})
            return

        target = self.headers.get("X-Agent-Server-Url") or default_server_url()
        origin = allowed_target(target) if target else None
        if not origin:
            self._json(
                400,
                {
                    "error": "Set a valid Agent Server URL",
                    "hint": (
                        "Copy api_url from the agent's Advanced settings → "
                        "View code snippets. Host must be *.langgraph.app "
                        "(or localhost)."
                    ),
                },
            )
            return

        url = origin + path + (("?" + query) if query else "")
        body = self._read_body()
        accept = self.headers.get("Accept") or "application/json"
        headers = {
            "Accept": accept,
            "X-Api-Key": api_key,
            "X-Auth-Scheme": "langsmith-api-key",
        }
        if body:
            headers["Content-Type"] = self.headers.get("Content-Type") or "application/json"

        request = urllib.request.Request(
            url, data=body or None, headers=headers, method=self.command
        )
        try:
            resp = urllib.request.urlopen(
                request, timeout=300, context=ssl.create_default_context()
            )
        except urllib.error.HTTPError as err:
            payload = err.read()
            resp_type = err.headers.get("Content-Type") or "application/json"
            self.send_response(err.code)
            self.send_header("Content-Type", resp_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if payload:
                self.wfile.write(payload)
            return
        except Exception as err:
            self._json(502, {"error": "upstream request failed", "type": type(err).__name__})
            return

        with resp:
            resp_type = resp.headers.get("Content-Type") or "application/json"
            streaming = "text/event-stream" in resp_type or path.rstrip("/").endswith("/stream")
            self.send_response(resp.status)
            self.send_header("Content-Type", resp_type)
            self.send_header("Cache-Control", "no-store")
            if streaming:
                # Pass SSE through as a raw byte stream. Do not wrap in
                # Transfer-Encoding: chunked — that breaks browser EventSource/fetch.
                self.send_header("Connection", "close")
                self.end_headers()
                try:
                    while True:
                        chunk = resp.read(1024)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        self.wfile.flush()
                except BrokenPipeError:
                    return
            else:
                payload = resp.read()
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                if payload:
                    self.wfile.write(payload)


def main() -> None:
    parser = argparse.ArgumentParser(description="Chat with an Agent Server assistant")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    boot_env()
    if not STATIC.is_dir():
        raise SystemExit(f"missing static dir: {STATIC}")
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print("Agent Server chat", flush=True)
    print(f"  http://{args.host}:{args.port}", flush=True)
    print(f"  LANGSMITH_API_KEY: {key_status()}", flush=True)
    print(f"  LANGSMITH_WORKSPACE_ID: {'set' if workspace_id() else 'unset'}", flush=True)
    print(f"  control plane: {control_plane_host()}", flush=True)
    print(f"  default Agent Server URL: {default_server_url() or '(set in the UI)'}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped", flush=True)


if __name__ == "__main__":
    main()
