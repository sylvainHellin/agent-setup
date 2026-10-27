"""Bridge between the pi extension and one IPython kernel.

Protocol: JSON lines. Requests on stdin, responses on stdout.
  -> {"id": 1, "op": "execute", "code": "...", "timeout": 120}
  <- {"id": 1, "status": "ok" | "error" | "timeout" | "restarted", ...}
  -> {"op": "shutdown"}
The first line written is {"type": "ready", "kernel_pid": N} once the kernel answers.
EOF on stdin shuts the kernel down, so a dead pi never leaves an orphaned kernel behind.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from queue import Empty

from jupyter_client.manager import KernelManager

INTERRUPT_GRACE_S = 10
MAX_TEXT_CHARS = 4_000_000
MAX_IMAGES = 4

INIT_CODE = """
get_ipython().run_line_magic("xmode", "Plain")
try:
    get_ipython().run_line_magic("colors", "nocolor")
except Exception:
    get_ipython().run_line_magic("colors", "NoColor")
import numpy as np, pandas as pd, polars as pl, duckdb
import matplotlib
matplotlib.rcParams["figure.dpi"] = 100
pd.set_option("display.width", 200)
pd.set_option("display.max_columns", 50)
pl.Config.set_tbl_cols(50)
pl.Config.set_tbl_rows(25)
pl.Config.set_tbl_width_chars(200)
pl.Config.set_fmt_str_lengths(80)
"""

out = sys.stdout
sys.stdout = sys.stderr  # stray prints from libraries must not corrupt the protocol


def send(obj):
    out.write(json.dumps(obj) + "\n")
    out.flush()


def start(cwd):
    # IPC sockets in a private temp dir instead of localhost TCP ports.
    sock_dir = tempfile.mkdtemp(prefix="pi-python-")
    km = KernelManager(kernel_name="python3", transport="ipc", ip=os.path.join(sock_dir, "k"))
    # The kernel echoes fd-level output to its own stdout, which is our protocol channel.
    km.start_kernel(
        cwd=cwd,
        env={**os.environ, "PYDEVD_DISABLE_FILE_VALIDATION": "1"},
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    kc = km.client()
    kc.start_channels()
    kc.wait_for_ready(timeout=120)
    run(kc, km, INIT_CODE, 60, silent=True)
    return km, kc, sock_dir


def kernel_pid(km):
    try:
        return km.provisioner.process.pid
    except Exception:
        return None


class Collector:
    def __init__(self):
        self.parts = []
        self.size = 0
        self.result = None
        self.images = []
        self.error = None

    def text(self, s):
        if self.size >= MAX_TEXT_CHARS:
            return
        s = s[: MAX_TEXT_CHARS - self.size]
        self.size += len(s)
        self.parts.append(s)

    def bundle(self, data, is_result):
        has_image = False
        for mime in ("image/png", "image/jpeg"):
            if mime in data:
                has_image = True
                if len(self.images) < MAX_IMAGES:
                    self.images.append({"mime": mime, "data": data[mime].strip()})
        plain = data.get("text/plain")
        if plain is None or (has_image and plain.startswith("<Figure")):
            return
        if is_result:
            self.result = plain
        else:
            self.text(plain if plain.endswith("\n") else plain + "\n")

    def handle(self, msg):
        kind, c = msg["msg_type"], msg["content"]
        if kind == "stream":
            self.text(c["text"])
        elif kind == "execute_result":
            self.bundle(c.get("data", {}), True)
        elif kind == "display_data":
            self.bundle(c.get("data", {}), False)
        elif kind == "error":
            self.error = {
                "ename": c.get("ename", ""),
                "evalue": c.get("evalue", ""),
                "traceback": "\n".join(c.get("traceback", [])),
            }


def run(kc, km, code, timeout, silent=False):
    msg_id = kc.execute(code, silent=silent, store_history=not silent, allow_stdin=False)
    col = Collector()
    started = time.monotonic()
    deadline = started + timeout
    interrupted = False
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            if interrupted:
                km.restart_kernel(now=True)
                kc.wait_for_ready(timeout=120)
                run(kc, km, INIT_CODE, 60, silent=True)
                return col, "restarted", None, started
            km.interrupt_kernel()
            interrupted = True
            deadline = time.monotonic() + INTERRUPT_GRACE_S
            continue
        try:
            msg = kc.get_iopub_msg(timeout=min(remaining, 1.0))
        except Empty:
            if not km.is_alive():
                km.restart_kernel(now=True)
                kc.wait_for_ready(timeout=120)
                run(kc, km, INIT_CODE, 60, silent=True)
                col.text("[kernel died; started a fresh one]\n")
                return col, "restarted", None, started
            continue
        if msg.get("parent_header", {}).get("msg_id") != msg_id:
            continue
        if msg["msg_type"] == "status" and msg["content"].get("execution_state") == "idle":
            break
        col.handle(msg)
    count = None
    try:
        reply = kc.get_shell_msg(timeout=5)
        count = reply["content"].get("execution_count")
    except Empty:
        pass
    if interrupted:
        status = "timeout"
    elif col.error:
        status = "error"
    else:
        status = "ok"
    return col, status, count, started


def main():
    km, kc, sock_dir = start(os.getcwd())
    send({"type": "ready", "kernel_pid": kernel_pid(km)})
    try:
        for line in sys.stdin:
            if not line.strip():
                continue
            req = json.loads(line)
            if req.get("op") == "shutdown":
                break
            if req.get("op") != "execute":
                continue
            col, status, count, started = run(kc, km, req["code"], float(req.get("timeout") or 120))
            send({
                "id": req["id"],
                "status": status,
                "execution_count": count,
                "output": "".join(col.parts),
                "output_capped": col.size >= MAX_TEXT_CHARS,
                "result": col.result,
                "images": col.images,
                "error": col.error,
                "duration_ms": int((time.monotonic() - started) * 1000),
                "kernel_pid": kernel_pid(km),
            })
    finally:
        kc.stop_channels()
        km.shutdown_kernel(now=False)
        shutil.rmtree(sock_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
