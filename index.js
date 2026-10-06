"use strict";
/*
 * MusicD Server — your own music files, played to Sonos.
 *
 *   browser / PWA / Android app ──HTTP──▶  this server  ──Sonos UPnP──▶  rooms
 *                                              │                           │
 *                                              └──── /stream/t<id>.flac ◀──┘
 *
 * The interface is MusicD Remote's. Underneath, instead of a Roon Core, there
 * is a library scanned from your music folder and the Sonos control from the
 * Caldera / UPnP-to-Sonos bridges. Sonos fetches each track from this server:
 * as stored when it is within 24-bit/48 kHz, resampled to 24/48 FLAC when it
 * is above that.
 */
const path = require("path");
const fs = require("fs");
const express = require("express");
const compression = require("compression");

const pkg = require("./package.json");
const { createAuth } = require("./lib/server/auth");
const DB = require("./lib/library/db");
const { Scanner } = require("./lib/library/scanner");
const { LibraryWatcher } = require("./lib/library/watch");
const { Library } = require("./lib/library/index");
const { ReleaseDays } = require("./lib/library/dates");
const { TailscaleNode } = require("./lib/server/tsnode");
const { Artwork } = require("./lib/library/artwork");
const { ZoneManager } = require("./lib/sonos/zones");
const { localIp } = require("./lib/sonos/topology");
const STREAM = require("./lib/stream");
const SERVICES = require("./lib/services");
const DSP = require("./lib/dsp");
const FF = require("./lib/ffmpeg");
const shareLinks = require("./lib/share-links");
const { Playback, trackIdFromUri, planFor } = require("./lib/server/playback");
const { Features } = require("./lib/server/features");

const list = v => String(v || "").split(",").map(s => s.trim()).filter(Boolean);

const config = {
  port: Number(process.env.PORT) || 3500,
  musicDir: process.env.MUSIC_DIR || "/music",
  dataDir: process.env.DATA_DIR || path.join(__dirname, "data"),
  serverIp: process.env.SERVER_IP || process.env.BRIDGE_IP || "",
  sonosHosts: list(process.env.SONOS_HOSTS),
  // UPnP/DLNA renderers (WiiM, Chord Poly…): IPs or description URLs to ask
  // when multicast discovery misses them; multicast can be turned off for tests.
  upnpHosts: list(process.env.UPNP_HOSTS),
  upnpMulticast: process.env.UPNP_DISCOVERY !== "0",
  include: list(process.env.INCLUDE_ZONES),
  exclude: list(process.env.EXCLUDE_ZONES),
  scanHours: Number(process.env.SCAN_INTERVAL_HOURS) || 6,
  transcodeCacheGb: Number(process.env.TRANSCODE_CACHE_GB) || 4,
  // Tailscale built into the server (lib/server/tsnode.js): the engine in the image.
  tailscaleBin: process.env.MUSICDNET_BIN || "/usr/local/bin/musicdnet",
  // Album identification (lib/identify): where MusicBrainz is (a fake in the
  // tests) and how often the scan looks for the next album.
  mbBaseUrl: process.env.MUSICBRAINZ_URL || "",
  itunesBaseUrl: process.env.ITUNES_URL || "",
  // Where the MusicBrainz pack is downloaded from (a fake in the tests).
  mbpackUrl: process.env.MBPACK_URL || "",
  // The folder the pack is kept in, instead of the data folder (or Settings' choice).
  mbpackDir: process.env.MBPACK_DIR || "",
  // Headphone profiles (lib/autoeq.js): where AutoEq's results are (a fake in the tests).
  autoeqBaseUrl: process.env.AUTOEQ_URL || "",
  // Record label logos (lib/labellogos.js): where Discogs and FanArt.tv are (fakes in the tests).
  discogsBaseUrl: process.env.DISCOGS_URL || "",
  fanartBaseUrl: process.env.FANART_URL || "",
  identifyTickMs: Number(process.env.IDENTIFY_TICK_MS) || 5000,
  loudnessTickMs: Number(process.env.LOUDNESS_TICK_MS) || 5000,
  identify: process.env.IDENTIFY !== "0",
  debug: !!process.env.DEBUG
};

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function createServer(overrides = {}) {
  Object.assign(config, overrides);
  // A database restored from a backup (Settings → Backup & restore) goes in now, before it opens.
  require("./lib/backup").swapStaged(config.dataDir, log);
  const db = DB.open(config.dataDir, { log });
  const library = new Library(db, { musicRoot: config.musicDir, log });
  // Where the music is: the folders chosen in Settings → Music folders, or —
  // until any are — the one the server was started with (MUSIC_DIR).
  const musicFolders = () => {
    const v = db.setting("music_folders", null);
    return Array.isArray(v) && v.length ? v : [config.musicDir];
  };
  const scanner = new Scanner({ db, root: config.musicDir, roots: musicFolders, log });
  const artwork = new Artwork({ library, cacheDir: path.join(config.dataDir, "art"), log });
  const transcoder = new STREAM.Transcoder({
    cacheDir: path.join(config.dataDir, "transcode"),
    maxBytes: config.transcodeCacheGb * 1024 ** 3,
    log
  });
  const advertisedIp = () => config.serverIp || localIp();
  // The speakers found last time are asked first, so after a restart or an
  // update the rooms are back in a second or two instead of after discovery.
  const knownHosts = (db.setting("sonosKnownHosts", []) || []).filter(h => !config.sonosHosts.includes(h));
  const zones = new ZoneManager({
    seedHosts: config.sonosHosts.concat(knownHosts), bindIp: config.serverIp || localIp(),
    include: config.include, exclude: config.exclude, log, trackIdFromUri
  });
  // The phones' and renderers' queues, kept across a restart (an update ends in one).
  zones.store = new (require("./lib/sonos/queue-store").QueueStore)(db, { log });
  zones.topology.onHosts = (ips) => {
    const next = [...new Set(ips)].sort();
    if (JSON.stringify(next) !== JSON.stringify(db.setting("sonosKnownHosts", []))) db.setSetting("sonosKnownHosts", next);
  };

  const ctx = {
    config, db, library, scanner, artwork, transcoder, zones, log, version: pkg.version,
    baseUrl: () => `http://${advertisedIp()}:${config.port}`,
    shareServices: () => {
      const v = db.setting("shareServices", null);
      return v === null ? shareLinks.defaultServiceIds() : shareLinks.sanitiseIds(v, shareLinks.knownServiceIds());
    },
    shareReviews: () => {
      const v = db.setting("shareReviews", null);
      return v === null ? shareLinks.defaultReviewIds() : shareLinks.sanitiseIds(v, shareLinks.knownReviewIds());
    },
    afterScan: () => {
      library.reload();
      // Days for albums whose tags stop at the year (the Release date sort).
      ctx.releaseDays.run().catch(() => {});
      artwork.prewarm(400).catch(() => {});
      features.kickSmartPicks();
    }
  };
  ctx.releaseDays = new ReleaseDays({ db, library, log });
  // The streaming services (lib/services): Qobuz (v0.6.23) and Tidal
  // (v0.6.24) — the account, its albums as library rows, the stream behind
  // /stream for a streamed track, Qobuz's play reports. Tests bring fakes.
  const afterChange = () => { library.reload(); artwork.prewarm(100).catch(() => {}); };
  ctx.qobuz = new (require("./lib/qobuz").Qobuz)({ db, library, dataDir: config.dataDir, log, baseUrl: config.qobuzBaseUrl || undefined, afterChange });
  ctx.tidal = new (require("./lib/tidal").Tidal)({ db, library, dataDir: config.dataDir, log, baseUrl: config.tidalBaseUrl || undefined,
    authUrl: config.tidalAuthUrl || undefined, imagesUrl: config.tidalImagesUrl || undefined, localBase: () => "http://127.0.0.1:" + config.port, afterChange });
  ctx.services = { qobuz: ctx.qobuz, tidal: ctx.tidal, of: p => { const id = SERVICES.ofPath(p); return id ? ctx.services[id] : null; } };
  // The transcoder asks the service where a streamed track's audio is, when
  // a device comes to fetch one (or the next is made ready behind it).
  transcoder.resolve = {
    wants: t => SERVICES.isStreamed(t.path),
    get: async (t, p) => {
      const r = await ctx.services.of(t.path).resolve(t, p);
      // FLAC at the rate and depth wanted, nothing else to do: copied as it
      // comes. Below what was planned (a track listed as hi-res that the
      // account gets at CD), copied too, at what it is — never upsampled —
      // unless a renderer was promised a rate (p.hq) or DSP or gain is in it.
      const flac = /flac/.test(String(r.mime || "audio/flac"));
      const same = r.rate === p.rate && r.bits === p.bits;
      const below = !p.hq && r.rate <= p.rate && r.bits <= p.bits;
      const copy = !p.dsp && !p.gain && flac && (same || below);
      return { src: r.src, plan: copy ? Object.assign({}, p, { copy: true, rate: r.rate, bits: r.bits }) : p };
    }
  };
  // The MusicBrainz pack (v0.6.4): releases with a barcode kept on this
  // machine, asked before musicbrainz.org when downloaded.
  const MBPACK = require("./lib/identify/mbpack");
  ctx.mbpack = new MBPACK.PackStore({ dataDir: config.dataDir, dir: config.mbpackDir || undefined, db, url: config.mbpackUrl || undefined, log });
  // The scan that finds each album's right names on MusicBrainz (Settings →
  // Setup → Identify albums).
  ctx.identifier = new (require("./lib/identify/identifier").Identifier)({
    db, library, scanner, log, tickMs: config.identifyTickMs,
    mb: MBPACK.withPack(new (require("./lib/identify/musicbrainz").MusicBrainz)({ baseUrl: config.mbBaseUrl || undefined, log }), () => ctx.mbpack.get()),
    pack: () => ctx.mbpack.get(),
    itunes: new (require("./lib/identify/itunes").ITunes)({ baseUrl: config.itunesBaseUrl || undefined, log })
  });
  // AutoEq's headphone profiles, kept in the database once chosen.
  ctx.autoeq = new (require("./lib/autoeq").AutoEq)({ db, baseUrl: config.autoeqBaseUrl || undefined, log });
  // Record label logos (Settings → Record labels), from Discogs and FanArt.tv.
  ctx.labelLogos = new (require("./lib/labellogos").LabelLogos)({
    db, dataDir: config.dataDir, log,
    mb: new (require("./lib/identify/musicbrainz").MusicBrainz)({ baseUrl: config.mbBaseUrl || undefined, log }),
    discogsBaseUrl: config.discogsBaseUrl || undefined, fanartBaseUrl: config.fanartBaseUrl || undefined,
    pauseMs: config.logoPauseMs
  });
  // Labels for the albums whose files carry none, from MusicBrainz then Discogs.
  ctx.labelLookup = new (require("./lib/labellookup").LabelLookup)({
    db, library, log, mb: ctx.labelLogos.mb, discogsBaseUrl: config.discogsBaseUrl || undefined, pauseMs: config.logoPauseMs
  });
  // Every player as one list — Sonos rooms, phones, UPnP renderers — with the
  // names you give them (Settings → Audio Devices).
  ctx.devices = new (require("./lib/renderers/devices").AudioDevices)({
    db, zones, bindIp: config.serverIp || localIp(), seedHosts: config.upnpHosts,
    multicast: config.upnpMulticast, offlineMs: config.upnpOfflineMs, log, local: config.localAudio
  });
  // The renderers as zones, beside the Sonos rooms and the phones.
  zones.upnp = new (require("./lib/renderers/players").UpnpPlayers)(zones, ctx.devices, { transcoder, log });
  zones.upnp.callbackBase = () => ctx.baseUrl();
  zones.upnp.localBase = () => "http://127.0.0.1:" + config.port;
  ctx.tailscale = new TailscaleNode({ bin: config.tailscaleBin, dir: path.join(config.dataDir, "tailscale"), port: config.port, db, log, version: pkg.version, watchdog: config.tailscaleWatchdog || {} });
  // Albums made ready for the Android app to keep (Original or Opus 256).
  ctx.downloads = new (require("./lib/server/downloads").Downloads)({
    cacheDir: path.join(config.dataDir, "download-cache"),
    maxBytes: config.transcodeCacheGb * 1024 ** 3, log
  });
  // One account and its signed-in devices; everything below sits behind it.
  const auth = ctx.auth = createAuth(ctx);
  // ReplayGain (v0.6.0-RC5): which gain each track gets, and the background
  // loudness measuring for files without ReplayGain tags.
  ctx.loudness = new (require("./lib/loudness").Loudness)({ db, log, tickMs: config.loudnessTickMs });
  ctx.playback = new Playback(ctx);
  // A queue moving between players is rebuilt for the player it goes to.
  zones.rebuildItems = (ids, zoneId) => ctx.playback.itemsFor(zoneId, ids.map(id => library.track(id)).filter(Boolean));
  const features = ctx.features = new Features(ctx);

  const app = express();
  app.disable("x-powered-by");
  // A renderer's NOTIFY (UPnP eventing, lib/renderers/gena.js): the device
  // saying its transport changed. Before the gate — a device can't sign in —
  // and before the JSON parser: it is XML, and only ever wakes a read.
  app.use("/upnp/event", (req, res, next) => {
    if (req.method !== "NOTIFY") return next();
    const chunks = [];
    req.on("data", c => { if (chunks.length < 64) chunks.push(c); });
    req.on("end", () => {
      const id = decodeURIComponent(req.path.replace(/^\//, "").split("/")[0] || "");
      try { zones.upnp.onNotify(id, require("./lib/renderers/gena").parseNotify(Buffer.concat(chunks).toString("utf8"))); } catch (e) { /* a malformed event is ignored */ }
      res.statusCode = 200; res.end();
    });
  });
  // A Tidal hi-res stream (lib/tidal): MPEG-DASH pieces fed to ffmpeg as one
  // stream, from this machine only, under a key the resolve just made.
  app.get("/internal/dash/:key", async (req, res) => {
    const from = String(req.socket.remoteAddress || "");
    if (!/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(from)) return res.status(403).end();
    const d = ctx.tidal.dashPieces(req.params.key);
    if (!d) return res.status(404).end();
    res.set("Content-Type", d.mime || "audio/mp4");
    res.set("Cache-Control", "no-store");
    const { pipeline } = require("stream/promises");
    const { Readable } = require("stream");
    try {
      for (const url of [d.init].concat(d.segments)) {
        if (res.destroyed) return;
        const r = await ctx.tidal.fetch(url, { signal: AbortSignal.timeout(60000) });
        if (!r.ok) throw new Error("segment HTTP " + r.status);
        await pipeline(Readable.fromWeb(r.body), res, { end: false });
      }
      res.end();
    } catch (e) {
      log(`[tidal] dash: ${e.message}`);
      if (!res.headersSent) res.status(502); res.end();
    }
  });
  app.use(express.json({ limit: "2mb" }));
  app.use(auth.gate);
  auth.mount(app);

  // ---------------------------------------------------------------- stream
  // Before compression: audio must go out byte for byte, with ranges.
  app.get(/^\/stream\/t(\d+)(?:\.(orig|\d+-\d+))?\.([a-z0-9]+)$/i, (req, res) => {
    const t = library.track(Number(req.params[0]));
    if (!t) return res.status(404).end();
    // ?q=opus: the phone away from home, on mobile data — Opus 256 kbps, the
    // same files the Downloads screen makes, with the album's next tracks
    // made ready behind it so each one starts promptly.
    // A streamed track away from home: the cached FLAC, not an Opus file made of it.
    if (req.query.q === "opus" && !SERVICES.isStreamed(t.path)) return streamOpus(t, req, res);
    // A renderer's URL says what it wants (lib/server/playback.js): the file
    // as stored, or a conversion to exactly this rate and depth. A Sonos URL
    // says nothing and gets the 24/48 rule, as ever.
    const seg = req.params[1] || "";
    let p;
    if (seg === "orig") {
      p = { transcode: false, mime: STREAM.mimeForExt(req.params[2]) };
      // A renderer's own word for DSD (v0.6.0-RC3), from a short list only.
      if (/^audio\/(x-)?(dsf|dff|dsd)$/.test(String(req.query.m || "")) && /^(dsf|dff)$/i.test(req.params[2])) p.mime = String(req.query.m);
    }
    else if (seg) {
      const [rate, bits] = seg.split("-").map(Number);
      if (!(rate >= 8000 && rate <= 768000) || ![16, 24, 32].includes(bits) || (bits === 32 && !FF.info().flac32)) return res.status(400).end();
      p = { transcode: true, hq: true, mime: "audio/flac", ext: "flac", rate, bits, reason: "what the renderer was promised" };
      // ?o=<output>: with that zone's DSP, as it is set now (lib/dsp.js).
      if (req.query.o && ctx.devices) {
        const part = DSP.planPart(ctx.devices.dspFor(String(req.query.o)), rate);
        if (part) { p.dsp = part; p.inRate = Number(t.sample_rate) || 0; }
      }
    } else p = planFor(t);
    // A streamed track (lib/services): always from the transcode cache,
    // fetched from the service when the device asks — as it comes, or
    // converted like a file.
    const svc = ctx.services.of(t.path);
    if (svc && !p.transcode) p = { transcode: true, mime: "audio/flac", ext: "flac", rate: Number(t.sample_rate) || 44100, bits: Number(t.bits) || 16, reason: "from " + svc.name + ", as it comes" };
    // ?g=<dB>: with this ReplayGain in it (lib/loudness.js).
    if (req.query.g != null) {
      const g = Number(req.query.g);
      if (!Number.isFinite(g) || g < -24 || g > 12) return res.status(400).end();
      p = STREAM.withGain(p, { path: t.path, codec: t.codec, sampleRate: t.sample_rate, bitsPerSample: t.bits, channels: t.channels }, null, g);
      if (seg && seg !== "orig") p.hq = true;
    }
    if (!p.transcode) {
      res.set("Content-Type", p.mime);
      res.set("Cache-Control", "no-store");
      return res.sendFile(t.path, { dotfiles: "allow", acceptRanges: true }, (err) => {
        if (err && !res.headersSent) res.status(err.statusCode || 404).end();
      });
    }
    // A streamed track fetched by a device is a play (reported, on Qobuz) —
    // and nothing of a service plays without the account, cached or not.
    if (svc && !svc.connected()) return res.status(403).end();
    if (svc && req.method === "GET") svc.played(t, p);
    const job = transcoder.start(Object.assign({}, t, svc ? { mtime: svc.tier() } : {}), p);
    if (job.done && !job.failed) {
      res.set("Content-Type", p.mime);
      res.set("Cache-Control", "no-store");
      return res.sendFile(job.final, (err) => { if (err && !res.headersSent) res.status(404).end(); });
    }
    if (job.done && job.failed) return res.status(500).end();
    STREAM.tailFollow(req, res, job, p.mime);
  });

  function streamOpus(t, req, res) {
    ctx.downloads.file(Object.assign({}, t), "opus").then(f => {
      res.set("Content-Type", f.mime);
      res.set("Cache-Control", "no-store");
      res.sendFile(f.path, { dotfiles: "allow", acceptRanges: true, headers: { "Content-Type": f.mime } }, (err) => {
        if (err && !res.headersSent) res.status(err.statusCode || 404).end();
      });
    }).catch(e => {
      log("[stream] opus", t.id, e.message);
      if (!res.headersSent) res.status(500).end();
    });
    const rest = library.tracks(t.album_id);
    const i = rest.findIndex(x => x.id === t.id);
    for (const n of rest.slice(i + 1, i + 3)) ctx.downloads.file(Object.assign({}, n), "opus").catch(() => {});
  }

  app.use(compression());
  app.use((req, res, next) => {
    if (!config.debug || !req.path.startsWith("/api/") || /zone-state|image\//.test(req.path)) return next();
    const t0 = Date.now();
    res.on("finish", () => log("[http]", req.method, req.originalUrl, "->", res.statusCode, (Date.now() - t0) + "ms"));
    next();
  });

  require("./lib/server/api-library")(app, ctx);
  require("./lib/server/api-playback")(app, ctx);
  require("./lib/server/api-playlists")(app, ctx);
  require("./lib/server/api-phone")(app, ctx);
  require("./lib/server/api-devices")(app, ctx);
  require("./lib/server/api-identify")(app, ctx);
  require("./lib/server/api-loudness")(app, ctx);
  require("./lib/server/api-dsp")(app, ctx);
  require("./lib/server/api-tailscale")(app, ctx);
  for (const id of SERVICES.IDS) require("./lib/server/api-service")(app, ctx, id);
  // Restart and Shut down (Settings → Restart & shut down). Tests hand in their own exit.
  // Restart: a clean stop, then 75 for launcher.js to start it again (a restore uses it).
  ctx.restartServer = () => Promise.resolve().then(() => stop()).catch(e => log(`[musicd] stopping: ${e.message}`))
    .finally(() => (config.exitProcess || (c => process.exit(c)))(75));
  require("./lib/server/api-backup")(app, ctx);
  require("./lib/server/api-power")(app, ctx, {
    stop: () => stop(),
    exit: config.exitProcess,
    env: config.powerEnv,
    platform: config.powerPlatform,
    spawn: config.powerSpawn
  });
  require("./lib/server/downloads").mount(app, ctx);

  app.get("/api/health", (req, res) => res.json({
    ok: true, version: pkg.version, albums: library.count, rooms: zones.topology.rooms().length,
    ffmpeg: FF.info().ok, soxr: FF.info().soxr, transcode_cache: transcoder.cacheStats()
  }));
  app.use("/api", (req, res) => res.status(404).json({ error: `No such endpoint: ${req.method} ${req.path}` }));

  const pub = path.join(__dirname, "public");
  app.get(["/display", "/display/"], (req, res) => res.sendFile(path.join(pub, "display.html")));
  app.get("/login", (req, res) => res.sendFile(path.join(pub, "login.html")));
  // The interface. The Android app keeps the page clear of the system bars
  // itself, so it gets the page without viewport-fit=cover: otherwise newer
  // WebViews report the bars as safe-area insets too and the page leaves the
  // same space twice (a gap over the top buttons, the mini player riding high).
  function sendApp(req, res) {
    const file = path.join(pub, "index.html");
    res.set("Vary", "User-Agent");
    if (!/MusicDAndroid\//.test(req.headers["user-agent"] || "")) return res.sendFile(file);
    fs.readFile(file, "utf8", (err, html) => {
      if (err) return res.status(500).end();
      res.set("Cache-Control", "no-cache");
      res.type("html").send(html.replace(/,\s*viewport-fit=cover/, ""));
    });
  }
  app.get(["/", "/index.html"], sendApp);
  // And the stylesheet with every safe-area allowance at zero, for the same
  // reason — whatever the WebView reports, the app has already made the room.
  app.get("/style.css", (req, res, next) => {
    if (!/MusicDAndroid\//.test(req.headers["user-agent"] || "")) return next();
    fs.readFile(path.join(pub, "style.css"), "utf8", (err, css) => {
      if (err) return next();
      res.set("Cache-Control", "no-cache");
      res.set("Vary", "User-Agent");
      // Plus the app's own few rules (public/android.css): its downloads, drawing, keyboard.
      let extra = "";
      try { extra = "\n" + fs.readFileSync(path.join(pub, "android.css"), "utf8"); } catch (e) { /* none */ }
      res.type("css").send(css.replace(/env\(safe-area-inset-(top|bottom|left|right)\)/g, "0px") + extra);
    });
  });
  app.use(express.static(pub, {
    maxAge: "1h",
    index: false,
    setHeaders(res, file) { if (/\.(html|js|css|json)$/.test(file)) res.setHeader("Cache-Control", "no-cache"); }
  }));
  // Anything else is the single-page app, so a deep link still opens it.
  app.get("*", sendApp);

  async function start() {
    library.reload();
    // What was queued on the phones and the renderers when the server last
    // ran: back before anything asks, so an update's restart loses nothing.
    const kept = zones.restoreQueues();
    if (kept) log(`[musicd] put back the queue of ${kept} player(s) from before the restart`);
    const ff = FF.info();
    log(`[musicd] Mandarin ${pkg.version} — music in ${config.musicDir}, data in ${config.dataDir}`);
    const parent = path.dirname(config.musicDir), base = path.basename(config.musicDir);
    let strays = [];
    try { strays = fs.readdirSync(parent).filter(n => n !== base && n.startsWith(base) && fs.statSync(path.join(parent, n)).isDirectory()); } catch (e) {}
    if (strays.length) {
      log(`[musicd] WARNING: ${strays.map(n => path.join(parent, n)).join(", ")} will not be scanned — mount each music folder inside ${config.musicDir}, e.g. -v /path/to/Music:${path.join(config.musicDir, "name")}:ro`);
    }
    log(ff.ok ? `[musicd] ${ff.version}${ff.soxr ? " (soxr resampler)" : ""}` : "[musicd] WARNING: ffmpeg not found — hi-res files cannot be converted for Sonos");
    await new Promise((resolve, reject) => {
      // The Android app's page reaches the server through the app's relay, which
      // it treats as a web proxy: the request line carries the whole address
      // ("GET http://host:3500/api/…"). Made the usual path before Express sees
      // it, so every route, redirect and log sees what a direct request would.
      const srv = require("http").createServer((req, res) => {
        if (/^https?:\/\//i.test(req.url)) {
          try { const u = new URL(req.url); req.url = u.pathname + u.search; } catch (e) { /* left as it is */ }
        }
        app(req, res);
      }).listen(config.port, "0.0.0.0", resolve);
      srv.on("error", reject);
      ctx.httpServer = srv;
    });
    log(`[musicd] listening on ${ctx.baseUrl()} — open it in a browser`);
    zones.start();
    ctx.devices.start();
    if (config.identify) ctx.identifier.start();
    ctx.mbpack.start();
    ctx.loudness.start();
    features.wire();
    // On your tailnet by itself, once signed in (Settings → Away from home).
    ctx.tailscale.start().catch(e => log("[tailscale] " + e.message));
    // Albums found by a scan appear (and play) as it goes, not only at the end.
    scanner.onProgress = () => library.reload();
    const scan = () => scanner.scan().then(r => { if (r.status !== "running") ctx.afterScan(); })
      .catch(e => log("[scan] " + e.message)).then(() => ctx.watcher.refresh());
    ctx.scanTimers = [setTimeout(scan, 500), setInterval(scan, config.scanHours * 3600 * 1000)];
    ctx.scanTimers[1].unref();
    // The music folders watched (lib/library/watch.js): a change on disk is
    // read within a minute, without waiting for the timer.
    ctx.watcher = new LibraryWatcher({ roots: () => scanner.roots(), onChange: scan, log });
    ctx.watcher.refresh();
    // The streaming services: your favourites (and purchases) brought up to
    // date soon after the start and every six hours, while signed in with
    // the import on; albums only ever played from the browser let go after
    // a month.
    const serviceSync = () => {
      for (const id of SERVICES.IDS) {
        const s = ctx.services[id];
        if (!s.connected() || !s.settings().import) continue;
        s.importLibrary().catch(e => log(`[${id}] import: ${e.message}`));
      }
    };
    // And the favourites watched between imports (v0.7.3): every two minutes
    // the ids the account wants are compared with what is kept, so an album
    // favourited or removed in the service's own app follows here unasked.
    const serviceWatch = () => {
      for (const id of SERVICES.IDS) {
        const s = ctx.services[id];
        if (!s.connected() || !s.settings().import) continue;
        s.watch().catch(e => log(`[${id}] watch: ${e.message}`));
      }
    };
    for (const t of [setTimeout(serviceSync, config.qobuzSyncDelayMs == null ? 20000 : config.qobuzSyncDelayMs),
      setInterval(serviceSync, 6 * 3600e3), setInterval(serviceWatch, config.serviceWatchMs || 120000),
      setInterval(() => { for (const id of SERVICES.IDS) { try { ctx.services[id].pruneTransient(); } catch (e) { /* next day */ } } }, 24 * 3600e3)]) {
      t.unref(); ctx.scanTimers.push(t);
    }
    return ctx;
  }

  async function stop() {
    for (const id of SERVICES.IDS) await ctx.services[id].stop().catch(() => {});
    zones.stop();
    ctx.devices.stop();
    ctx.identifier.stop();
    ctx.mbpack.stop();
    ctx.loudness.stop();
    ctx.releaseDays.stop();
    ctx.tailscale.stop();
    for (const t of ctx.scanTimers || []) clearTimeout(t);
    if (ctx.watcher) ctx.watcher.stop();
    scanner.onProgress = null;
    if (ctx.httpServer) {
      const closed = new Promise(r => ctx.httpServer.close(r));
      // Kept-alive connections too, or a client (or the next server on this
      // port, after an in-app update) talks to a socket that's going away.
      if (ctx.httpServer.closeAllConnections) ctx.httpServer.closeAllConnections();
      await closed;
    }
    db.close();
  }

  return { app, ctx, start, stop };
}

module.exports = { createServer, config };

if (require.main === module) {
  const s = createServer();
  s.start().catch(e => { console.error(e); process.exit(1); });
  const bye = () => { s.stop().finally(() => process.exit(0)); };
  process.on("SIGTERM", bye);
  process.on("SIGINT", bye);
}
