"""Which builds of Mandarin the box installs, on the system page (item 405), as /usr/lib/mandarin-os/channel.sh reads it:
the releases ("latest") or dev's builds ("dev").

  state()   for /api/state's mandarin.channel: what Mandarin was last installed from (MachineSettings/mandarin-channel.env,
            which its own updates follow), and what the share's Installer asks for at the next Reinstall Mandarin (a file in
            it whose name starts with "dev", in any case: dev; none: latest). Read only: the page changes neither.
"""
import os

_page = None        # the system page's own helpers (run, read, log, P): server.py hands them over


def use(run, read, log, P):
    global _page
    _page = {"read": read, "P": P}


def now():
    said = [l for l in _page["read"]("/data/MachineSettings/mandarin-channel.env").splitlines() if l.startswith("MANDARIN_CHANNEL=")]
    return "dev" if said and said[-1].split("=", 1)[1].strip() == "dev" else "latest"


def wanted():
    folder = _page["P"]("/data/Installer")
    try:
        names = [n for n in os.listdir(folder) if os.path.isfile(os.path.join(folder, n))]
    except OSError:
        return "latest"
    return "dev" if any(n.lower().startswith("dev") for n in names) else "latest"


def state():
    return {"now": now(), "wanted": wanted()}
