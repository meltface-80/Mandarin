"use strict";
/*
 * fake-renderer.js — a UPnP/DLNA media renderer on loopback: its description,
 * ConnectionManager.GetProtocolInfo, and — when asked for — the LinkPlay HTTP
 * API a WiiM answers beside UPnP. Transport (playing to it) comes with the
 * version that plays to renderers; here it faults, as a device with no such
 * action would.
 */
const http = require("http");
const XML = require("../lib/xml");

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

class FakeRenderer {
  constructor({ name, manufacturer = "Acme", model = "Streamer", modelNumber = "1", udn, sink = SINK_WIIM,
                linkplay = null, nested = false, urlBase = false, noAvTransport = false } = {}) {
    Object.assign(this, { name, manufacturer, model, modelNumber, sink, linkplay, nested, urlBase, noAvTransport });
    this.udn = udn || ("uuid:" + require("crypto").randomUUID());
    this.requests = [];
    this.port = 0;
  }

  get location() { return `http://127.0.0.1:${this.port}/description.xml`; }

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
        if (cmd === "getStatusEx") {
          res.writeHead(200, { "Content-Type": "text/html" });
          return res.end(JSON.stringify(Object.assign({
            uuid: "FF31F09E" + this.udn.slice(-8), DeviceName: this.name, project: "WiiM_Pro_Plus",
            firmware: "4.8.612345", hardware: "Allwinner-R329", MAC: "00:11:22:33:44:55"
          }, this.linkplay)));
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end("unknown command");
      }
      if (req.method === "POST") {
        const chunks = [];
        req.on("data", c => chunks.push(c));
        req.on("end", () => {
          const action = (/#(\w+)"?$/.exec(req.headers.soapaction || "") || [])[1] || "";
          res.setHeader("Content-Type", 'text/xml; charset="utf-8"');
          if (u.pathname.endsWith("/ConnectionManager1") && action === "GetProtocolInfo") {
            return res.end(envelope("GetProtocolInfo", "urn:schemas-upnp-org:service:ConnectionManager:1", { Source: "", Sink: this.sink }));
          }
          res.statusCode = 500;
          res.end(fault(401));
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
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      if (this.server.closeAllConnections) this.server.closeAllConnections();
      this.server.close(() => resolve());
      this.server = null;
    });
  }
}

module.exports = { FakeRenderer, SINK_WIIM };
