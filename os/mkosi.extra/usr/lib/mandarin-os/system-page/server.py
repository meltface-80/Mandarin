#!/usr/bin/python3
"""Mandarin OS's system page, http://mandarin/ (item 389): the box itself, apart from Mandarin so
that it works when Mandarin doesn't (Reinstall). Status is read by anyone at home; every change asks for the share's
password (smb://mandarin/data's, chosen at install), checked against Samba's own record of it. Requests are taken only
under a name a home uses (an address, mandarin, .local, .lan), and a change only from this page (its Origin): a web page
elsewhere can't reach it under its own site's name, nor make changes in your browser.

  GET  /api/state                     everything the Overview, Storage and Network tabs show
  GET  /api/logs/<os|mandarin|journal> a log's newest lines
  GET  /api/logs.txt                  every log as one text file, merged in time order (logs_one.py)
  GET  /api/diagnostics               the network, layer by layer: link, address, gateway, DNS, internet, GitHub
  POST /api/check                     { password }: whether it is the share's
  POST /api/power                     { password, action: restart-mandarin | reboot | shutdown }
  POST /api/mandarin                  { password, action: reinstall | reset }
  POST /api/network                   { password, mode: dhcp | static, address, gateway, dns }: undone after two minutes
                                      unless /api/network/keep is asked from the new address
  POST /api/network/keep              { password }
  POST /api/usb/eject                 { password, name }
  POST /api/usb/own                   { password, name }: a Linux drive's files made the shared folder's (usb_owner.py)
  POST /api/internal/format           { password, disk, erase: "erase" }
  POST /api/bridge                    { password, action: install | remove }

MANDARIN_OS_ROOT (the tests'): every path under it, and its commands from PATH as they find them."""
import hashlib, http.server, ipaddress, json, os, re, shutil, socketserver, struct, subprocess, sys, threading, time, urllib.request
import logs_one, usb_owner

ROOT = os.environ.get("MANDARIN_OS_ROOT", "")
PORT = int(os.environ.get("MANDARIN_OS_PORT", "80"))
MANDARIN = os.environ.get("MANDARIN_URL", "http://127.0.0.1:3500")
HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.dirname(HERE)
P = lambda p: ROOT + p
SERVICES = [("mandarin.service", "Mandarin"), ("smbd.service", "Shared folder (SMB)"), ("avahi-daemon.service", "mandarin.local (Bonjour)"),
            ("wsdd2.service", "Windows discovery"), ("nftables.service", "Firewall"), ("NetworkManager.service", "Network"),
            ("mandarin-os-maintain.timer", "Weekly upkeep"), ("mandarin-bridge.service", "Mandarin Bridge")]
wrong = []          # times of wrong passwords: five in five minutes, and no more are tried for five minutes
pending = {}        # a network change waiting to be kept: { "undo": [...], "timer": Timer }
lock = threading.Lock()


def run(cmd, timeout=20, input=None):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, input=input)
        return r.returncode, r.stdout.strip(), r.stderr.strip()
    except (OSError, subprocess.TimeoutExpired) as e:
        return 1, "", str(e)


def read(path, default=""):
    try:
        with open(P(path), encoding="utf-8", errors="replace") as f:
            return f.read().strip()
    except OSError:
        return default


def log(level, msg):
    run(["bash", "-c", '. "$0"/log.sh && oslog "$1" "$2"', LIB, level, "[system page] " + msg])


usb_owner.use(run, read, log, P)


# The share's password, checked as Samba keeps it (its NT hash: MD4 of the password in UTF-16LE).
def md4(data):
    M = 0xFFFFFFFF
    def rol(v, s): return ((v << s) | (v >> (32 - s))) & M
    msg = bytearray(data) + b"\x80"
    while len(msg) % 64 != 56:
        msg.append(0)
    msg += struct.pack("<Q", len(data) * 8)
    h = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476]
    rounds = [(lambda x, y, z: (x & y) | (~x & z), 0, list(range(16)), [3, 7, 11, 19]),
              (lambda x, y, z: (x & y) | (x & z) | (y & z), 0x5A827999, [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15], [3, 5, 9, 13]),
              (lambda x, y, z: x ^ y ^ z, 0x6ED9EBA1, [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15], [3, 9, 11, 15])]
    for i in range(0, len(msg), 64):
        x = struct.unpack("<16I", bytes(msg[i:i + 64]))
        v = list(h)
        for fn, k, order, shifts in rounds:
            for j, idx in enumerate(order):
                a, b, c, d = (v[(-j) % 4], v[(1 - j) % 4], v[(2 - j) % 4], v[(3 - j) % 4])
                v[(-j) % 4] = rol((a + fn(b, c, d) + x[idx] + k) & M, shifts[j % 4])
        h = [(h[n] + v[n]) & M for n in range(4)]
    return struct.pack("<4I", *h)


def password_ok(password):
    user = read("/data/MachineSettings/share-user")
    if not user or not isinstance(password, str) or not password:
        return False
    code, out, _ = run(["pdbedit", "-L", "-w", "-u", user])
    parts = out.split(":") if code == 0 else []
    if len(parts) < 4:
        return False
    return hashlib.sha256(md4(password.encode("utf-16-le")).hex().upper().encode()).digest() == hashlib.sha256(parts[3].upper().encode()).digest()


def human(n):
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if n < 1024 or unit == "TB":
            return f"{n:.0f} {unit}" if unit in ("B", "KB") else f"{n:.1f} {unit}"
        n /= 1024


def space(path):
    try:
        st = os.statvfs(P(path))
        return {"size": human(st.f_blocks * st.f_frsize), "free": human(st.f_bavail * st.f_frsize),
                "used_pct": round(100 * (1 - st.f_bavail / st.f_blocks)) if st.f_blocks else 0}
    except OSError:
        return None


def mandarin_health():
    try:
        with urllib.request.urlopen(MANDARIN + "/api/health", timeout=4) as r:
            return json.loads(r.read())
    except Exception:
        return None


def usb_drives():
    out, state = [], P("/run/mandarin-os/usb")
    base = P("/data/Storage/USB")
    for name in sorted(os.listdir(base)) if os.path.isdir(base) else []:
        mode = (read("/run/mandarin-os/usb/" + name) or "rw").split("\n")
        code, fs, _ = run(["findmnt", "-no", "FSTYPE", os.path.join(base, name)])
        out.append({"name": name, "fs": fs or "?", "mounted": code == 0, "read_only": mode[0] == "ro",
                    "why": mode[1] if len(mode) > 1 else "", "space": space("/data/Storage/USB/" + name),
                    "others": mode[0] != "ro" and usb_owner.others(name, fs), "changing": usb_owner.changing(name)})
    return out


def network():
    code, out, _ = run(["nmcli", "-t", "-f", "DEVICE,TYPE,STATE", "device"])
    dev = next((l.split(":")[0] for l in out.splitlines() if ":ethernet:" in l), "")
    addr = run(["ip", "-4", "-o", "addr", "show", "dev", dev])[1].split() if dev else []
    route = run(["ip", "-4", "route", "show", "default"])[1].split()
    saved = {}
    try:
        saved = json.loads(read("/data/MachineSettings/setup.json") or "{}").get("network", {})
    except ValueError:
        pass
    speed = read(f"/sys/class/net/{dev}/speed") if dev else ""
    return {"device": dev, "address": addr[3] if len(addr) > 3 else "", "gateway": route[2] if len(route) > 2 else "",
            "dns": dns_servers(),
            "mode": saved.get("mode", "dhcp"), "link": (speed + " Mb/s " + read(f"/sys/class/net/{dev}/duplex")).strip() if speed and speed != "-1" else "",
            "pending_undo": bool(pending)}


def internal():
    disks, root_disk = [], run(["bash", "-c", 'lsblk -no PKNAME "$(findmnt -no SOURCE /)" | head -n 1'])[1]
    code, out, _ = run(["lsblk", "-J", "-b", "-d", "-o", "NAME,SIZE,MODEL,TRAN,RM,TYPE"])
    try:
        for d in json.loads(out).get("blockdevices", []) if code == 0 else []:
            if d.get("type") == "disk" and d.get("name") != root_disk and d.get("tran") != "usb" and not d.get("rm") and not d["name"].startswith(("loop", "zram", "sr")):
                disks.append({"disk": "/dev/" + d["name"], "model": (d.get("model") or "disk").strip(), "size": human(int(d.get("size") or 0))})
    except ValueError:
        pass
    mounted = run(["findmnt", "-no", "SOURCE", P("/data/Storage/Internal")])[0] == 0
    return {"mounted": mounted, "space": space("/data/Storage/Internal") if mounted else None, "disks": disks}


def dns_servers():
    """The DNS servers in use, addresses only: resolvectl's lines are "Link 2 (enp0s31f6): 8.8.8.8" and "Global: …"."""
    found = []
    for word in run(["resolvectl", "dns"])[1].split():
        try:
            ip = str(ipaddress.ip_address(word))
        except ValueError:
            continue
        if ip not in found:
            found.append(ip)
    return " ".join(found[:2])


def state():
    h = mandarin_health()
    services = []
    for unit, name in SERVICES:
        active = run(["systemctl", "is-active", unit])[1] or "unknown"
        if unit == "mandarin-bridge.service" and active in ("inactive", "unknown") and not os.path.exists(P("/usr/lib/mandarin-bridge/mandarin-bridge")):
            active = "not installed"
        services.append({"unit": unit, "name": name, "state": active})
    return {
        "os": {"version": read("/usr/lib/mandarin-os/VERSION", "?"), "uptime": read("/proc/uptime", "0").split()[0],
               "last_upkeep": read("/data/MandarinOS/last-upkeep.txt"), "hostname": read("/etc/hostname", "mandarin")},
        "mandarin": {"answering": h is not None, "version": (h or {}).get("version"), "albums": (h or {}).get("albums"),
                     "rooms": (h or {}).get("rooms"), "busy": (h or {}).get("busy"), "port": 3500},
        "services": services, "data": space("/data"), "usb": usb_drives(), "internal": internal(), "network": network(),
        "share": {"user": read("/data/MachineSettings/share-user"), "path": "smb://mandarin/data"},
    }


LOGS = {"os": "/data/MandarinOS/Logs/MandarinOS_log.txt", "mandarin": "/data/MandarinServer/Logs/MandarinServer_log.txt"}


def log_text(which, lines=2000):
    if which == "journal":
        return run(["journalctl", "-b", "-n", str(lines), "--no-pager", "-o", "short-iso-precise"], timeout=30)[1]
    path = LOGS.get(which)
    try:
        with open(P(path), encoding="utf-8", errors="replace") as f:
            return "".join(f.readlines()[-lines:])
    except (OSError, TypeError):
        return ""


def logs_txt():
    """Every log as one file (logs_one.py), headed by what the box is and how it is now."""
    st = state()
    m, n = st["mandarin"], st["network"]
    header = [f"Mandarin — every log on this box, merged in time order (UTC); made {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())} UTC",
              f"Mandarin OS {st['os']['version']} on {st['os']['hostname']} · up {st['os']['uptime']} s · last upkeep {st['os']['last_upkeep'] or 'not yet'}",
              f"Mandarin {m['version'] or '(not answering)'} · {m['albums'] or 0} albums · {m['rooms'] or 0} rooms",
              f"Network: {n['address'] or 'no address'} · {n['mode']} · {n['link'] or 'no link'} · gateway {n['gateway'] or '-'} · DNS {n['dns'] or '-'}",
              "Services: " + ", ".join(f"{s['name']} {s['state']}" for s in st["services"]),
              "USB drives: " + (", ".join(f"{u['name']} ({u['fs']}{', read-only: ' + u['why'] if u['read_only'] else ''})" for u in st["usb"]) or "none")]
    return logs_one.merged([("MandarinOS", P("/data/MandarinOS/Logs")), ("", P("/data/MandarinServer/Logs"))], log_text("journal", 20000), header)


def diagnostics():
    n = network()
    steps = [("Link", bool(n["link"]), n["link"] or "no cable, or no link"),
             ("Address", bool(n["address"]), (n["address"] + " · " + n["mode"].upper()) if n["address"] else "none yet")]
    code, out, _ = run(["ping", "-c", "1", "-W", "2", n["gateway"]]) if n["gateway"] else (1, "", "")
    rtt = re.search(r"time=([\d.]+) ms", out)
    steps.append(("Gateway", code == 0, (n["gateway"] + " · " + rtt.group(1) + " ms") if code == 0 and rtt else (n["gateway"] or "none")))
    t = time.time(); code, out, _ = run(["getent", "hosts", "github.com"], timeout=6)
    steps.append(("DNS", code == 0, (n["dns"].strip() or "?") + (f" · github.com in {round((time.time() - t) * 1000)} ms" if code == 0 else " · github.com not found")))
    code, _, _ = run(["curl", "-fsS", "-o", "/dev/null", "--max-time", "6", "https://deb.debian.org/debian/"], timeout=8)
    steps.append(("Internet", code == 0, "Debian's updates reachable" if code == 0 else "Debian's updates not reachable"))
    code, _, _ = run(["curl", "-fsS", "-o", "/dev/null", "--max-time", "6", "https://github.com/meltface-80/Mandarin"], timeout=8)
    steps.append(("Mandarin's updates", code == 0, "GitHub reachable" if code == 0 else "GitHub not reachable"))
    return [{"step": s, "ok": ok, "detail": d} for s, ok, d in steps]


def change_network(body, client):
    mode = body.get("mode")
    if mode not in ("dhcp", "static"):
        return 400, {"error": "DHCP or static"}
    new = {"mode": "dhcp"}
    if mode == "static":
        try:
            iface = ipaddress.ip_interface(body.get("address", ""))
            gw = ipaddress.ip_address(body.get("gateway", ""))
            if gw not in iface.network or iface.network.prefixlen == 32:
                return 400, {"error": "The gateway isn't in the address's network"}
            dns = " ".join(str(ipaddress.ip_address(x)) for x in str(body.get("dns", "")).replace(",", " ").split())
        except ValueError:
            return 400, {"error": "Write the address with its prefix (192.168.1.20/24), and the gateway and DNS as addresses"}
        new = {"mode": "static", "address": str(iface), "gateway": str(gw), "dns": dns}
    setup_path = P("/data/MachineSettings/setup.json")
    try:
        setup = json.loads(read("/data/MachineSettings/setup.json") or "{}")
    except ValueError:
        setup = {}
    old = setup.get("network", {"mode": "dhcp"})
    args = lambda n: [LIB + "/network", "static", n["address"], n["gateway"], n.get("dns", "")] if n.get("mode") == "static" else [LIB + "/network", "dhcp"]

    def undo():
        with lock:
            if not pending:
                return
            pending.clear()
        log("WARN", "the network change wasn't kept from its new address in two minutes: put back")
        run(args(old), timeout=60)
    with lock:
        if pending:
            pending["timer"].cancel()
        timer = threading.Timer(120, undo)
        pending.update({"timer": timer, "new": new})
    setup["network"] = new
    with open(setup_path, "w") as f:
        json.dump(setup, f)
    log("INFO", f"network: {new} (from {old}); undone in two minutes unless kept from the new address")
    threading.Thread(target=lambda: (time.sleep(1), run(args(new), timeout=60)), daemon=True).start()
    timer.start()
    return 200, {"ok": True, "undo_in": 120, "new_address": new.get("address", "").split("/")[0] or None}


def keep_network():
    with lock:
        if not pending:
            return 200, {"ok": True, "kept": False}
        pending["timer"].cancel()
        pending.clear()
    log("INFO", "network change kept")
    return 200, {"ok": True, "kept": True}


def eject(name):
    base = P("/data/Storage/USB")
    if not name or "/" in name or name not in (os.listdir(base) if os.path.isdir(base) else []):
        return 404, {"error": "No such drive"}
    for f in os.listdir(P("/run/mandarin-os/usb")) if os.path.isdir(P("/run/mandarin-os/usb")) else []:
        if f.startswith(".") and read("/run/mandarin-os/usb/" + f).endswith("/" + name):
            run(["systemctl", "stop", "mandarin-usb@" + f[1:] + ".service"], timeout=60)
            log("INFO", f"USB drive {name} ejected")
            return 200, {"ok": True, "said": f"{name} can be unplugged now."}
    return 409, {"error": f"{name} couldn't be ejected"}


def format_internal(disk):
    if disk not in [d["disk"] for d in internal()["disks"]]:
        return 400, {"error": "Only an internal disk that isn't the system's can be formatted"}
    log("WARN", f"internal storage: {disk} formatted from the system page")
    run(["umount", P("/data/Storage/Internal")])
    for cmd in (["wipefs", "-a", disk], ["sfdisk", "--label", "gpt", disk]):
        code, _, err = run(cmd, input="type=linux\n" if cmd[0] == "sfdisk" else None, timeout=60)
        if code != 0:
            return 500, {"error": f"{cmd[0]}: {err}"}
    run(["udevadm", "settle"], timeout=30)
    part = run(["bash", "-c", f"lsblk -lnpo NAME,TYPE {disk} | awk '$2 == \"part\" {{ print $1; exit }}'"])[1]
    code, _, err = run(["mkfs.ext4", "-F", "-L", "mandarin-internal", part], timeout=600)
    if code != 0:
        return 500, {"error": "mkfs: " + err}
    fstab = read("/etc/fstab")
    if "LABEL=mandarin-internal" not in fstab:
        with open(P("/etc/fstab"), "a") as f:
            f.write("LABEL=mandarin-internal  /data/Storage/Internal ext4  defaults,noatime,nofail,x-systemd.device-timeout=30s  0 2\n")
        run(["systemctl", "daemon-reload"])
    os.makedirs(P("/data/Storage/Internal"), exist_ok=True)
    run(["mount", P("/data/Storage/Internal")], timeout=60)
    run([LIB + "/apply"], timeout=120)
    return 200, {"ok": True, "said": "Internal storage is ready: Storage/Internal in the shared folder."}


def mandarin_action(action):
    if action == "reinstall":
        log("INFO", "Mandarin reinstalled from the system page")
        threading.Thread(target=lambda: run([LIB + "/reinstall-mandarin"], timeout=1800), daemon=True).start()
        return 200, {"ok": True, "said": "Mandarin is being put back from its latest release, your library and settings kept. A few minutes."}
    if action == "reset":
        stamp = time.strftime("%Y%m%d-%H%M%S")
        run(["systemctl", "stop", "mandarin.service"], timeout=60)
        src = P("/data/MandarinServer")
        keep = {"Logs", "backups"}
        dest = os.path.join(src, "backups", "before-reset-" + stamp)
        os.makedirs(dest, exist_ok=True)
        for f in os.listdir(src):
            if f not in keep:
                shutil.move(os.path.join(src, f), os.path.join(dest, f))
        log("WARN", f"Mandarin reset from the system page: what it kept moved to backups/before-reset-{stamp}")
        run(["systemctl", "start", "mandarin.service"], timeout=60)
        return 200, {"ok": True, "said": "Mandarin starts as new. What it kept is in MandarinServer/Backups/before-reset-" + stamp + "."}
    return 400, {"error": "Reinstall or reset"}


def bridge(action):
    if action == "install":
        threading.Thread(target=lambda: run([LIB + "/install-bridge"], timeout=900), daemon=True).start()
        return 200, {"ok": True, "said": "Mandarin Bridge is being installed; it appears in Mandarin within a minute or two."}
    if action == "remove":
        run(["systemctl", "disable", "--now", "mandarin-bridge.service"], timeout=60)
        for p in ("/etc/systemd/system/mandarin-bridge.service",):
            try:
                os.remove(P(p))
            except OSError:
                pass
        shutil.rmtree(P("/usr/lib/mandarin-bridge"), ignore_errors=True)
        run(["systemctl", "daemon-reload"])
        log("INFO", "Mandarin Bridge removed from the system page")
        return 200, {"ok": True, "said": "Mandarin Bridge removed."}
    return 400, {"error": "Install or remove"}


def power(action):
    if action == "restart-mandarin":
        run(["systemctl", "restart", "mandarin.service"], timeout=60)
        return 200, {"ok": True, "said": "Mandarin is starting again."}
    if action in ("reboot", "shutdown"):
        log("INFO", f"{action} from the system page")
        threading.Thread(target=lambda: (time.sleep(1), run(["systemctl", "reboot" if action == "reboot" else "poweroff"])), daemon=True).start()
        return 200, {"ok": True, "said": "The computer is starting again." if action == "reboot" else "The computer is shutting down."}
    return 400, {"error": "Restart Mandarin, reboot or shut down"}


def home_name(host):
    host = (host or "").rsplit("]", 1)[0].lstrip("[") if host.startswith("[") else (host or "").split(":")[0]
    if not host:
        return False
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        pass
    h = host.lower().rstrip(".")
    name = read("/etc/hostname", "mandarin").lower()
    return h in ("localhost", name) or h.endswith((".local", ".lan", ".home", ".internal", ".home.arpa", ".ts.net")) or "." not in h


class Page(http.server.BaseHTTPRequestHandler):
    server_version = "MandarinOS"

    def log_message(self, *a):
        pass

    def send(self, code, body, kind="application/json"):
        data = body if isinstance(body, bytes) else (json.dumps(body) if kind == "application/json" else body).encode()
        self.send_response(code)
        self.send_header("Content-Type", kind + ("; charset=utf-8" if kind.startswith(("text/", "application/json", "application/javascript")) else ""))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'")
        self.end_headers()
        self.wfile.write(data)

    def guard(self):
        if not home_name(self.headers.get("Host")):
            self.send(421, {"error": "Use the box's name or address"})
            return False
        return True

    def do_GET(self):
        if not self.guard():
            return
        p = self.path.split("?")[0]
        if p == "/api/state":
            return self.send(200, state())
        if p == "/api/diagnostics":
            return self.send(200, diagnostics())
        if p == "/api/logs.txt":
            data = logs_txt().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Disposition", f'attachment; filename="mandarin-logs-{time.strftime("%Y%m%d-%H%M", time.gmtime())}.txt"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return self.wfile.write(data)
        m = re.fullmatch(r"/api/logs/(os|mandarin|journal)", p)
        if m:
            return self.send(200, log_text(m.group(1)), "text/plain")
        files = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "application/javascript"), "/style.css": ("style.css", "text/css")}
        if p in files:
            with open(os.path.join(HERE, files[p][0]), "rb") as f:
                return self.send(200, f.read(), files[p][1])
        self.send(404, {"error": "No such page"})

    def do_POST(self):
        if not self.guard():
            return
        # Only from this page: a browser's request from elsewhere names its Origin, and it isn't this one.
        origin = self.headers.get("Origin")
        if origin and re.sub(r"^https?://", "", origin) != self.headers.get("Host"):
            return self.send(403, {"error": "Only from Mandarin OS's own page"})
        if (self.headers.get("Content-Type") or "").split(";")[0].strip() != "application/json":
            return self.send(415, {"error": "JSON only"})
        try:
            body = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length") or 0), 65536)) or b"{}")
        except ValueError:
            return self.send(400, {"error": "Not JSON"})
        now = time.time()
        with lock:
            wrong[:] = [t for t in wrong if now - t < 300]
            if len(wrong) >= 5:
                return self.send(429, {"error": "Too many wrong passwords: try again in five minutes"})
        if not password_ok(body.get("password")):
            with lock:
                wrong.append(now)
            log("WARN", f"a wrong password from {self.client_address[0]}")
            return self.send(401, {"error": "That isn't the shared folder's password"})
        p, action = self.path.split("?")[0], body.get("action")
        routes = {"/api/check": lambda: (200, {"ok": True}), "/api/power": lambda: power(action), "/api/mandarin": lambda: mandarin_action(action),
                  "/api/network": lambda: change_network(body, self.client_address[0]), "/api/network/keep": keep_network,
                  "/api/usb/eject": lambda: eject(body.get("name")), "/api/usb/own": lambda: usb_owner.make_ours(body.get("name")),
                  "/api/bridge": lambda: bridge(action),
                  "/api/internal/format": lambda: format_internal(body.get("disk")) if body.get("erase") == "erase" else (400, {"error": "Type erase to format it"})}
        if p not in routes:
            return self.send(404, {"error": "No such action"})
        code, answer = routes[p]()
        self.send(code, answer)


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        # A browser that hung up (a phone's screen off, a tab closed) is no error of the page's: only the rest are written
        # to SystemPage_errors.txt, which filled with "Connection reset by peer" tracebacks otherwise.
        if isinstance(sys.exc_info()[1], (ConnectionError, TimeoutError)):
            return
        super().handle_error(request, client_address)

    def server_bind(self):
        # HTTPServer's own looks the machine's name up in DNS (getfqdn), which can hold the page back for as long as
        # DNS takes to fail; the name is never used here.
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = "mandarin", self.server_address[1]


if __name__ == "__main__":
    Server(("0.0.0.0", PORT), Page).serve_forever()
