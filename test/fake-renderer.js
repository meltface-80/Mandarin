"use strict";
/*
 * fake-renderer.js — a UPnP/DLNA media renderer on loopback: its description,
 * ConnectionManager.GetProtocolInfo, a plain AVTransport and RenderingControl,
 * and — when asked for — the LinkPlay HTTP API a WiiM answers beside UPnP.
 *
 * Like the fake Sonos rooms, on Play it FETCHES the track it was given, the
 * way a device does, and records what came back: that is what proves a file
 * reaches a renderer bit-perfect, or converted to what the device takes. A
 * track "plays" in real time for as long as its DIDL says it lasts, then the
 * next URI (SetNextAVTransportURI) starts by itself — or, told not to honour
 * one, the renderer simply stops, as a device without that action would.
 */
const http = require("http");
const XML = require("../lib/xml");
const DIDL = require("../lib/sonos/didl");

function envelope(action, service, args) {
  const body = Object.entries(args || {}).map(([k, v]) => `<${k}>${XML.escape(v)}</${k}>`).join("");
  return `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>` +
    `<u:${action}Response xmlns:u="${service}">${body}</u:${action}Response></s:Body></s:Envelope>`;
}
function fault(code) {
  return `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault>` +
    `<faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail>` +
    `<UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>${code}</errorCode></UPnPError>` +
    `</detail></s:Fault></s:Body></s:Envelope>`;
}

const SINK_WIIM = "http-get:*:audio/flac:*,http-get:*:audio/x-flac:*,http-get:*:audio/wav:*,http-get:*:audio/x-wav:*," +
  "http-get:*:audio/mp4:*,http-get:*:audio/mpeg:*,http-get:*:audio/aac:*,http-get:*:audio/ogg:*," +
  "http-get:*:audio/L16;rate=44100;channels=2:DLNA.ORG_PN=LPCM,http-get:*:audio/L16;rate=48000;channels=2:DLNA.ORG_PN=LPCM";

const AVT = "urn:schemas-upnp-org:service:AVTransport:1";
const RC = "urn:schemas-upnp-org:service:RenderingControl:1";
const CM = "urn:schemas-upnp-org:service:ConnectionManager:1";

class FakeRenderer {
  constructor({ name, manufacturer = "Acme", model = "Streamer", modelNumber = "1", udn, sink = SINK_WIIM,
                linkplay = null, nested = false, urlBase = false, noAvTransport = false, setNext = true } = {}) {
    Object.assign(this, { name, manufacturer, model, modelNumber, sink, linkplay, nested, urlBase, noAvTransport, setNext });
    this.udn = udn || ("uuid:" + require("crypto").randomUUID());
    this.requests = [];
    this.log = [];              // AVTransport / RenderingControl actions, in order
    this.fetches = [];          // what the device pulled when told to play
    this.port = 0;
    // transport
    this.state = "NO_MEDIA_PRESENT";
    this.uri = ""; this.meta = "";
    this.nextUri = ""; this.nextMeta = "";
    this.position = 0; this.at = Date.now();
    this.volume = 25; this.muted = false;
    this.endTimer = null;
    this.subscribers = [];      // GENA: [{ sid, callback }]
    this.notified = 0;
  }

  /* NOTIFY every subscriber that the transport changed (LastChange). */
  notify() {
    const lc = XML.escape(`<Event xmlns="urn:schemas-upnp-org:metadata-1-0/AVT/"><InstanceID val="0"><TransportState val="${this.state}"/><CurrentTrackURI val="${XML.escape(this.uri)}"/></InstanceID></Event>`);
    const body = `<?xml version="1.0"?><e:propertyset xmlns:e="urn:schemas-upnp-org:event-1-0"><e:property><LastChange>${lc}</LastChange></e:property></e:propertyset>`;
    for (const s of this.subscribers) {
      const u = new URL(s.callback);
      const req = http.request({ hostname: u.hostname, port: u.port || 80, path: u.pathname, method: "NOTIFY",
        headers: { "Content-Type": 'text/xml; charset="utf-8"', NT: "upnp:event", NTS: "upnp:propchange", SID: s.sid, SEQ: String(this.notified) } }, (res) => { res.resume(); });
      req.on("error", () => {});
      req.end(body);
      this.notified++;
    }
  }

  get location() { return `http://127.0.0.1:${this.port}/description.xml`; }

  // ------------------------------------------------------------ description

  service(name) {
    return `<service><serviceType>urn:schemas-upnp-org:service:${name}:1</serviceType><serviceId>urn:upnp-org:serviceId:${name}</serviceId>` +
      `<SCPDURL>/upnp/${name}.xml</SCPDURL><controlURL>${this.urlBase ? "" : "/"}upnp/control/${name}1</controlURL><eventSubURL>/upnp/event/${name}1</eventSubURL></service>`;
  }

  description() {
    const services = [this.noAvTransport ? "" : this.service("AVTransport"), this.service("RenderingControl"), this.service("ConnectionManager")].join("");
    const renderer = `<device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>` +
      `<friendlyName>${XML.escape(this.name)}</friendlyName><manufacturer>${XML.escape(this.manufacturer)}</manufacturer>` +
      `<modelName>${XML.escape(this.model)}</modelName><modelNumber>${XML.escape(this.modelNumber)}</modelNumber>` +
      `<UDN>${this.udn}</UDN><serviceList>${services}</serviceList></device>`;
    const device = this.nested
      ? `<device><deviceType>urn:schemas-upnp-org:device:Basic:1</deviceType><friendlyName>${XML.escape(this.name)} (root)</friendlyName>` +
        `<manufacturer>${XML.escape(this.manufacturer)}</manufacturer><modelName>TV</modelName><UDN>uuid:root-${this.udn.slice(5)}</UDN>` +
        `<deviceList>${renderer}</deviceList></device>`
      : renderer;
    return `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><specVersion><major>1</major><minor>0</minor></specVersion>` +
      (this.urlBase ? `<URLBase>http://127.0.0.1:${this.port}/</URLBase>` : "") + device + `</root>`;
  }

  // ------------------------------------------------------------ transport

  pos() { return this.state === "PLAYING" ? this.position + (Date.now() - this.at) / 1000 : this.position; }
  setPos(s) { this.position = s; this.at = Date.now(); }
  duration() {
    const it = DIDL.parseItems(this.meta || "")[0] || {};
    return it.duration || 3;
  }

  fetchCurrent() {
    if (!this.uri) return;
    const entry = { uri: this.uri, status: 0, type: "", bytes: 0, chunks: [], done: false };
    this.fetches.push(entry);
    const req = http.get(this.uri, (res) => {
      entry.status = res.statusCode;
      entry.type = res.headers["content-type"] || "";
      entry.length = res.headers["content-length"] || null;
      res.on("data", c => { entry.bytes += c.length; if (entry.bytes < 4 * 1024 * 1024) entry.chunks.push(c); });
      res.on("end", () => { entry.done = true; entry.body = Buffer.concat(entry.chunks); delete entry.chunks; });
    });
    req.on("error", (e) => { entry.error = e.message; entry.done = true; });
  }

  // Playing in real time: when the track's length is up, the next URI (if
  // one was set) starts by itself, else the device stops.
  armEnd() {
    if (this.endTimer) clearTimeout(this.endTimer);
    const left = Math.max(0, this.duration() - this.pos());
    this.endTimer = setTimeout(() => {
      this.endTimer = null;
      if (this.state !== "PLAYING") return;
      if (this.nextUri) {
        this.log.push("auto-next");
        this.uri = this.nextUri; this.meta = this.nextMeta;
        this.nextUri = ""; this.nextMeta = "";
        this.setPos(0);
        this.fetchCurrent();
        this.armEnd();
        this.notify();
      } else {
        this.log.push("ended");
        this.state = "STOPPED";
        this.setPos(0);
        this.notify();
      }
    }, left * 1000 + 20);
    this.endTimer.unref();
  }

  handle(action, a) {
    this.log.push(action);
    switch (action) {
      case "GetProtocolInfo": return { Source: "", Sink: this.sink };
      case "GetTransportInfo": return { CurrentTransportState: this.state, CurrentTransportStatus: "OK", CurrentSpeed: "1" };
      case "GetPositionInfo": return {
        Track: this.uri ? "1" : "0", TrackDuration: DIDL.hms(this.uri ? this.duration() : 0), TrackMetaData: this.meta, TrackURI: this.uri,
        RelTime: DIDL.hms(this.pos()), AbsTime: "NOT_IMPLEMENTED", RelCount: "2147483647", AbsCount: "2147483647"
      };
      case "GetMediaInfo": return { NrTracks: this.uri ? "1" : "0", MediaDuration: DIDL.hms(this.duration()), CurrentURI: this.uri, CurrentURIMetaData: this.meta, NextURI: this.nextUri, NextURIMetaData: this.nextMeta, PlayMedium: "NETWORK", RecordMedium: "NOT_IMPLEMENTED", WriteStatus: "NOT_IMPLEMENTED" };
      case "SetAVTransportURI":
        if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; }
        this.uri = a.CurrentURI; this.meta = a.CurrentURIMetaData || "";
        this.nextUri = ""; this.nextMeta = "";
        this.state = this.uri ? "STOPPED" : "NO_MEDIA_PRESENT";
        this.setPos(0);
        return {};
      case "SetNextAVTransportURI":
        if (!this.setNext) throw 401;
        this.nextUri = a.NextURI || ""; this.nextMeta = a.NextURIMetaData || "";
        return {};
      case "Play":
        if (!this.uri) throw 701;
        if (this.state !== "PLAYING") { this.setPos(this.state === "PAUSED_PLAYBACK" ? this.position : 0); this.state = "PLAYING"; this.fetchCurrent(); this.armEnd(); }
        return {};
      case "Pause":
        if (this.state === "PLAYING") { this.position = this.pos(); this.at = Date.now(); this.state = "PAUSED_PLAYBACK"; if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; } }
        return {};
      case "Stop":
        this.state = this.uri ? "STOPPED" : "NO_MEDIA_PRESENT"; this.setPos(0);
        if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; }
        return {};
      case "Seek":
        if (a.Unit !== "REL_TIME") throw 710;
        this.setPos(DIDL.toSeconds(a.Target));
        if (this.state === "PLAYING") this.armEnd();
        return {};
      case "GetVolume": return { CurrentVolume: String(this.volume) };
      case "SetVolume": this.volume = Number(a.DesiredVolume); return {};
      case "GetMute": return { CurrentMute: this.muted ? "1" : "0" };
      case "SetMute": this.muted = a.DesiredMute === "1" || a.DesiredMute === "true"; return {};
      default: throw 401;
    }
  }

  // ------------------------------------------------------------ http

  start() {
    this.server = http.createServer((req, res) => {
      const u = new URL(req.url, "http://x");
      this.requests.push({ method: req.method, path: u.pathname, query: u.search, soap: req.headers.soapaction || "" });
      if (req.method === "GET" && u.pathname === "/description.xml") {
        res.writeHead(200, { "Content-Type": "text/xml" });
        return res.end(this.description());
      }
      if (req.method === "GET" && u.pathname === "/httpapi.asp") {
        if (!this.linkplay) { res.writeHead(404); return res.end(); }
        const cmd = u.searchParams.get("command");
        res.writeHead(200, { "Content-Type": "text/html" });
        if (cmd === "getStatusEx") {
          return res.end(JSON.stringify(Object.assign({
            uuid: "FF31F09E" + this.udn.slice(-8), DeviceName: this.name, project: "WiiM_Pro_Plus",
            firmware: "4.8.612345", hardware: "Allwinner-R329", MAC: "00:11:22:33:44:55"
          }, this.linkplay)));
        }
        if (cmd === "getMetaInfo") {
          // What the decoder is really running: read from the FLAC it fetched.
          const last = [...this.fetches].reverse().find(f => f.body && f.body.length > 42);
          const info = last ? require("./fixtures").probe(last.body) : null;
          return res.end(JSON.stringify({ metaData: info
            ? { title: "", artist: "", album: "", sampleRate: String(info.rate), bitDepth: String(info.bits), bitRate: "" }
            : {} }));
        }
        return res.end("unknown command");
      }
      if (req.method === "SUBSCRIBE") {
        if (req.headers.sid) {
          const s = this.subscribers.find(x => x.sid === req.headers.sid);
          res.writeHead(s ? 200 : 412, s ? { SID: s.sid, TIMEOUT: "Second-1800" } : {}); return res.end();
        }
        const cb = (/<([^>]+)>/.exec(req.headers.callback || "") || [])[1];
        if (!cb) { res.writeHead(412); return res.end(); }
        const sid = "uuid:sub-" + (this.subscribers.length + 1) + "-" + Date.now();
        this.subscribers.push({ sid, callback: cb });
        res.writeHead(200, { SID: sid, TIMEOUT: "Second-1800" }); res.end();
        setTimeout(() => this.notify(), 50);   // the initial event, as the spec asks
        return;
      }
      if (req.method === "UNSUBSCRIBE") {
        this.subscribers = this.subscribers.filter(x => x.sid !== req.headers.sid);
        res.writeHead(200); return res.end();
      }
      if (req.method === "POST") {
        const chunks = [];
        req.on("data", c => chunks.push(c));
        req.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const doc = XML.parse(body);
          const b = doc && doc.Envelope && doc.Envelope.Body;
          const [actionTag, node] = Object.entries(b || {}).find(([k]) => !k.startsWith("@")) || [];
          const args = {};
          for (const [k, v] of Object.entries(node || {})) if (!k.startsWith("@")) args[k] = XML.text(v);
          const service = u.pathname.endsWith("ConnectionManager1") ? CM : u.pathname.endsWith("RenderingControl1") ? RC : AVT;
          res.setHeader("Content-Type", 'text/xml; charset="utf-8"');
          if ((service === AVT && this.noAvTransport) || !actionTag) { res.statusCode = 404; return res.end(); }
          try {
            const before = this.state + "|" + this.uri;
            const out = this.handle(actionTag, args);
            res.end(envelope(actionTag, service, out));
            if (this.state + "|" + this.uri !== before) this.notify();
          } catch (code) {
            res.statusCode = 500;
            res.end(fault(typeof code === "number" ? code : 501));
          }
        });
        return;
      }
      res.writeHead(404); res.end();
    });
    return new Promise((resolve, reject) => {
      this.server.on("error", reject);
      this.server.listen(0, "127.0.0.1", () => { this.port = this.server.address().port; resolve(this); });
    });
  }

  stop() {
    if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; }
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      if (this.server.closeAllConnections) this.server.closeAllConnections();
      this.server.close(() => resolve());
      this.server = null;
    });
  }
}

module.exports = { FakeRenderer, SINK_WIIM };
