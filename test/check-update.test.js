"use strict";
/*
 * Settings → Updates on the page (item 223): the server's row, its version in its name and its own button. Opened, it
 * says what the last check found; Check for update looks, and becomes Update available once one is found, which
 * installs the server's alone on its next tap; otherwise it says how things stand, then Check for update again. Under
 * it, what the update brings: a heading and the release's short lines, nothing when it has none. check-update.js run
 * here as the page runs it, against the server's answers. The Android app's rows are its own (core UpdateCheckTest.kt).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(path.join(__dirname, "..", "public", "app", "check-update.js"), "utf8");

/* An element as far as check-update.js uses one. */
function el(tag = "div") {
  const classes = new Set();
  const e = {
    tag, children: [], attrs: {}, disabled: false, on: null, _text: "",
    classList: {
      add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
      toggle: (c, on) => { if (on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); }
    },
    get textContent() { return this._text + this.children.map(c => c.textContent).join("|"); },
    set textContent(v) { this._text = String(v); this.children = []; },
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(_, fn) { this.on = fn; },
    click() { return this.on && this.on(); }
  };
  return e;
}

/* The page's Updates with the server answering [answers] in turn (its status, each time it is asked); what came of it. */
function page(answers) {
  const btn = el("button"), name = el("span"), box = el(), closer = el("button");
  btn.textContent = "Check for update"; name.textContent = "Server"; box.classList.add("hidden");
  let closed = 0;
  closer.addEventListener("click", () => { closed++; });
  const asked = [], applied = [];
  const statuses = answers.slice();
  const window = { __applyUpdateNow: what => applied.push(what) };
  const ids = { "check-update-btn": btn, "update-server-name": name, "settings-whats-new": box };
  const sandbox = {
    window, Promise, JSON, setTimeout: fn => { sandbox.later.push(fn); return 0; }, later: [],
    document: {
      getElementById: id => ids[id] || null,
      querySelector: s => (s === "#settings-overlay [data-settings-close]" ? closer : null),
      querySelectorAll: () => [],
      createElement: el
    },
    fetch: async (url, opts) => {
      asked.push((opts && opts.method || "GET") + " " + url);
      const s = String(url).startsWith("/api/update/status") ? (statuses.length > 1 ? statuses.shift() : statuses[0]) : {};
      return { json: async () => s };
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  const settle = () => new Promise(r => setImmediate(r));
  return {
    btn, name, box, asked, applied, settle, closed: () => closed,
    notes: () => box.children.map(c => [c.attrs["data-parity"], c.textContent]),
    async tap() { await btn.click(); await settle(); },
    pass() { sandbox.later.splice(0).forEach(fn => fn()); }
  };
}

const NOTES = "• Fixed - track times now show on albums\n• New - Shelf, a new way to navigate your library";

test("opened with an update the last check found: Update available, and what it brings under it", async () => {
  const p = page([{ current: "1.1.13", latest: "1.1.14", available: true, notes: NOTES }]);
  await p.settle();
  assert.equal(p.name.textContent, "Server v1.1.13");
  assert.equal(p.btn.textContent, "Update available");
  assert.ok(p.btn.classList.contains("is-update-ready"));
  assert.ok(!p.box.classList.contains("hidden"));
  assert.deepEqual(p.notes(), [["settings-system.notes-head", "What's new in v1.1.14"], ["settings-system.notes", NOTES]]);
});

test("Check for update finds one: Update available, its notes; tapped, the server's alone installed, Settings closed for its banner", async () => {
  const p = page([{ current: "1.1.13", latest: "1.1.13", available: false }, { current: "1.1.13", latest: "1.1.14", available: true, notes: NOTES }]);
  await p.settle();
  assert.equal(p.btn.textContent, "Check for update");
  assert.deepEqual(p.notes(), []);
  await p.tap();
  assert.deepEqual(p.asked.slice(1), ["POST /api/update/check", "GET /api/update/status"]);
  assert.equal(p.btn.textContent, "Update available");
  assert.equal(p.notes()[0][1], "What's new in v1.1.14");
  await p.tap();
  assert.deepEqual(p.applied.map(w => ({ ...w })), [{ server: true, app: false }]);
  assert.equal(p.closed(), 1);
  assert.equal(p.btn.textContent, "Check for update");
  assert.deepEqual(p.notes(), []);
});

test("Check for update finds nothing: Up to date, then Check for update; the check failing: Check failed", async () => {
  const p = page([{ current: "1.1.14-t1", latest: "1.1.13", available: false, error: null }]);
  await p.settle();
  await p.tap();
  assert.equal(p.btn.textContent, "Up to date");
  assert.equal(p.name.textContent, "Server v1.1.14-t1");
  p.pass();
  assert.equal(p.btn.textContent, "Check for update");
  const q = page([{ current: "1.1.13", available: false, error: "GitHub API HTTP 500" }]);
  await q.settle();
  await q.tap();
  assert.equal(q.btn.textContent, "Check failed");
});

test("an update without short notes: Update available, nothing under it", async () => {
  const p = page([{ current: "1.1.13", latest: "1.1.14", available: true, notes: null }]);
  await p.settle();
  assert.equal(p.btn.textContent, "Update available");
  assert.ok(p.box.classList.contains("hidden"));
  assert.deepEqual(p.notes(), []);
});
