"use strict";
/*
 * renderer.js — one UPnP media renderer's transport and volume, typed.
 *
 * The plain AVTransport and RenderingControl services every DLNA renderer
 * offers, at the control URLs its description gave (lib/renderers/
 * description.js) — where a Sonos player has fixed paths of its own.
 */
const SOAP = require("../sonos/soap");
const DIDL = require("../sonos/didl");

const AV_TRANSPORT = "urn:schemas-upnp-org:service:AVTransport:1";
const RENDERING_CONTROL = "urn:schemas-upnp-org:service:RenderingControl:1";

class Renderer {
  constructor({ id, name, services = {} }) {
    this.id = id;
    this.name = name || id;
    this.avtUrl = services.AVTransport || "";
    this.rcUrl = services.RenderingControl || "";
  }

  async call(url, type, action, args, timeoutMs = 8000) {
    if (!url) throw new Error(`${this.name} has no ${type.split(":")[3]} service`);
    try {
      return await SOAP.call(url, type, action, args, timeoutMs);
    } catch (e) {
      const err = new Error(`${this.name}: ${String(e.message || e).replace(/^Sonos player at \S+ is not responding: /, "")}`);
      err.code = e.code;
      throw err;
    }
  }

  avt(action, args = {}) { return this.call(this.avtUrl, AV_TRANSPORT, action, Object.assign({ InstanceID: 0 }, args)); }
  rc(action, args = {}) { return this.call(this.rcUrl, RENDERING_CONTROL, action, Object.assign({ InstanceID: 0, Channel: "Master" }, args)); }

  // -- transport --
  play() { return this.avt("Play", { Speed: 1 }); }
  pause() { return this.avt("Pause"); }
  stop() { return this.avt("Stop"); }
  seekTime(seconds) { return this.avt("Seek", { Unit: "REL_TIME", Target: DIDL.hms(seconds) }); }
  setUri(uri, meta = "") { return this.avt("SetAVTransportURI", { CurrentURI: uri, CurrentURIMetaData: meta }); }
  setNextUri(uri, meta = "") { return this.avt("SetNextAVTransportURI", { NextURI: uri, NextURIMetaData: meta }); }
  getTransportInfo() { return this.avt("GetTransportInfo"); }
  getPositionInfo() { return this.avt("GetPositionInfo"); }
  getMediaInfo() { return this.avt("GetMediaInfo"); }

  // -- volume --
  async getVolume() {
    const r = await this.rc("GetVolume");
    return Number(r.CurrentVolume) || 0;
  }
  setVolume(v) { return this.rc("SetVolume", { DesiredVolume: Math.max(0, Math.min(100, Math.round(v))) }); }
  async getMute() {
    const r = await this.rc("GetMute");
    return r.CurrentMute === "1" || r.CurrentMute === "true";
  }
  setMute(m) { return this.rc("SetMute", { DesiredMute: m ? 1 : 0 }); }
}

module.exports = { Renderer, AV_TRANSPORT, RENDERING_CONTROL };
