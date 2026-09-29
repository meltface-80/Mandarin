# Audio Devices: UPnP/DLNA renderers, capabilities and upsampling

**Status: proposed — nothing here is built yet.** This is the written plan for playing to
UPnP/DLNA renderers (a WiiM Pro Plus first, then a Chord Poly + Mojo 2) beside the Sonos rooms
and the phones Mandarin already plays to, with an Audio Devices page that shows every device,
what it can take, and — for the new renderers — what Mandarin should send it. Building starts
when the project owner approves it; the phases at the end say what lands in which version.

## 1. Decisions already taken

These came from the owner and are not open:

| Question | Decision |
| --- | --- |
| Default output for a new UPnP renderer | **Original** — the file as stored, bit-perfect where the device takes it |
| Upsampling options | **×2, ×4 and Max** (the highest rate the device supports, in the file's own family) |
| Processing | **64-bit floating point** end to end, dithered once at the end |
| Output depth after processing | **24-bit, or 32-bit where the device supports it** ("Auto"), with a manual 24 / 32 choice |
| Sonos | **Read-only** on the page (44.1/48 kHz, 16/24-bit) and **its code untouched**: the 24/48 rule stays exactly as it is |
| First devices | **WiiM Pro Plus** (its own "fixed output resampling" is off, so what Mandarin sends is what it plays), then **Chord Poly with Mojo 2** |
| Server | DietPi on an **i5-6500T, 4 cores** — it already upsamples for Roon without trouble, so CPU is not a design constraint |
| DSD | **Later.** The page shows a DSD row from the start, empty until then |
| Names | Each device's name is **editable and stored in the server's database**; the network name stays visible underneath |

## 2. Goals and non-goals

**Goals**

* Find every UPnP/DLNA media renderer on the network, read what it is and what it accepts,
  and keep a record of it that survives restarts (a "device register").
* Play to those renderers with everything a Sonos room or a phone has today: the queue, the
  transport, volume, history, Random album radio, transfer between zones, the share card,
  Now playing with a format badge.
* Per device, choose the output: Original, or upsampled ×2 / ×4 / Max, processed in 64-bit
  float, out at 24 or 32 bits.
* An Audio Devices page: the list, and a detail view per device with its name, its
  capabilities and its output settings.

**Non-goals (for this spec)**

* Changing anything about how Sonos is driven. `lib/sonos/soap.js`, `device.js`,
  `topology.js` and the Sonos queue logic in `zones.js` keep their behaviour; the only edits
  to `zones.js` are the same three-line "if this is one of the new zones, hand it over"
  branches that phones already have. The end-to-end Sonos test proves nothing moved.
* Roon Ready (RAAT), Bluetooth and AirPlay: never — the owner's decision. Chromecast: not
  planned; its own spec if ever.
* LinkPlay multiroom (grouping WiiMs): later, once single-device playback is solid.
* DSD output: later (section 11 says how).
* Playing to these devices from away: the away rule stays. Renderers are on the home
  network, so — like Sonos rooms — they are not offered when you are away.

## 3. Where this fits in the code today

The pieces this builds on, so the plan reads against the real thing:

* **Zones.** `lib/sonos/zones.js` — `ZoneManager` owns `state` (one entry per zone: state,
  trackUri, trackId, position, duration, title, volume…), bumps a revision on change, and
  emits `track`, `played` and `queue-low`, which history and Random album radio hang off.
  Sonos zones are polled (`pollGroup`); phones report in (`lib/sonos/phones.js`,
  `PhonePlayers`), and every public method starts with
  `if (this.phones.isPhoneId(id)) return this.phones.…`. The new renderers follow the phone
  pattern exactly: their own class, their own ids, the same `applyState` and the same hooks.
* **Discovery.** `lib/sonos/topology.js` — `msearch(bindIp, { st })` already takes a search
  target, but it only keeps answers that look like Sonos. The new discovery is its own small
  module (a copy of those thirty lines with the filter removed) rather than a change to it.
* **What a track goes out as.** `lib/stream.js` — `plan(t)` decides bit-perfect vs FLAC
  24/48 with the Sonos ceiling (`MAX_RATE`, `MAX_BITS`); `Transcoder` writes the file to a
  cache keyed `track-mtime-rate-bits`, serves the growing file, prefetches upcoming tracks.
  `lib/server/playback.js` — `Playback.item(t)` builds the signed `/stream/t<id>.<ext>` URL
  and the DIDL-Lite for it. `plan()` grows a `target` argument; called without one it does
  precisely what it does now, which is what Sonos keeps getting.
* **Names shown on screen.** `/api/zones` in `lib/server/api-playback.js` goes through
  `named(z, req)`; the device register's custom names are applied there, for every kind of
  zone, so the zone picker, the mini transport and Now playing all show the name you gave a
  device.
* **The badge.** `nowPlaying()` in `api-playback.js` sends `format: { kind, text }` and the
  page draws it (`paintNpFormat` in `public/app.js`). It grows a rate/depth text for the
  new renderers.
* **Settings pane.** The `playback` pane in `public/index.html` is already titled
  **Audio Devices** (zone picker, waveform, radio). The device list goes into it, and a
  device's detail view is a sub-pane opened from it, stepping back the way Setup's do.
* **Database.** `lib/library/db.js` — `settings`, `devices` (signed-in browsers and phones:
  a different thing, not reused) and a `KEEP` list of tables that survive a library reset.
  The register is a new table on that list.

## 4. The renderers out there

Four families, each detected differently and driven a little differently:

| Family | How you tell | How it is driven | Examples |
| --- | --- | --- | --- |
| **Sonos** | `ZonePlayer` search target, `RINCON_` ids | As today; nothing changes | all Sonos S2 rooms |
| **Plain UPnP AV / DLNA** | `urn:schemas-upnp-org:device:MediaRenderer:1` with `AVTransport`, `RenderingControl`, `ConnectionManager` services | `SetAVTransportURI` + `Play`, `SetNextAVTransportURI` for gapless, `GetTransportInfo`/`GetPositionInfo` for state, `RenderingControl` for volume | WiiM (all models), most streamers, AVRs, TVs, upmpdcli, gmrender |
| **OpenHome** | The same device also lists `urn:av-openhome-org:service:Playlist:1`, `Product`, `Volume` | It keeps its own playlist (like Sonos does); a later phase drives it through that instead of `AVTransport` | Linn, upmpdcli (with OpenHome on), Lumin, some Naim/Auralic |
| **Vendor-extended** | A plain renderer whose maker also has an HTTP API | Plain UPnP for playback; the vendor API for what it cannot say — which rate it is *really* playing, its hardware name | **LinkPlay/WiiM** (`httpapi.asp`), HEOS, MusicCast, BluOS |

A Chord Poly presents itself as a plain UPnP/DLNA renderer (Chord recommends BubbleUPnP and
8Player to drive it); it also runs an **MPD** server (the Music Player Daemon protocol on
port 6600, which MPD clients play through gaplessly), and it is Roon Ready and does AirPlay
and Bluetooth. Which of the UPnP niceties (`SetNextAVTransportURI`, OpenHome) its renderer
has is *not* documented anywhere reachable, so the Poly's profile below carries "to verify"
marks: the first build that talks to it fills them in.

## 5. Discovery

Runs beside the Sonos discovery loop, on the same timers, in a new module
`lib/renderers/discovery.js`:

1. **M-SEARCH** for `urn:schemas-upnp-org:device:MediaRenderer:1` every 60 s (and on
   demand from the page's "Look again"), MX 2, three sends, bound to the same interface as
   the Sonos search. Sonos players answer this too (they are renderers); they are recognised
   by their `RINCON_` UDN and left to the Sonos code.
2. **The device description** at each `LOCATION`: `friendlyName` (the network name),
   `manufacturer`, `modelName`, `modelNumber`, `UDN`, and the `serviceList` with each
   service's `controlURL`, `eventSubURL` and `SCPDURL`. A renderer without `AVTransport` is
   recorded but marked "can't be played to". OpenHome services are noted for the later
   phase.
3. **`ConnectionManager.GetProtocolInfo`** → the `Sink` list. It says which containers the
   device accepts (`http-get:*:audio/flac:*`, `audio/wav`, `audio/x-flac`, `audio/mp4`,
   `audio/L16;rate=48000;channels=2` …). Rates appear only in the rare `audio/L16` entries;
   it never says "up to 192 kHz". That is why capabilities are layered (section 6).
4. **LinkPlay probe.** If the manufacturer or model reads LinkPlay/WiiM (or the description
   carries LinkPlay's extension elements), `GET https://<ip>/httpapi.asp?command=getStatusEx`
   — HTTPS with the device's self-signed certificate, so verification is off for that one
   LAN call — gives the WiiM app's own device name, firmware, hardware and `uuid`. That marks
   the record `family: "wiim"`, which unlocks the verified-rate badge (section 9).
5. **Seeds.** `UPNP_HOSTS` (comma-separated IPs or description URLs) for networks where
   multicast is unreliable, the way `SONOS_HOSTS` works today. Docker users need host
   networking for SSDP, as they do for Sonos.
6. **Alive/byebye.** Listening for `ssdp:alive` / `ssdp:byebye` NOTIFYs so a device that
   comes on or goes off is noticed within seconds rather than at the next minute — an
   optimisation for a later phase; the 60 s search is enough to start.

A device not seen for two minutes is shown as **offline** (greyed in the list, not offered
in the zone picker) and comes back by itself. Nothing is deleted on its own: the record, the
name you gave it and its settings stay until you choose **Forget**.

## 6. Capabilities

What the page shows as chips — sample rates, bit depths, DSD — comes from four layers, in
rising order of trust. The page says which layer each chip came from.

| Layer | Source | What it can tell us |
| --- | --- | --- |
| **Advertised** | `GetProtocolInfo`, the device description | Containers and codecs; a rate only from `audio/L16;rate=…` entries |
| **Known model** | `lib/renderers/profiles.js`, matched on manufacturer/model | Rates, depths, DSD, whether `SetNextAVTransportURI` works, volume quirks, the vendor API |
| **You set it** | Ticks on the detail page | Anything the profile does not know — a generic renderer's hi-res rates, 32-bit on a device we never met |
| **Verified** | Something the device itself reported after playing: a WiiM's `getMetaInfo`, or a successful test play | The rate and depth it actually played, with the date it was seen |

The **effective** set — what the output settings let you pick and what the planner may
choose — is *you set* if present, otherwise *verified ∪ known model*, otherwise the safe
floor of 44.1 / 48 kHz at 16 / 24-bit that every renderer takes. Advertised MIME types decide
the container (FLAC where offered, else WAV, else the L16 raw PCM fallback), never the rate.

### Profiles

Profiles are small records, one per model (or model family), matched by regular expression
on manufacturer and model. A profile never lowers what a device advertises; it adds what
the device cannot say for itself.

**WiiM Pro Plus** (`wiim-pro-plus`)

| | |
| --- | --- |
| PCM rates | 44.1, 48, 88.2, 96, 176.4, 192 kHz — bit-perfect to 24/192 on optical and coaxial out; the AKM 4493SEQ DAC path takes the same |
| Depths | 16, 24. **32-bit: to verify** (unknown whether its decoder takes 32-bit FLAC/WAV; Auto stays at 24 until it does) |
| DSD | none (later, as DoP if it ever takes it — unlikely) |
| Gapless | `SetNextAVTransportURI` supported. Known quirks on older firmware: poor with very short tracks; Now playing metadata may lag one track behind after a gapless transition (Mandarin never relies on the renderer's metadata — section 8) |
| Volume | `RenderingControl` works; with the WiiM's line out set to *fixed* the slider is meaningless, so the profile lets you mark the volume "fixed by the device" and the slider goes away |
| Vendor API | LinkPlay `httpapi.asp`: `getStatusEx` (identity), `getPlayerStatus`, `getMetaInfo` → `metaData.sampleRate` / `bitDepth` (the verification source) |
| Applies to | WiiM Mini, Pro, Pro Plus, Amp, Ultra with model-specific ceilings (Mini: 24/192 optical; Ultra: adds 32-bit? to verify) |

**Chord Poly + Mojo 2** (`chord-poly`)

| | |
| --- | --- |
| PCM rates | 44.1, 48, 88.2, 96, 176.4, 192, 352.8, 384, 705.6, 768 kHz (Poly's published list; it feeds Mojo 2 which takes them all) |
| Depths | 16, 24, 32 (Mojo 2 accepts 32-bit PCM; **whether Poly's DLNA renderer passes 32-bit through: to verify**) |
| DSD | DSD64–DSD256 as DoP (later) |
| Gapless | **To verify.** If its renderer lacks `SetNextAVTransportURI`, the fallback is the MPD path: Poly's MPD server on port 6600 plays URLs gaplessly by design. Mandarin would speak MPD's small text protocol (`add`, `play`, `status`, `currentsong`, `idle`) — a second transport for the same zone, chosen by the profile |
| Volume | Fixed: Mojo 2's own buttons. No slider |
| OpenHome | To verify from the device description |
| Notes | Poly has a hotspot mode and a Wi-Fi mode; only Wi-Fi mode is on the LAN. Its network name is set in Chord's Gofigure app |

**Generic renderer** (`generic`)

44.1 / 48 kHz at 16 / 24-bit, FLAC if advertised else WAV; gapless assumed off until
`SetNextAVTransportURI` is seen in its `AVTransport` SCPD (the action list is read, and the
first successful call marks it verified). Everything above the floor is yours to tick, with
a warning that a rate the device cannot take will stop with a transport error — which
Mandarin catches and reports on the device page ("192 kHz failed on 2 Oct — unticked").

## 7. The device register

A new table in `lib/library/db.js`, on the `KEEP` list:

```sql
CREATE TABLE IF NOT EXISTS audio_devices (
  id            TEXT PRIMARY KEY,        -- 'RINCON_…' (Sonos), 'UPNP_<udn>' (renderers), 'PHONE_<deviceId>'
  kind          TEXT NOT NULL,           -- 'sonos' | 'upnp' | 'phone'
  family        TEXT NOT NULL DEFAULT '',-- 'wiim' | 'openhome' | 'mpd' | 'generic' | ''
  network_name  TEXT NOT NULL,           -- friendlyName / Sonos room name / the phone's name
  name          TEXT,                    -- what you called it; NULL = use network_name
  manufacturer  TEXT, model TEXT, model_number TEXT, firmware TEXT,
  ip            TEXT, location TEXT,     -- last address and description URL
  caps          TEXT NOT NULL DEFAULT '{}',  -- JSON, section 6: { advertised, profile, user, verified }
  settings      TEXT NOT NULL DEFAULT '{}',  -- JSON, section 10: { mode, bits, volume, hidden }
  first_seen    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL,
  forgotten     INTEGER NOT NULL DEFAULT 0
);
```

* Sonos rooms and phones get a row too, so the page is one list and a name is a name
  everywhere. For them the row is a label overlay: the Sonos app keeps its own room name,
  the phone app its own, and nothing is written back to either.
* `caps.verified` is a map of what was seen and when:
  `{ "rates": { "176400": "2026-10-02T19:14:03Z" }, "bits": { "24": "…" } }`.
* **Forget** sets `forgotten` (the row is dropped once the device has been gone a day). A
  forgotten device that turns up again starts fresh with defaults.
* The ids are the zone ids. `UPNP_` + the UDN without its `uuid:` prefix, so
  `isUpnpId()` is a prefix test like `isPhoneId()`.

**API**

| | |
| --- | --- |
| `GET /api/audio-devices` | The list: id, kind, family, names, model, online, playing, `caps` summary |
| `GET /api/audio-devices/:id` | The full record plus live state (what it is playing now, verified now?) |
| `PATCH /api/audio-devices/:id` | `{ name?, settings?, caps: { user? } }`; `name: ""` returns to the network name. Sonos rows accept only `name` and `hidden` |
| `POST /api/audio-devices/:id/forget` | As above |
| `POST /api/audio-devices/rescan` | An M-SEARCH now; answers within three seconds |
| `POST /api/audio-devices/:id/test` | *(later)* play a short test file at a chosen rate and report whether it played |

Changes bump the zone revision, so open pages update through `/api/zone-state` as they do
for everything else.

## 8. Playing to a UPnP renderer

`lib/renderers/players.js` — `UpnpPlayers`, the `PhonePlayers` pattern with a network
device on the other end:

* **The queue lives on the server**, as it does for phones (a plain renderer has no queue
  of its own). Items are the same `{ uri, meta, track, plan }` the Sonos code builds.
* **Starting:** `SetAVTransportURI(uri, didl)` then `Play`. **Gapless:** as soon as a track
  starts, `SetNextAVTransportURI` with the following item. When the renderer reports it has
  moved on, the next `SetNext` goes out. Queue edits re-issue `SetNext` with the new
  follower; a renderer that ignores the change and starts the stale one is corrected at
  once (`Stop`, `SetAVTransportURI` the right track, `Play`) — the one gap you may hear is
  right after editing the queue on a device that keeps a stale buffer, which is a known
  DLNA limitation.
* **`SetNext` only names a finished file.** The transcode cache is prefetched in play
  order; the next track is handed over once its file is complete, so the renderer always
  sees a real length and byte ranges for it. The *first* track of Play now is served from
  the growing file, the way Sonos is (the WiiM is expected to cope; a device that will not
  gets a profile flag that makes Play now wait for the file, which for a four-minute track
  at ×4 is a few seconds on the i5).
* **State** is polled like Sonos: `GetTransportInfo` + `GetPositionInfo` every second while
  someone is looking, every few seconds otherwise, through the same `applyState`, so
  `track`, `played` and `queue-low` fire as they do today and history and Random album radio
  need no changes. GENA event subscriptions (`SUBSCRIBE` to `AVTransport`'s `eventSubURL`,
  with a callback on the server's own port) come in a later phase as an improvement, not a
  requirement.
* **Which track is playing** is read from the URI the renderer reports, never from its
  metadata: our stream URLs carry the track id, so the title, artist and cover are always
  Mandarin's own. That sidesteps the WiiM's stale-metadata-after-gapless quirk entirely.
* **Volume and mute** through `RenderingControl` (`GetVolume`/`SetVolume`/`SetMute`,
  channel `Master`) unless the device is marked fixed (Poly) or you marked it fixed (a WiiM on
  fixed line out); then the output carries no `volume` object, which is the shape Roon uses
  for fixed-volume outputs and what the interface was written for.
* **Grouping** is refused, as it is for phones. **Transfer** to and from any zone works
  through the server-side queue, as for phones.
* **DIDL-Lite** for renderers: the same builder, with `res` attributes a DLNA renderer
  likes to see — `sampleFrequency`, `bitsPerSample`, `nrAudioChannels`, `duration` — added
  only when given, so what Sonos receives stays byte for byte what it receives now.
* **Errors** (`TransportStatus = ERROR_OCCURRED`, a `Play` that faults, a device that
  fetches the stream and stops within a second) are surfaced on the device page against the
  rate that was being sent, and the zone shows "The WiiM stopped: 192 kHz may be too much
  for it".

## 9. What goes out: Original and upsampling

`plan(t, target)` in `lib/stream.js`, where `target` is derived from the device's effective
capabilities and its settings. With no target it is the Sonos rule, untouched.

**Rate families.** 44.1 kHz and its multiples (88.2, 176.4, 352.8, 705.6) are one family;
48 kHz and its multiples (96, 192, 384, 768) the other. Mandarin never crosses families:
a CD-rate file goes up by whole powers of two, which is what Roon does and what keeps the
conversion clean. The **ladder** for a file is the device's effective rates in the file's
family, ascending.

| Mode | Output rate |
| --- | --- |
| **Original** (default) | The file's own rate if it is on the ladder → bit-perfect. If the file is *above* the ladder (a 352.8 kHz file on a WiiM) → the highest rung below it. DSD → 24-bit at the top of the 44.1 ladder up to 176.4 kHz, until native DSD lands |
| **Upsample ×2** | The file's rate × 2, capped at the top of the ladder; if that lands off the ladder, the rung below. A file already at the top stays Original |
| **Upsample ×4** | The same with × 4 (a 16/44.1 CD rip → 176.4 kHz on a WiiM; a 96 kHz file → 192 on a WiiM, 384 on a Poly) |
| **Max** | The top of the ladder for the file's family, whatever the file's rate (44.1 → 176.4 on a WiiM, 705.6 on a Poly; 48 → 192 / 768) |

A lossy file (MP3, AAC, Opus) decodes to its own rate and follows the same rules — Roon
does the same; there is nothing to gain from special-casing it.

**Depth.** Anything processed goes out at **24-bit**, or **32-bit** when the device's
effective depths include 32 and the setting is Auto (or you chose 32). A bit-perfect pass
keeps the file's own depth. 16-bit is never produced after processing.

**Container.** FLAC where the device advertises it, as today. 32-bit FLAC needs an encoder
that writes it (FLAC 1.4 does; whether the Docker image's ffmpeg FLAC encoder does is
probed once at start and reported in `/api/health` as `flac32`); where it cannot, 32-bit
goes as WAV. Devices that advertise neither get raw `audio/L16` (16-bit only — such a
device is capped at 16-bit and the page says so).

**The pipeline.** One ffmpeg process per conversion, as now, with the resampling step
changed for the new targets:

```
ffmpeg -i <file> -map 0:a:0 -vn
  -af aresample=resampler=soxr:precision=33:internal_sample_fmt=dbl:osr=<rate>:dither_method=triangular
  -ar <rate> -ac 2 -sample_fmt s32 -bits_per_raw_sample <24|32>
  -c:a flac -compression_level 5 -f flac <cache file>
```

* `internal_sample_fmt=dbl` makes libswresample carry the audio as 64-bit float, and
  `precision=33` puts SoX's resampler in its 32-bit-quality, double-precision mode — so the
  whole chain from decoder to the final requantise is 64-bit float, as decided.
* Dither: triangular at 24-bit; none at 32-bit (there is nothing left to hide).
* The Sonos rule keeps its current `precision=28` line; the existing e2e test guards it.
* The Docker image's ffmpeg is built with libsoxr (`FF.info().soxr` already checks). A
  build without it falls back to swresample's own filter, as today, and `/api/health` says so.

**Cost.** On the i5-6500T, soxr at this quality converts a 44.1 → 176.4 kHz stereo track at
well over ten times real time per core (measured numbers go into the v0.5.2 notes); ×16 to
705.6/768 kHz for the Poly is a few times more. Two conversions run at once
(`TRANSCODE_CONCURRENCY`), prefetched in play order, so the queue stays ahead of the
renderer. The cache (`TRANSCODE_CACHE_GB`, 4 GB) holds fewer upsampled tracks — a 24/176.4
FLAC is roughly four times a CD-rate FLAC — so the README will suggest 16 GB when upsampling
is on. Cache keys already carry rate and depth; they gain the container, so two devices
with the same target share one file.

## 10. The Audio Devices page

Settings → **Audio Devices** keeps what it has (zone picker, waveform, Random album radio)
and gains the device list under it, in the same row style as the rest of Settings.

**The list.** One row per device: an icon for its kind (a Sonos speaker, a streamer, a
phone), the name — yours if you set one, else the network name — with the network name
and model underneath in the small capitals (*WiiM Pro Plus · Living room*), and a state
word on the right: **Playing**, **Idle**, **Offline**. Offline rows are dimmed. A **Look
again** button runs discovery now. Order: playing first, then online, then offline, each
alphabetically.

**The detail view** (a sub-pane, Back returns to the list):

1. **Name** — a text field, the network name shown beneath it with *Use network name* to
   reset. Saves on blur, applied everywhere at once.
2. **About** — model, manufacturer, firmware, IP, how it was found, first and last seen.
3. **Capabilities** — three rows of chips:
   * *Sample rates:* 44.1 · 48 · 88.2 · 96 · 176.4 · 192 · 352.8 · 384 · 705.6 · 768
   * *Bit depth:* 16 · 24 · 32
   * *DSD:* 64 · 128 · 256 — greyed with "later" until DSD lands
   A chip is filled when the device takes it, outlined when not, and carries a small mark
   for its source: ✓ verified (with the date on tap), ◆ known model, ✎ you set it. On a
   UPnP renderer, a tap toggles a chip (that is the "you set" layer); on Sonos and phones
   the chips are display only.
4. **Output** (UPnP renderers only) —
   * *Mode:* Original · Upsample ×2 · Upsample ×4 · Max — a segmented control, Original
     selected by default.
   * *Bit depth:* Auto · 24 · 32 — the 32 option appears only when 32 is in the effective
     depths.
   * A one-line preview under it that reads back the rule: *"A 16-bit/44.1 kHz file will
     play as 24-bit/176.4 kHz FLAC."*
   * *Volume:* Mandarin controls it · Fixed by the device.
5. **Now** — while it plays: *Playing 24-bit/176.4 kHz FLAC — confirmed by the WiiM* (or
   *as sent* on a device that cannot confirm).
6. **Hide from the zone picker** (a switch) and **Forget this device** (offline devices
   only; asks first).

**Sonos rooms** show 1, 2, 3 (44.1 · 48 filled; 16 · 24 filled; DSD greyed) with the note
*Sonos plays up to 24-bit/48 kHz. Mandarin's 24/48 rule applies; nothing to set here.*
**Phones** show 1, 2 and a note about Original at home and Opus 256 away.

**The Now playing badge** for a UPnP zone becomes the target itself — *FLAC 24/176.4* with
a ↑×4 marker when upsampled and a ✓ when the device confirmed it — instead of the plain
*Lossless*. Sonos and phones keep their badges as they are.

## 11. Verification, and DSD later

**WiiM.** After a track starts, `getMetaInfo` is asked once (and again after any
`SetNext` transition): `metaData.sampleRate` and `bitDepth` are what its decoder is
actually running. Matching the target marks the rate and depth verified (chips get their ✓,
the badge its ✓); a mismatch is logged, shown on the device page, and — if the device
downshifted (say it played 96 when sent 192) — that rate is unticked with a note.

**Others.** A later *Test this rate* button plays a two-second file at the chosen rate and
depth and watches `TransportState`: PLAYING for the length of the file → verified; ERROR or
an immediate STOPPED → unticked with the reason.

**DSD, when it comes.** Two routes, chosen by capability: native DSF/DFF where the device
advertises `audio/x-dsf` / `audio/dsd` (Poly likely — to verify), else DoP packed into
24-bit PCM at 176.4 kHz (DSD64) / 352.8 (DSD128) / 705.6 (DSD256) inside FLAC or WAV for
devices whose DACs decode DoP (Mojo 2 does). The chips and the plan() target already have
the DSD slots; only the encoder work is missing.

## 12. Phases

Each phase is a version and a testable step; the owner tests between them.

**v0.5.0 — Devices seen.** Discovery, the register, profiles, the Audio Devices list and
detail (name, about, capabilities with ticks), Sonos and phones listed with their read-only
chips, names applied across the interface. No playback to the new devices yet.
*Done when:* the WiiM Pro Plus and the Poly appear with the right model and chips, renames
stick across a restart and show in the zone picker, `npm test` includes the new discovery
and register tests, the Sonos e2e test is unchanged and green.

**v0.5.1 — Plays.** The UPnP zone family: queue, transport, seek, volume, transfer,
history, Random album radio, gapless via `SetNext`; Original mode with the device ceiling;
the target segment in stream URLs; the fake renderer test.
*Done when:* an album plays gapless on the WiiM from the app and the PWA with every control
working; a 24/192 file plays bit-perfect on it; a 352.8 kHz file plays as 24/176.4; the
Poly plays (via UPnP or, if it must, MPD) and its findings are written into its profile.

**v0.5.2 — Upsampling.** ×2 / ×4 / Max, the 64-bit float pipeline, 24/32 with the
`flac32` probe, the cache keys, the Now playing badge, WiiM verification via `getMetaInfo`
and the ✓ marks.
*Done when:* a CD rip at ×4 shows *24/176.4 ✓ confirmed by the WiiM*; the i5's conversion
times are logged and written into the README; the cache advice is in the README.

**v0.5.3 — The rest of the network.** OpenHome detection (and the Playlist-service
transport if a device needs it), GENA events, alive/byebye, *Test this rate*, quirk flags
(wait-for-complete-file, fixed volume, no-SetNext), hide/forget polish, `UPNP_HOSTS`.

**Later.** DSD (section 11); LinkPlay multiroom. Never: Roon Ready, Bluetooth, AirPlay.

## 13. Tests

* **`test/fake-renderer.js`** — a fake DLNA renderer on loopback beside the fake Sonos
  household: a device description, `AVTransport` (`SetAVTransportURI`, `SetNext…`, `Play`,
  `Pause`, `Stop`, `Seek`, `GetTransportInfo`, `GetPositionInfo`, `GetMediaInfo`),
  `RenderingControl`, `ConnectionManager.GetProtocolInfo`, and a fake LinkPlay `httpapi.asp`
  whose `getMetaInfo` reports the rate and depth read from the STREAMINFO block of the FLAC
  it fetched — so verification is tested end to end, not mocked.
* **Unit:** `plan(t, target)` tables for every mode × source rate × ladder; family
  preservation; depth rules; container choice; `GetProtocolInfo` parsing; profile matching;
  the register (rename, reset, forget, the overlay for Sonos rows); discovery parsing of a
  captured WiiM description; the URL target segment round trip.
* **End to end:** play a 16/44.1 album to the fake WiiM at ×4 → it fetched FLAC 24/176.4,
  `SetNext` was issued before the first track ended, the second track started without a
  `SetAVTransportURI`, the badge says 24/176.4 ✓. Then the existing Sonos e2e run,
  untouched, still bit-perfect and 24/48.
* **On the owner's network:** the WiiM Pro Plus with its fixed resampling off, the Poly +
  Mojo 2, checked against the WiiM app's own "now playing" line and Mojo 2's sample-rate
  colour.

## 14. Open questions for the owner

Answers change details, not the plan. Defaults in bold are what gets built if unanswered.

1. Renaming Sonos rooms and phones in Mandarin — **allowed, as a label only** — or should
   their names stay read-only like their chips?
2. Lossy files under an upsample mode — **upsampled like everything else** — or left as
   they are?
3. 32-bit output — **only where a device is verified or profiled for it; Auto picks it
   then** — or 24-bit always unless you choose 32 by hand?
4. The Poly — **try UPnP first, fall back to MPD if `SetNext` is missing** — or MPD from the
   start, since it is gapless by design?
5. A Mandarin-controlled volume on the WiiM when its line out is fixed — **hidden once you
   mark it fixed** — or leave the slider and let it do nothing?

## 15. Sources

* WiiM Pro Plus: [specifications](https://wiimhome.com/WiiMPro/specs),
  [user manual](https://www.wiimhome.com/pdf/WiiM%20Pro%20Plus%20User%20Manual.pdf),
  [Hi-Fi News lab report](https://www.hifinews.com/content/wiim-pro-plus-lab-report)
  (bit-perfect to 24/192 on optical/coaxial).
* WiiM/LinkPlay HTTP API: [HTTP API for WiiM Products
  (PDF)](https://www.wiimhome.com/pdf/HTTP%20API%20for%20WiiM%20Products.pdf),
  [WiiM HTTP API list (forum)](https://forum.wiimhome.com/threads/wiim-http-api-list.9985/),
  [cvdlinden/wiim-httpapi](https://github.com/cvdlinden/wiim-httpapi),
  [n4archive/LinkPlayAPI](https://github.com/n4archive/LinkPlayAPI/blob/master/api.md),
  [companion-module-wiim-http](https://github.com/houtacheng/companion-module-wiim-http)
  (`getStatusEx`, `getPlayerStatus`, `getMetaInfo` → `sampleRate`, `bitDepth`).
* WiiM gapless over DLNA: [Metadata don't refresh in gapless
  mode](https://forum.wiimhome.com/threads/metadata-dont-refresh-when-dlna-is-used-in-gapless-playback-mode.847/),
  [BubbleUPnP on SetNextAVTransportURI](https://groups.google.com/g/bubbleupnp/c/tv0k3x5XSyQ),
  [UPnPBridge for LMS](https://forums.lyrion.org/forum/user-forums/3rd-party-software/100256-announce-upnpbridge-integrate-upnp-dlna-players-with-lms-squeeze2upnp/page279),
  [feishin DLNA casting](https://github.com/jeffvli/feishin/pull/1887) (no reliable way to
  clear a renderer's next-URI buffer).
* Chord Poly / Mojo 2: [Chord Poly product
  page](https://chordelectronics.co.uk/product/chord-electronics-poly),
  [Poly for Mojo 2 (HeadAmp)](https://www.headamp.com/products/chord-poly),
  [Poly V3 (Bloom Audio)](https://bloomaudio.com/products/chord-electronics-poly-v3),
  [Darko: Going home and away with the Chord
  Poly](https://darko.audio/2018/03/going-home-and-away-with-the-chord-poly/) (UPnP and
  MPD), [Roon community: DLNA apps for the
  Poly](https://community.roonlabs.com/t/what-dlna-app-do-you-use-with-the-chord-poly/91109),
  [Head-Fi Poly thread](https://www.head-fi.org/threads/chord-electronics-%E2%98%86-poly-%E2%98%86-wireless-microsd-module-for-mojo-%E2%98%86%E2%98%85%E2%96%BAuseful-info-on-1st-page-%E2%97%84%E2%98%85%E2%98%86.831347/).
* UPnP/OpenHome renderers: [upmpdcli](https://www.lesbonscomptes.com/upmpdcli/index.html)
  (UPnP gapless and the OpenHome services on top of MPD),
  [Gentoo wiki: upmpdcli](https://wiki.gentoo.org/wiki/Upmpdcli).
* Home Assistant's [DLNA Digital Media Renderer](https://www.home-assistant.io/integrations/dlna_dmr/)
  (async_upnp_client) and [WiiM](https://www.home-assistant.io/integrations/wiim/)
  integrations, as prior art for discovery and the vendor API beside UPnP.
