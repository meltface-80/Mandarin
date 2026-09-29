"use strict";
/*
 * gena.js — UPnP eventing (GENA): a renderer tells the server when its
 * transport changes, instead of being asked every second.
 *
 * SUBSCRIBE to a service's event URL with a callback address here; the
 * device answers with a subscription id (SID) and a lifetime, and from then
 * on POSTs a NOTIFY to the callback whenever its state variables change —
 * for AVTransport a LastChange document naming TransportState, the current
 * URI and so on. Renewed before it runs out; UNSUBSCRIBEd on the way out.
 * Position is not evented, so a playing renderer is still read now and then;
 * events make every change show at once and let the reading slow right down.
 */
const http = require("http");
const XML = require("../xml");

const TIMEOUT_S = 1800;

function request(url, method, headers, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error("bad event url " + url)); }
    const req = http.request({ hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method, headers, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end();
  });
}

function seconds(v) {
  const m = /Second-(\d+)/i.exec(String(v || ""));
  return m ? Number(m[1]) : TIMEOUT_S;
}

/* → { sid, expires } */
async function subscribe(eventUrl, callbackUrl) {
  const r = await request(eventUrl, "SUBSCRIBE", { CALLBACK: `<${callbackUrl}>`, NT: "upnp:event", TIMEOUT: `Second-${TIMEOUT_S}` });
  if (r.status !== 200 || !r.headers.sid) throw new Error(`SUBSCRIBE answered ${r.status}`);
  return { sid: r.headers.sid, expires: Date.now() + seconds(r.headers.timeout) * 1000 };
}

async function renew(eventUrl, sid) {
  const r = await request(eventUrl, "SUBSCRIBE", { SID: sid, TIMEOUT: `Second-${TIMEOUT_S}` });
  if (r.status !== 200) throw new Error(`renew answered ${r.status}`);
  return { sid: r.headers.sid || sid, expires: Date.now() + seconds(r.headers.timeout) * 1000 };
}

function unsubscribe(eventUrl, sid) {
  return request(eventUrl, "UNSUBSCRIBE", { SID: sid }, 3000).catch(() => null);
}

/*
 * A NOTIFY body → the changed variables, flat. AVTransport and
 * RenderingControl wrap theirs in a LastChange document (an escaped XML
 * string inside the propertyset); plain variables come as they are.
 */
function parseNotify(body) {
  const out = {};
  const doc = XML.parse(body);
  const ps = doc && doc.propertyset;
  if (!ps) return out;
  for (const prop of XML.list(ps.property)) {
    for (const [k, v] of Object.entries(prop || {})) {
      if (k.startsWith("@")) continue;
      if (k === "LastChange") {
        const lc = XML.parse(XML.text(v));
        const ev = lc && lc.Event;
        for (const inst of XML.list(ev && ev.InstanceID)) {
          for (const [name, node] of Object.entries(inst || {})) {
            if (name.startsWith("@")) continue;
            const first = XML.list(node)[0];
            if (first && typeof first === "object" && first["@val"] != null) out[name] = String(first["@val"]);
          }
        }
      } else out[k] = XML.text(v);
    }
  }
  return out;
}

module.exports = { subscribe, renew, unsubscribe, parseNotify, TIMEOUT_S };
