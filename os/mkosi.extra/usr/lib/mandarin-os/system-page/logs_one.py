"""Every log on a Mandarin OS box as one plain-text file, merged in time order (item 389, 0.1.1): Mandarin OS's own
(MandarinOS/Logs), Mandarin's server's, each Bridge's and each app's as the server keeps them (MandarinServer/Logs,
its Bridges and Apps folders), and the system's journal of this start. Each line says where it came from; a line with
no time of its own (a stack trace's, ffmpeg's) stays under the line before it. The files' own headers ("# Mandarin
Server 1.3.1 log", the mounts…) head the file, by source. Every time is UTC.

Times read: Mandarin's and Mandarin OS's ("2026-11-12 17:30:06.502 UTC  INFO   …"), an older Bridge's ("2026-11-12
17:30:08 [http] …"), Android's logcat ("2026-11-12 17:30:06.502  4242  4250 W Tag: …") and the journal's
("2026-11-12T17:48:33.861948+00:00 host unit[1]: …")."""
import datetime, os, re

OURS = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)(\.\d{3})? UTC  (INFO|WARN|ERROR|DEBUG)\s+(.*)$")
PLAIN = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)(\.\d{3})? (.*)$")
LOGCAT = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)(\.\d{3})\s+\d+\s+\d+ ([VDIWEF]) (.*)$")
JOURNAL = re.compile(r"^(\d{4}-\d\d-\d\d)T(\d\d:\d\d:\d\d)(\.\d+)?([+-]\d\d:\d\d|Z) (\S+ )?(.*)$")
LEVEL = {"V": "DEBUG", "D": "DEBUG", "I": "INFO", "W": "WARN", "E": "ERROR", "F": "ERROR"}
ROLLED = re.compile(r"\.(\d\d)\.txt$")


def parse(line):
    """(time "YYYY-MM-DD HH:MM:SS.mmm" in UTC, level, text) for a line with a time; None for one without."""
    m = OURS.match(line)
    if m:
        return m.group(1) + (m.group(2) or ".000"), m.group(3), m.group(4)
    m = LOGCAT.match(line)
    if m:
        return m.group(1) + m.group(2), LEVEL[m.group(3)], m.group(4)
    m = JOURNAL.match(line)
    if m:
        at = datetime.datetime.fromisoformat(f"{m.group(1)}T{m.group(2)}{(m.group(3) or '')[:7]}{'+00:00' if m.group(4) == 'Z' else m.group(4)}")
        at = at.astimezone(datetime.timezone.utc)
        return at.strftime("%Y-%m-%d %H:%M:%S.") + f"{at.microsecond // 1000:03d}", "INFO", m.group(6)
    m = PLAIN.match(line)
    if m:
        return m.group(1) + (m.group(2) or ".000"), "INFO", m.group(3)
    return None


def source_of(folder, path):
    """Where a file's lines came from: its folder (Bridges, Apps) and its name, without .txt or a rolled file's .01."""
    rel = os.path.relpath(path, folder)
    name = ROLLED.sub("", rel)
    name = name[:-4] if name.endswith(".txt") else name
    return name.replace(os.sep, "/").replace("_log", "")


def files(folder):
    """The text files under [folder], each rolled one (.10 the oldest) before the one it rolled from."""
    out = []
    for dirpath, _, names in os.walk(folder):
        for n in names:
            if n.endswith(".txt"):
                out.append(os.path.join(dirpath, n))

    def order(p):
        m = ROLLED.search(p)
        return (ROLLED.sub(".txt", p), -int(m.group(1)) if m else 0)
    return sorted(out, key=order)


def merged(sources, journal_text, header):
    """The one file: [sources] [(name, folder)], [journal_text] the journal of this start, [header] its first lines."""
    heads, entries = [], []
    seq = 0

    def take(source, lines):
        nonlocal seq
        last = None
        for raw in lines:
            line = raw.rstrip("\n")
            if not line.strip():
                continue
            if line.startswith("# "):
                heads.append(f"[{source}] {line[2:]}")
                continue
            p = parse(line)
            if p is None:
                if last is not None:
                    last[4].append(line)
                continue
            seq += 1
            last = (p[0], seq, source, p[1], [p[2]])
            entries.append(last)

    for name, folder in sources:
        for path in files(folder):
            try:
                with open(path, encoding="utf-8", errors="replace") as f:
                    take(f"{name}/{source_of(folder, path)}" if name else source_of(folder, path), f)
            except OSError:
                continue
    take("journal", journal_text.splitlines())
    entries.sort(key=lambda e: (e[0], e[1]))
    width = max([len(e[2]) for e in entries] + [8])
    out = [f"# {h}" for h in header] + [f"# {h}" for h in heads] + [""]
    for at, _, source, level, text in entries:
        out.append(f"{at}  {source.ljust(width)}  {level.ljust(5)}  {text[0]}")
        out.extend("    " + more for more in text[1:])
    return "\n".join(out) + "\n"
