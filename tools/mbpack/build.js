"use strict";
/*
 * build.js — the MusicBrainz pack (v0.6.4): every release with a barcode,
 * with its tracks, in one small SQLite file, so the identification scan can
 * look a barcode up on this machine instead of asking musicbrainz.org.
 *
 * Built from MusicBrainz's own data dump (CC0), by .github/workflows/mbpack.yml
 * on GitHub's machines; installs only download the result. Run by hand:
 *
 *   node tools/mbpack/build.js --dump=mbdump --schema=CreateTables.sql --out=mbpack.sqlite
 *
 * --dump    the folder the dump's tables were unpacked into (mbdump/release…)
 * --schema  MusicBrainz's admin/sql/CreateTables.sql, so each table's
 *           columns are found by name; without it the orders below are used
 * --out     the pack to write (replaced)
 * --all     every release, not only those with a barcode
 *
 * The dump's tables are PostgreSQL COPY text: a row a line, columns split
 * by tabs, \N for nothing, and backslash escapes.
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const Database = require("better-sqlite3");

const PACK_FORMAT = 1;

/* Each table's columns in the dump's order, as CreateTables.sql has them
 * (checked against it when --schema is given). */
const COLUMNS = {
  artist_credit: ["id", "name", "artist_count", "ref_count", "created", "edits_pending", "gid"],
  release: ["id", "gid", "name", "artist_credit", "release_group", "status", "packaging", "language", "script", "barcode", "comment", "edits_pending", "quality", "last_updated"],
  release_group: ["id", "gid", "name", "artist_credit", "type", "comment", "edits_pending", "last_updated"],
  release_group_primary_type: ["id", "name", "parent", "child_order", "description", "gid"],
  release_group_secondary_type: ["id", "name", "parent", "child_order", "description", "gid"],
  release_group_secondary_type_join: ["release_group", "secondary_type", "created"],
  release_status: ["id", "name", "parent", "child_order", "description", "gid"],
  release_country: ["release", "country", "date_year", "date_month", "date_day"],
  release_unknown_country: ["release", "date_year", "date_month", "date_day"],
  iso_3166_1: ["area", "code"],
  medium_format: ["id", "name", "parent", "child_order", "year", "has_discids", "description", "gid"],
  medium: ["id", "release", "position", "format", "name", "edits_pending", "last_updated", "track_count", "gid"],
  track: ["id", "gid", "recording", "medium", "position", "number", "name", "artist_credit", "length", "edits_pending", "last_updated", "is_data_track"]
};
const TABLES = Object.keys(COLUMNS);

/* Columns by table from CreateTables.sql: "CREATE TABLE x ( -- note" up to
 * ");", one column a line, constraints and comments skipped. */
function columnsFrom(sql) {
  const out = {};
  let table = null;
  for (const raw of String(sql).split("\n")) {
    const line = raw.replace(/--.*$/, "").trim();
    const open = /^CREATE TABLE\s+(\w+)\s*\(/i.exec(line);
    if (open) { table = open[1].toLowerCase(); out[table] = []; continue; }
    if (!table) continue;
    if (/^\)/.test(line)) { table = null; continue; }
    const col = /^"?(\w+)"?\s+\w/.exec(line);
    if (col && !/^(CHECK|CONSTRAINT|PRIMARY|UNIQUE|EXCLUDE|FOREIGN)$/i.test(col[1])) out[table].push(col[1].toLowerCase());
  }
  return out;
}

/* The columns to read each table by: the schema's, when it names them all. */
function layout(schemaSql) {
  const found = schemaSql ? columnsFrom(schemaSql) : {};
  const out = {};
  for (const t of TABLES) {
    const cols = found[t] && found[t].length ? found[t] : COLUMNS[t];
    // Only the columns this builder reads must be there; others may come and go.
    for (const c of NEEDED[t]) if (!cols.includes(c)) throw new Error(`MusicBrainz's ${t} table has no ${c} column any more`);
    out[t] = Object.fromEntries(cols.map((c, i) => [c, i]));
  }
  return out;
}
const NEEDED = {
  artist_credit: ["id", "name"],
  release: ["id", "gid", "name", "artist_credit", "release_group", "status", "barcode", "comment"],
  release_group: ["id", "gid", "name", "type", "comment"],
  release_group_primary_type: ["id", "name"],
  release_group_secondary_type: ["id", "name"],
  release_group_secondary_type_join: ["release_group", "secondary_type"],
  release_status: ["id", "name"],
  release_country: ["release", "country", "date_year", "date_month", "date_day"],
  release_unknown_country: ["release", "date_year", "date_month", "date_day"],
  iso_3166_1: ["area", "code"],
  medium_format: ["id", "name"],
  medium: ["id", "release", "position", "format"],
  track: ["medium", "position", "name", "artist_credit", "length"]
};

/* One COPY text field: \N is nothing; \\ \t \n \r \b \f \v and \ooo / \xhh. */
const ESC = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" };
function field(s) {
  if (s === "\\N") return null;
  if (s.indexOf("\\") < 0) return s;
  return s.replace(/\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3}|.)/g, (m, e) => {
    if (ESC[e]) return ESC[e];
    if (e[0] === "x" && e.length > 1) return String.fromCharCode(parseInt(e.slice(1), 16));
    if (/^[0-7]+$/.test(e)) return String.fromCharCode(parseInt(e, 8));
    return e;
  });
}

/* Every row of a dump table → fn(row, cols), the row an array of strings. */
async function eachRow(dir, table, cols, fn) {
  const file = path.join(dir, table);
  if (!fs.existsSync(file)) throw new Error(`the dump has no ${table} table (${file})`);
  const rl = readline.createInterface({ input: fs.createReadStream(file, { highWaterMark: 1 << 20 }), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    if (!line) continue;
    fn(line.split("\t"), cols);
    n++;
  }
  return n;
}

/* A barcode as it is compared: digits only, leading zeros dropped, so the
 * 12-digit UPC and the 13-digit EAN of one sleeve are the same code. */
function codeOf(barcode) {
  const d = String(barcode || "").replace(/\D/g, "").replace(/^0+/, "");
  return d || null;
}

/* A MusicBrainz ID as 16 bytes and back. */
const gidBlob = g => Buffer.from(String(g).replace(/-/g, ""), "hex");
const gidText = b => { const h = Buffer.from(b).toString("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };

/* yyyymmdd from a date's parts, unknown parts 0; and the text MusicBrainz shows. */
const dateNum = (y, m, d) => (y ? Number(y) * 10000 + (Number(m) || 0) * 100 + (Number(d) || 0) : 0);
const dateText = n => {
  if (!n) return null;
  const y = Math.floor(n / 10000), m = Math.floor(n / 100) % 100, d = n % 100;
  const p = v => String(v).padStart(2, "0");
  return m ? (d ? `${y}-${p(m)}-${p(d)}` : `${y}-${p(m)}`) : String(y).padStart(4, "0");
};

/* An Int32Array indexed by ID that grows as IDs come. */
class IdArray {
  constructor() { this.a = new Int32Array(1 << 20); }
  set(i, v) {
    if (i >= this.a.length) { let n = this.a.length; while (n <= i) n *= 2; const b = new Int32Array(n); b.set(this.a); this.a = b; }
    this.a[i] = v;
  }
  get(i) { return i < this.a.length ? this.a[i] : 0; }
}

async function build({ dump, schema, out, all = false, log = () => {} }) {
  const L = layout(schema ? fs.readFileSync(schema, "utf8") : null);
  const t0 = Date.now();
  const took = () => Math.round((Date.now() - t0) / 1000) + "s";
  const work = out + ".work";
  for (const f of [work, out]) fs.rmSync(f, { force: true });
  const tmp = new Database(work);
  tmp.pragma("journal_mode = OFF");
  tmp.pragma("synchronous = OFF");
  tmp.exec(`CREATE TABLE ac (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE med (id INTEGER PRIMARY KEY, rel INTEGER, pos INTEGER, fmt INTEGER);
    CREATE TABLE trk (med INTEGER, pos INTEGER, name TEXT, ac INTEGER, len INTEGER);`);
  const batch = (stmt) => { const rows = []; return { add(r) { rows.push(r); if (rows.length >= 50000) this.flush(); }, flush: tmp.transaction(() => { for (const r of rows) stmt.run(r); rows.length = 0; }) }; };

  // Names of the small tables.
  const small = async (table) => { const m = new Map(); const c = L[table]; await eachRow(dump, table, c, r => m.set(Number(r[c.id]), field(r[c.name]))); return m; };
  const primary = await small("release_group_primary_type");
  const secondary = await small("release_group_secondary_type");
  const statuses = await small("release_status");
  const formats = await small("medium_format");
  const countries = new Map();
  await eachRow(dump, "iso_3166_1", L.iso_3166_1, (r, c) => { if (!countries.has(Number(r[c.area]))) countries.set(Number(r[c.area]), field(r[c.code])); });

  // Artist credits ("Simon & Garfunkel"), for releases and tracks.
  const acs = batch(tmp.prepare("INSERT INTO ac VALUES (?, ?)"));
  let n = await eachRow(dump, "artist_credit", L.artist_credit, (r, c) => acs.add([Number(r[c.id]), field(r[c.name])]));
  acs.flush();
  log(`artist credits: ${n} (${took()})`);

  // Releases: the group of every one (its first date is the earliest of
  // all its releases'), and those the pack keeps.
  const relGroup = new IdArray();
  const kept = new Map();
  n = await eachRow(dump, "release", L.release, (r, c) => {
    const id = Number(r[c.id]);
    relGroup.set(id, Number(r[c.release_group]));
    const barcode = field(r[c.barcode]);
    const code = codeOf(barcode);
    if (!code && !all) return;
    kept.set(id, { gid: field(r[c.gid]), name: field(r[c.name]), ac: Number(r[c.artist_credit]), grp: Number(r[c.release_group]),
      status: statuses.get(Number(field(r[c.status]))) || null, barcode, code, note: field(r[c.comment]) || "", date: 0, country: null });
  });
  log(`releases: ${n}, kept ${kept.size} (${took()})`);

  // Release dates: the release's earliest, and its group's earliest of all.
  const groupFirst = new IdArray();
  const dated = (rel, num, country) => {
    if (!num) return;
    const g = relGroup.get(rel);
    const f = groupFirst.get(g);
    if (g && (!f || num < f)) groupFirst.set(g, num);
    const k = kept.get(rel);
    if (k && (!k.date || num < k.date)) { k.date = num; k.country = country; }
  };
  await eachRow(dump, "release_country", L.release_country, (r, c) =>
    dated(Number(r[c.release]), dateNum(field(r[c.date_year]), field(r[c.date_month]), field(r[c.date_day])), countries.get(Number(r[c.country])) || null));
  await eachRow(dump, "release_unknown_country", L.release_unknown_country, (r, c) =>
    dated(Number(r[c.release]), dateNum(field(r[c.date_year]), field(r[c.date_month]), field(r[c.date_day])), null));
  log(`dates (${took()})`);

  // Release groups the kept releases belong to.
  const groupsWanted = new Set([...kept.values()].map(k => k.grp));
  const groups = new Map();
  await eachRow(dump, "release_group", L.release_group, (r, c) => {
    const id = Number(r[c.id]);
    if (!groupsWanted.has(id)) return;
    groups.set(id, { gid: field(r[c.gid]), name: field(r[c.name]), note: field(r[c.comment]) || "", type: primary.get(Number(field(r[c.type]))) || null, more: [] });
  });
  await eachRow(dump, "release_group_secondary_type_join", L.release_group_secondary_type_join, (r, c) => {
    const g = groups.get(Number(r[c.release_group]));
    const s = secondary.get(Number(r[c.secondary_type]));
    if (g && s) g.more.push(s);
  });
  log(`release groups: ${groups.size} (${took()})`);

  // Discs and tracks of the kept releases, set aside to be put in order.
  const meds = batch(tmp.prepare("INSERT INTO med VALUES (?, ?, ?, ?)"));
  const medKept = new Set();
  await eachRow(dump, "medium", L.medium, (r, c) => {
    const rel = Number(r[c.release]);
    if (!kept.has(rel)) return;
    const id = Number(r[c.id]);
    medKept.add(id);
    meds.add([id, rel, Number(r[c.position]) || 0, Number(field(r[c.format])) || 0]);
  });
  meds.flush();
  const trks = batch(tmp.prepare("INSERT INTO trk VALUES (?, ?, ?, ?, ?)"));
  n = await eachRow(dump, "track", L.track, (r, c) => {
    const med = Number(r[c.medium]);
    if (!medKept.has(med)) return;
    const len = field(r[c.length]);
    trks.add([med, Number(r[c.position]) || 0, field(r[c.name]), Number(r[c.artist_credit]), len == null ? null : Number(len)]);
  });
  trks.flush();
  medKept.clear();
  log(`discs ${tmp.prepare("SELECT COUNT(*) n FROM med").get().n}, tracks ${n} read (${took()})`);
  tmp.exec("CREATE INDEX med_rel ON med (rel, pos); CREATE INDEX trk_med ON trk (med, pos);");
  log(`indexed (${took()})`);

  // The pack.
  const pack = new Database(out);
  pack.pragma("journal_mode = OFF");
  pack.pragma("synchronous = OFF");
  pack.pragma("page_size = 4096");
  pack.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE groups (id INTEGER PRIMARY KEY, gid BLOB NOT NULL, title TEXT, note TEXT, type TEXT, first INTEGER);
    CREATE TABLE releases (id INTEGER PRIMARY KEY, gid BLOB NOT NULL, grp INTEGER, title TEXT, artist TEXT, note TEXT,
      status TEXT, barcode TEXT, code TEXT, date INTEGER, country TEXT, format TEXT, tracks TEXT);`);
  const addGroup = pack.prepare("INSERT INTO groups VALUES (?, ?, ?, ?, ?, ?)");
  pack.transaction(() => {
    for (const [id, g] of groups) addGroup.run(id, gidBlob(g.gid), g.name, g.note, [g.type].concat(g.more).filter(Boolean).join(" + ") || null, groupFirst.get(id) || null);
  })();
  groups.clear();

  const acName = tmp.prepare("SELECT name FROM ac WHERE id = ?").pluck();
  const addRel = pack.prepare("INSERT INTO releases VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  // Tracks a release: [disc, no, title, seconds, artist (when not the release's)].
  const flushRel = (relId, discs, tracks) => {
    const k = kept.get(relId);
    if (!k) return;
    const artist = acName.get(k.ac) || "";
    for (const t of tracks) { if (t.length === 5) { const a = acName.get(t[4]) || ""; if (a && a !== artist) t[4] = a; else t.length = 4; } }
    const fmt = new Map();
    for (const f of discs) { const name = formats.get(f) || "?"; fmt.set(name, (fmt.get(name) || 0) + 1); }
    const format = [...fmt].map(([name, c]) => (c > 1 ? c + "×" : "") + name).join(" + ") || null;
    addRel.run(relId, gidBlob(k.gid), k.grp, k.name, artist, k.note, k.status, k.barcode, k.code, k.date || null, k.country, format, JSON.stringify(tracks));
    kept.delete(relId);
  };
  const rows = tmp.prepare("SELECT m.rel, m.id, m.pos AS disc, m.fmt, t.pos, t.name, t.ac, t.len FROM med m LEFT JOIN trk t ON t.med = m.id ORDER BY m.rel, m.pos, m.id, t.pos").raw();
  let cur = null, discs = [], tracks = [], lastMed = null, written = 0;
  const write = pack.transaction((list) => { for (const [r, d, t] of list) flushRel(r, d, t); });
  let pending = [];
  for (const [rel, med, disc, fmt, pos, name, ac, len] of rows.iterate()) {
    if (rel !== cur) {
      if (cur !== null) { pending.push([cur, discs, tracks]); written++; }
      if (pending.length >= 20000) { write(pending); pending = []; }
      cur = rel; discs = []; tracks = []; lastMed = null;
    }
    if (med !== lastMed) { discs.push(fmt); lastMed = med; }
    if (pos !== null) tracks.push([disc, pos, name || "", len == null ? null : Math.round(len / 1000), ac]);
  }
  if (cur !== null) { pending.push([cur, discs, tracks]); written++; }
  write(pending);
  // Releases with no discs at all.
  const bare = [...kept.keys()];
  write(bare.map(id => [id, [], []]));
  written += bare.length;
  log(`releases written: ${written} (${took()})`);

  pack.exec("CREATE INDEX releases_code ON releases (code); CREATE INDEX releases_gid ON releases (gid); CREATE INDEX groups_gid ON groups (gid);");
  const meta = pack.prepare("INSERT INTO meta VALUES (?, ?)");
  const read = f => { try { return fs.readFileSync(path.join(dump, f), "utf8").trim(); } catch (e) { return null; } };
  for (const [k, v] of [["format", PACK_FORMAT], ["built", new Date().toISOString()], ["dump", read("TIMESTAMP")],
    ["replication_sequence", read("REPLICATION_SEQUENCE")], ["schema_sequence", read("SCHEMA_SEQUENCE")],
    ["releases", written], ["barcodes_only", all ? 0 : 1]]) meta.run(k, v == null ? null : String(v));
  pack.exec("VACUUM");
  pack.close();
  tmp.close();
  fs.rmSync(work, { force: true });
  log(`done: ${out} ${Math.round(fs.statSync(out).size / 1048576)} MB (${took()})`);
  return { releases: written };
}

module.exports = { build, columnsFrom, layout, field, codeOf, gidBlob, gidText, dateText, COLUMNS, PACK_FORMAT };

if (require.main === module) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  }));
  if (!args.dump || !args.out) { console.error("usage: build.js --dump=DIR --out=FILE [--schema=CreateTables.sql] [--all]"); process.exit(2); }
  build({ dump: args.dump, schema: args.schema || null, out: args.out, all: !!args.all, log: s => console.error(s) })
    .catch(e => { console.error(e.stack || e.message); process.exit(1); });
}
