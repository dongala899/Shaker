#!/usr/bin/env python3
import argparse
import json
import os
import posixpath
import threading
import urllib.parse
from http import HTTPStatus
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn


class ServerState:
    def __init__(self, root_directory, shutdown_delay_seconds=4.0):
        self.root_directory = os.path.abspath(root_directory)
        self.storage_directory = os.path.join(self.root_directory, "app-data")
        self.storage_file_path = os.path.join(self.storage_directory, "shaker-storage.json")
        self.shutdown_delay_seconds = shutdown_delay_seconds
        self.active_clients = set()
        self._shutdown_timer = None
        self._lock = threading.Lock()
        self.httpd = None

    def attach(self, httpd):
        self.httpd = httpd

    def _cancel_shutdown_locked(self):
        if self._shutdown_timer is not None:
            self._shutdown_timer.cancel()
            self._shutdown_timer = None

    def register(self, client_id):
        if not client_id:
            return self.snapshot()

        with self._lock:
            self._cancel_shutdown_locked()
            self.active_clients.add(client_id)
            return self.snapshot_locked()

    def release(self, client_id):
        with self._lock:
            if client_id:
                self.active_clients.discard(client_id)
            snapshot = self.snapshot_locked()
            if not self.active_clients:
                self._schedule_shutdown_locked(self.shutdown_delay_seconds)
            return snapshot

    def shutdown_now(self):
        with self._lock:
            self.active_clients.clear()
            self._schedule_shutdown_locked(0.25)
            return self.snapshot_locked()

    def snapshot(self):
        with self._lock:
            return self.snapshot_locked()

    def snapshot_locked(self):
        return {
            "managed": True,
            "activeClients": len(self.active_clients),
            "shutdownDelayMs": int(self.shutdown_delay_seconds * 1000),
            "fileBackedStorage": True,
        }

    def read_storage_snapshot(self):
        if not os.path.exists(self.storage_file_path):
            return {}

        try:
            with open(self.storage_file_path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
            storage = payload.get("storage", {})
            return storage if isinstance(storage, dict) else {}
        except Exception:
            return {}

    def write_storage_snapshot(self, storage):
        os.makedirs(self.storage_directory, exist_ok=True)
        payload = {
            "updatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
            "storage": storage if isinstance(storage, dict) else {},
        }
        with open(self.storage_file_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=True, indent=2)

    def _schedule_shutdown_locked(self, delay_seconds):
        self._cancel_shutdown_locked()
        self._shutdown_timer = threading.Timer(delay_seconds, self._perform_shutdown)
        self._shutdown_timer.daemon = True
        self._shutdown_timer.start()

    def _perform_shutdown(self):
        if self.httpd is None:
            return

        try:
            self.httpd.shutdown()
        except Exception:
            pass


class ShakerRequestHandler(SimpleHTTPRequestHandler):
    server_version = "ShakerLocalhost/1.0"

    def __init__(self, *args, directory=None, server_state=None, **kwargs):
        self.server_state = server_state
        self.root_directory = directory or getattr(server_state, "root_directory", os.getcwd())
        super().__init__(*args, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format_string, *args):
        print("%s - - [%s] %s" % (self.client_address[0], self.log_date_time_string(), format_string % args))

    def do_GET(self):
        if self._handle_management_request():
            return
        super().do_GET()

    def do_HEAD(self):
        if self._handle_management_request(head_only=True):
            return
        super().do_HEAD()

    def do_POST(self):
        if self._handle_management_request():
            return
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED, "Method Not Allowed")

    def translate_path(self, path):
        parsed = urllib.parse.urlsplit(path)
        normalized = parsed.path or "/"
        if normalized == "/":
            normalized = "/index.html"
        normalized = posixpath.normpath(urllib.parse.unquote(normalized))
        words = [word for word in normalized.split("/") if word]
        resolved_path = self.root_directory

        for word in words:
            drive, word = os.path.splitdrive(word)
            head, word = os.path.split(word)
            if word in (os.curdir, os.pardir):
                continue
            resolved_path = os.path.join(resolved_path, word)

        if normalized.endswith("/") and not resolved_path.endswith(os.sep):
            resolved_path += os.sep

        return resolved_path

    def _handle_management_request(self, head_only=False):
        parsed = urllib.parse.urlsplit(self.path)
        route = parsed.path.rstrip("/")
        if not route.startswith("/__shaker__"):
            return False

        query = urllib.parse.parse_qs(parsed.query)
        client_id = query.get("clientId", [""])[0].strip()

        if route == "/__shaker__/health":
            self._write_json({"ok": True, **self.server_state.snapshot()}, head_only=head_only)
            return True

        if route == "/__shaker__/config":
            self._write_json(
                {
                    "managed": True,
                    "shutdownDelayMs": int(self.server_state.shutdown_delay_seconds * 1000),
                    "loginUrl": "/index.html?forceLogin=1&source=shortcut",
                    "fileBackedStorage": True,
                    "storageUrl": "/__shaker__/storage",
                },
                head_only=head_only,
            )
            return True

        if route == "/__shaker__/storage":
            if self.command in ("GET", "HEAD"):
                self._write_json(
                    {
                        "ok": True,
                        "fileBacked": True,
                        "storage": self.server_state.read_storage_snapshot(),
                    },
                    head_only=head_only,
                )
                return True

            if self.command == "POST":
                try:
                    raw = self._read_request_text()
                    payload = json.loads(raw or "{}")
                    storage = payload.get("storage", {})
                    if not isinstance(storage, dict):
                        storage = {}
                    self.server_state.write_storage_snapshot(storage)
                    self._write_json({"ok": True, "fileBacked": True}, head_only=head_only)
                except Exception:
                    self._write_json(
                        {"ok": False, "error": "Invalid storage payload."},
                        status=HTTPStatus.BAD_REQUEST,
                        head_only=head_only,
                    )
                return True

        if route == "/__shaker__/register":
            snapshot = self.server_state.register(client_id)
            self._write_json({"ok": True, **snapshot}, head_only=head_only)
            return True

        if route == "/__shaker__/release":
            snapshot = self.server_state.release(client_id)
            self._write_json({"ok": True, **snapshot}, head_only=head_only)
            return True

        if route == "/__shaker__/shutdown":
            snapshot = self.server_state.shutdown_now()
            self._write_json({"ok": True, **snapshot}, head_only=head_only)
            return True

        self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
        return True

    def _consume_request_body(self):
        length_header = self.headers.get("Content-Length", "0").strip()
        try:
            length = int(length_header or "0")
        except ValueError:
            length = 0

        if length > 0:
            self.rfile.read(length)

    def _read_request_text(self):
        length_header = self.headers.get("Content-Length", "0").strip()
        try:
            length = int(length_header or "0")
        except ValueError:
            length = 0

        if length <= 0:
            return ""

        return self.rfile.read(length).decode("utf-8")

    def _write_json(self, payload, status=HTTPStatus.OK, head_only=False):
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        if not head_only:
            self.wfile.write(raw)


def build_handler(root_directory, server_state):
    def factory(*args, **kwargs):
        return ShakerRequestHandler(*args, directory=root_directory, server_state=server_state, **kwargs)

    return factory


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


def parse_args():
    parser = argparse.ArgumentParser(description="Serve Shaker over localhost")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--root", default="")
    return parser.parse_args()


def main():
    args = parse_args()
    script_root = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(args.root or os.path.dirname(script_root))

    server_state = ServerState(project_root)
    handler_factory = build_handler(project_root, server_state)
    httpd = ThreadedHTTPServer(("127.0.0.1", args.port), handler_factory)
    server_state.attach(httpd)

    print("Serving {} at http://localhost:{}/".format(project_root, args.port))
    try:
        httpd.serve_forever()
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
