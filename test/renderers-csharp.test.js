"use strict";
/*
 * v0.8.37's ports of the UPnP renderers' logic (stage 2a, server/Mandarin.
 * Server/Renderers/) decide what the Node server's decide: a device's
 * description read (lib/renderers/description.js, with lib/xml.js's parse and
 * the URLs resolved as `new URL` resolves them), GetProtocolInfo's Sink
 * (protocolinfo.js), a GENA NOTIFY and its TIMEOUT header (gena.js), and the
 * capability profiles and their chips (profiles.js) — each asked of both, the
 * C# server through `mandarin-server score`, over the samples the other tests
 * use (test/fake-renderer.js, test/fake-sonos.js, test/audio-devices.test.js,
 * test/local-output.test.js), hand-picked real-world and sloppy documents, and
 * generated cases, seeded; deepStrictEqual and the same JSON, key order and
 * all. Nothing that runs uses the C# ports yet (playback, stage 6, will).
 * Skipped where the C# server isn't built.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawnSync } = require("child_process");
const XML = require("../lib/xml");
const { parseDescription, shortType } = require("../lib/renderers/description");
const { parseSink, containerOf } = require("../lib/renderers/protocolinfo");
const G = require("../lib/renderers/gena");
const PR = require("../lib/renderers/profiles");
const { FakeRenderer, SINK_WIIM } = require("./fake-renderer");

const BIN = process.env.MANDARIN_SERVER_BIN || path.join(__dirname, "..", "server", "bin", "mandarin-server");
const skip = !fs.existsSync(BIN) && "the C# server isn't built (server/build.sh)";

function csharp(job) {
  const r = spawnSync(BIN, ["score"], { input: JSON.stringify(job) + "\n", maxBuffer: 512 * 1024 * 1024 });
  assert.equal(r.status, 0, String(r.stderr));
  const out = JSON.parse(String(r.stdout).split("\n")[0]);
  assert.ok(!out.error, out.error);
  return out;
}
const plain = v => JSON.parse(JSON.stringify(v));
const ch = (...codes) => String.fromCharCode(...codes);

// A small seeded generator, so a failure can be run again.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* Each answer the same both ways, the first that isn't shown with what was asked (and the seed that made it). */
function same(what, inputs, got, want, seed) {
  assert.equal(got.length, want.length, what + ": as many answers");
  for (let i = 0; i < want.length; i++) {
    const msg = `${what} #${i}${seed != null ? ` (seed ${seed})` : ""}: ${JSON.stringify(inputs[i]).slice(0, 1500)}`;
    assert.deepStrictEqual(got[i], want[i], msg);
    assert.equal(JSON.stringify(got[i]), JSON.stringify(want[i]), msg + " (key order)");
  }
}

// ---------------------------------------------------------------- samples

const LS = ch(0x2028), NBSP = ch(0xA0), BOM = ch(0xFEFF), LONE = ch(0xD800), NEL = ch(0x85), KELVIN = ch(0x212A), LONG_S = ch(0x17F);
const SINK_POLY = "http-get:*:audio/flac:*,http-get:*:audio/wav:*,http-get:*:audio/x-dsf:*";
const SINK_PLAYBACK = "http-get:*:audio/flac:*,http-get:*:audio/wav:*,http-get:*:audio/dsf:*,http-get:*:audio/dff:*";

/* The fake renderer's own description, as the other tests serve it. */
function fakeDescriptions() {
  const out = [];
  const variants = [
    {}, { nested: true }, { urlBase: true }, { nested: true, urlBase: true }, { noAvTransport: true },
    { name: "Telly", manufacturer: "Samsung", model: "UE55", nested: true, urlBase: true },
    { name: "Living Room", manufacturer: "Linkplay Technology Inc.", model: "WiiM Pro Plus", udn: "uuid:FF31F09E-0000-1111-2222-333344445555" },
    { name: "Poly", manufacturer: "Chord Electronics Ltd", model: "Poly", sink: SINK_POLY },
    { name: "Kitchen & Den <2>", manufacturer: "Ac\"me's", model: "Box > 1", modelNumber: "x&y" },
    { name: "Ünïcode 😀 " + NBSP, manufacturer: "  spaced  ", model: "" }
  ];
  variants.forEach((v, i) => {
    const r = new FakeRenderer(Object.assign({ name: "Renderer " + i, udn: "uuid:fixed-" + i }, v));
    r.port = 4321 + i;
    out.push({ xml: r.description(), location: r.location });
    // As audio-devices.test.js checks OpenHome: one service renamed.
    out.push({ xml: r.description().replace("urn:schemas-upnp-org:service:RenderingControl:1", "urn:av-openhome-org:service:Playlist:1"), location: r.location });
  });
  // test/fake-sonos.js's description: a ZonePlayer, no renderer, no services.
  out.push({ xml: `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><device>` +
    `<deviceType>urn:schemas-upnp-org:device:ZonePlayer:1</deviceType><roomName>Kitchen</roomName>` +
    `<modelName>Sonos One</modelName><UDN>uuid:RINCON_000E58AAAA0001400</UDN></device></root>`, location: "http://127.0.0.1:1400/xml/device_description.xml" });
  out.push({ xml: "<html>not upnp</html>", location: "http://x/" });
  return out;
}

/* The fake renderer's NOTIFY body, as notify() sends it (its request caught here). */
function fakeNotify(state, uri) {
  const real = http.request;
  let body = null;
  http.request = () => ({ on() {}, end(b) { body = b; } });
  try {
    const r = new FakeRenderer({ name: "x" });
    r.state = state; r.uri = uri;
    r.subscribers = [{ sid: "uuid:sub-1", callback: "http://127.0.0.1:9/upnp/event/x" }];
    r.notify();
  } finally { http.request = real; }
  return body;
}

const DIDL = '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">' +
  '<item id="-1" parentID="-1" restricted="true"><res protocolInfo="http-get:*:audio/flac:*" duration="0:04:12">http://10.0.0.2:3500/stream/12.flac?s=a&amp;t=b</res>' +
  '<dc:title>Song &amp; Dance</dc:title><upnp:class>object.item.audioItem.musicTrack</upnp:class><dc:creator>Artist</dc:creator><upnp:album>Album</upnp:album></item></DIDL-Lite>';

/* Hand-written from what devices send: whole descriptions. */
const REAL_DESCRIPTIONS = [
  // A WiiM (LinkPlay firmware): no URLBase, controlURLs without a leading slash, an icon list, DLNA extras.
  { location: "http://192.168.1.31:49152/description.xml", xml: `<?xml version="1.0" encoding="UTF-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0" xmlns:dlna="urn:schemas-dlna-org:device-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
    <friendlyName>WiiM Pro Plus-1A2B</friendlyName>
    <manufacturer>Linkplay Technology Inc.</manufacturer>
    <manufacturerURL>http://www.linkplay.com</manufacturerURL>
    <modelDescription>WiiM Pro Plus</modelDescription>
    <modelName>WiiM Pro Plus</modelName>
    <modelNumber>WiiM_Pro_Plus</modelNumber>
    <serialNumber>0000001</serialNumber>
    <UDN>uuid:FF31F09E-1A2B-3C4D-5E6F-00112233AABB</UDN>
    <dlna:X_DLNADOC>DMR-1.50</dlna:X_DLNADOC>
    <iconList><icon><mimetype>image/png</mimetype><width>120</width><height>120</height><depth>24</depth><url>/upnp/icon.png</url></icon></iconList>
    <serviceList>
      <service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><serviceId>urn:upnp-org:serviceId:AVTransport</serviceId>
        <SCPDURL>/upnp/rendertransportSCPD.xml</SCPDURL><controlURL>/upnp/control/rendertransport1</controlURL><eventSubURL>/upnp/event/rendertransport1</eventSubURL></service>
      <service><serviceType>urn:schemas-upnp-org:service:ConnectionManager:1</serviceType><serviceId>urn:upnp-org:serviceId:ConnectionManager</serviceId>
        <SCPDURL>upnp/rendercmpSCPD.xml</SCPDURL><controlURL>upnp/control/rendercmp1</controlURL><eventSubURL>upnp/event/rendercmp1</eventSubURL></service>
      <service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><serviceId>urn:upnp-org:serviceId:RenderingControl</serviceId>
        <SCPDURL>/upnp/rendercontrolSCPD.xml</SCPDURL><controlURL>/upnp/control/rendercontrol1</controlURL><eventSubURL>/upnp/event/rendercontrol1</eventSubURL></service>
      <service><serviceType>urn:schemas-wiimu-com:service:PlayQueue:1</serviceType><serviceId>urn:wiimu-com:serviceId:PlayQueue</serviceId>
        <SCPDURL>/upnp/PlayQueueSCPD.xml</SCPDURL><controlURL>/upnp/control/PlayQueue1</controlURL><eventSubURL>/upnp/event/PlayQueue1</eventSubURL></service>
    </serviceList>
  </device>
</root>` },
  // A Sonos: the renderer nested inside the ZonePlayer, beside a MediaServer.
  { location: "http://192.168.1.40:1400/xml/device_description.xml", xml: `<?xml version="1.0" encoding="utf-8" ?>
<root xmlns="urn:schemas-upnp-org:device-1-0"><specVersion><major>1</major><minor>0</minor></specVersion>
<device><deviceType>urn:schemas-upnp-org:device:ZonePlayer:1</deviceType><friendlyName>192.168.1.40 - Sonos One - RINCON_48A6B8000001400</friendlyName>
<manufacturer>Sonos, Inc.</manufacturer><manufacturerURL>http://www.sonos.com</manufacturerURL><modelNumber>S18</modelNumber><modelDescription>Sonos One</modelDescription>
<modelName>Sonos One</modelName><modelURL>http://www.sonos.com/products/zoneplayers/S18</modelURL><softwareVersion>79.1-56030</softwareVersion>
<roomName>Living Room</roomName><displayName>One</displayName><UDN>uuid:RINCON_48A6B8000001400</UDN>
<serviceList><service><serviceType>urn:schemas-upnp-org:service:AlarmClock:1</serviceType><serviceId>urn:upnp-org:serviceId:AlarmClock</serviceId><controlURL>/AlarmClock/Control</controlURL><eventSubURL>/AlarmClock/Event</eventSubURL><SCPDURL>/xml/AlarmClock1.xml</SCPDURL></service>
<service><serviceType>urn:schemas-upnp-org:service:ZoneGroupTopology:1</serviceType><serviceId>urn:upnp-org:serviceId:ZoneGroupTopology</serviceId><controlURL>/ZoneGroupTopology/Control</controlURL><eventSubURL>/ZoneGroupTopology/Event</eventSubURL><SCPDURL>/xml/ZoneGroupTopology1.xml</SCPDURL></service></serviceList>
<deviceList>
<device><deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType><friendlyName>192.168.1.40 - Sonos One Media Server</friendlyName><manufacturer>Sonos, Inc.</manufacturer><modelName>Sonos One</modelName><UDN>uuid:RINCON_48A6B8000001400_MS</UDN>
<serviceList><service><serviceType>urn:schemas-upnp-org:service:ContentDirectory:1</serviceType><serviceId>urn:upnp-org:serviceId:ContentDirectory</serviceId><controlURL>/MediaServer/ContentDirectory/Control</controlURL><eventSubURL>/MediaServer/ContentDirectory/Event</eventSubURL><SCPDURL>/xml/ContentDirectory1.xml</SCPDURL></service></serviceList></device>
<device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><friendlyName>Living Room - Sonos One Media Renderer</friendlyName><manufacturer>Sonos, Inc.</manufacturer><modelName>Sonos One</modelName><UDN>uuid:RINCON_48A6B8000001400_MR</UDN>
<serviceList><service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><serviceId>urn:upnp-org:serviceId:RenderingControl</serviceId><controlURL>/MediaRenderer/RenderingControl/Control</controlURL><eventSubURL>/MediaRenderer/RenderingControl/Event</eventSubURL><SCPDURL>/xml/RenderingControl1.xml</SCPDURL></service>
<service><serviceType>urn:schemas-upnp-org:service:ConnectionManager:1</serviceType><serviceId>urn:upnp-org:serviceId:ConnectionManager</serviceId><controlURL>/MediaRenderer/ConnectionManager/Control</controlURL><eventSubURL>/MediaRenderer/ConnectionManager/Event</eventSubURL><SCPDURL>/xml/ConnectionManager1.xml</SCPDURL></service>
<service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><serviceId>urn:upnp-org:serviceId:AVTransport</serviceId><controlURL>/MediaRenderer/AVTransport/Control</controlURL><eventSubURL>/MediaRenderer/AVTransport/Event</eventSubURL><SCPDURL>/xml/AVTransport1.xml</SCPDURL></service>
<service><serviceType>urn:schemas-sonos-com:service:Queue:1</serviceType><serviceId>urn:sonos-com:serviceId:Queue</serviceId><controlURL>/MediaRenderer/Queue/Control</controlURL><eventSubURL>/MediaRenderer/Queue/Event</eventSubURL><SCPDURL>/xml/Queue1.xml</SCPDURL></service></serviceList></device>
</deviceList></device></root>` },
  // A receiver: a URLBase with a path, absolute and relative URLs, the renderer two levels down.
  { location: "http://192.168.1.50:60006/upnp/desc/aios_device/aios_device.xml", xml: `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0"><specVersion><major>1</major><minor>0</minor></specVersion><URLBase>http://192.168.1.50:60006/upnp/</URLBase>
<device><deviceType>urn:schemas-denon-com:device:AiosDevice:1</deviceType><friendlyName>Denon AVR-X2700H</friendlyName><manufacturer>Denon</manufacturer><modelName>*AVR-X2700H</modelName><UDN>uuid:root-0001</UDN>
<deviceList><device><deviceType>urn:schemas-upnp-org:device:Basic:1</deviceType><friendlyName>inner</friendlyName><UDN>uuid:inner</UDN>
<deviceList><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><friendlyName> Denon AVR-X2700H </friendlyName><manufacturer>Denon</manufacturer>
<modelName>Denon AVR-X2700H</modelName><modelNumber>X2700H</modelNumber><serialNumber>AAA0000</serialNumber><UDN>uuid:renderer-0001</UDN><presentationURL>../index.html</presentationURL>
<serviceList><service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>control/AVTransport</controlURL><eventSubURL>http://192.168.1.50:60006/upnp/event/AVTransport</eventSubURL><SCPDURL>/upnp/scpd/AVTransport.xml</SCPDURL></service>
<service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>./control/RenderingControl</controlURL><eventSubURL>event/RenderingControl</eventSubURL><SCPDURL>scpd/RenderingControl.xml</SCPDURL></service>
<service><serviceType>urn:schemas-upnp-org:service:ConnectionManager:1</serviceType><controlURL>//192.168.1.50:60006/upnp/control/ConnectionManager</controlURL><eventSubURL></eventSubURL><SCPDURL/></service>
</serviceList></device></deviceList></device></deviceList></device></root>` },
  // OpenHome (Linn): av-openhome-org services beside the UPnP ones.
  { location: "http://192.168.1.60:55178/Ds/device.xml", xml: `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><specVersion><major>1</major><minor>1</minor></specVersion>
<device><deviceType>urn:linn-co-uk:device:Source:1</deviceType><friendlyName>Lounge:Klimax DSM</friendlyName><manufacturer>Linn Products Ltd</manufacturer><modelName>Klimax DSM</modelName><UDN>uuid:4c494e4e-0000-0000-0000-000000000001</UDN>
<serviceList><service><serviceType>urn:av-openhome-org:service:Product:3</serviceType><serviceId>urn:av-openhome-org:serviceId:Product</serviceId><SCPDURL>/4c494e4e/Ds/av.openhome.org-Product-3/service.xml</SCPDURL><controlURL>/4c494e4e/Ds/av.openhome.org-Product-3/control</controlURL><eventSubURL>/4c494e4e/Ds/av.openhome.org-Product-3/event</eventSubURL></service>
<service><serviceType>urn:av-openhome-org:service:Playlist:1</serviceType><serviceId>urn:av-openhome-org:serviceId:Playlist</serviceId><SCPDURL>/4c494e4e/Ds/Playlist/service.xml</SCPDURL><controlURL>/4c494e4e/Ds/Playlist/control</controlURL><eventSubURL>/4c494e4e/Ds/Playlist/event</eventSubURL></service></serviceList>
<deviceList><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><friendlyName>Lounge:Klimax DSM:MediaRenderer</friendlyName><manufacturer>Linn</manufacturer><modelName>Klimax DSM</modelName><UDN>uuid:4c494e4e-0000-0000-0000-000000000002</UDN>
<serviceList><service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/MediaRenderer/AVTransport/control</controlURL><eventSubURL>/MediaRenderer/AVTransport/event</eventSubURL><SCPDURL>/MediaRenderer/AVTransport/service.xml</SCPDURL></service>
<service><serviceType>urn:av-openhome-org:service:Volume:1</serviceType><controlURL>/MediaRenderer/Volume/control</controlURL><eventSubURL>/MediaRenderer/Volume/event</eventSubURL><SCPDURL>/MediaRenderer/Volume/service.xml</SCPDURL></service></serviceList></device></deviceList></device></root>` },
  // gmrender-resurrect on a Raspberry Pi: prefixed root, CDATA name, entities, odd whitespace, mixed-case element names.
  { location: "http://10.0.0.7:49494/description.xml", xml: `<?xml version="1.0"?>
<u:root xmlns:u="urn:schemas-upnp-org:device-1-0">\r\n\t<u:device>\r\n<u:deviceType>\turn:schemas-upnp-org:device:MediaRenderer:1\t</u:deviceType>
<u:friendlyName><![CDATA[  Pi & "Kitchen"  ]]></u:friendlyName><u:manufacturer>Henner Zeller &amp; co</u:manufacturer><u:ModelName>GMediaRender</u:ModelName><u:modelName>gmediarender</u:modelName>
<u:UDN>uuid:GMediaRender-1_0-000-000-002</u:UDN><u:presentationURL> http://10.0.0.7:49494/ </u:presentationURL>
<u:serviceList><u:service><u:serviceType>urn:schemas-upnp-org:service:ConnectionManager:1</u:serviceType><u:controlURL>/upnp/control/cm</u:controlURL><u:eventSubURL>/upnp/event/cm</u:eventSubURL><u:SCPDURL>/upnp/cm.xml</u:SCPDURL></u:service>
<u:service><u:serviceType>urn:schemas-upnp-org:service:AVTransport:1</u:serviceType><u:controlURL>/upnp/control/tvcontrol1</u:controlURL><u:eventSubURL>/upnp/event/tvcontrol1</u:eventSubURL><u:SCPDURL>/upnp/transport.xml</u:SCPDURL></u:service></u:serviceList></u:device></u:root>` },
  // A TV whose description is HTML-ish around the edges, with a bare & in a URL and a duplicated name.
  { location: "http://10.0.0.8:9197/dmr", xml: `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0" xmlns:sec="http://www.sec.co.kr/dlna">
<device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><friendlyName>[TV] Samsung 7 Series (55)</friendlyName><friendlyName>Second name</friendlyName>
<manufacturer lang="en">Samsung Electronics</manufacturer><modelName>UE55RU7400</modelName><UDN>uuid:0dee0000-0000-0000-0000-000000000000</UDN><sec:deviceID>P0000</sec:deviceID>
<presentationURL>http://10.0.0.8:9197/?a=1&b=2&amp;c=3</presentationURL>
<serviceList><service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/upnp/control/RenderingControl1</controlURL><eventSubURL>/upnp/event/RenderingControl1</eventSubURL><SCPDURL>RenderingControl_1.xml</SCPDURL></service>
<service><serviceType>urn:schemas-upnp-org:service:ConnectionManager:1</serviceType><controlURL>/upnp/control/ConnectionManager1</controlURL><eventSubURL>/upnp/event/ConnectionManager1</eventSubURL><SCPDURL>ConnectionManager_1.xml</SCPDURL></service>
<service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/upnp/control/AVTransport1</controlURL><eventSubURL>/upnp/event/AVTransport1</eventSubURL><SCPDURL>AVTransport_1.xml</SCPDURL></service>
</serviceList><sec:ProductCap>Tizen,Y2019</sec:ProductCap></device></root>` }
];

/* Hand-picked sloppy and broken documents (with a location each). */
const EDGE_DESCRIPTIONS = [
  "", " ", "<root/>", "<root></root>", "<root>text</root>", "<root><device/></root>", "<root><device>text</device></root>",
  "<root><device><deviceType>urn:x:device:MediaRenderer:1</deviceType></device><device><UDN>u2</UDN></device></root>",
  "<root><device><serviceList/></device></root>", "<root><device><serviceList>words</serviceList></device></root>",
  "<root><device><serviceList><service>words</service><service/></serviceList></device></root>",
  "<root><device><deviceList/><deviceList><device><deviceType>urn:a:device:MediaRenderer:2</deviceType><UDN>in</UDN></device></deviceList></device></root>",
  "<root><device><deviceList><device>txt</device><device><deviceType>urn:a:device:MEDIARENDERER:1</deviceType><UDN>x</UDN></device></deviceList></device></root>",
  "<Root><device><UDN>wrong case</UDN></device></Root>", "<root><Device><UDN>wrong case</UDN></Device></root>",
  "<root><URLBase>not a url</URLBase><device><serviceList><service><serviceType>urn:x:service:A:1</serviceType><controlURL>/c</controlURL></service></serviceList></device></root>",
  "<root><URLBase/><device><serviceList><service><serviceType>urn:x:service:A:1</serviceType><controlURL>c</controlURL></service></serviceList></device></root>",
  "<root><URLBase>http://h:80/x/</URLBase><URLBase>http://other/</URLBase><device><serviceList><service><serviceType>urn:x:service:A:1</serviceType><controlURL>c</controlURL></service></serviceList></device></root>",
  "<root><device><serviceList><service><serviceType>urn:x:service:__proto__:1</serviceType><controlURL>/p</controlURL></service><service><serviceType>urn:x:service:5:1</serviceType></service><service><serviceType>urn:x:service:A:1</serviceType></service><service><serviceType>urn:x:service:A:2</serviceType><controlURL>/second</controlURL></service></serviceList></device></root>",
  "<root><device><serviceList><service><serviceType>urn:x:Service:Mixed:1</serviceType></service><service><serviceType>no service</serviceType></service><service><serviceType>urn:x:service::1</serviceType></service><service><serviceType>:service:end</serviceType></service><service><serviceType>urn:a:service:x:service:Y:1</serviceType></service></serviceList></device></root>",
  "<root><device><UDN>" + "a".repeat(9000) + "</UDN><manufacturer>WiiM</manufacturer></device></root>",
  "<!-- " + "x".repeat(8000) + " --><root><device><manufacturer>LinkPlay</manufacturer></device></root>",
  "<root><device><friendlyName>&#60;b&#62; &lt;b&gt; &amp;amp; &nbsp; &#0; &#x1;</friendlyName><UDN>" + BOM + " uuid:bom " + NBSP + "</UDN></device></root>",
  BOM + "<?xml version=\"1.0\"?><root><device><UDN>after a BOM</UDN></device></root>",
  "<root><device><UDN>unclosed", "<root><device><UDN>x</UDN></device>", "<root><device><UDN>x</UDN></root></device>", "</x><root><device><UDN>stray close first</UDN></device></root>",
  "<root><device><UDN a='1'>with attr</UDN><friendlyName a=\"1\"/></device></root>",
  "<root><device><toString>t</toString><constructor>c</constructor></device></root>", "<root><device><#text>t</#text></device></root>",
  "<root><device><#text/><UDN>x</UDN></device></root>", "<root><x:device><x:UDN>prefixed</x:UDN></x:device></root>",
  "<root><device><UDN>u</UDN><serviceList><service><serviceType>urn:x:service:A:1</serviceType><controlURL>" + "\t/a\n/b " + "</controlURL><eventSubURL>javascript:alert(1)</eventSubURL><SCPDURL>http://[::1]:80/s</SCPDURL></service></serviceList></device></root>",
  "<!DOCTYPE root [<!ENTITY n \"Entity Name\"><!ENTITY bad \"<script>\">]><root><device><friendlyName>&n; &bad;</friendlyName></device></root>",
  "<root>" + "<a>".repeat(120) + "</root>", "not xml at all", "<<<>>>", "<root><device>&</device></root>", "<?xml version=\"1.0\"?",
  "<root><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><UDN>uuid:x</UDN><serviceList><service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>http://" + "bücher.de/ctl</controlURL></service></serviceList></device></root>"
];
const EDGE_LOCATIONS = ["http://10.0.0.9:1900/desc.xml", undefined, null, "", "not a url", 5, "https://h/a/b/c?x#y", "file:///C:/dev/desc.xml", "urn:x:y"];

/* Hand-written from what devices send: NOTIFY bodies. */
function lastChange(inner) { return `<?xml version="1.0"?><e:propertyset xmlns:e="urn:schemas-upnp-org:event-1-0"><e:property><LastChange>${XML.escape(inner)}</LastChange></e:property></e:propertyset>`; }
const AVT_EVENT = `<Event xmlns="urn:schemas-upnp-org:metadata-1-0/AVT/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/"><InstanceID val="0">` +
  `<TransportState val="PLAYING"/><CurrentPlayMode val="NORMAL"/><CurrentCrossfadeMode val="0"/><NumberOfTracks val="1"/><CurrentTrack val="1"/><CurrentSection val="0"/>` +
  `<CurrentTrackURI val="http://10.0.0.2:3500/stream/12.flac?s=a&amp;t=b"/><CurrentTrackDuration val="0:04:12"/><CurrentTrackMetaData val="${XML.escape(DIDL)}"/>` +
  `<r:NextTrackURI val=""/><r:NextTrackMetaData val=""/><r:EnqueuedTransportURI val="x-rincon-queue:RINCON_1#0"/><AVTransportURI val="x-rincon-queue:RINCON_1#0"/>` +
  `<TransportStatus val="OK"></TransportStatus></InstanceID></Event>`;
const RC_EVENT = `<Event xmlns="urn:schemas-upnp-org:metadata-1-0/RCS/"><InstanceID val="0"><Volume channel="Master" val="23"/><Volume channel="LF" val="100"/><Volume channel="RF" val="100"/>` +
  `<Mute channel="Master" val="0"/><Mute channel="LF" val="0"/><Bass val="0"/><Treble val="0"/><Loudness channel="Master" val="1"/></InstanceID></Event>`;
const REAL_NOTIFIES = [
  lastChange(AVT_EVENT), lastChange(RC_EVENT),
  `<e:propertyset xmlns:e="urn:schemas-upnp-org:event-1-0"/>`,
  `<e:propertyset xmlns:e="urn:schemas-upnp-org:event-1-0"><e:property><SourceProtocolInfo></SourceProtocolInfo></e:property><e:property><SinkProtocolInfo>${XML.escape(SINK_WIIM)}</SinkProtocolInfo></e:property><e:property><CurrentConnectionIDs>0</CurrentConnectionIDs></e:property></e:propertyset>`,
  `<e:propertyset xmlns:e="urn:schemas-upnp-org:event-1-0"><e:property><LastChange><![CDATA[<Event xmlns="urn:schemas-upnp-org:metadata-1-0/AVT/"><InstanceID val="0"><TransportState val="STOPPED"/></InstanceID></Event>]]></LastChange></e:property></e:propertyset>`,
  `<e:propertyset xmlns:e="urn:schemas-upnp-org:event-1-0"><e:property><LastChange>${XML.escape(XML.escape(AVT_EVENT))}</LastChange></e:property></e:propertyset>`,
  `<e:propertyset xmlns:e="urn:schemas-upnp-org:event-1-0"><e:property><LastChange>${AVT_EVENT}</LastChange></e:property></e:propertyset>`,
  lastChange(`<Event><InstanceID val="0"><TransportState val="PLAYING"/></InstanceID><InstanceID val="1"><TransportState val="STOPPED"/><Extra val="1"/></InstanceID></Event>`),
  lastChange(`<Event><InstanceID val="0"><TransportState/><Volume>12</Volume><Mute val=""/><A val="1">t</A><B><val>x</val></B></InstanceID></Event>`),
  lastChange(`<avt:Event xmlns:avt="x"><avt:InstanceID val="0"><avt:TransportState val="PAUSED_PLAYBACK"/></avt:InstanceID></avt:Event>`),
  lastChange(`<Event><InstanceID>words</InstanceID></Event>`), lastChange(`<Event/>`), lastChange(`<Event>words</Event>`), lastChange("not xml"), lastChange(""),
  `<e:propertyset><e:property a="1">loose text</e:property><e:property><X a="1">t</X><Y/></e:property><e:property/></e:propertyset>`,
  `<e:propertyset><e:property><LastChange a="1">${XML.escape(RC_EVENT)}</LastChange></e:property></e:propertyset>`,
  `<e:propertyset><e:property><LastChange>${XML.escape(RC_EVENT)}</LastChange><LastChange>${XML.escape(AVT_EVENT)}</LastChange></e:property></e:propertyset>`,
  `<e:propertyset><e:property><Volume>1</Volume></e:property></e:propertyset><e:propertyset/>`,
  `<propertyset><property><5>five</5><A>a</A></property></propertyset>`, "", "<x/>", "garbage <", 5, null,
  fakeNotify("PLAYING", "http://127.0.0.1:3500/stream/1.flac?a=1&b=2"), fakeNotify("STOPPED", ""), fakeNotify("NO_MEDIA_PRESENT", "<odd> & \"uri\"")
];

// ---------------------------------------------------------------- generators

function pick(r, list) { return list[Math.floor(r() * list.length)]; }

/* XML soup: well-formed pieces and broken ones, run together. */
const XML_PIECES = [
  "<a>", "</a>", "<b x=\"1\">", "</b>", "<c/>", "<d />", "<ns:e>", "</ns:e>", "<e:f g:h='2' xmlns:e=\"u\" xmlns=\"v\">", "</e:f>", "<g a=b c = 'd' e>", "<h a='x\"y' b=\"p'q\">",
  "text", " spaced ", "\t", "\n", "\r\n", "\r", "&amp;", "&lt;", "&#60;", "&#x3C;", "&#0;", "&#1;", "&#x1F;", "&#xD800;", "&#9;", "&#-0;", "&#0x41;", "&#x0x41;", "&# 65;",
  "&unknown;", "&", ";", "&apos;&quot;&gt;", "&" + "a".repeat(40) + ";", "<![CDATA[ c <x> ]]>", "<![CDATA[]]>", "<![x]]>", "<!-- note -->", "<!---->", "<?xml version=\"1.0\"?>", "<?xml version=\"1.1\"?>",
  "<?pi a=\"b\"?>", "<?xml?>", "<?>", "<!DOCTYPE x>", "<!DOCTYPE r [<!ENTITY e \"ee\">]>", "<", ">", "\"", "'", "/", "=", "<toString>", "</toString>", "<valueOf/>",
  "<#text/>", "<x:#text/>", "<5>", "</5>", "<x::@>", "<a/ >", "<!x>", "<!ELEMENT>", "é", LS, LONE, NBSP, "ünï", "<root>", "</root>", "<device>", "</device>", "<a\tb='1'>", "<a" + NBSP + "b='1'>",
  "<UDN>", "</UDN>", "<service>", "</service>", "</>", "<>", "< a>", "</ a >", "<a b='unterminated>"
];
function xmlSoup(r) {
  let s = "";
  for (let k = 1 + Math.floor(r() * 24); k > 0; k--) s += pick(r, XML_PIECES);
  return s;
}

/* A tree of elements, written with every quirk of quoting, entities and spacing, then sometimes broken. */
const NAMES = ["a", "b", "x:y", "item", "UDN", "root", "device", "service", "LastChange", "Event", "InstanceID", "val", "5", "toString", "q:r:s", "_n", "n-1", "n.2", "ñ"];
const TEXTS = ["", "x", "  padded  ", "a &amp; b", "&lt;tag&gt;", "&#38;", "&#x26;", "&#0;", "&nbsp;", "1 < 2", "é😀", NBSP + "nb" + NBSP, "line\r\nbreak", "tab\there", "<![CDATA[ raw & <b> ]]>", "<!-- c -->"];
function tree(r, depth) {
  const name = pick(r, NAMES);
  let attrs = "";
  for (let k = Math.floor(r() * 3); k > 0; k--) {
    const q = pick(r, ["\"", "'", "\"", ""]);
    attrs += pick(r, [" ", "  ", "\t", "\n"]) + pick(r, ["val", "x", "ns:a", "xmlns", "xmlns:p", "channel", "v"]) + pick(r, ["=", " = "]) + q + pick(r, ["0", "PLAYING", " sp ", "a&amp;b", "&lt;x&gt;", "", "&#1;"]) + q;
  }
  if (depth > 3 || r() < 0.3) return r() < 0.3 ? `<${name}${attrs}/>` : `<${name}${attrs}>${pick(r, TEXTS)}</${name}>`;
  let inner = "";
  for (let k = Math.floor(r() * 4); k > 0; k--) inner += (r() < 0.3 ? pick(r, TEXTS) : "") + tree(r, depth + 1);
  return `<${name}${attrs}>${inner}${r() < 0.2 ? pick(r, TEXTS) : ""}</${name}${r() < 0.1 ? " " : ""}>`;
}
function xmlTree(r) {
  let s = (r() < 0.3 ? pick(r, ["<?xml version=\"1.0\"?>", "<?xml version=\"1.1\"?>\n", "<!DOCTYPE d [<!ENTITY e \"E\"><!ELEMENT d (#PCDATA)><!ATTLIST d a CDATA #IMPLIED><!-- c -->]>"]) : "") + tree(r, 0);
  const cut = r();
  if (cut < 0.1) s = s.slice(0, Math.floor(r() * s.length));
  else if (cut < 0.2) { const at = Math.floor(r() * s.length); s = s.slice(0, at) + pick(r, XML_PIECES) + s.slice(at); }
  return s;
}

const DOCTYPES = [
  "<!DOCTYPE a [<!ENTITY e \"x\"><!ENTITY e \"y\">]><a>&e;</a>", "<!DOCTYPE a [<!ENTITY amp \"AMP\">]><a>&amp; &lt;</a>",
  "<!DOCTYPE a [<!ENTITY s \"<script>alert(1)</script>\"><!ENTITY j \"javascript:x\"><!ENTITY ok \"fine\">]><a>&s;|&j;|&ok;</a>",
  "<!DOCTYPE a [<!ENTITY x SYSTEM \"http://e/\">]><a/>", "<!DOCTYPE a [<!ENTITY % p \"x\">]><a/>", "<!DOCTYPE a [<!ENTITY 1bad \"x\">]><a/>",
  "<!DOCTYPE a [<!ENTITY e \"has &amp; in it\">]><a>&e;</a>", "<!DOCTYPE a [<!ENTITY big \"" + "z".repeat(10001) + "\">]><a/>",
  "<!DOCTYPE a [<!ENTITY big \"" + "z".repeat(9000) + "\">]><a>" + "&big;".repeat(12) + "</a>", "<!DOCTYPE a [<!ENTITY big \"" + "z".repeat(9000) + "\">]><a>" + "&big;".repeat(11) + "</a>",
  "<!DOCTYPE a [<!ELEMENT a EMPTY><!ELEMENT b ANY><!ELEMENT c (x|y)*><!NOTATION n PUBLIC \"p\" \"s\"><!NOTATION m SYSTEM \"s\">]><a/>", "<!DOCTYPE a [<!ELEMENT a (x>]><a/>",
  "<!DOCTYPE a [<!NOTATION m SYSTEM \"\">]><a/>", "<!DOCTYPE a [<!BOGUS>]><a/>", "<!DOCTYPE a \"quoted > inside\"><a>q</a>", "<!DOCTYPE a [<!-- > -->]><a>c</a>",
  "<!DOCTYPE a><!DOCTYPE b><a/>", "<!DOCTYPE a", "<!Dx><a/>", "<!DOCTYPE a [<!ENTITY q 'single'>]><a b='&q;'>&q;</a>",
  "<!DOCTYPE a [<!ENTITY e \"&#1;\">]><?xml version=\"1.1\"?><a>&e;&#1;</a>", "<!DOCTYPE a [<!ENTITY ſystem \"x\">]><a>&ſystem;</a>",
  "<!DOCTYPE a [<!ENTITY e \"x\"><!ENTITY f \"y\"><!ENTITY g \"z\">]><a>&e;&f;&g;</a>", "<!DOCTYPE a [<!ENTITY e \"on" + "click=x\">]><a>&e;</a>"
];

/* Addresses as devices write them, and worse. */
const URL_SCHEMES = ["", "", "", "http:", "https:", "HTTP:", "file:", "sc:", "urn:", "mailto:", "ws:", "wss:", "ftp:", "javascript:", "a+b-c.d:", "1x:"];
const URL_SLASHES = ["", "/", "//", "//", "\\", "\\\\", "///", "/\\"];
const URL_USERS = ["", "", "", "u@", "u:p@", "a b@", "@", "a@b@", ":@", "u:@", ":p@", "é:%41@"];
const URL_HOSTS = ["h", "H.Com", "192.168.1.20", "192.168.001.020", "0x7f.1", "[::1]", "[1:0::]", "[::ffff:1.2.3.4]", "[1:2:3:4:5:6:7:8]", "[::1", "4294967295", "4294967296",
  "1.2.3.09", "foo.1", "foo.0x10", "a..b", "1.2.3.4.", "xn--bcher-kva.de", "XN--BCHER-KVA.DE", "bücher.de", "BÜCHER.de", "ＥＸＡＭＰＬＥ.com", "a<b", "", "%41b", "a%2eb", "localhost",
  "LOCALHOST", "C|", "c:", "a b", "a_b", "-x", "x%00", "0", "09", "1e2", "[x]", "a" + ch(0x3002) + "b"];
const URL_PORTS = ["", "", ":80", ":443", ":8080", ":", ":0049152", ":65535", ":65536", ":x", ":1:2"];
const URL_PATHS = ["", "/", "/a/b", "/a/../b", "/a/b/..", "/./x", "/%2e%2E/x", "/.%2e/", "a/b", "../c", "./", "..", ".", "/x y", "/é", "/{x}`^|", "\\a\\b", "/C|/x", "/c:/x/../..", "//dbl", "/a?", "/%zz/%41"];
const URL_QUERIES = ["", "", "?", "?a=b&c", "?q r'\"<>`", "?é", "?#"];
const URL_FRAGS = ["", "", "#", "#f g", "#`{}'<>", "#é", "##"];
const URL_BASES = ["http://10.0.0.5:49152/description.xml", "http://10.0.0.5:49152/upnp/dev/desc.xml?x=1#f", "https://h/a/b/", "file:///C:/x/y", "file://host/share/f", "sc://h/p/q",
  "sc:/p/q", "urn:x", "mailto:a", "http://[::1]/", "", "not a url", "null", "http://u:p@h:8080/a/b?q#f", undefined, undefined];
function urlCase(r) {
  let rel = pick(r, URL_SCHEMES) + pick(r, URL_SLASHES) + (r() < 0.6 ? pick(r, URL_USERS) + pick(r, URL_HOSTS) + pick(r, URL_PORTS) : "") + pick(r, URL_PATHS) + pick(r, URL_QUERIES) + pick(r, URL_FRAGS);
  if (r() < 0.15) { const at = Math.floor(r() * (rel.length + 1)); rel = rel.slice(0, at) + pick(r, ["\t", "\n", "\r", " ", ch(0), ch(0x7F), LONE, "%"]) + rel.slice(at); }
  if (r() < 0.1) rel = pick(r, [" ", "\t", ch(1)]) + rel + pick(r, [" ", "\n", ch(0x1F)]);
  const base = pick(r, URL_BASES);
  return base === undefined ? { rel } : { rel, base };
}

/* A device description put together from the parts devices use, nested and broken now and then. */
const DEVICE_TYPES = ["urn:schemas-upnp-org:device:MediaRenderer:1", "urn:schemas-upnp-org:device:MediaRenderer:2", "urn:schemas-upnp-org:device:mediarenderer:1",
  "urn:schemas-upnp-org:device:MediaServer:1", "urn:schemas-upnp-org:device:Basic:1", "urn:schemas-upnp-org:device:ZonePlayer:1", "", "  urn:x:device:MediaRenderer:1  ", "device:MediaRenderer"];
const MAKERS = ["Linkplay Technology Inc.", "WiiM", "Chord Electronics Ltd", "Sonos, Inc.", "Samsung Electronics", "Denon", "Linn Products Ltd", "  Acme &amp; Sons  ", "", "<![CDATA[Raw & Co]]>", "LINKPLAY"];
const MODELS = ["WiiM Pro Plus", "WiiM Mini", "Poly", "Sonos One", "UE55RU7400", "Streamer", "", "Klimax DSM", "Model &lt;X&gt;", "Arylic A50+"];
const SERVICE_TYPES = ["urn:schemas-upnp-org:service:AVTransport:1", "urn:schemas-upnp-org:service:RenderingControl:1", "urn:schemas-upnp-org:service:ConnectionManager:1",
  "urn:av-openhome-org:service:Playlist:1", "urn:AV-OpenHome-org:service:Volume:2", "urn:schemas-wiimu-com:service:PlayQueue:1", "urn:x:SERVICE:Odd:1", "no service", "urn:x:service::1", "", "urn:x:service:__proto__:1", "urn:x:service:7:1"];
const SERVICE_URLS = ["/upnp/control/x", "upnp/control/x", "http://10.0.0.6/ctl", "", "  /sp ace ", "../up", "?q", "//other/x", "\\back\\slash", "http://[::1]:8080/c", "javascript:x", "/a&amp;b", "#frag", "/é"];
const URL_BASE_TEXTS = [null, null, null, "http://10.0.0.5:49152/", "http://10.0.0.5:49152", "  http://x/base/  ", "", "/relative/", "garbage", "file:///base/"];
const LOCATIONS = ["http://10.0.0.5:49152/description.xml", "http://10.0.0.5:49152/a/b/desc.xml", "http://[fe80::1]:1400/x.xml", "", "not a url", undefined, null];
function element(r, name, text) {
  if (r() < 0.08) return "";
  if (r() < 0.05) return `<${name}>${text}</${name}><${name}>dup</${name}>`;
  if (r() < 0.05) return `<${name} lang="en">${text}</${name}>`;
  if (r() < 0.04) return `<${name}/>`;
  return `<${name}>${pick(r, ["", " ", "\n  "])}${text}${pick(r, ["", " ", "\t\n"])}</${name}>`;
}
function genDevice(r, depth) {
  let s = "<device>" + element(r, "deviceType", pick(r, DEVICE_TYPES)) + element(r, "friendlyName", pick(r, ["Living Room", "Pi &amp; Kitchen", "<![CDATA[ Raw <name> ]]>", "Ünï 😀", "", "&#60;x&#62;", LS + "sep"]))
    + element(r, "manufacturer", pick(r, MAKERS)) + element(r, "modelName", pick(r, MODELS)) + element(r, "modelNumber", pick(r, ["1", "WiiM_Pro_Plus", ""]))
    + (r() < 0.5 ? element(r, "modelDescription", pick(r, ["A renderer", "WiiM streamer", ""])) : "") + (r() < 0.5 ? element(r, "serialNumber", pick(r, ["SN1", " 00 "])) : "")
    + element(r, "UDN", pick(r, ["uuid:" + Math.floor(r() * 1e9), " uuid:spaced ", "", "uuid:RINCON_1"])) + (r() < 0.4 ? element(r, "presentationURL", pick(r, SERVICE_URLS)) : "");
  if (r() < 0.85) {
    let list = "";
    for (let k = Math.floor(r() * 5); k > 0; k--) {
      list += r() < 0.05 ? "<service>loose</service>" : "<service>" + element(r, "serviceType", pick(r, SERVICE_TYPES)) + element(r, "controlURL", pick(r, SERVICE_URLS))
        + element(r, "eventSubURL", pick(r, SERVICE_URLS)) + element(r, "SCPDURL", pick(r, SERVICE_URLS)) + "</service>";
    }
    s += r() < 0.05 ? "<serviceList/>" : `<serviceList>${list}</serviceList>`;
  }
  if (depth < 2 && r() < 0.35) {
    let kids = "";
    for (let k = 1 + Math.floor(r() * 2); k > 0; k--) kids += genDevice(r, depth + 1);
    s += `<deviceList>${kids}</deviceList>`;
  }
  return s + "</device>";
}
function genDescription(r) {
  const base = pick(r, URL_BASE_TEXTS);
  const rootName = pick(r, ["root", "root", "root", "u:root", "Root"]);
  let s = pick(r, ["", "<?xml version=\"1.0\"?>", "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n", BOM + "<?xml version=\"1.0\"?>"])
    + `<${rootName} xmlns="urn:schemas-upnp-org:device-1-0">` + (r() < 0.5 ? "<specVersion><major>1</major><minor>0</minor></specVersion>" : "")
    + (base != null ? `<URLBase>${base}</URLBase>` : "") + (r() < 0.95 ? genDevice(r, 0) : "") + (r() < 0.05 ? genDevice(r, 0) : "")
    + (r() < 0.05 ? "<!--" + "w".repeat(8000) + "--><wiim/>" : "") + `</${rootName}>`;
  const cut = r();
  if (cut < 0.04) s = s.slice(0, Math.floor(r() * s.length));
  else if (cut < 0.08) { const at = Math.floor(r() * s.length); s = s.slice(0, at) + pick(r, XML_PIECES) + s.slice(at); }
  const location = pick(r, LOCATIONS);
  return location === undefined ? { xml: s } : { xml: s, location };
}

/* A Sink list: every container and odd rate, odd spacing and empty entries. */
const SINK_FORMATS = ["audio/flac", "audio/x-flac", "AUDIO/FLAC", "audio/wav", "audio/wave", "audio/x-wav", "audio/aiff", "audio/x-aiff", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/alac",
  "audio/mpeg", "audio/mp3", "audio/x-mpeg", "audio/mpeg3", "audio/aac", "audio/aacp", "audio/3gpp", "audio/vnd.dlna.adts", "audio/ogg", "application/ogg", "application/x-ogg", "application/flac",
  "application/x-flac", "application/x-flac-extra", "audio/opus", "audio/x-ms-wma", "audio/dsf", "audio/x-dsf", "audio/dff", "audio/x-dff", "audio/dsd", "audio/L16", "audio/l24", "audio/L32", "audio/L8",
  "video/mp4", "image/jpeg", "*", "", "audio/", "audio/x-unknown", "AUDİO/FLAC", " audio/flac ", "audio/flac\n"];
const SINK_PARAMS = ["", "", ";rate=44100", ";rate=48000;channels=2", ";RATE=96000", "; rate = 88200", ";rate=0", ";rate=00192000", ";rate=", ";rate=x", ";rate=1e5", ";rate=" + "9".repeat(400),
  ";channels=1", ";rate=176400;rate=352800", ";rate=١٢٣", ";rate=44100 "];
function genSink(r) {
  const entries = [];
  for (let k = Math.floor(r() * 12); k > 0; k--) {
    if (r() < 0.05) { entries.push(pick(r, ["", "  ", "garbage", "a:b", "x:y:z:w:v"])); continue; }
    entries.push(pick(r, ["", " ", "\t", "\n"]) + pick(r, ["http-get", "rtsp-rtp-udp", "internal", "xbmc-get", ""]) + ":" + pick(r, ["*", ""]) + ":"
      + pick(r, SINK_FORMATS) + pick(r, SINK_PARAMS) + ":" + pick(r, ["*", "DLNA.ORG_PN=LPCM", "DLNA.ORG_PN=MP3;DLNA.ORG_OP=01", "", "a:b"]) + pick(r, ["", " "]));
  }
  return entries.join(pick(r, [",", ",", ", ", ",,"]));
}

/* A NOTIFY body: LastChange documents, escaped and not, plain variables, and the odd broken one. */
const EVENT_VARS = ['<TransportState val="PLAYING"/>', '<TransportState val="STOPPED"></TransportState>', '<CurrentTrackURI val="http://10.0.0.2:3500/s/1.flac?a=1&amp;b=2"/>',
  '<Volume channel="Master" val="20"/><Volume channel="LF" val="100"/>', '<Mute channel="Master" val="0"/>', `<CurrentTrackMetaData val="${XML.escape(DIDL)}"/>`, '<NoVal/>', '<Text>abc</Text>',
  '<r:NextTrackURI val="x"/>', '<TransportState val=" spaced "/>', '<A val="&#60;&#1;"/>', '<toString val="t"/>', '<val val="v"/>', '<5 val="five"/>', '<Dup val="1"/><Dup val="2"/>'];
function genNotify(r) {
  let props = "";
  for (let k = Math.floor(r() * 4); k > 0; k--) {
    const roll = r();
    if (roll < 0.55) {
      let insts = "";
      for (let j = 1 + Math.floor(r() * (r() < 0.8 ? 1 : 3)); j > 0; j--) {
        let vars = "";
        for (let v = Math.floor(r() * 6); v > 0; v--) vars += pick(r, EVENT_VARS);
        insts += `<InstanceID val="${j - 1}">${vars}</InstanceID>`;
      }
      const ev = `<Event xmlns="urn:schemas-upnp-org:metadata-1-0/AVT/">${insts}</Event>`;
      const how = r();
      const lc = how < 0.7 ? XML.escape(ev) : how < 0.8 ? `<![CDATA[${ev}]]>` : how < 0.88 ? XML.escape(XML.escape(ev)) : how < 0.94 ? ev : XML.escape(ev).slice(0, Math.floor(r() * ev.length));
      props += `<e:property>${pick(r, ["", " ", "\n"])}<LastChange>${lc}</LastChange></e:property>`;
    } else if (roll < 0.85) {
      const name = pick(r, ["SystemUpdateID", "ContainerUpdateIDs", "SinkProtocolInfo", "Volume"]);
      props += `<e:property><${name}>${pick(r, ["4", "", " 7 ", "a&amp;b", "Q,1"])}</${name}></e:property>`;
    }
    else props += pick(r, ["<e:property/>", "<e:property>loose</e:property>", "<e:property a=\"1\"><X>1</X></e:property>"]);
  }
  let s = `<?xml version="1.0"?><e:propertyset xmlns:e="urn:schemas-upnp-org:event-1-0">${props}</e:propertyset>`;
  if (r() < 0.05) s = s.slice(0, Math.floor(r() * s.length));
  return s;
}

const TIMEOUTS = ["Second-1800", "second-300", "SECOND-0", "Second-infinite", "infinite", "", null, 5, "Second-0042", "Second-12abc", "xSecond-7", "Second--5", "Second-" + "9".repeat(400),
  "Second-١٢٣", "Second-1 Second-2", LONG_S + "econd-5", "Second-\n5", "Second-5,Second-6", "Second-" + KELVIN, "Second-", "Second-x Second-9", true, ["Second-30"], {}];

/* gena.js's seconds() is its own: read from the file and run as written, since the module keeps it to itself. */
function genaSeconds() {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "renderers", "gena.js"), "utf8");
  const m = /\nfunction seconds\(v\) \{[\s\S]*?\n\}\n/.exec(src);
  assert.ok(m, "gena.js's seconds() found");
  return new Function("TIMEOUT_S", m[0] + "\nreturn seconds;")(G.TIMEOUT_S);
}

/* Profiles: every model the table knows, written many ways, beside makers and families. */
const PROFILE_MODELS = ["WiiM Pro Plus", "WiiM Pro", "WiiM  Pro\tPlus", "wiimpro", "WiiM Pro Plus 2", "WiiM ProPlus", "WiiM Pro/WiiM Pro Plus", "WiiM Pro Plus/WiiM Pro", "WiiM Ultra", "WiiM Amp",
  "WiiM Amp Pro", "WiiM Mini", "WiiM", "Wiim Sub Pro", "LinkPlay A31", "Poly", "poly", "Poly Headset", "Chord Poly", "poly2", "Poly-X", "Polyé", "xpoly", "Poly_", "Streamer", "",
  "WiiM" + NBSP + "Pro", "WiiM" + NEL + "Pro", "WiiM" + LS + "Pro Plus", "WİİM Pro", "wıım", "W" + ch(0x130) + "iM", "Sonos One", "UE55", " LINKPLAY ", "WiiM Pro Plus" + BOM, "Mini WiiM"];
const PROFILE_MAKERS = ["Linkplay Technology Inc.", "Linkplay", "WiiM", "Chord Electronics Ltd", "CHORD", "Poly Inc", "Acme", "", null, 5, "Chord" + KELVIN];
const PROFILE_FAMILIES = ["", "wiim", "local", "generic", "openhome", null, "LinkPlay", "WIIM", undefined];

const RECORD_KINDS = ["upnp", "upnp", "upnp", "local", "sonos", "phone", "", null, undefined, 5, "openhome", "SONOS"];
function genRecord(r) {
  const rec = {};
  const set = (k, v) => { if (v !== undefined) rec[k] = v; };
  set("kind", pick(r, RECORD_KINDS));
  set("manufacturer", pick(r, PROFILE_MAKERS));
  set("model", pick(r, PROFILE_MODELS));
  set("family", pick(r, PROFILE_FAMILIES));
  set("playable", pick(r, [true, false, 1, 0, "yes", "", null, undefined]));
  const capsRoll = r();
  if (capsRoll < 0.05) set("caps", pick(r, [null, "x", 5, [], 0]));
  else if (capsRoll < 0.95) {
    const caps = {};
    if (r() < 0.8) {
      const adv = {};
      const c = r();
      if (c < 0.7) adv.containers = ["flac", "dsd", "wav", "mp3", "pcm", "aiff"].filter(() => r() < 0.4);
      else if (c < 0.8) adv.containers = pick(r, ["flac,dsd", "", "dsdx", "flac"]);
      else if (c < 0.83) adv.containers = pick(r, [{}, 5, true]);
      const rr = r();
      if (rr < 0.6) adv.rates = PR.RATES.filter(() => r() < 0.3).concat(r() < 0.1 ? ["44100", 0, 12345] : []);
      else if (rr < 0.7) adv.rates = pick(r, ["44100,96000", "", "768000"]);
      else if (rr < 0.73) adv.rates = pick(r, [{}, 7]);
      const br = r();
      if (br < 0.5) adv.bits = PR.BITS.filter(() => r() < 0.4);
      else if (br < 0.55) adv.bits = pick(r, ["24", {}, true]);
      if (r() < 0.2) adv.mimes = ["audio/flac"];
      caps.advertised = r() < 0.03 ? pick(r, ["x", 0, null]) : adv;
    }
    const u = r();
    if (u < 0.35) {
      const user = {};
      if (r() < 0.7) user.rates = r() < 0.9 ? PR.RATES.filter(() => r() < 0.3) : pick(r, ["44100", null, {}]);
      if (r() < 0.5) user.bits = r() < 0.9 ? PR.BITS.filter(() => r() < 0.5) : "24";
      if (r() < 0.4) user.dsd = r() < 0.9 ? PR.DSD.filter(() => r() < 0.5) : 64;
      caps.user = user;
    } else if (u < 0.4) caps.user = pick(r, ["x", 5, [], null, {}]);
    const v = r();
    if (v < 0.4) {
      const verified = {};
      if (r() < 0.7) { verified.rates = {}; for (const hz of PR.RATES) if (r() < 0.2) verified.rates[hz] = r() < 0.9 ? "2026-10-02T10:00:00Z" : pick(r, ["", 0, null]); }
      if (r() < 0.5) { verified.bits = {}; for (const n of PR.BITS) if (r() < 0.3) verified.bits[n] = true; }
      if (r() < 0.1) verified.bits = pick(r, ["x".repeat(30), Array.from({ length: 30 }, (_, i) => i), 5]);
      caps.verified = verified;
    } else if (v < 0.45) caps.verified = pick(r, ["x", 5, [], null]);
    rec.caps = caps;
  }
  return rec;
}

/* The records the other tests give effective(): audio-devices.test.js's and local-output.test.js's. */
const REAL_RECORDS = [
  { kind: "upnp", manufacturer: "Linkplay", model: "WiiM Pro Plus", playable: true, caps: { advertised: { containers: ["flac", "wav"], rates: [44100, 48000] } } },
  { kind: "upnp", manufacturer: "Chord Electronics", model: "Poly", caps: {} },
  { kind: "upnp", manufacturer: "Chord Electronics", model: "Poly", caps: { advertised: { containers: ["flac", "dsd"] } } },
  { kind: "upnp", manufacturer: "Acme", model: "Box", caps: { advertised: { containers: ["flac", "dsd"] } } },
  { kind: "upnp", manufacturer: "Chord Electronics", model: "Poly", caps: { advertised: { containers: ["flac", "dsd"] }, user: { dsd: [64] } } },
  { kind: "upnp", manufacturer: "Acme", model: "Box", caps: { advertised: { rates: [96000] } } },
  { kind: "upnp", manufacturer: "Linkplay", model: "WiiM Pro Plus", caps: { user: { rates: [44100, 176400] }, verified: { rates: { "176400": "2026-10-02T10:00:00Z" } } } },
  { kind: "sonos", caps: {} }, { kind: "phone", caps: {} },
  { playable: true, id: "LOCAL_000000000001", kind: "local", network_name: "Chord Mojo", manufacturer: "Chord Electronics Ltd", model: "USB audio", location: "alsa:plughw:CARD=Mojo,DEV=0",
    caps: { advertised: { rates: [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000], bits: [24, 32] } } },
  { playable: true, id: "LOCAL_000000000002", kind: "local", network_name: "HDA Intel PCH (ALC892 Analog)", manufacturer: "", model: "Built-in", caps: { advertised: { rates: [], bits: [] } } },
  { playable: true, kind: "local", network_name: "Topping E30", manufacturer: "Topping", model: "USB audio", caps: { advertised: { rates: [96000], bits: [] } } },
  // As the register rows come back (registry.js): the advertised layer from parseSink, the family from discovery.
  { id: "UPNP_abc", kind: "upnp", family: "wiim", network_name: "Living Room", manufacturer: "Linkplay", model: "WiiM Pro Plus", caps: Object.assign({ playable: true }, { advertised: parseSink(SINK_WIIM) }) },
  { id: "UPNP_poly", kind: "upnp", family: "generic", manufacturer: "Chord Electronics Ltd", model: "Poly", caps: { playable: true, advertised: parseSink(SINK_POLY) } },
  { id: "UPNP_box", kind: "upnp", family: "openhome", manufacturer: "Acme", model: "Streamer", caps: { advertised: parseSink(SINK_PLAYBACK), verified: { rates: { "96000": "x" }, bits: { "24": "y" } } } }
];

const RE = (k, v) => v instanceof RegExp ? String(v) : v;
const plainProfile = p => JSON.parse(JSON.stringify(p, RE));
const guard = f => { try { return plain(f()); } catch (e) { return { threw: true }; } };

// ---------------------------------------------------------------- tests

test("lib/xml.js's trees: device documents, events, soup and DOCTYPEs read the same both ways", { skip }, () => {
  const groups = [
    ["samples", null, [...fakeDescriptions(), ...REAL_DESCRIPTIONS].map(d => d.xml).concat(EDGE_DESCRIPTIONS, REAL_NOTIFIES.filter(b => typeof b === "string"), DOCTYPES,
      [AVT_EVENT, RC_EVENT, DIDL, "<a>" + "<b>".repeat(99) + "</a>", "<a>" + "<b>".repeat(100) + "</a>", "<a>" + "<b>".repeat(101) + "</a>", "<a>" + "<b/>".repeat(300) + "</a>"])],
    ["soup", 3701, null], ["trees", 3702, null]
  ];
  for (const [what, seed, given] of groups) {
    let texts = given;
    if (!texts) {
      const r = rng(seed);
      texts = Array.from({ length: 1500 }, () => what === "soup" ? xmlSoup(r) : xmlTree(r));
    }
    const job = plain({ fn: "description", xml: texts });
    same("XML.parse " + what, job.xml, csharp(job).xml, job.xml.map(t => plain(XML.parse(t))), seed);
  }
});

test("URLs resolved as new URL resolves them: what devices write, and worse", { skip }, () => {
  const fixed = [
    { rel: "/x", base: "http://192.168.001.020:80/a" }, { rel: "ctl", base: "http://10.0.0.1:49152/d/desc.xml" }, { rel: "../../../up", base: "http://h/a/b/c" },
    { rel: "//other:8080/p", base: "http://h/" }, { rel: "\\\\x\\y", base: "http://h/a/b" }, { rel: "  \t/a\nb ", base: "http://h/" }, { rel: "?q", base: "http://h/p?old#f" },
    { rel: "#f", base: "urn:a" }, { rel: "x", base: "urn:a" }, { rel: "", base: "http://h/a?b#c" }, { rel: "http://[::ffff:192.168.1.1]:80/" }, { rel: "http://[1:0:0:2::3:0]/" },
    { rel: "http://[0:0:0:0:0:0:0:0]/" }, { rel: "http://[::1.2.3.4]/" }, { rel: "http://[::127.0.0.01]/" }, { rel: "http://[1::2::3]/" }, { rel: "file:///C|/x/../.." },
    { rel: "C|/x", base: "file:///D:/y" }, { rel: "/..", base: "file:///C:/" }, { rel: "file:c:\\x" }, { rel: "file://LOCALHOST/x" }, { rel: "sc:/..//p" }, { rel: "sc:/.//p" },
    { rel: "a: b ?x" }, { rel: "http://a@b@c/" }, { rel: "HTTP://User:Pa:ss@H.COM:0080/%7e?q r#f g" }, { rel: "http://h:65536/" }, { rel: "http://h:/x" }, { rel: "http://1.2.3.4.5/" },
    { rel: "http://0x/" }, { rel: "http://.0x/" }, { rel: "http://1.0x/" }, { rel: "http://a" + ch(0xAD) + "b/" }, { rel: "http://" + ch(0x3002) + "x/" }, { rel: "http://x%2e.com/" },
    { rel: "http://xn--/" }, { rel: "http://xn--a/" }, { rel: "http://-x.bücher.de/" }, { rel: "sc://ñ/x" }, { rel: "sc://a%3Cb/" }, { rel: "sc://[x]/" }, { rel: "http://h/" + LONE },
    { rel: "/x", base: "not a url" }, { rel: "/x", base: "" }, { rel: "/x", base: "null" }, { rel: "x", base: "sc:/x/y" }, { rel: "///x", base: "http://h/" }, { rel: "//", base: "http://h/" },
    { rel: "http:x", base: "http://h/a/b" }, { rel: "https:x", base: "http://h/a/b" }, { rel: "web+demo:/.//not-a-host/" }, { rel: "blob:http://h/uuid" }, { rel: "http://h" + "/a".repeat(200) + "/" + "../".repeat(150) }
  ];
  const r = rng(3703);
  const all = plain(fixed.concat(Array.from({ length: 2500 }, () => urlCase(r))));
  // Node's URL (ada 2.9.2, in Node 20 and 22 alike) takes a relative reference with a "#" past its
  // start against a base with an opaque path ("x#f" on "mailto:a" gives "mailto:a/x#f"), where the
  // standard, and ada itself without the "#", refuse it. The C# server keeps to the standard: those
  // are checked to fail there, and left out of the comparison.
  const strip = s => {
    let a = 0, b = s.length;
    while (a < b && s.charCodeAt(a) <= 0x20) a++;
    while (b > a && s.charCodeAt(b - 1) <= 0x20) b--;
    return s.slice(a, b).replace(/[\t\n\r]/g, "");
  };
  const adaQuirk = u => {
    if (u.base === undefined) return false;
    let b;
    try { b = new URL(u.base); } catch (e) { return false; }
    if (b.href.charAt(b.protocol.length) === "/") return false;
    try { new URL(u.rel); return false; } catch (e) { /* it needs the base */ }
    return strip(u.rel).indexOf("#") > 0;
  };
  const quirks = all.filter(adaQuirk).concat([{ rel: "x#f", base: "mailto:a" }, { rel: "/x#f", base: "mailto:a?b" }, { rel: "..#f", base: "mailto:a/b" }]);
  const cases = all.filter(u => !adaQuirk(u));
  const got = csharp({ fn: "description", urls: cases.concat(quirks) }).urls;
  const want = cases.map(u => { try { return new URL(u.rel, u.base).toString(); } catch (e) { return null; } });
  same("new URL", cases, got.slice(0, cases.length), want, 3703);
  same("new URL (ada's opaque-base quirk: the standard's failure)", quirks, got.slice(cases.length), quirks.map(() => null));
});

test("device descriptions: the fakes, real devices, sloppy and broken ones, and generated ones", { skip }, () => {
  const short = SERVICE_TYPES.concat(["urn:schemas-upnp-org:service:AVTransport:1", ":service:A:", ":SERVICE:b:", ":service:", ":service::x:", "x:service:y", null, undefined, 5, ":service:a:service:b:",
    ":" + LONG_S + "ervice:x:", ":service:\n:"]);
  const samples = [...fakeDescriptions(), ...REAL_DESCRIPTIONS];
  for (const xml of EDGE_DESCRIPTIONS) for (const location of EDGE_LOCATIONS) samples.push(location === undefined ? { xml } : { xml, location });
  samples.push({ xml: null, location: "http://x/" }, { xml: 5 }, { location: "http://x/" });
  const job = plain({ fn: "description", short, cases: samples });
  const got = csharp(job);
  same("shortType", job.short, got.short, job.short.map(t => shortType(t)));
  same("parseDescription (samples)", job.cases, got.parsed, job.cases.map(c => plain(parseDescription(c.xml, c.location))));

  const r = rng(3704);
  const gen = plain({ fn: "description", cases: Array.from({ length: 1200 }, () => genDescription(r)) });
  same("parseDescription (generated)", gen.cases, csharp(gen).parsed, gen.cases.map(c => plain(parseDescription(c.xml, c.location))), 3704);
});

test("GetProtocolInfo's Sink: containers, MIME types and rates only from raw PCM, the same both ways", { skip }, () => {
  const fixed = [SINK_WIIM, SINK_WIIM + ",http-get:*:video/mp4:*,http-get:*:audio/x-dsf:*,rtsp-rtp-udp:*:audio/L24;rate=96000:*", SINK_POLY, SINK_PLAYBACK, "", null, undefined, 0, 5, true, {}, ["a:b:audio/flac:*"],
    "http-get:*:audio/L16;rate=44100;channels=2:DLNA.ORG_PN=LPCM,http-get:*:audio/L16;rate=44100:*,http-get:*:audio/L24;rate=192000:*,http-get:*:audio/l16;rate=8000:*"];
  const r = rng(3705);
  const sinks = fixed.concat(Array.from({ length: 1500 }, () => genSink(r)));
  const mimes = SINK_FORMATS.concat(SINK_FORMATS.map(m => m.toUpperCase()), [null, 5, "audio/flac\n", "audio/flac" + LS, "audio/x-flacx", "xaudio/flac"]);
  const job = plain({ fn: "protocolinfo", sinks, mimes });
  const got = csharp(job);
  same("parseSink", job.sinks, got.sinks, job.sinks.map(s => plain(parseSink(s))), 3705);
  same("containerOf", job.mimes, got.containers, job.mimes.map(m => containerOf(m)));
});

test("GENA: NOTIFY bodies read into the same variables, the TIMEOUT header into the same lifetime", { skip }, () => {
  const seconds = genaSeconds();
  const r = rng(3706);
  const bodies = REAL_NOTIFIES.concat(Array.from({ length: 1500 }, () => genNotify(r)));
  const timeouts = TIMEOUTS.concat(Array.from({ length: 300 }, () => pick(r, ["", "Second-", "second-", "x", " "]) + pick(r, ["", String(Math.floor(r() * 1e6)), "0" + Math.floor(r() * 99), "-1", "infinite"]) + pick(r, ["", " ", ",Second-9", "s"])));
  const job = plain({ fn: "gena", bodies, timeouts });
  const got = csharp(job);
  assert.equal(got.timeout_s, G.TIMEOUT_S);
  same("parseNotify", job.bodies, got.notify, job.bodies.map(b => plain(G.parseNotify(b))), 3706);
  same("seconds", job.timeouts, got.seconds, plain(job.timeouts.map(t => seconds(t))), 3706);
});

test("profiles: the tables, the profile every model gets, and the chips with the layers they come from", { skip }, () => {
  const lookups = [];
  for (const model of PROFILE_MODELS) for (const manufacturer of PROFILE_MAKERS) for (const family of PROFILE_FAMILIES) {
    const device = {};
    if (model !== "") device.model = model;
    if (manufacturer !== "") device.manufacturer = manufacturer;
    if (family !== undefined) device.family = family;
    lookups.push({ device });
  }
  lookups.push({}, { device: null }, { device: "str" }, { device: 5 }, { device: [] }, { device: { model: ["WiiM", "Pro"] } }, { device: { model: {} } }, { device: { model: true } },
    { device: { manufacturer: "Chord", model: ["Poly"] } }, { device: { family: ["local"] } });
  const r = rng(3707);
  const records = REAL_RECORDS.map(record => ({ record })).concat([{}, { record: null }, { record: "str" }, { record: 5 }, { record: [] }],
    Array.from({ length: 1500 }, () => ({ record: genRecord(r) })));
  const job = plain({ fn: "profiles", lookups, records });
  const got = csharp(job);
  assert.deepStrictEqual(got.rates, PR.RATES);
  assert.deepStrictEqual(got.bits, PR.BITS);
  assert.deepStrictEqual(got.dsd, PR.DSD);
  assert.deepStrictEqual(got.floor, plain(PR.FLOOR));
  assert.equal(JSON.stringify(got.profiles), JSON.stringify(plainProfile(PR.PROFILES)));
  assert.equal(JSON.stringify(got.local), JSON.stringify(plainProfile(PR.LOCAL)));
  same("profileFor", job.lookups, got.profile, job.lookups.map(a => { try { return plainProfile(PR.profileFor(a.device)); } catch (e) { return { threw: true }; } }));
  same("effective", job.records, got.effective, job.records.map(x => guard(() => PR.effective(x.record))), 3707);
});
