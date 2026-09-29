"use strict";
/*
 * What the server can see of the machine it runs on: the drives and shares
 * mounted into its container (or, outside Docker, into the system), read
 * from /proc/self/mountinfo — for Settings → Music Folders to offer, and to
 * say why a folder looks empty.
 *
 * The usual trap (DietPi's Drive Manager, and any fstab line with
 * x-systemd.automount): a network share the host mounts only when it's first
 * opened. Inside a container started with a plain -v /mnt:/mnt, that later
 * mount never arrives — the folder stays an empty "autofs" stand-in — unless
 * the -v line ends in :rslave (mounts made on the host afterwards then follow).
 */
const fs = require("fs");
const path = require("path");

// Mount points that are the system's own, never music.
const SYSTEM = /^\/(proc|sys|dev|run|etc|boot|tmp|var\/lib\/docker|usr|lib|lib64|bin|sbin|opt\/[^/]*)(\/|$)|^\/etc\//;
const PSEUDO = new Set(["proc", "sysfs", "devtmpfs", "devpts", "tmpfs", "cgroup", "cgroup2", "mqueue", "overlay",
  "securityfs", "debugfs", "tracefs", "pstore", "bpf", "configfs", "fusectl", "hugetlbfs", "nsfs", "binfmt_misc", "squashfs"]);

// "\040" and friends, as mountinfo writes spaces and tabs in paths.
const unescape = s => s.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));

function parse(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    const [left, right] = line.split(" - ");
    if (!right) continue;
    const a = left.split(" "), b = right.split(" ");
    out.push({
      point: unescape(a[4]),
      // Optional fields: "shared:N", "master:N" (a slave: the host's later mounts follow).
      follows: a.slice(6).some(f => f.startsWith("master:") || f.startsWith("shared:")),
      type: b[0],
      source: unescape(b[1] || "")
    });
  }
  return out;
}

/*
 * The music-looking mounts: [{ path, type, source, automount, waiting }].
 * [waiting]: an automount stand-in with nothing mounted on it inside here —
 * the share is on the host, but this container can't see it.
 */
function musicMounts({ mountinfo, dataDir } = {}) {
  let text = mountinfo;
  if (text == null) { try { text = fs.readFileSync("/proc/self/mountinfo", "utf8"); } catch (e) { return []; } }
  const all = parse(text);
  const data = dataDir ? path.resolve(dataDir) : null;
  const byPoint = new Map();
  for (const m of all) {
    if (m.point === "/" || SYSTEM.test(m.point) || PSEUDO.has(m.type)) continue;
    if (data && (m.point === data || m.point.startsWith(data + "/"))) continue;
    const prev = byPoint.get(m.point);
    // Mounted over (an automount, then the share on it): the last one is what's seen.
    byPoint.set(m.point, Object.assign({}, m, { automount: m.type === "autofs" || !!(prev && prev.automount) }));
  }
  return [...byPoint.values()]
    .map(m => ({ path: m.point, type: m.type, source: m.source, automount: m.automount, waiting: m.type === "autofs", follows: m.follows }))
    .sort((x, y) => x.path.localeCompare(y.path));
}

/* A word about a folder being browsed, when there's something to say. */
function hintFor(dir, mounts, { entries = 1, docker = false } = {}) {
  const d = path.resolve(dir);
  const m = mounts.find(x => x.path === d);
  const fix = "Add :rslave to its -v line (e.g. -v /mnt:/mnt:ro,rslave) and re-create the container.";
  if (m && m.waiting) {
    return "This is a share the machine mounts only when it's opened (DietPi's Drive Manager does this), and this container can't see it. " + fix;
  }
  if (!entries && docker) {
    const inside = mounts.some(x => x.path === d || d.startsWith(x.path + "/"));
    return inside
      ? "Empty here. If a drive or share is mounted at this folder on the machine after the container started, the container doesn't see it. " + fix
      : "Nothing from the machine is mounted here. The server sees only what its container is given — add a -v line for your drives (e.g. -v /mnt:/mnt:ro,rslave).";
  }
  return null;
}

module.exports = { parse, musicMounts, hintFor };
