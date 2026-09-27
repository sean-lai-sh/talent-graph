#!/usr/bin/env python3
"""Forward loopback port 80 to the local Convex site port.

convexConfigured() only accepts a site URL that ends in .convex.site, so the
URL cannot carry a port. This process is the port-80 stand-in for 127.0.0.1:3211.
"""

import socket
import sys
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TARGET_HOST = "127.0.0.1"
TARGET_PORT = 3211
HOP_BY_HOP = {"transfer-encoding", "connection", "keep-alive", "content-length"}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _proxy(self) -> None:
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length) if length else None
        headers = {key: value for key, value in self.headers.items() if key.lower() not in HOP_BY_HOP}
        headers["Host"] = f"{TARGET_HOST}:{TARGET_PORT}"
        headers["Connection"] = "close"
        conn = HTTPConnection(TARGET_HOST, TARGET_PORT, timeout=30)
        try:
            conn.request(self.command, self.path, body=body, headers=headers)
            resp = conn.getresponse()
            data = resp.read()
            self.send_response(resp.status)
            for key, value in resp.getheaders():
                if key.lower() in HOP_BY_HOP:
                    continue
                self.send_header(key, value)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(data)
        except Exception as exc:
            self.send_error(502, str(exc))
        finally:
            conn.close()

    def do_GET(self) -> None:
        self._proxy()

    def do_POST(self) -> None:
        self._proxy()

    def do_PUT(self) -> None:
        self._proxy()

    def do_PATCH(self) -> None:
        self._proxy()

    def do_DELETE(self) -> None:
        self._proxy()

    def do_OPTIONS(self) -> None:
        self._proxy()

    def do_HEAD(self) -> None:
        self._proxy()

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


class Server(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


class Server6(Server):
    address_family = socket.AF_INET6


def serve(server: ThreadingHTTPServer, label: str) -> None:
    print(f"proxy {label} -> {TARGET_HOST}:{TARGET_PORT}", flush=True)
    server.serve_forever()


def main() -> None:
    v4 = Server(("127.0.0.1", 80), Handler)
    v6 = Server6(("::1", 80), Handler)
    import threading

    threading.Thread(target=serve, args=(v4, "127.0.0.1:80"), daemon=True).start()
    serve(v6, "[::1]:80")


if __name__ == "__main__":
    main()
