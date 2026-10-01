/*
 * biquad.js — the DSP maths Mandarin shares between the server and the page:
 * the parametric bands (peak, shelves, passes) as second-order sections,
 * their combined response, and the headroom a set of bands needs.
 *
 * One file for both, so the curve the page draws and the chain the server
 * runs (lib/stream.js turns these bands into ffmpeg filters) can never
 * disagree. The phone (Stage 3's engine) carries the same formulae in
 * Kotlin: the Audio EQ Cookbook (R. Bristow-Johnson), which is also what
 * ffmpeg's equalizer, lowshelf, highshelf, lowpass and highpass compute.
 *
 * A band: { type, freq, gain, q }
 *   type  peak | low_shelf | high_shelf | low_pass | high_pass
 *   freq  Hz (10–24000)      gain  dB (−20–20; none for a pass)
 *   q     0.1–20 (a shelf's Q is its slope; 0.707 is a gentle one)
 *
 * A DSP setting: { enabled, headphone: { name, preamp, bands } | null,
 *                  peq: { bands } | null, headroom: "auto" | dB }
 * The headphone bands run first, then the PEQ, all after the preamp.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Biquad = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TYPES = ["peak", "low_shelf", "high_shelf", "low_pass", "high_pass"];
  const MAX_BANDS = 10;
  const HEADROOM_MARGIN = 0.5;   // dB under the peak, so a full-scale peak never clips

  /* Coefficients (normalised, a0 = 1) for one band at sample rate fs. */
  function coeffs(band, fs) {
    const f0 = Math.min(Math.max(Number(band.freq) || 1000, 1), fs / 2 - 1);
    const Q = Math.min(Math.max(Number(band.q) || 0.707, 0.01), 100);
    const g = band.type === "low_pass" || band.type === "high_pass" ? 0 : (Number(band.gain) || 0);
    const A = Math.pow(10, g / 40);
    const w0 = 2 * Math.PI * f0 / fs;
    const cs = Math.cos(w0), sn = Math.sin(w0);
    const alpha = sn / (2 * Q);
    let b0, b1, b2, a0, a1, a2;
    switch (band.type) {
      case "low_shelf": {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) - (A - 1) * cs + s);
        b1 = 2 * A * ((A - 1) - (A + 1) * cs);
        b2 = A * ((A + 1) - (A - 1) * cs - s);
        a0 = (A + 1) + (A - 1) * cs + s;
        a1 = -2 * ((A - 1) + (A + 1) * cs);
        a2 = (A + 1) + (A - 1) * cs - s;
        break;
      }
      case "high_shelf": {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) + (A - 1) * cs + s);
        b1 = -2 * A * ((A - 1) + (A + 1) * cs);
        b2 = A * ((A + 1) + (A - 1) * cs - s);
        a0 = (A + 1) - (A - 1) * cs + s;
        a1 = 2 * ((A - 1) - (A + 1) * cs);
        a2 = (A + 1) - (A - 1) * cs - s;
        break;
      }
      case "low_pass":
        b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2;
        a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
        break;
      case "high_pass":
        b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2;
        a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
        break;
      default:   // peak
        b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A;
        a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A;
    }
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }

  /* |H(f)| in dB of one section. */
  function sectionDb(c, f, fs) {
    const w = 2 * Math.PI * f / fs;
    const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = c.b0 + c.b1 * c1 + c.b2 * c2, ni = -(c.b1 * s1 + c.b2 * s2);
    const dr = 1 + c.a1 * c1 + c.a2 * c2, di = -(c.a1 * s1 + c.a2 * s2);
    const mag2 = (nr * nr + ni * ni) / Math.max(dr * dr + di * di, 1e-30);
    return 10 * Math.log10(Math.max(mag2, 1e-30));
  }

  /* The bands' combined response in dB at each frequency. */
  function response(bands, fs, freqs) {
    const cs = (bands || []).map(b => coeffs(b, fs));
    return freqs.map(f => cs.reduce((db, c) => db + sectionDb(c, f, fs), 0));
  }

  /* Log-spaced frequencies over the audible band, plus each band's centre. */
  function sweep(bands, n) {
    const out = [];
    const lo = Math.log10(20), hi = Math.log10(20000);
    for (let i = 0; i < n; i++) out.push(Math.pow(10, lo + (hi - lo) * i / (n - 1)));
    for (const b of bands || []) if (b.freq > 20 && b.freq < 20000) out.push(Number(b.freq));
    return out.sort((a, b) => a - b);
  }

  /* The highest point of the combined response (dB, ≥ 0): what the bands
   * add at their loudest, which the preamp has to take away again. */
  function peakDb(bands, fs) {
    if (!bands || !bands.length) return 0;
    const r = response(bands, fs, sweep(bands, 400));
    return Math.max(0, ...r);
  }

  /* All the bands a setting applies, in order. */
  function bandsOf(dsp) {
    const hp = dsp && dsp.headphone && Array.isArray(dsp.headphone.bands) ? dsp.headphone.bands : [];
    const pq = dsp && dsp.peq && Array.isArray(dsp.peq.bands) ? dsp.peq.bands : [];
    return hp.concat(pq);
  }

  /*
   * The preamp in dB (≤ 0). Auto: half a dB under the combined peak — the
   * peak of every band together, not the largest one, since bands that
   * overlap add. A headphone profile that brings its own preamp keeps it if
   * it covers the peak, else the measured one applies. A number set by hand
   * is used as it is.
   */
  function headroom(dsp, fs) {
    if (!dsp) return 0;
    if (typeof dsp.headroom === "number" && Number.isFinite(dsp.headroom)) return Math.min(0, dsp.headroom);
    const bands = bandsOf(dsp);
    if (!bands.length) return 0;
    const needed = -(peakDb(bands, fs || 48000) + HEADROOM_MARGIN);
    const own = dsp.headphone && typeof dsp.headphone.preamp === "number" ? dsp.headphone.preamp : null;
    if (own != null && own <= needed) return own;
    return Math.round(needed * 10) / 10;
  }

  /* A band as stored: types and ranges checked, numbers rounded sanely.
   * Throws on anything that isn't a band. */
  function normaliseBand(b) {
    if (!b || typeof b !== "object") throw new Error("a band must be an object");
    const type = TYPES.includes(b.type) ? b.type : null;
    if (!type) throw new Error("band type must be one of " + TYPES.join(", "));
    const freq = Number(b.freq);
    if (!(freq >= 10 && freq <= 24000)) throw new Error("band frequency must be 10–24000 Hz");
    const q = Number(b.q == null ? 0.707 : b.q);
    if (!(q >= 0.1 && q <= 20)) throw new Error("band Q must be 0.1–20");
    let gain = type === "low_pass" || type === "high_pass" ? 0 : Number(b.gain == null ? 0 : b.gain);
    if (!(gain >= -20 && gain <= 20)) throw new Error("band gain must be −20–20 dB");
    return { type, freq: Math.round(freq * 10) / 10, gain: Math.round(gain * 10) / 10, q: Math.round(q * 1000) / 1000 };
  }

  /* A DSP setting as stored. Missing parts are the defaults; bad parts throw. */
  function normalise(d) {
    const cur = d && typeof d === "object" ? d : {};
    const out = { enabled: !!cur.enabled, headphone: null, peq: null, headroom: "auto" };
    if (cur.headphone && typeof cur.headphone === "object") {
      const bands = (Array.isArray(cur.headphone.bands) ? cur.headphone.bands : []).map(normaliseBand);
      if (bands.length > MAX_BANDS) throw new Error("a headphone profile has at most " + MAX_BANDS + " bands");
      out.headphone = {
        source: String(cur.headphone.source || "custom").slice(0, 20),
        id: String(cur.headphone.id || "").slice(0, 200),
        name: String(cur.headphone.name || "").slice(0, 120),
        preamp: typeof cur.headphone.preamp === "number" && Number.isFinite(cur.headphone.preamp) ? Math.min(0, Math.round(cur.headphone.preamp * 10) / 10) : null,
        bands
      };
    }
    if (cur.peq && typeof cur.peq === "object") {
      const bands = (Array.isArray(cur.peq.bands) ? cur.peq.bands : []).map(normaliseBand);
      if (bands.length > MAX_BANDS) throw new Error("the PEQ has at most " + MAX_BANDS + " bands");
      out.peq = { bands };
    }
    if (typeof cur.headroom === "number") {
      if (!(cur.headroom >= -30 && cur.headroom <= 0)) throw new Error("headroom must be 0 to −30 dB");
      out.headroom = Math.round(cur.headroom * 10) / 10;
    }
    return out;
  }

  /* Does this setting change the sound at all? */
  function active(dsp) {
    return !!(dsp && dsp.enabled && bandsOf(dsp).length);
  }

  /* A short stable name for what a setting does, for cache files: the same
   * bands and headroom give the same name; anything else a different one. */
  function fingerprint(dsp, fs) {
    const s = JSON.stringify({ b: bandsOf(dsp), h: headroom(dsp, fs) });
    // FNV-1a, 32 bits, twice over the string for 64 bits' worth of spread.
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ (c * 31 + i), 0x01000193) >>> 0;
    }
    return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
  }

  return { TYPES, MAX_BANDS, HEADROOM_MARGIN, coeffs, sectionDb, response, sweep, peakDb, bandsOf, headroom, normaliseBand, normalise, active, fingerprint };
});
