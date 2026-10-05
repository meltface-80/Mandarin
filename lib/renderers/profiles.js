"use strict";
/*
 * profiles.js — what a model can take that it does not say for itself.
 *
 * GetProtocolInfo names containers, never "up to 192 kHz"; so the rates and
 * depths a device is offered come in layers, in rising order of trust:
 *
 *   advertised   what the device's own description said (containers, and the
 *                odd rate from a raw-PCM entry)
 *   profile      this file: the model looked up by maker and name
 *   user         what you ticked on the device's page
 *   verified     what the device itself reported having played (WiiM's API),
 *                or a test play that went through
 *
 * The chips on the page show which layer each came from. A profile never
 * takes away what a device advertises; it adds what the device cannot say.
 */

const RATES = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000];
const BITS = [16, 24, 32];
const DSD = [64, 128, 256];
const FLOOR = { rates: [44100, 48000], bits: [16, 24] };

const upTo = (max) => RATES.filter(r => r <= max);

const PROFILES = [
  {
    id: "wiim-pro-plus", label: "WiiM Pro Plus",
    match: { model: /wiim\s*pro\s*plus/i },
    rates: upTo(192000), bits: [16, 24], dsd: [],
    setNext: true, api: "linkplay", volume: "upnp",
    notes: "Bit-perfect to 24-bit/192 kHz on its optical and coaxial outputs. 32-bit: to verify."
  },
  {
    id: "wiim-ultra", label: "WiiM Ultra",
    match: { model: /wiim\s*ultra/i },
    rates: upTo(192000), bits: [16, 24], dsd: [],
    setNext: true, api: "linkplay", volume: "upnp"
  },
  {
    id: "wiim-amp", label: "WiiM Amp",
    match: { model: /wiim\s*amp/i },
    rates: upTo(192000), bits: [16, 24], dsd: [],
    setNext: true, api: "linkplay", volume: "upnp"
  },
  {
    id: "wiim-pro", label: "WiiM Pro",
    match: { model: /wiim\s*pro(?!\s*plus)/i },
    rates: upTo(192000), bits: [16, 24], dsd: [],
    setNext: true, api: "linkplay", volume: "upnp"
  },
  {
    id: "wiim-mini", label: "WiiM Mini",
    match: { model: /wiim\s*mini/i },
    rates: upTo(192000), bits: [16, 24], dsd: [],
    setNext: true, api: "linkplay", volume: "upnp"
  },
  {
    id: "wiim", label: "WiiM",
    match: { any: /wiim/i },
    rates: upTo(192000), bits: [16, 24], dsd: [],
    setNext: true, api: "linkplay", volume: "upnp"
  },
  {
    id: "chord-poly", label: "Chord Poly",
    match: { model: /\bpoly\b/i, manufacturer: /chord/i },
    rates: upTo(768000), bits: [16, 24, 32], dsd: [64, 128, 256],
    setNext: null, api: "mpd", volume: "fixed",
    notes: "Feeds a Mojo 2: PCM to 768 kHz, DSD64–256 as DoP. Gapless over UPnP and 32-bit pass-through: to verify. Volume is Mojo 2's own."
  },
  {
    id: "linkplay", label: "LinkPlay player",
    match: { any: /linkplay/i },
    rates: upTo(192000), bits: [16, 24], dsd: [],
    setNext: true, api: "linkplay", volume: "upnp"
  },
  {
    id: "generic", label: "UPnP renderer",
    match: null,
    rates: FLOOR.rates, bits: FLOOR.bits, dsd: [],
    setNext: null, api: null, volume: "upnp",
    notes: "Only 44.1 and 48 kHz are assumed. Tick the rates it takes; a rate it cannot play stops with an error and is unticked."
  }
];

/*
 * A sound device on this computer (v0.6.18): the rates and depths it lists
 * itself (a USB DAC on Linux), or the rate the Mac has it set to, over the
 * 44.1/48 floor; yours when ticked.
 */
const LOCAL = {
  id: "local", label: "Sound output on this computer",
  rates: [], bits: [], dsd: [], setNext: true, api: null, volume: "upnp"
};

function test(re, v) { return !!re && re.test(String(v || "")); }

/* The profile for a device: by model, then maker, then the generic one. */
function profileFor({ manufacturer = "", model = "", family = "" } = {}) {
  if (family === "local") return LOCAL;
  for (const p of PROFILES) {
    const m = p.match;
    if (!m) continue;
    if (m.model && m.manufacturer) { if (test(m.model, model) && test(m.manufacturer, manufacturer)) return p; continue; }
    if (m.model && test(m.model, model)) return p;
    if (m.any && (test(m.any, model) || test(m.any, manufacturer) || test(m.any, family))) return p;
  }
  if (family === "wiim") return PROFILES.find(p => p.id === "wiim");
  return PROFILES[PROFILES.length - 1];
}

/*
 * The chips: every rate, depth and DSD step, on or off, with where "on" came
 * from. `record` is a register row (caps parsed), with kind and family.
 */
function effective(record) {
  const kind = record.kind || "upnp";
  const caps = record.caps || {};
  const adv = caps.advertised || {};
  const user = caps.user || null;
  const verified = caps.verified || {};
  const containers = adv.containers || [];

  if (kind === "sonos") {
    return {
      profile: { id: "sonos", label: "Sonos" },
      rates: RATES.map(hz => ({ hz, on: hz <= 48000, source: hz <= 48000 ? "sonos" : "off" })),
      bits: BITS.map(n => ({ n, on: n <= 24, source: n <= 24 ? "sonos" : "off" })),
      dsd: DSD.map(n => ({ n, on: false, source: "off" })),
      containers: ["flac", "mp3", "alac", "aac", "ogg", "wav", "aiff"],
      editable: false, playable: true
    };
  }
  if (kind === "phone") {
    return {
      profile: { id: "phone", label: "Phone" },
      rates: RATES.map(hz => ({ hz, on: hz <= 192000, source: hz <= 192000 ? "phone" : "off" })),
      bits: BITS.map(n => ({ n, on: n <= 24, source: n <= 24 ? "phone" : "off" })),
      dsd: DSD.map(n => ({ n, on: false, source: "off" })),
      containers: ["flac", "mp3", "alac", "aac", "ogg", "opus", "wav"],
      editable: false, playable: true
    };
  }

  const profile = profileFor(record);
  const pick = (all, key, floor) => all.map(v => {
    const inProfile = (profile[key] || []).includes(v);
    const inAdv = key === "rates" ? (adv.rates || []).includes(v) : key === "bits" ? (adv.bits || []).includes(v) : false;
    const isVerified = !!(verified[key] && verified[key][String(v)]);
    const inFloor = floor.includes(v);
    let on, source;
    if (user && Array.isArray(user[key])) {
      on = user[key].includes(v);
      source = !on ? "off" : isVerified ? "verified" : "user";
    } else {
      on = isVerified || inProfile || inAdv || inFloor;
      source = !on ? "off" : isVerified ? "verified" : inProfile && profile.id !== "generic" && profile.id !== "local" ? "profile" : inAdv ? "advertised" : "floor";
    }
    return { on, source };
  });
  return {
    profile: { id: profile.id, label: profile.label, notes: profile.notes || "", setNext: profile.setNext, api: profile.api, volume: profile.volume },
    rates: RATES.map((hz, i) => Object.assign({ hz }, pick(RATES, "rates", FLOOR.rates)[i])),
    bits: BITS.map((n, i) => Object.assign({ n }, pick(BITS, "bits", FLOOR.bits)[i])),
    dsd: dsdChips(profile, containers, user),
    containers,
    editable: true,
    playable: !!record.playable
  };
}

/*
 * DSD to a renderer (v0.6.0-RC3): the DSF or DFF file itself, for a device
 * that says it takes DSD files (GetProtocolInfo) — at the multiples its
 * profile lists, or DSD64 for a device with no profile of its own. Yours,
 * when you have set them. Anything else is played as PCM, as before.
 */
function dsdChips(profile, containers, user) {
  const takes = containers.includes("dsd");
  const own = profile.id === "generic" ? [64] : (profile.dsd || []);
  return DSD.map(n => {
    if (!takes) return { n, on: false, source: "off" };
    if (user && Array.isArray(user.dsd)) { const on = user.dsd.includes(n); return { n, on, source: on ? "user" : "off" }; }
    const on = own.includes(n);
    return { n, on, source: !on ? "off" : profile.id === "generic" ? "advertised" : "profile" };
  });
}

module.exports = { RATES, BITS, DSD, FLOOR, PROFILES, LOCAL, profileFor, effective };
