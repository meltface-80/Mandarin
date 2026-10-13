// @ts-check
"use strict";
/*
 * helpers.js — what the tests share (v0.9.0, the audit's T3,
 * docs/specs/audit-b4-main.md): waiting for a condition, a signed-in client
 * of the server's /api, and a server started on a fresh copy of the fixture
 * library. Until v0.9.0 each file wrote its own (62 `until`s, 25 `api`s),
 * with timeouts and swallowed errors of their own; files move here as they
 * are touched.
 */
const ports = require("./ports");
const { makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { createServer } = require("./server");

/**
 * Until `fn` answers something truthy: that answer. A throw or a falsy answer
 * is "not yet"; past `ms`, it fails, saying what it waited for and, when `fn`
 * threw, the last error.
 * @template T
 * @param {() => T | Promise<T>} fn
 * @param {number} [ms]
 * @param {string} [what]
 * @returns {Promise<T>}
 */
async function until(fn, ms = 15000, what = "") {
  const t0 = Date.now();
  let last = null;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) { last = e; }
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? " for " + what : "") + (last ? " (last: " + last.message + ")" : ""));
    await new Promise(r => setTimeout(r, 100));
  }
}

/**
 * A client of one server's /api, signed in with `token`: `api("zones")` GETs,
 * `api("play", { … })` POSTs JSON. The answer's status and its JSON (null
 * when it has none).
 * @param {string} base  "http://127.0.0.1:<port>"
 * @param {string} token
 * @returns {(path: string, body?: any) => Promise<{ status: number, json: any }>}
 */
function apiOf(base, token) {
  return async (p, body) => {
    const headers = { Authorization: "Bearer " + token };
    const r = await fetch(base + "/api/" + p, body === undefined ? { headers }
      : { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, headers), body: JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
}

/**
 * A server on a fresh copy of the fixture library, signed in, its first scan
 * done, stopped when the test ends. No speakers, no discovery, no
 * identification unless `config` says otherwise (test/server.js's keys).
 * @param {import("node:test").TestContext} t
 * @param {Record<string, any>} [config]
 */
async function started(t, config = {}) {
  const lib = makeLibrary();
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer(Object.assign({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false }, config));
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(base);
  const api = apiOf(base, token);
  await until(async () => { const s = (await api("status")).json; return s && s.index_count > 0 && !(s.scan && s.scan.running); }, 30000, "the first scan");
  /** The library's album of this title (from the album list). @param {string} title */
  const album = async (title) => ((await api("library/albums?sort=album")).json.albums || []).find(a => a.title === title);
  return { lib, base, port, srv, ctx, token, api, album, H: { Authorization: "Bearer " + token } };
}

module.exports = { until, apiOf, started };
