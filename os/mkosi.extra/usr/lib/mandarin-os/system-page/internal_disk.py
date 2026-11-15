"""The computer's own storage drive made Storage/Internal from the system page (Storage → Internal storage → Format).

Item 429: formatted, the drive wasn't mounted (the boot test's second disk, formatted as the owner's was: Storage/Internal
not mounted ten seconds after). Its new filesystem was mounted at once by its label, before udev had read that label,
by mount alone, beside systemd, which knew the label's device as missing (the fstab line's, waited for at every start
since the first try) and keeps a mount of fstab's to its device; and that mount's answer was never looked at, so the
page said it was ready, the log said only "formatted", and it said "not yet formatted" after. Its top folder was root's
besides (a new ext4's), so the shared folder could write nothing in it. Now: the label read by udev and seen
in /dev/disk/by-label before it is mounted, through systemd (the fstab line's mount unit), the mount looked for, the
drive's top made the shared folder's user's and Mandarin's group's (2775, as Storage is; apply keeps it so at every
start), and every step that fails said in the one log with why, as well as on the page.

  format_disk(disk)  (code, answer) for POST /api/internal/format, [disk] one internal() offered
"""
import os, time

MOUNT = "/data/Storage/Internal"
UNIT = "data-Storage-Internal.mount"          # systemd's name for MOUNT's fstab line
LABEL = "mandarin-internal"
FSTAB = f"LABEL={LABEL}  {MOUNT} ext4  defaults,noatime,nofail,x-systemd.device-timeout=30s  0 2\n"
WAIT = float(os.environ.get("MANDARIN_OS_WAIT", "30"))   # seconds for the label, and for the mount (the tests' shorter)
_page = None        # the system page's own helpers (run, read, log, P): server.py hands them over


def use(run, read, log, P):
    global _page
    _page = {"run": run, "read": read, "log": log, "P": P}


def _until(fn, seconds):
    t0 = time.monotonic()
    while not fn():
        if time.monotonic() - t0 > seconds:
            return False
        time.sleep(0.5)
    return True


def mounted():
    return _page["run"](["findmnt", "-no", "SOURCE", _page["P"](MOUNT)])[0] == 0


def format_disk(disk):
    run, read, log, P = _page["run"], _page["read"], _page["log"], _page["P"]

    def failed(why):
        log("ERROR", f"internal storage: {disk} couldn't be made Storage/Internal: {why}")
        return 500, {"error": f"{disk} couldn't be made internal storage: {why}"}
    log("WARN", f"internal storage: {disk} being formatted from the system page")
    run(["systemctl", "stop", UNIT], timeout=60)
    run(["umount", P(MOUNT)], timeout=60)
    for cmd, given in ((["wipefs", "-a", disk], None), (["sfdisk", "--label", "gpt", disk], "type=linux\n")):
        code, _, err = run(cmd, input=given, timeout=60)
        if code != 0:
            return failed(f"{cmd[0]}: {err or 'failed'}")
    run(["udevadm", "settle"], timeout=60)
    part = run(["bash", "-c", f"lsblk -lnpo NAME,TYPE {disk} | awk '$2 == \"part\" {{ print $1; exit }}'"])[1]
    if not part:
        return failed("no partition was made on it")
    code, _, err = run(["mkfs.ext4", "-F", "-L", LABEL, part], timeout=600)
    if code != 0:
        return failed("mkfs.ext4: " + (err.splitlines()[-1] if err else "failed"))
    # udev reads the new label (systemd knows the drive by it only then); asked again if it hasn't.
    run(["udevadm", "trigger", "--settle", part], timeout=60)
    if not _until(lambda: os.path.exists(P("/dev/disk/by-label/" + LABEL)), WAIT):
        return failed(f"its label ({LABEL}) didn't appear in /dev/disk/by-label")
    if FSTAB.split()[0] not in read("/etc/fstab"):
        with open(P("/etc/fstab"), "a") as f:
            f.write(FSTAB)
    run(["systemctl", "daemon-reload"], timeout=60)
    os.makedirs(P(MOUNT), exist_ok=True)
    code, _, err = run(["systemctl", "start", UNIT], timeout=90)
    if code != 0 or not _until(mounted, WAIT):
        return failed(f"it didn't mount at {MOUNT}: " + (err.splitlines()[-1] if err else "not mounted"))
    user = read("/data/MachineSettings/share-user") or "root"
    for cmd in (["chown", f"{user}:mandarin", P(MOUNT)], ["chmod", "2775", P(MOUNT)]):
        code, _, err = run(cmd)
        if code != 0:
            return failed(f"{cmd[0]}: {err or 'failed'}")
    log("INFO", f"internal storage: {disk} formatted, mounted at {MOUNT}, the shared folder's")
    return 200, {"ok": True, "said": "Internal storage is ready: Storage/Internal in the shared folder."}
