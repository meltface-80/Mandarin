"""Mandarin OS's own update on the system page (item 401, Mandarin OS 0.1.4).

/usr/lib/mandarin-os/os-update does it, in a unit of its own (mandarin-os-update@check|apply.service): the page asks it,
reads what it says in /run/mandarin-os/os-update.json while it works, and what the last update came to in
/data/MandarinOS/update-last.json (written by os-started: started and kept, or didn't start in its three tries and the
box went back to the version before).

  state()       for /api/state's os.update: the version running, a newer one out, the update under way and how far,
                what the last one came to
  act(action)   (code, answer) for POST /api/os-update { password, action: check | apply }
"""
import json

BUSY = ("preparing", "downloading", "checking", "writing", "installing", "restarting")
_page = None        # the system page's own helpers (run, read, log, P): server.py hands them over


def use(run, read, log, P):
    global _page
    _page = {"run": run, "read": read, "log": log, "P": P}


def _json(path):
    try:
        found = json.loads(_page["read"](path) or "null")
    except ValueError:
        return None
    return found if isinstance(found, dict) else None


def state():
    now = _json("/run/mandarin-os/os-update.json") or {}
    return {"version": _page["read"]("/usr/lib/mandarin-os/VERSION", "?"), "available": now.get("available"),
            "state": now.get("state") or "idle", "progress": now.get("progress"), "said": now.get("said") or "",
            "error": now.get("error") or "", "checked": now.get("checked") or "",
            "last": _json("/data/MandarinOS/update-last.json")}


def act(action):
    run, log = _page["run"], _page["log"]
    st = state()
    if action == "check":
        if st["state"] in BUSY:
            return 409, {"error": "Mandarin OS is being updated already"}
        run(["systemctl", "start", "mandarin-os-update@check.service"], timeout=150)
        st = state()
        if st["error"]:
            return 502, {"error": st["error"], "update": st}
        said = f"Mandarin OS {st['available']} is out: Update and restart puts it in." if st["available"] else f"Mandarin OS {st['version']} is the newest."
        return 200, {"ok": True, "said": said, "update": st}
    if action == "apply":
        if st["state"] in BUSY:
            return 409, {"error": "Mandarin OS is being updated already"}
        if not st["available"]:
            return 409, {"error": "There's no newer Mandarin OS to update to: check for updates first"}
        code, _, err = run(["systemctl", "start", "--no-block", "mandarin-os-update@apply.service"], timeout=30)
        if code != 0:
            return 500, {"error": "The update couldn't be started: " + err[-200:]}
        log("INFO", f"Mandarin OS {st['available']} asked for (Update and restart)")
        return 200, {"ok": True, "said": f"Mandarin OS {st['available']} is being downloaded and written beside this one; then the computer "
                                         "starts again on it, in a few minutes. Your music, settings and drives aren't touched."}
    return 400, {"error": "Check or apply"}
