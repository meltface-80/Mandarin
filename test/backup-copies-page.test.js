"use strict";
/*
 * Settings → Backup & restore's copies of the database (bug list item 410, public/app/backup-copies.js): the copy a
 * restore keeps aside and the one Mandarin OS's reinstaller makes before it switches builds, listed beside the
 * backups as a card of their own (what came after it, when, how big, the database alone: no settings), with
 * Restore… and Delete and no Download; the question before one is deleted; and what the page says while Mandarin
 * restarts after a restore, the music folders kept included. And the Library Scanner's note when the music folders
 * can't be reached (public/app/covers-reach.js). The app says the same (BackupSettingsTest.kt, ScannerTest.kt).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const part = (name, names) => vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "public", "app", name), "utf8") + "\n;({ " + names + " })", {});
const copies = part("backup-copies.js", "BACKUP_COPY_PARTS, backupCopies, backupCopyTitle, backupCopyItem, backupCopyDeleteQuestion, backupRestartingNote");
const reach = part("covers-reach.js", "coversUnreachable");

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const h = { esc, date: t => "D" + t, when: t => "W" + t, bytes: n => n + " B" };
const INFO = {
  backups: [{ id: "manual-2026-11-10-101010-abcdef", kind: "manual", created: 4, parts: ["settings"] }],
  copies: [
    { id: "before-restore-2026-11-14-003225", kind: "restore", created: 9, bytes: 2000, parts: ["database"] },
    { id: "before-dev-2026-11-13-101010", kind: "dev", created: 7, bytes: 5, parts: ["database"] },
    { id: "before-latest-2026-11-12-101010", kind: "latest", created: 3, bytes: 5, parts: ["database"] }
  ]
};

// A card's parts: [title, meta, what it holds, its buttons' labels].
const card = (html) => [
  /item-title">([^<]*)</.exec(html)[1], /item-meta">([^<]*)</.exec(html)[1], /item-parts">([^<]*)</.exec(html)[1],
  [...html.matchAll(/<(?:button|a)[^>]*data-parity="settings-backup\.(\w+)"[^>]*>([^<]*)</g)].map(m => m[1] + ":" + m[2])
];

test("the copies of the database are listed, each a card with Restore… and Delete, the database alone said", () => {
  const list = copies.backupCopies(INFO);
  assert.deepStrictEqual(list.map(c => [c.where, c.id]), [
    ["copy", "before-restore-2026-11-14-003225"], ["copy", "before-dev-2026-11-13-101010"], ["copy", "before-latest-2026-11-12-101010"]]);
  assert.strictEqual(copies.backupCopies({ backups: [] }).length, 0);
  assert.strictEqual(copies.backupCopies(null).length, 0);

  const [restore, dev, latest] = list.map(c => copies.backupCopyItem(c, h));
  assert.deepStrictEqual(card(restore), ["Before the restore of W9 · on the server", "D9 · 2000 B", "The whole database only: no settings",
    ["restore:Restore…", "delete:Delete"]]);
  assert.match(restore, /^<div class="backup-item" data-where="copy" data-id="before-restore-2026-11-14-003225">/);
  assert.match(restore, /data-act="restore"[^>]*>Restore…/);
  assert.ok(!restore.includes("download"), "no Download: a copy is the server's own");
  assert.ok(restore.includes('<div class="backup-restore hidden"></div>'), "its restore panel, as a backup's");
  assert.strictEqual(card(dev)[0], "Before switching to development builds · on the server");
  assert.strictEqual(card(latest)[0], "Before switching to the latest release · on the server");
  assert.strictEqual(copies.backupCopyDeleteQuestion(list[0], h.date), "Delete the copy of the database of D9 from the server?");
  // A name made safe.
  assert.ok(copies.backupCopyItem({ id: "x\"<", kind: "restore", created: 1 }, h).includes('data-id="x&quot;&lt;"'));
});

test("while Mandarin restarts after a restore, the music folders kept are said", () => {
  const plain = "Mandarin is restarting with the restored settings. This page reloads when it's back.";
  assert.strictEqual(copies.backupRestartingNote({ ok: true, restarting: true }, ""), plain);
  const kept = "The backup's music folders (/music/1tb/Music) aren't on this computer: this one's (/data/Storage) kept. Its albums are matched to the same files here by the next scan.";
  assert.strictEqual(copies.backupRestartingNote({ ok: true, restarting: true, folders: kept }, " Choose again."), plain + " " + kept + " Choose again.");
});

test("the Album Scanner's Progress names the music folders the cover finder can't reach (item 411: under it)", () => {
  assert.strictEqual(reach.coversUnreachable({ found: 1 }), "");
  assert.strictEqual(reach.coversUnreachable({ unreachable: [] }), "");
  assert.strictEqual(reach.coversUnreachable({ unreachable: ["/music/1tb/Music", "/music/2tb/Music"] }),
    "The music folders can't be reached (/music/1tb/Music, /music/2tb/Music not found): covers will be looked for once they are.");
  assert.strictEqual(reach.coversUnreachable({ unreachable: ["/a", "/b", "/c", "/d"] }),
    "The music folders can't be reached (/a, /b, /c, … not found): covers will be looked for once they are.");
});
