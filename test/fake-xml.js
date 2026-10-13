// @ts-check
"use strict";
/*
 * fake-xml.js — the XML the fake speakers and renderers on loopback read and
 * write (test/fake-sonos.js, test/fake-renderer.js): a SOAP request's
 * arguments, the DIDL-Lite they are handed, and the times they answer in. A
 * device's own side of the conversation, so the fakes keep reading it as
 * they always have: lib/xml.js's and lib/sonos/didl.js's reading, kept here
 * when the Node server went (v0.8.50, stage 7 part 5).
 */
const { XMLParser } = require("fast-xml-parser");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: false
});

/** @param {any} text  @returns {any} */
function parse(text) {
  if (!text || typeof text !== "string") return null;
  try { return parser.parse(text); } catch (e) { return null; }
}

/** @param {any} s */
function escape(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** One child or several, as a list. @param {any} v  @returns {any[]} */
function list(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** A node's text, bare or {"#text": …}. @param {any} v */
function text(v) {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object" && v["#text"] != null) return String(v["#text"]);
  return "";
}

/** Seconds as UPnP writes a time (H:MM:SS). @param {any} seconds */
function hms(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/** A UPnP time as seconds. @param {any} v */
function toSeconds(v) {
  const t = String(v || "").trim();
  if (!t || t === "NOT_IMPLEMENTED") return 0;
  const parts = t.split(":").map(Number);
  if (parts.some(n => !Number.isFinite(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** A DIDL-Lite document's items, flat; never throws. @param {any} didl */
function parseItems(didl) {
  const doc = parse(didl);
  const root = doc && doc["DIDL-Lite"];
  if (!root) return [];
  const items = list(root.item).concat(list(root.container));
  return items.map(it => {
    const res = list(it.res)[0];
    return {
      id: it["@id"] || "",
      title: text(it.title),
      artist: text(it.creator) || text(it.artist),
      album: text(it.album),
      albumArtist: text(it.albumArtist),
      artUri: text(it.albumArtURI),
      uri: text(res),
      duration: res && typeof res === "object" ? toSeconds(res["@duration"]) : 0,
      streamContent: text(it.streamContent)
    };
  });
}

module.exports = { parse, escape, list, text, hms, toSeconds, parseItems };
