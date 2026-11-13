"""A USB drive's files made the shared folder's (item 399, Mandarin OS 0.1.3).

A Linux filesystem (ext2/3/4) keeps the owners its files were given on the computer that wrote them, and Mandarin OS
mounts it as it is (usb-mount): the shared folder's user reads it, as Mandarin does, but can't move, rename or delete
in it ("Access denied" over SMB). Asked from the system page (Storage, the drive's row), the drive's files become the
shared folder's user's and the mandarin group's, writable by both: only that drive, only when asked, and never its
lost+found (fsck's, root's). exFAT, FAT and NTFS are mounted as the shared folder's already.

  others(name)   whether the drive's files (the first few hundred looked at) belong to someone else
  changing(name) "changing" while its files are being made the shared folder's, "failed: …" if that failed, else ""
  make_ours(name) (code, answer) for POST /api/usb/own: the change started, in the background (a big drive takes a while)
"""
import os, threading, time

LOOK = 400          # entries looked at for others(): the drive's top and the folders under it, enough to tell
EXT = ("ext2", "ext3", "ext4")
_state = {}         # name: "changing" | "failed: …"
_lock = threading.Lock()
_page = None        # the system page's own helpers (run, read, log, P): server.py hands them over


def use(run, read, log, P):
    global _page
    _page = {"run": run, "read": read, "log": log, "P": P}


def _share():
    user = _page["read"]("/data/MachineSettings/share-user") or ""
    code, uid, _ = _page["run"](["id", "-u", user]) if user else (1, "", "")
    return user, (int(uid) if code == 0 and uid.isdigit() else None)


def _mountpoint(name):
    base = _page["P"]("/data/Storage/USB")
    if not name or "/" in name or name.startswith(".") or not os.path.isdir(os.path.join(base, name)):
        return None
    return os.path.join(base, name)


def _fs(mp):
    code, fs, _ = _page["run"](["findmnt", "-no", "FSTYPE", mp])
    return fs if code == 0 else ""


def others(name, fs=None):
    mp = _mountpoint(name)
    if not mp or (fs if fs is not None else _fs(mp)) not in EXT:
        return False
    _, uid = _share()
    if uid is None:
        return False
    seen = 0
    try:
        if os.stat(mp).st_uid != uid:
            return True
        for top in os.scandir(mp):
            if top.name == "lost+found":
                continue
            seen += 1
            if top.stat(follow_symlinks=False).st_uid != uid:
                return True
            if top.is_dir(follow_symlinks=False):
                for e in os.scandir(top.path):
                    seen += 1
                    if e.stat(follow_symlinks=False).st_uid != uid:
                        return True
                    if seen >= LOOK:
                        return False
            if seen >= LOOK:
                return False
    except OSError:
        return False
    return False


def changing(name):
    with _lock:
        return _state.get(name, "")


def _change(name, mp, user):
    run, log = _page["run"], _page["log"]
    t0 = time.time()
    who = f"{user}:mandarin"
    steps = [["chown", who, mp], ["chmod", "u+rwx,g+rwx", mp],
             ["find", mp, "-mindepth", "1", "-maxdepth", "1", "!", "-name", "lost+found", "-exec", "chown", "-R", who, "{}", "+"],
             ["find", mp, "-mindepth", "1", "-maxdepth", "1", "!", "-name", "lost+found", "-exec", "chmod", "-R", "u+rwX,g+rwX", "{}", "+"]]
    for cmd in steps:
        code, _, err = run(cmd, timeout=6 * 3600)
        if code != 0:
            with _lock:
                _state[name] = "failed: " + (err.splitlines()[-1] if err else f"{cmd[0]} failed")[:200]
            log("ERROR", f"USB drive {name}: its files couldn't all be made the shared folder's: {err[-300:]}")
            return
    with _lock:
        _state.pop(name, None)
    log("INFO", f"USB drive {name}: its files are the shared folder's ({user}) now, in {time.time() - t0:.0f} s")


def make_ours(name):
    mp = _mountpoint(name)
    if not mp:
        return 404, {"error": "No such drive"}
    if (_page["read"]("/run/mandarin-os/usb/" + name) or "rw").split("\n")[0] == "ro":
        return 409, {"error": f"{name} is mounted read-only: its files can't be changed"}
    if _fs(mp) not in EXT:
        return 409, {"error": f"{name}'s files are the shared folder's already: only a Linux drive (ext4) keeps another computer's"}
    user, uid = _share()
    if uid is None:
        return 409, {"error": "The shared folder's user wasn't found"}
    with _lock:
        if _state.get(name) == "changing":
            return 409, {"error": f"{name}'s files are being made the shared folder's already"}
        _state[name] = "changing"
    _page["log"]("INFO", f"USB drive {name}: its files being made the shared folder's ({user})")
    threading.Thread(target=_change, args=(name, mp, user), daemon=True).start()
    return 200, {"ok": True, "said": f"{name}'s files are being made the shared folder's: a big drive takes a few minutes. Moving, renaming and deleting on it work once it's done."}
