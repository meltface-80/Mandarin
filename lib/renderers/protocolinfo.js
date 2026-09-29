"use strict";
/*
 * protocolinfo.js — what a renderer says it accepts.
 *
 * ConnectionManager.GetProtocolInfo answers with a Sink list:
 *   http-get:*:audio/flac:*,http-get:*:audio/L16;rate=48000;channels=2:DLNA.ORG_PN=LPCM,…
 * It names containers and codecs. It almost never names a sample rate — only
 * the raw-PCM entries carry one — so the rates a device takes come from its
 * profile, from you, or from what it was seen to play (profiles.js).
 */
const SOAP = require("../sonos/soap");

// MIME → the word shown on the page. Anything not here is shown as its MIME.
const CONTAINERS = [
  ["flac", /^audio\/(x-)?flac$/],
  ["wav", /^audio\/(x-)?wave?$/],
  ["aiff", /^audio\/(x-)?aiff$/],
  ["alac", /^audio\/(x-)?(m4a|mp4|alac)$/],
  ["mp3", /^audio\/(mpeg|mp3|x-mp3|mpeg3|x-mpeg)$/],
  ["aac", /^audio\/(aac|aacp|x-aac|3gpp|vnd\.dlna\.adts)$/],
  ["ogg", /^(audio|application)\/(x-)?ogg$/],
  ["opus", /^audio\/opus$/],
  ["wma", /^audio\/x-ms-wma$/],
  ["dsd", /^audio\/(x-)?(dsf|dff|dsd)$/],
  ["pcm", /^audio\/l(16|24|32)$/]
];

function containerOf(mime) {
  for (const [name, re] of CONTAINERS) if (re.test(mime)) return name;
  return null;
}

/* The Sink string → { mimes, containers, rates, raw }. Never throws. */
function parseSink(sink) {
  const mimes = new Set();
  const rates = new Set();
  for (const entry of String(sink || "").split(",")) {
    const parts = entry.trim().split(":");
    if (parts.length < 3) continue;
    const format = parts[2].trim();
    if (!format || format === "*") continue;
    const [mime, ...params] = format.split(";").map(s => s.trim());
    const m = mime.toLowerCase();
    if (!/^(audio\/|application\/(x-)?(ogg|flac))/.test(m)) continue;
    mimes.add(m);
    if (/^audio\/l(16|24|32)$/.test(m)) {
      for (const p of params) {
        const r = /^rate=(\d+)$/i.exec(p);
        if (r) rates.add(Number(r[1]));
      }
    }
  }
  const containers = [...new Set([...mimes].map(containerOf).filter(Boolean))];
  return { mimes: [...mimes].sort(), containers, rates: [...rates].sort((a, b) => a - b), raw: String(sink || "") };
}

async function fetchSink(service, timeoutMs = 5000) {
  const r = await SOAP.call(service.controlUrl, service.type, "GetProtocolInfo", {}, timeoutMs);
  return parseSink(r.Sink);
}

module.exports = { parseSink, fetchSink, containerOf };
