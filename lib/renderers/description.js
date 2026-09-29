"use strict";
/*
 * description.js — what a UPnP device says about itself.
 *
 * The LOCATION an SSDP answer points at is an XML document: the device's
 * name (friendlyName, which is what its own app calls it), maker and model,
 * its UDN (the id that survives an address change), and the services it
 * offers with the URLs to drive them. Some devices nest the renderer inside a
 * root device (a TV, a receiver with several personalities), so the whole tree
 * is searched for the MediaRenderer.
 */
const XML = require("../xml");
const SOAP = require("../sonos/soap");

const RENDERER_RE = /device:MediaRenderer:/i;
const OPENHOME_RE = /av-openhome-org/i;

function shortType(serviceType) {
  // urn:schemas-upnp-org:service:AVTransport:1 → AVTransport
  const m = /:service:([^:]+):/i.exec(String(serviceType || ""));
  return m ? m[1] : "";
}

function resolve(rel, base) {
  if (!rel) return "";
  try { return new URL(rel, base).toString(); } catch (e) { return ""; }
}

function findRenderer(device) {
  if (!device || typeof device !== "object") return null;
  if (RENDERER_RE.test(XML.text(device.deviceType))) return device;
  const kids = device.deviceList ? XML.list(device.deviceList.device) : [];
  for (const k of kids) { const r = findRenderer(k); if (r) return r; }
  return null;
}

/* Pure: the XML text and where it came from → a device record, or null. */
function parseDescription(xml, location) {
  const doc = XML.parse(xml);
  const root = doc && doc.root;
  if (!root) return null;
  const base = XML.text(root.URLBase) || location;
  const dev = findRenderer(root.device) || root.device;
  if (!dev || typeof dev !== "object") return null;
  const services = {};
  let openhome = false;
  for (const s of XML.list(dev.serviceList && dev.serviceList.service)) {
    const type = XML.text(s.serviceType);
    const name = shortType(type);
    if (!name) continue;
    if (OPENHOME_RE.test(type)) openhome = true;
    services[name] = {
      type,
      controlUrl: resolve(XML.text(s.controlURL), base),
      eventSubUrl: resolve(XML.text(s.eventSubURL), base),
      scpdUrl: resolve(XML.text(s.SCPDURL), base)
    };
  }
  const udn = XML.text(dev.UDN).trim();
  return {
    udn,
    deviceType: XML.text(dev.deviceType),
    friendlyName: XML.text(dev.friendlyName).trim(),
    manufacturer: XML.text(dev.manufacturer).trim(),
    modelName: XML.text(dev.modelName).trim(),
    modelNumber: XML.text(dev.modelNumber).trim(),
    modelDescription: XML.text(dev.modelDescription).trim(),
    serialNumber: XML.text(dev.serialNumber).trim(),
    presentationUrl: resolve(XML.text(dev.presentationURL), base),
    services,
    openhome,
    renderer: RENDERER_RE.test(XML.text(dev.deviceType)),
    // LinkPlay firmware (WiiM, Arylic, Audio Pro…) names itself in the
    // description one way or another; the probe confirms it.
    linkplayHint: /linkplay|wiim/i.test(String(xml).slice(0, 8000))
  };
}

async function fetchDescription(location, timeoutMs = 5000) {
  const xml = await SOAP.httpGet(location, timeoutMs);
  const d = parseDescription(xml, location);
  if (!d) throw new Error("not a UPnP device description");
  return d;
}

module.exports = { parseDescription, fetchDescription, shortType };
