"use strict";
/*
 * linkplay.js — the HTTP API WiiM (and every other LinkPlay-based player)
 * answers beside UPnP: https://<ip>/httpapi.asp?command=…
 *
 * UPnP says what a WiiM accepts; this says what it IS (the name in the WiiM
 * app, its firmware) and — later — what it is actually playing, sample rate
 * and bit depth included, which no UPnP call can tell. The device signs its
 * own certificate, so that one LAN call skips verification. Older LinkPlay
 * firmware answers on plain HTTP instead, so both are tried.
 */
const http = require("http");
const https = require("https");

function get(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https:") ? https : http;
    const req = mod.get(url, { timeout: timeoutMs, rejectUnauthorized: false }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
  });
}

/* One command against one base URL: parsed JSON, or null when it isn't LinkPlay. */
async function command(base, cmd, timeoutMs = 3000) {
  const r = await get(`${base}/httpapi.asp?command=${encodeURIComponent(cmd)}`, timeoutMs);
  if (r.status !== 200) return null;
  try {
    const j = JSON.parse(r.text);
    return j && typeof j === "object" ? j : null;
  } catch (e) { return null; }
}

/*
 * Is the device at this address LinkPlay, and what does it say about itself?
 * `extraBases` lets a description's own host:port be tried too (a device that
 * serves both on one port — the test double does).
 */
async function probe(host, { extraBases = [], timeoutMs = 3000 } = {}) {
  const bases = [`https://${host}`, `http://${host}`].concat(extraBases);
  for (const base of bases) {
    let j = null;
    try { j = await command(base, "getStatusEx", timeoutMs); } catch (e) { j = null; }
    if (!j || !(j.uuid || j.DeviceName || j.project)) continue;
    return {
      base,
      deviceName: String(j.DeviceName || "").trim(),
      project: String(j.project || "").trim(),
      firmware: String(j.firmware || "").trim(),
      hardware: String(j.hardware || "").trim(),
      uuid: String(j.uuid || "").trim(),
      mac: String(j.MAC || j.STA_MAC || "").trim()
    };
  }
  return null;
}

module.exports = { probe, command };
