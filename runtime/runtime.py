import json
import os
import signal
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import psycopg

from gate import approved, commit_marker, connect


def log(event):
    print(json.dumps({"logger": "railway-recipe", "event": event}), flush=True)


def validate(role):
    required = ["AUTHENTIK_POSTGRESQL__HOST", "AUTHENTIK_POSTGRESQL__PASSWORD", "AUTHENTIK_SECRET_KEY"]
    if role == "worker":
        required += ["AUTHENTIK_BOOTSTRAP_PASSWORD", "AUTHENTIK_BOOTSTRAP_TOKEN", "AUTHENTIK_BOOTSTRAP_EMAIL"]
    for name in required:
        if not os.environ.get(name):
            raise ValueError(f"Missing required variable: {name}")
    for name in ["AUTHENTIK_SECRET_KEY", "AUTHENTIK_BOOTSTRAP_PASSWORD", "AUTHENTIK_BOOTSTRAP_TOKEN"]:
        if name in required and len(os.environ[name]) < 32:
            raise ValueError(f"{name} must contain at least 32 characters")
    if role == "server" and any(name.startswith("AUTHENTIK_BOOTSTRAP_") for name in os.environ):
        raise ValueError("Bootstrap credentials belong only on the worker")
    if os.environ.get("AUTHENTIK_OUTPOSTS__DISCOVER", "").lower() != "false":
        raise ValueError("Outpost discovery must be disabled")
    if os.environ.get("AUTHENTIK_OUTPOSTS__DISABLE_EMBEDDED_OUTPOST", "").lower() != "true":
        raise ValueError("Embedded outpost must be disabled")


def await_gate(deadline, child=None):
    while time.monotonic() < deadline:
        if child is not None and child.poll() is not None:
            raise RuntimeError("Upstream worker exited before bootstrap approval")
        try:
            with connect() as connection:
                if child is None and approved(connection):
                    return
                if child is not None:
                    if approved(connection):
                        return
                    if commit_marker(connection):
                        log("Worker bootstrap committed to PostgreSQL")
                        return
        except psycopg.Error:
            pass
        time.sleep(2)
    raise TimeoutError("Bootstrap gate timed out; HTTP server was not exposed")


def local_health():
    try:
        with connect() as connection:
            if not approved(connection):
                return False
        return subprocess.run(
            ["ak", "healthcheck"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=10, check=False,
        ).returncode == 0
    except (psycopg.Error, RuntimeError, subprocess.TimeoutExpired):
        return False


class WorkerHealth(BaseHTTPRequestHandler):
    def do_GET(self):
        ready = self.path == "/health/ready" and local_health()
        self.send_response(200 if ready else 503)
        self.end_headers()
        self.wfile.write(b"ready\n" if ready else b"not ready\n")

    def log_message(self, *args):
        return


class WorkerHealthServer(ThreadingHTTPServer):
    address_family = socket.AF_INET6


def main():
    role = sys.argv[1] if len(sys.argv) > 1 else "server"
    if role == "check":
        sys.exit(0 if local_health() else 1)
    if role not in ("worker", "server"):
        raise ValueError("Role must be server, worker, or check")
    validate(role)
    wait_seconds = int(os.environ.get("RECIPE_BOOTSTRAP_TIMEOUT", "600"))
    if not 30 <= wait_seconds <= 1800:
        raise ValueError("RECIPE_BOOTSTRAP_TIMEOUT must be between 30 and 1800")
    deadline = time.monotonic() + wait_seconds
    if role == "server":
        log("Waiting for durable worker bootstrap gate; no HTTP listener exists yet")
        await_gate(deadline)
        log("Bootstrap approved; starting upstream server")
        os.execvp("ak", ["ak", "server"])
    child = subprocess.Popen(["ak", "worker"])

    def shutdown(signum, frame):
        child.send_signal(signum)
        try:
            child.wait(timeout=25)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
        sys.exit(128 + signum)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    try:
        await_gate(deadline, child)
        health_server = WorkerHealthServer(("::", 9301), WorkerHealth)
        threading.Thread(target=health_server.serve_forever, daemon=True).start()
        sys.exit(child.wait())
    finally:
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=25)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        log(f"Recipe failed closed: {type(error).__name__}")
        raise
