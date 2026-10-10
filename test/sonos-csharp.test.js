"use strict";
/*
 * Stage 2's Sonos ports (v0.8.37, server/Mandarin.Server/Playback/) decide
 * what the Node server's decide: lib/xml.js's reading of XML (fast-xml-parser
 * as configured there), DIDL-Lite built byte for byte and read back
 * (lib/sonos/didl.js), the queue's move plans (lib/sonos/queue-moves.js), the
 * household read from a ZoneGroupState, the SSDP answer's headers and this
 * machine's LAN addresses (lib/sonos/topology.js), and the SOAP envelope sent
 * and the answer or fault read (lib/sonos/soap.js) — each asked of both, the
 * C# side through `mandarin-server score`, over what the repo's fakes and
 * real players send, awkward cases by hand and seeded generated ones, then
 * compared as JSON (key order too). Nothing of this runs in C# yet: playback
 * moves in stage 6. Skipped where the C# server isn't built.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { isDeepStrictEqual } = require("util");
const { spawnSync } = require("child_process");
const XML = require("../lib/xml");
const DIDL = require("../lib/sonos/didl");
const { planMoves } = require("../lib/sonos/queue-moves");
const TOPO = require("../lib/sonos/topology");
const SOAP = require("../lib/sonos/soap");
const { FakeHousehold } = require("./fake-sonos");
const { FakeRenderer } = require("./fake-renderer");

const BIN = process.env.MANDARIN_SERVER_BIN || path.join(__dirname, "..", "server", "bin", "mandarin-server");
const skip = !fs.existsSync(BIN) && "the C# server isn't built (server/build.sh)";

function csharp(job) {
  const r = spawnSync(BIN, ["score"], { input: JSON.stringify(job) + "\n", maxBuffer: 256 * 1024 * 1024 });
  assert.equal(r.status, 0, String(r.stderr));
  const out = JSON.parse(String(r.stdout).split("\n")[0]);
  assert.ok(!out.error, out.error);
  return out;
}
const plain = v => JSON.parse(JSON.stringify(v === undefined ? null : v));
const tryOr = f => { try { return f(); } catch (e) { return { threw: true }; } };

// A small seeded generator, so a failure can be run again.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
const int = (r, n) => Math.floor(r() * n);

/* Every case's answer the same both ways, key order included; the first that isn't is printed with where it came from. */
function same(what, labels, cases, got, want) {
  assert.equal(got.length, want.length, what + ": as many answers as cases");
  for (let i = 0; i < want.length; i++) {
    const w = plain(want[i]);
    if (!isDeepStrictEqual(got[i], w) || JSON.stringify(got[i]) !== JSON.stringify(w)) {
      assert.fail(`${what} #${i} (${labels[i]}) differs\ncase: ${JSON.stringify(cases[i])}\nnode: ${JSON.stringify(w)}\nc#:   ${JSON.stringify(got[i])}`);
    }
  }
}

/* A list of cases with a label each (where it came from, or its seed). */
class Cases {
  constructor() { this.items = []; this.labels = []; }
  add(label, ...items) { for (const x of items) { this.items.push(x); this.labels.push(label); } return this; }
}

// -- what goes into the documents --

const TEXTS = [
  "Kid A", "A & B", "Rock & Roll", "<b>bold</b>", "\"quoted\"", "it's", "a'b\"c<d>e&f", "Sigur Rós", "Björk", "日本語のアルバム", "Привет",
  "😀🎵", "\ud83c lone", "lone \udc00", "", " ", "  padded  ", "tab\there", "new\nline", "cr\r\nlf", "&amp;", "&lt;already&gt;", "&#38;",
  "&#0;", "]]>", "<![CDATA[x]]>", "x".repeat(3000), "\u0000nul", "\u0001ctl", "AC/DC", "Guns N' Roses", "100%", "#hash", "?q=1&r=2",
  "\u00a0nbsp\u00a0", "\ufeffbom", "Zero\u200bwidth", "toString", "__proto__", "constructor", "Ünïcode Ⅻ ½"
];
const VALUES = [null, 0, 7, 3.5, -1, true, false, [], ["x"], ["a", "b"], {}, { a: 1 }, "0", "NaN"];
const DURATIONS = [0, 1, 59, 60, 125, 3599, 3600, 3661, 86399, 86400, 359999, 1e6, 1e20, 0.5, 125.9, -5, -0.5, "125", "1:02", "abc",
  "Infinity", "-Infinity", "1e3", " 42 ", "0x10", "", null, true, false, [5], ["7"], [], {}, "1e400", "0b11", "0o7", "12abc", "\u00a07\u00a0"];
const MIMES = ["audio/flac", "audio/mpeg", "audio/x-flac", "audio/mp4", "audio/L16;rate=44100;channels=2", "audio/dsf", "audio/x-dsf", "", null, 5, "a&b<c>\"'"];
const URIS = ["http://10.0.0.2:3500/stream/t42.flac?s=abc&e=123", "http://h:1/stream/t5.flac", "x-rincon-queue:RINCON_1#0", "x-sonos-spotify:spotify%3atrack%3a6rq?sid=12&flags=8224",
  "http://[fe80::1]:3500/stream/t1.48000-24.flac?o=dev%20one&g=-3.5", "", null, undefined, 42, "a<b>&\"'", "http://x/" + "p".repeat(500)];

function genMeta(r) {
  const val = list => r() < 0.12 ? pick(r, VALUES) : pick(r, list);
  const m = {};
  const maybe = (k, f, p = 0.6) => { if (r() < p) m[k] = f(); };
  maybe("title", () => val(TEXTS), 0.85);
  maybe("artist", () => val(TEXTS));
  maybe("album", () => val(TEXTS));
  maybe("albumArtist", () => val(TEXTS), 0.4);
  maybe("artUri", () => val(["http://10.0.0.2:3500/api/image/a%20b?size=600&s=x", "/getaa?s=1&u=x", "", "u-1"]), 0.5);
  maybe("trackNumber", () => val([1, 12, "3", "03", "", 0, "1/12"]), 0.5);
  maybe("duration", () => pick(r, DURATIONS), 0.7);
  maybe("mime", () => pick(r, MIMES), 0.7);
  maybe("itemId", () => val(["musicd-t42", "-1", "Q:0/1", "", "a&b"]), 0.5);
  maybe("sampleFrequency", () => val([44100, 48000, 96000, "44100", 0, "abc", 44100.5]), 0.25);
  maybe("bitsPerSample", () => val([16, 24, 32, "24", 0]), 0.25);
  maybe("nrAudioChannels", () => val([2, 1, 6, "2", 0]), 0.25);
  return m;
}

/* A document changed a little or a lot: bits cut, repeated, or markup of every kind dropped in. */
const FRAGMENTS = ["<", ">", "&", "&amp;", "&#38;", "&#0;", "&#x1;", "&#9;", "&#xD800;", "&lt;", "\"", "'", "\t", "\r\n", "\r", " ", "/", "=",
  "<![CDATA[ c&d ]]>", "<![CDATA[", "<!-- c -->", "<!--", "-->", "</item>", "<item>", "<item id=\"x\">", "</DIDL-Lite>", "<DIDL-Lite>",
  "<res duration=\"1:00\">u</res>", "<dc:title>T</dc:title>", "<?xml version=\"1.0\"?>", "<?xml version=\"1.1\"?>", "<?pi", "?>", "<a/>",
  "<toString/>", "<valueOf>v</valueOf>", "<#text/>", "<constructor>", "<x:y:z>", "<@id>5</@id>", "<a::@>q</a::@>", "<!x>", "< a>", "<>", "</>",
  "<!DOCTYPE d [<!ENTITY e \"v\">]>", "&e;", "<!DOCTYPE>", "xmlns:q=\"u\"", "\u00a0", "\ufeff", "😀", "<r:streamContent>S - T</r:streamContent>",
  "<ZoneGroupMember UUID=\"RINCON_X\" ZoneName=\"X\"/>", "</ZoneGroup>", "<ZoneGroup Coordinator=\"C\">", "Invisible=\"1\"", "<s:Fault>", "</s:Body>"];
/* Text made of XML's own characters and words, in no order: every path through the reader. */
const SOUP = ["<", "<", "<", ">", ">", "/", "?", "!", "-", "--", "[", "]", "]]>", "CDATA", "DOCTYPE", "ENTITY", "ELEMENT", "\"", "'", "=", "&", ";", "#", "#x",
  "x", "a", "b", ":", "::", " ", "\t", "\n", "\r", "\u00a0", "\u2028", "\ufeff", "item", "text", "#text", "toString", "1", "0", "amp", "lt", "@", "xmlns", "e", "%", "SYSTEM"];
function soup(r) {
  let s = "";
  for (let n = int(r, 60); n > 0; n--) s += pick(r, SOUP);
  return s;
}
function mutate(r, s) {
  for (let n = 1 + int(r, 4); n > 0; n--) {
    const at = int(r, s.length + 1);
    const op = r();
    if (op < 0.3) s = s.slice(0, at) + s.slice(at + 1 + int(r, 12));
    else if (op < 0.75) s = s.slice(0, at) + pick(r, FRAGMENTS) + s.slice(at);
    else if (op < 0.9) { const b = int(r, s.length + 1); s = s.slice(0, Math.min(at, b)) + s.slice(Math.min(at, b), Math.max(at, b)).repeat(2) + s.slice(Math.max(at, b)); }
    else s = s.slice(0, at);
  }
  return s;
}

// -- the fakes' own answers, as the tests' players give them --

const AVT = "urn:schemas-upnp-org:service:AVTransport:1";
const ZGT = "urn:schemas-upnp-org:service:ZoneGroupTopology:1";
const CD = "urn:schemas-upnp-org:service:ContentDirectory:1";
// As test/fake-sonos.js and test/fake-renderer.js write them.
function envelope(action, service, args) {
  const body = Object.entries(args || {}).map(([k, v]) => `<${k}>${XML.escape(v)}</${k}>`).join("");
  return `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>` +
    `<u:${action}Response xmlns:u="${service}">${body}</u:${action}Response></s:Body></s:Envelope>`;
}
function fault(code, desc) {
  return `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault>` +
    `<faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail>` +
    `<UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>${code}</errorCode>${desc != null ? `<errorDescription>${desc}</errorDescription>` : ""}</UPnPError>` +
    `</detail></s:Fault></s:Body></s:Envelope>`;
}

/* A household of the fakes' rooms, grouped and queued, and what its rooms answer. */
function fakeAnswers() {
  const house = new FakeHousehold([
    { uid: "RINCON_KITCHEN01400", name: "Kitchen", ip: "10.0.0.5" },
    { uid: "RINCON_STUDY001400", name: "Study", ip: "10.0.0.6", model: "Sonos Era 100" },
    { uid: "RINCON_LOUNGE01400", name: "Lounge & Bar", ip: "10.0.0.7" }
  ]);
  const zgs = [house.zgs()];
  house.rooms[1].coordinator = "RINCON_KITCHEN01400";
  zgs.push(house.zgs());
  const kitchen = house.room("Kitchen");
  const metas = [
    { itemId: "musicd-t42", title: "Paranoid Android", artist: "Radiohead", albumArtist: "Radiohead", album: "OK Computer", artUri: "http://10.0.0.2:3500/api/image/a1?size=600&s=sig", trackNumber: 2, duration: 383, mime: "audio/flac" },
    { title: "Hyperballad", artist: "Björk", album: "Post", duration: 321.4, mime: "audio/mpeg" },
    { title: "Rock & Roll <Live>", artist: "Led \"Zep\"", album: "How the West Was Won", duration: 0 },
    { itemId: "musicd-t7", title: "x", sampleFrequency: 96000, bitsPerSample: 24, nrAudioChannels: 2, duration: 61, mime: "audio/flac" }
  ];
  for (const [i, m] of metas.entries()) {
    const uri = `http://10.0.0.2:3500/stream/t${i + 1}.flac?s=a&e=${i}`;
    kitchen.queue.push({ uri, meta: DIDL.build(uri, m) });
  }
  kitchen.currentUri = "x-rincon-queue:RINCON_KITCHEN01400#0";
  kitchen.track = 2;
  const answers = [
    ["GetZoneGroupState", ZGT, kitchen.handle("GetZoneGroupState", {})],
    ["Browse", CD, kitchen.handle("Browse", { StartingIndex: "0", RequestedCount: "100" })],
    ["Browse", CD, kitchen.handle("Browse", { StartingIndex: "2", RequestedCount: "1" })],
    ["GetPositionInfo", AVT, kitchen.handle("GetPositionInfo", {})],
    ["GetMediaInfo", AVT, kitchen.handle("GetMediaInfo", {})],
    ["GetTransportInfo", AVT, kitchen.handle("GetTransportInfo", {})],
    ["GetTransportSettings", AVT, kitchen.handle("GetTransportSettings", {})],
    ["AddURIToQueue", AVT, kitchen.handle("AddURIToQueue", { EnqueuedURI: "http://x/1.flac", EnqueuedURIMetaData: metas[0] && DIDL.build("http://x/1.flac", metas[0]), DesiredFirstTrackNumberEnqueued: "0" })],
    ["GetVolume", "urn:schemas-upnp-org:service:RenderingControl:1", kitchen.handle("GetVolume", {})],
    ["GetPositionInfo", AVT, house.room("Study").handle("GetPositionInfo", {})]
  ];
  const renderer = new FakeRenderer({ name: "Streamer", udn: "uuid:fake-1" });
  renderer.handle("SetAVTransportURI", { CurrentURI: "http://10.0.0.2:3500/stream/t9.flac", CurrentURIMetaData: DIDL.build("http://10.0.0.2:3500/stream/t9.flac", metas[3]) });
  answers.push(["GetPositionInfo", AVT, renderer.handle("GetPositionInfo", {})], ["GetMediaInfo", AVT, renderer.handle("GetMediaInfo", {})]);
  return { zgs, metas, answers };
}

// -- what real players send --

const DIDL_OPEN = '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">';
const REAL_DIDL = [
  // A queue Browsed: a streaming service's tracks, entities in the URIs and attributes.
  DIDL_OPEN + '<item id="Q:0/1" parentID="Q:0" restricted="true"><res protocolInfo="sonos.com-spotify:*:audio/x-spotify:*" duration="0:04:21">x-sonos-spotify:spotify%3atrack%3a6rqhFgbbKwnb9MLmUQDhG6?sid=12&amp;flags=8224&amp;sn=3</res><upnp:albumArtURI>/getaa?s=1&amp;u=x-sonos-spotify%3aspotify%253atrack%253a6rq%3fsid%3d12%26flags%3d8224</upnp:albumArtURI><dc:title>Speak to Me</dc:title><upnp:class>object.item.audioItem.musicTrack</upnp:class><dc:creator>Pink Floyd</dc:creator><upnp:album>The Dark Side of the Moon</upnp:album></item>' +
    '<item id="Q:0/2" parentID="Q:0" restricted="true"><res protocolInfo="http-get:*:audio/flac:*" duration="0:03:45.123">http://10.0.0.2:3500/stream/t2.flac?s=x&amp;e=1</res><dc:title>Breathe (In the Air)</dc:title><upnp:class>object.item.audioItem.musicTrack</upnp:class><dc:creator>Pink Floyd</dc:creator><r:albumArtist>Pink Floyd</r:albumArtist><upnp:album>The Dark Side of the Moon</upnp:album></item></DIDL-Lite>',
  // A radio station playing: the title is the stream's URI, what's on is streamContent.
  DIDL_OPEN + '<item id="-1" parentID="-1" restricted="true"><res protocolInfo="sonos.com-http:*:application/octet-stream:*">x-sonosapi-stream:s24940?sid=254&amp;flags=8224&amp;sn=0</res><r:streamContent>BBC Radio 6 Music - Khruangbin - Maria También</r:streamContent><r:radioShowMd></r:radioShowMd><upnp:albumArtURI>/getaa?s=1&amp;u=x-sonosapi-stream%3as24940%3fsid%3d254</upnp:albumArtURI><dc:title>x-sonosapi-stream:s24940?sid=254&amp;flags=8224&amp;sn=0</dc:title><upnp:class>object.item</upnp:class></item></DIDL-Lite>',
  // The TV, line-in, and a saved queue (a container).
  DIDL_OPEN + '<item id="RINCON_48A6B8B5614E01400" parentID="-1" restricted="true"><dc:title>TV</dc:title><upnp:class>object.item.audioItem</upnp:class><res protocolInfo="x-sonos-htastream:*:*:*">x-sonos-htastream:RINCON_48A6B8B5614E01400:spdif</res></item></DIDL-Lite>',
  DIDL_OPEN + '<container id="SQ:3" parentID="SQ:" restricted="true"><dc:title>Friday &amp; Saturday</dc:title><upnp:class>object.container.playlistContainer</upnp:class><res protocolInfo="file:*:audio/mpegurl:*">file:///jffs/settings/savedqueues.rsq#3</res></container><item id="SQ:3/1" parentID="SQ:3"><dc:title>One</dc:title><res duration="NOT_IMPLEMENTED">u</res></item></DIDL-Lite>',
  // As some renderers write it: a declaration, white space, upper-case prefixes, durations of every form.
  '<?xml version="1.0" encoding="UTF-8"?>\r\n<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/">\r\n  <item id="1" parentID="0" restricted="1">\r\n    <dc:title>  Spaced  </dc:title>\r\n    <res protocolInfo="http-get:*:audio/mpeg:*" duration="1:00:00:00">http://h/a.mp3</res>\r\n    <res duration="0:01:00">http://h/second.mp3</res>\r\n  </item>\r\n  <item id="2"><dc:title><![CDATA[Cee & Data <x>]]></dc:title><res duration=" 3:45 ">u2</res></item>\r\n  <item id="3"><dc:title>T3</dc:title><res duration="">u3</res></item>\r\n  <item><res duration="-1:30">u4</res></item>\r\n</DIDL-Lite>',
  "NOT_IMPLEMENTED", "", " ", "<DIDL-Lite/>", "<DIDL-Lite></DIDL-Lite>", "<DIDL-Lite>text only</DIDL-Lite>", "<DIDL-Lite><item/></DIDL-Lite>",
  "<DIDL-Lite><item>bare</item><container/></DIDL-Lite>", "<DIDL-Lite><item id=\"a\" id=\"b\"><title>t</title><title>u</title><res>r1</res></item></DIDL-Lite>",
  "<DIDL-Lite><item><@id>5</@id><title><#text/></title><res><#text/></res><res><#text/></res></item></DIDL-Lite>",
  "<DIDL-Lite></DIDL-Lite><DIDL-Lite><item id=\"2\"/></DIDL-Lite>", "<x:DIDL-Lite><y:item id=\"q\"><z:title>ns</z:title></y:item></x:DIDL-Lite>",
  "<DIDL-Lite><item id=\"&amp;&lt;&#38;&#0;&quot;&apos;&bogus;\"><dc:title>&amp;amp; &#x26; &#1; &#9;</dc:title></item></DIDL-Lite>",
  "<?xml version=\"1.1\"?><DIDL-Lite><item><dc:title>&#1;&#x1F;</dc:title></item></DIDL-Lite>",
  "<!DOCTYPE DIDL-Lite [<!ENTITY art \"Pink Floyd\"><!ENTITY bad \"<script>\"><!ELEMENT x EMPTY><!NOTATION n SYSTEM \"s\">]><DIDL-Lite><item><dc:creator>&art;</dc:creator><dc:title>&bad;</dc:title></item></DIDL-Lite>",
  "<DIDL-Lite><item><dc:title>open", "<DIDL-Lite><item><dc:title>x</dc:title><!-- unclosed", "<DIDL-Lite><item id=\"unterminated></item></DIDL-Lite>",
  "<DIDL-Lite>" + "<item>".repeat(99) + "</DIDL-Lite>", "<DIDL-Lite>" + "<item>".repeat(100) + "</DIDL-Lite>",
  "<DIDL-Lite><item><toString>t</toString><constructor/></item></DIDL-Lite>", "<DIDL-Lite><item><valueOf/><title>v</title></item></DIDL-Lite>",
  "<DIDL-Lite>\t<item\tid=\"tab\"\tparentID='q'><dc:title\tx=\"1\">t</dc:title></item></DIDL-Lite>"
];

const REAL_ZGS = [
  // S2: a home theatre with its sub and surrounds as satellites, a pair, a room grouped to it, a BOOST, and one vanished.
  '<ZoneGroupState><ZoneGroups><ZoneGroup Coordinator="RINCON_48A6B8B5614E01400" ID="RINCON_48A6B8B5614E01400:3961805117"><ZoneGroupMember UUID="RINCON_48A6B8B5614E01400" Location="http://192.168.1.101:1400/xml/device_description.xml" ZoneName="Living Room" Icon="" Configuration="1" SoftwareVersion="78.1-52020" SWGen="2" MinCompatibleVersion="77.0-00000" LegacyCompatibleVersion="58.0-00000" HTSatChanMapSet="RINCON_48A6B8B5614E01400:LF,RF;RINCON_542A1B5D3E9201400:SW;RINCON_7828CA0A1B2C01400:LR;RINCON_7828CA0A1B2D01400:RR" BootSeq="14" TVConfigurationError="0" HdmiCecAvailable="1" WirelessMode="0" WirelessLeafOnly="0" ChannelFreq="2437" BehindWifiExtender="0" WifiEnabled="1" EthLink="1" Orientation="0" RoomCalibrationState="4" SecureRegState="3" VoiceConfigState="2" MicEnabled="1" AirPlayEnabled="1" IdleState="1" MoreInfo="" SSLPort="1443" HHSSLPort="1843">' +
    '<Satellite UUID="RINCON_542A1B5D3E9201400" Location="http://192.168.1.102:1400/xml/device_description.xml" ZoneName="Living Room" Icon="" Configuration="1" Invisible="1" SoftwareVersion="78.1-52020" HTSatChanMapSet="RINCON_48A6B8B5614E01400:LF,RF;RINCON_542A1B5D3E9201400:SW"/>' +
    '<Satellite UUID="RINCON_7828CA0A1B2C01400" Location="http://192.168.1.103:1400/xml/device_description.xml" ZoneName="Living Room" Invisible="1" HTSatChanMapSet="RINCON_48A6B8B5614E01400:LF,RF;RINCON_7828CA0A1B2C01400:LR"/></ZoneGroupMember>' +
    '<ZoneGroupMember UUID="RINCON_000E58AABBCC01400" Location="http://192.168.1.104:1400/xml/device_description.xml" ZoneName="Dining Room" SoftwareVersion="78.1-52020"/></ZoneGroup>' +
    '<ZoneGroup Coordinator="RINCON_B8E9372C1A2B01400" ID="RINCON_B8E9372C1A2B01400:12"><ZoneGroupMember UUID="RINCON_B8E9372C1A2B01400" Location="http://192.168.1.110:1400/xml/device_description.xml" ZoneName="Kitchen" ChannelMapSet="RINCON_B8E9372C1A2B01400:LF,LF;RINCON_B8E9372C1A2C01400:RF,RF" SoftwareVersion="78.1-52020"/>' +
    '<ZoneGroupMember UUID="RINCON_B8E9372C1A2C01400" Location="http://192.168.1.111:1400/xml/device_description.xml" ZoneName="Kitchen" ChannelMapSet="RINCON_B8E9372C1A2B01400:LF,LF;RINCON_B8E9372C1A2C01400:RF,RF" Invisible="1"/></ZoneGroup>' +
    '<ZoneGroup Coordinator="RINCON_000E58B00B5701400" ID="RINCON_000E58B00B5701400:5"><ZoneGroupMember UUID="RINCON_000E58B00B5701400" Location="http://192.168.1.120:1400/xml/device_description.xml" ZoneName="BOOST" IsZoneBridge="1" SoftwareVersion="78.1-52020"/></ZoneGroup>' +
    '</ZoneGroups><VanishedDevices><Device UUID="RINCON_DEAD0001400" ZoneName="Bathroom" Reason="powered off"/></VanishedDevices></ZoneGroupState>',
  // S1: the groups at the root.
  '<ZoneGroups><ZoneGroup Coordinator="RINCON_000E5859E49601400" ID="RINCON_000E5859E49601400:0"><ZoneGroupMember UUID="RINCON_000E5859E49601400" Location="http://10.1.1.20:1400/xml/device_description.xml" ZoneName="Office &amp; Den" Icon="x-rincon-roomicon:office" SoftwareVersion="57.3-77280" Invisible="0" IsZoneBridge="0"/></ZoneGroup></ZoneGroups>',
  // test/topology.test.js's.
  `<ZoneGroupState><ZoneGroups>
<ZoneGroup Coordinator="RINCON_A" ID="RINCON_A:1">
 <ZoneGroupMember UUID="RINCON_A" ZoneName="Kitchen" Location="http://10.0.0.5:1400/xml/device_description.xml"/>
 <ZoneGroupMember UUID="RINCON_B" ZoneName="Dining" Location="http://10.0.0.6:1400/xml/device_description.xml"/>
</ZoneGroup>
<ZoneGroup Coordinator="RINCON_C" ID="RINCON_C:2">
 <ZoneGroupMember UUID="RINCON_C" ZoneName="Lounge" Location="http://10.0.0.7:1400/xml/device_description.xml" ChannelMapSet="RINCON_C:LF,LF;RINCON_D:RF,RF"/>
 <ZoneGroupMember UUID="RINCON_SUB" ZoneName="Lounge" Invisible="1" Location="http://10.0.0.8:1400/xml/device_description.xml"/>
</ZoneGroup>
</ZoneGroups></ZoneGroupState>`,
  "", "   ", "garbage", "<ZoneGroupState/>", "<ZoneGroupState>text</ZoneGroupState>", "<ZoneGroupState><ZoneGroups/></ZoneGroupState>",
  "<ZoneGroupState></ZoneGroupState><ZoneGroups><ZoneGroup><ZoneGroupMember UUID=\"U\"/></ZoneGroup></ZoneGroups>",
  "<ZoneGroupState><ZoneGroups>bare</ZoneGroups></ZoneGroupState>", "<ZoneGroups><ZoneGroup>bare</ZoneGroup><ZoneGroup Coordinator=\"C\"><ZoneGroupMember>bare</ZoneGroupMember></ZoneGroup></ZoneGroups>",
  "<ZoneGroups><ZoneGroup Coordinator=\"C\" ID=\"I\"><ZoneGroupMember UUID=\"\"/><ZoneGroupMember ZoneName=\"no uid\"/><ZoneGroupMember UUID=\"U\" ZoneName=\"\" Location=\"\"/></ZoneGroup></ZoneGroups>",
  "<ZoneGroups><ZoneGroup><ZoneGroupMember><@UUID>obj</@UUID><@ZoneName><a>1</a></@ZoneName><@Location>http://10.0.0.9/</@Location></ZoneGroupMember></ZoneGroup><ZoneGroup><@Coordinator>x</@Coordinator><@Coordinator>y</@Coordinator><ZoneGroupMember UUID=\"V\"><@SoftwareVersion>1</@SoftwareVersion><@ChannelMapSet>V:LF;W:RF</@ChannelMapSet></ZoneGroupMember></ZoneGroup></ZoneGroups>",
  "<ZoneGroups><ZoneGroup Coordinator=\"A\"><ZoneGroupMember UUID=\"A\" ChannelMapSet=\"__proto__:LF;size:RF\"/></ZoneGroup></ZoneGroups>",
  "<ZoneGroups><ZoneGroup Coordinator=\"A\"><ZoneGroupMember UUID=\"A\" ChannelMapSet=\"__proto__:LF;B:RF;1:LF;0:rf , lf\" Location=\" http://10.0.0.1:1400/ \"/></ZoneGroup></ZoneGroups>"
];

const LOCATIONS = ["http://10.0.0.5:1400/xml/device_description.xml", "http://192.168.1.23:1400/xml/device_description.xml", "http://[fe80::1]:1400/x", "http://host.local:1400/",
  "HTTP://EXAMPLE.COM:1400/", "", "not a url", "http://10.0.0.256:1400/", "http://0x0a.0.0.5/", "http://1.2.3/", "https://user:pw@10.1.1.1:443/", "http://10.0.0.5:99999/",
  "http://10.0.0.5:abc/", "http://10.0.0.5:/", "file:///x", "file://host/x", "file://LOCALHOST/x", "file://C:/x", "x-rincon:RINCON", "sonos://Kitchen/", "sonos://K%C3%BCche/", "sonos://Kü che/",
  "http://münchen.de/", "http://ＥＸＡＭＰＬＥ.com/", "http://日本.jp/", "http://ex%41mple/", "http://%zz/", "http://a%00b/", "http:\\\\10.0.0.9\\x", " http://10.0.0.7:1400/ ",
  "http://a b/", "http://xn--mnchen-3ya.de/", "http://XN--MNCHEN-3YA.de/", "http://xn--a.com/", "http://xn--/", "http://xn--abc-.com/", "http://[::ffff:1.2.3.4]/", "http://[1:2:3:4:5:6:7:8]:1400/",
  "http://[1:0:0:2:0:0:0:3]/", "http://[0:0:0:0:0:0:0:0]/", "http://[::1", "http://[::1]x/", "http://[1::2::3]/", "http://[::1.2.3.256]/", "http://[1:2:3:4:5:6:7:8:9]/",
  "http://999999999/", "http://4294967295/", "http://4294967296/", "http://a..b/", "http://a./", "http://./", "http://-a-.com/", "http://😀.com/", "http://a。b/",
  "foo://", "foo://:80", "foo:/x", "http://user@/", "http://@host/", "http://a@b@c/", "http:x", "http:/x", "ws://10.0.0.1/", "ftp://10.0.0.1:21/", "1http://x/",
  "http://0x/", "http://09/", "http://1.2.3.4.5/", "http://1.2.3.4./", "http://ab_c/", "http://a*b/", "http://a^b/", "http://a|b/", "http://1e2/", "http://1.0x/", "http://0x100000000/",
  "http://\u0000x/", "\u0001http://x/\u001f", "http://h\t\n/", "http://x/#frag", "http://x?q", "http://\ud800/"];

// -- the tests --

test("XML read as lib/xml.js reads it: the same tree for every document, sloppy or broken; escape, text and list", { skip }, () => {
  const { zgs, answers } = fakeAnswers();
  const docs = new Cases();
  docs.add("real DIDL", ...REAL_DIDL).add("real ZoneGroupState", ...REAL_ZGS).add("fake household", ...zgs);
  for (const [action, service, args] of answers) docs.add(`fake ${action}`, envelope(action, service, args));
  for (const c of [401, 402, 501, 701, 714, 800, "abc", ""]) docs.add("fault", fault(c), fault(c, "Described & <escaped>"));
  docs.add("by hand", "<a><#text/></a>", "<a><b><#text/></b><b>x</b></a>", "<a>x<#text/>y</a>", "<?>", "< a>t</ a>", "abc<?pi?>", "abc</x>", "<a>1<!--c-->2</a>",
    "<![]]>xyz", "<!xml><b/>t<c/></!xml>", "<a/ >t</a/>", "<a b=\"1\" b=\"2\" c=x d e=\"q' f='v'/>", "<x:a x:b=\"1\" xmlns=\"u\" xmlns:x=\"v\" :c=\"2\" d:=\"3\" a:b:c=\"4\" />",
    "<a>&#0;&#x1;&#9;&#x0x1;&#0x41;&# 1;&#-0;&#xD800;&#xFFFF;&#x110000;&#99999999999999999999;</a>", "<?xml version=\"1.10\"?><a>&#1;</a>", "<?foo version=\"1.1\"?><a>&#1;</a>",
    "<a>&" + "x".repeat(31) + ";&" + "y".repeat(33) + ";</a>", "<1>one</1><b>bee</b><0>zero</0>", "<a><1/><b/><0/></a>", "<a x=\"&amp;&#38;\" y='&apos;' z=\" \t pad \t \"/>",
    "<!DOCTYPE d [<!ENTITY e \"<script>\"><!ENTITY f \"ok\">]><a>&e;&f;</a>", "<!DOCTYPE d><a/>", "<!DOCTYPE d [<!ENTITY e SYSTEM \"x\">]><a/>", "<!DOCTYPE d [<!ENTITY 1e \"x\">]><a/>",
    "<!DOCTYPE d [<!-- c --><!ENTITY e 'quoted'>]><a>&e;</a>", "<!DOCTYPE d [<!ENTITY a \"1\">]><!DOCTYPE e><a/>", "<!Dx>", "<!DOCTYPE d [<!ATTLIST a b CDATA #IMPLIED>]><a/>",
    "<!DOCTYPE d [<!ENTITY big \"" + "z".repeat(10001) + "\">]><a/>", "<!DOCTYPE d [<!ENTITY e \"" + "w".repeat(9000) + "\">]><a>" + "&e;".repeat(12) + "</a>",
    "<a>" + "<b>".repeat(100) + "</a>", "<a>" + "<b>".repeat(101) + "</a>", "<a><hasOwnProperty/><__lookupGetter__>x</__lookupGetter__></a>", "<a><prototype/></a>", "<__proto__/>",
    "<a></constructor>", "<#text>x</#text>", "<x:#text>y</x:#text>", "<![CDATA[top]]>", "<a><![CDATA[]]></a>", "<a>\r\n x \r y \n</a>", "\ufeff<a>bom</a>", "<a>\u00a0nb\u00a0</a>",
    "<a b=\"1\"/><a>t</a><a c=\"2\">u</a>", "<a>t<b/>u<c>v</c>w</a>", "<?xml version=\"1.0\"?>", "<?xml?>", "<?pi unclosed", "<!-- -->", "<!---->", "<!-->", "<a", "</a>", "<", ">",
    "text", "<a>&#x;&#;&#x-1;&;&amp</a>", "<a b=\"x\"c=\"y\"d='z'/>", "<a b = \"spaced\" />", "<a b=>", "<a ===/>", "<a/><a/>", "<a><b>1</b><b><c/></b><b/></a>");
  const r = rng(20261010);
  const all = docs.items.slice();
  for (let i = 0; i < 1200; i++) {
    const seed = 1000 + i, g = rng(seed);
    docs.add(`seed ${seed}`, mutate(g, pick(g, all)));
  }
  for (let i = 0; i < 1500; i++) {
    const seed = 3000 + i;
    docs.add(`seed ${seed}, soup`, soup(rng(seed)));
  }
  for (let i = 0; i < 100; i++) docs.add("not a string", pick(r, [null, 5, true, [], {}, ["<a/>"], { a: 1 }]));
  const job = plain({ docs: docs.items });
  same("XML.parse", docs.labels, job.docs, csharp({ fn: "xml", ...job }).trees, job.docs.map(XML.parse));

  const vals = TEXTS.concat(VALUES, [null, "", 1.5e300, -0, 1e21, 123456789012, "&<>\"'"]);
  const helpers = plain({ escapes: vals, texts: vals.concat([{ "#text": "t" }, { "#text": "" }, { "#text": null }, { "#text": [] }, { "#text": "x", "@a": "1" }, [{ "#text": "a" }]]), lists: vals });
  const got = csharp({ fn: "xml", ...helpers });
  const lab = n => Array(n).fill("helper");
  same("XML.escape", lab(helpers.escapes.length), helpers.escapes, got.escaped, helpers.escapes.map(XML.escape));
  same("XML.text", lab(helpers.texts.length), helpers.texts, got.texts, helpers.texts.map(XML.text));
  same("XML.list", lab(helpers.lists.length), helpers.lists, got.lists, helpers.lists.map(XML.list));
});

test("DIDL-Lite: built byte for byte, and read back (items, durations, hms) from every kind of document", { skip }, () => {
  const { metas, answers } = fakeAnswers();
  const builds = new Cases();
  builds.add("topology.test.js", { uri: "http://h:1/stream/t5.flac", meta: { title: "A & B", artist: "X", album: "Y", duration: 125, mime: "audio/flac" } });
  for (const m of metas) builds.add("fake household", { uri: "http://10.0.0.2:3500/stream/t1.flac?s=a&e=1", meta: m });
  builds.add("by hand", { uri: "u" }, { uri: "u", meta: null }, { uri: "u", meta: {} }, { uri: "u", meta: "str" }, { uri: "u", meta: [1] }, { uri: "u", meta: 5 },
    { meta: { title: "no uri" } }, { uri: null, meta: { duration: "Infinity" } }, { uri: "u", meta: { duration: 1e20, sampleFrequency: "abc", bitsPerSample: [24], nrAudioChannels: true } },
    { uri: "u", meta: { title: 0, artist: false, album: "", albumArtist: null, artUri: [], trackNumber: {}, mime: {}, itemId: 0 } });
  for (let i = 0; i < 800; i++) {
    const seed = 5000 + i, g = rng(seed);
    const c = { uri: pick(g, URIS) };
    if (g() < 0.95) c.meta = genMeta(g);
    builds.add(`seed ${seed}`, c);
  }
  const bjob = plain({ builds: builds.items });
  const out = csharp({ fn: "didl", ...bjob });
  same("DIDL.build", builds.labels, bjob.builds, out.built, bjob.builds.map(c => tryOr(() => DIDL.build(c.uri, c.meta))));
  assert.equal(out.sentinel, DIDL.CDUDN_SENTINEL);

  // Read back: what was built, what the fakes and real players send (inside SOAP too), and all of it damaged.
  const docs = new Cases();
  docs.add("built", ...out.built.filter(x => typeof x === "string"));
  docs.add("real DIDL", ...REAL_DIDL);
  for (const [action, service, args] of answers) {
    const res = SOAP.parseResponse(envelope(action, service, args), action);
    for (const v of Object.values(res)) docs.add(`fake ${action}, unwrapped`, v);
  }
  for (const d of REAL_DIDL.slice(0, 5)) {
    const body = envelope("GetPositionInfo", AVT, { Track: "1", TrackDuration: "0:04:21", TrackMetaData: d, TrackURI: "x-sonos-spotify:a?b=1&c=2", RelTime: "0:00:10" });
    docs.add("real, unwrapped from SOAP", SOAP.parseResponse(body, "GetPositionInfo").TrackMetaData);
  }
  const seen = docs.items.slice();
  for (let i = 0; i < 1000; i++) {
    const seed = 9000 + i, g = rng(seed);
    docs.add(`seed ${seed}`, mutate(g, pick(g, seen)));
  }
  docs.add("not a string", null, 5, {}, ["<DIDL-Lite/>"]);
  const hms = DURATIONS.concat(VALUES, [59.999, 3599.5, 1e15, 2 ** 53, -1e-9, "  60  ", 1e21, 123456.789]);
  const seconds = ["0:00:00", "0:03:45", "0:03:45.5", "1:00:00:00", "3:45", "45", ":", "::", "1:", ":30", " 1 : 2 ", "1:-30", "NOT_IMPLEMENTED", " NOT_IMPLEMENTED ", "not_implemented",
    "a:b", "1:2:x", "0x10:0b1", "Infinity", "1e3:1", "", null, 0, 125, true, [], ["1:00"], {}, "1:00:00\u00a0", "\ufeff1:00", "１:00", "-0", "-1:-1"];
  const djob = plain({ docs: docs.items, hms, seconds });
  const got = csharp({ fn: "didl", ...djob });
  same("DIDL.parseItems", docs.labels, djob.docs, got.items, djob.docs.map(d => DIDL.parseItems(d)));
  same("DIDL.hms", djob.hms.map(() => "hms"), djob.hms, got.hms, djob.hms.map(DIDL.hms));
  same("DIDL.toSeconds", djob.seconds.map(() => "toSeconds"), djob.seconds, got.seconds, djob.seconds.map(DIDL.toSeconds));
});

test("planMoves: the queue's Play now / Play next plan, for every kind of pick", { skip }, () => {
  const plans = new Cases();
  plans.add("queue-moves.test.js", { length: 6, current: 2, positions: [5, 4] }, { length: 6, current: 3, positions: [1] }, { length: 6, current: 0, positions: [6, 2] },
    { length: 6, current: 2, positions: [3, 2] }, { length: 3, current: 1, positions: [9] });
  plans.add("by hand", { length: 0, current: 0, positions: [] }, { length: 1, current: 1, positions: [1, 1, 1] }, { length: 5, current: 5, positions: [1, 2, 3, 4, 5] },
    { length: 5, current: 9, positions: [1] }, { length: 5, current: -3, positions: [5, 4] }, { length: "7", current: "2", positions: ["6", "1"] }, { length: 3.9, current: 2.5, positions: [1, 3] },
    { length: 6, current: 0.5, positions: [1, 2] }, { length: -2, current: 1, positions: [1] }, { length: null, current: null, positions: [1] }, { length: true, current: true, positions: [1] },
    { length: [5], current: ["2"], positions: [[4], ["5"]] }, { current: 1, positions: [1] }, { length: 4, positions: [4, 3] }, { length: 4, current: "x", positions: [2] },
    { length: 6, current: 2, positions: [null, true, "3", [4], {}, 2.5, -1, 0, 7, "", " 5 ", "0x6"] }, { length: 4, current: 1 }, { length: 4, current: 1, positions: "34" },
    { length: 4, current: 1, positions: { 0: 3 } }, { length: 4, current: 1, positions: null }, { length: 40, current: 20, positions: Array.from({ length: 40 }, (_, i) => 40 - i) });
  for (let i = 0; i < 1000; i++) {
    const seed = 20000 + i, g = rng(seed);
    const length = int(g, 30);
    const c = { length, current: g() < 0.1 ? pick(g, [-1, length + 1, length + 5, 1.5, "1", null]) : int(g, length + 1), positions: [] };
    for (let k = int(g, 9); k > 0; k--) c.positions.push(g() < 0.08 ? pick(g, [0, -1, length + 1, "2", null, 1.5]) : 1 + int(g, Math.max(1, length)));
    plans.add(`seed ${seed}`, c);
  }
  const job = plain({ plans: plans.items });
  same("planMoves", plans.labels, job.plans, csharp({ fn: "moves", ...job }).plans, job.plans.map(c => tryOr(() => planMoves(c.length, c.current, c.positions))));
});

/* A household of up to five groups: members with and without every attribute, satellites, pairs, home theatres, bridges. */
const NAMES = ["Kitchen", "Living Room", "Lounge & Bar", "Bedroom \"Main\"", "Büro", "書斎", "Kid's Room", "", "  Spaced  ", "Office", "KITCHEN", "Patio 😀", "toString", "__proto__"];
function genZgs(g) {
  const uid = () => "RINCON_" + (g() < 0.05 ? "" : (int(g, 1 << 24)).toString(16).toUpperCase().padStart(6, "0")) + "01400";
  const attr = (k, v) => ` ${k}="${g() < 0.9 ? XML.escape(v) : String(v).replace(/"/g, "")}"`;
  const groups = [];
  for (let n = 1 + int(g, 5); n > 0; n--) {
    const members = [];
    for (let k = 1 + int(g, 5); k > 0; k--) members.push(uid());
    if (g() < 0.2) members.push(members[0]);
    const coord = g() < 0.9 ? members[0] : g() < 0.5 ? uid() : "";
    let xml = `<ZoneGroup${g() < 0.95 ? attr("Coordinator", coord) : ""}${g() < 0.9 ? attr("ID", coord + ":" + int(g, 99)) : ""}>`;
    for (const m of members) {
      let a = "";
      if (g() < 0.95) a += attr("UUID", g() < 0.03 ? "" : m);
      if (g() < 0.9) a += attr("Location", g() < 0.75 ? `http://192.168.${int(g, 3)}.${int(g, 256)}:1400/xml/device_description.xml` : pick(g, LOCATIONS));
      if (g() < 0.9) a += attr("ZoneName", pick(g, NAMES));
      if (g() < 0.3) a += attr("Invisible", pick(g, ["1", "0", "true", " 1 ", ""]));
      if (g() < 0.1) a += attr("IsZoneBridge", pick(g, ["1", "0"]));
      if (g() < 0.6) a += attr("SoftwareVersion", pick(g, ["78.1-52020", "57.3-77280", ""]));
      const other = pick(g, members);
      if (g() < 0.25) a += attr("ChannelMapSet", pick(g, [`${m}:LF,LF;${other}:RF,RF`, `${m}:LF,RF`, `${m}:LF;${other}:RF`, `${m}:lf , lf;${other}: rf,RF,`, `${m}:SW`, ";;", ":", `${m}`, `1:LF;0:RF`, `${m}:LF:RF;${other}:RF`]));
      if (g() < 0.2) a += attr("HTSatChanMapSet", `${m}:LF,RF;${other}:SW;${uid()}:LR;${uid()}:RR`);
      if (g() < 0.3) a += attr("BootSeq", int(g, 99)) + attr("MicEnabled", "1");
      const sats = g() < 0.15 ? `<Satellite${attr("UUID", uid())}${attr("Invisible", "1")}/>` : "";
      xml += sats ? `<ZoneGroupMember${a}>${sats}</ZoneGroupMember>` : `<ZoneGroupMember${a}/>`;
    }
    groups.push(xml + "</ZoneGroup>");
  }
  const body = groups.join(g() < 0.3 ? "\n  " : "");
  const doc = g() < 0.7 ? `<ZoneGroupState><ZoneGroups>${body}</ZoneGroups><VanishedDevices/></ZoneGroupState>` : `<ZoneGroups>${body}</ZoneGroups>`;
  return (g() < 0.1 ? '<?xml version="1.0"?>\n' : "") + doc + (g() < 0.1 ? "\n" : "");
}

test("topology: ZoneGroupState read into members, the household's rooms and groups, channel maps, SSDP headers, LAN addresses", { skip }, () => {
  const { zgs } = fakeAnswers();
  const states = new Cases();
  states.add("real ZoneGroupState", ...REAL_ZGS).add("fake household", ...zgs);
  states.add("fake household, unwrapped from SOAP", SOAP.parseResponse(envelope("GetZoneGroupState", ZGT, { ZoneGroupState: REAL_ZGS[0] }), "GetZoneGroupState").ZoneGroupState);
  // Every Location form, a member apiece.
  for (let i = 0; i < LOCATIONS.length; i += 8) {
    states.add("locations", `<ZoneGroups><ZoneGroup Coordinator="RINCON_L"><${LOCATIONS.slice(i, i + 8).map((l, k) => `ZoneGroupMember UUID="RINCON_L${k}" Location="${XML.escape(l)}"/`).join("><")}></ZoneGroup></ZoneGroups>`);
  }
  // Locations built from parts, to cover the URL rules between them.
  const SCHEMES = ["http", "HTTP", "https", "ws", "ftp", "file", "foo", "x-rincon", "1x", ""];
  const SEPS = [":", "://", ":\\\\", ":/", ":///", "://\\/", ":?"];
  const USERS = ["", "", "u@", "u:p@", "@", "a@b@", ":@"];
  const HOSTS = ["10.0.0.5", "192.168.001.010", "0x7f.1", "1.2.3", "4294967295", "4294967296", "10.0.0.256", "1.2.3.4.", "1..2", "[::1]", "[fe80::a:B:c]", "[::ffff:10.0.0.5]", "[1::]",
    "[::]", "[1:2:3:4:5:6:7::]", "[g::1]", "host", "Host.Local", "a-b.c_d", "ex%41mple", "%2e", "a%2Fb", "münchen", "ＢÜＣＨＥＲ", "日本", "xn--mnchen-3ya", "xn--zz", "", "a b", "a<b", "a`b", "a~b", "a\"b", "1e2", "0x", "09", "08.1"];
  const PORTS = ["", ":1400", ":", ":0", ":65535", ":65536", ":99999999999999999999", ":0x1", ":14 00", ":-1"];
  const PATHS = ["", "/", "/xml/device_description.xml", "?q=1", "#f", "\\x", "/a b"];
  const locs = [];
  for (let i = 0; i < 600; i++) {
    const g = rng(30000 + i);
    locs.push(pick(g, SCHEMES) + pick(g, SEPS) + pick(g, USERS) + pick(g, HOSTS) + pick(g, PORTS) + pick(g, PATHS));
  }
  for (let i = 0; i < locs.length; i += 10) {
    states.add(`locations, seeds ${30000 + i}…`, `<ZoneGroups><ZoneGroup Coordinator="RINCON_L"><${locs.slice(i, i + 10).map((l, k) => `ZoneGroupMember UUID="RINCON_L${k}" Location="${XML.escape(l)}"/`).join("><")}></ZoneGroup></ZoneGroups>`);
  }
  const base = states.items.slice();
  for (let i = 0; i < 500; i++) { const seed = 40000 + i; states.add(`seed ${seed}`, genZgs(rng(seed))); }
  for (let i = 0; i < 400; i++) { const seed = 45000 + i, g = rng(seed); states.add(`seed ${seed}, damaged`, mutate(g, g() < 0.5 ? pick(g, base) : genZgs(g))); }
  states.add("not a string", null, 0, 5, [], {});
  const households = new Cases();
  for (let i = 0; i < states.items.length; i++) {
    const s = states.items[i];
    if (typeof s !== "string") continue;
    const g = rng(50000 + i);
    const uids = [...new Set((s.match(/RINCON_[A-Z0-9]*/g) || []))].concat(["RINCON_NOPE", ""]);
    const names = NAMES.slice(0, 4 + int(g, NAMES.length - 4));
    const sub = () => names.filter(() => g() < 0.3).map(n => g() < 0.5 ? n.toUpperCase() : n);
    households.add(states.labels[i], { state: s, include: g() < 0.3 ? sub() : [], exclude: g() < 0.3 ? sub() : [], uids, names: names.concat([null, 5, "kitchen"]) });
  }
  const channelMaps = ["RINCON_A:LF,LF;RINCON_B:RF,RF", "RINCON_A:LF,RF;RINCON_S:SW;RINCON_L:LR;RINCON_R:RR", "", ";", ":", "A:", ":LF", "A:LF:RF", " A : lf , , LF ;B:rf",
    "A:ß,ﬁ", "1:LF;0:RF;b:SW", "__proto__:LF", "__proto__:LF;size:RF", "size:RF;__proto__:LF", "__proto__:LF;constructor:RF;toString:SW", null, 5, ["A:LF", "B:RF"], {}];

  const headers = ["HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age = 1800\r\nEXT:\r\nLOCATION: http://192.168.1.101:1400/xml/device_description.xml\r\nSERVER: Linux UPnP/1.0 Sonos/78.1-52020 (ZPS13)\r\nST: urn:schemas-upnp-org:device:ZonePlayer:1\r\nUSN: uuid:RINCON_48A6B8B5614E01400::urn:schemas-upnp-org:device:ZonePlayer:1\r\nX-RINCON-HOUSEHOLD: Sonos_abc\r\nX-RINCON-BOOTSEQ: 14\r\n\r\n",
    "HTTP/1.1 200 OK\nLocation:http://10.0.0.5:1400/x\nServer: x\n", "  NOTIFY * HTTP/1.1  \r\n:no name\r\nA:1\r\na: 2\r\nÄ: ü\r\nİ: i\r\n__proto__: x\r\n2: two\r\n1: one\r\n : blank\r\nno colon\r\n",
    "", "\r\n\r\n", "HTTP/1.1 200 OK\r\nX: a:b:c\r\nY:\t tabbed \t\r\n"].map(h => Buffer.from(h).toString("base64"));
  headers.push(Buffer.from([0x48, 0x3a, 0xff, 0xfe, 0x0d, 0x0a, 0x4b, 0x3a, 0xc3, 0x28, 0xe2, 0x82, 0x0a, 0x4c, 0x3a, 0xf0, 0x9f, 0x98, 0x80, 0xed, 0xa0, 0x80]).toString("base64"));
  for (let i = 0; i < 100; i++) {
    const g = rng(60000 + i);
    const bytes = [];
    for (let k = int(g, 120); k > 0; k--) bytes.push(g() < 0.6 ? pick(g, [0x0d, 0x0a, 0x3a, 0x20, 0x41, 0x61, 0x09]) : int(g, 256));
    headers.push(Buffer.from(bytes).toString("base64"));
  }

  const IFNAMES = ["eth0", "en0", "wlan0", "Wi-Fi", "Ethernet 2", "docker0", "br-1a2b", "br0", "veth12", "virbr0", "vmnet8", "vboxnet0", "lxcbr0", "cni0", "flannel.1", "cali9",
    "kube-ipvs0", "tailscale0", "wg0", "zt5", "tun0", "tap1", "utun3", "ppp0", "ipsec0", "bridge100", "bridge", "bridgeX", "BRIDGE7", "Docker1", "lo", "1", "0", "ıpsec", "\u212Aube0"];
  const ADDRS = ["192.168.1.10", "10.0.0.2", "172.16.5.4", "172.31.255.255", "172.32.0.1", "169.254.1.1", "100.64.0.1", "100.127.255.255", "100.128.0.1", "8.8.8.8", "127.0.0.1",
    "1.2.3.1e-1", "...", "", "a.b.c.d", " 10.0.0.1", "0x0a.0.0.1", "256.1.1.1", "-0.0.0.0", "10.0.0", null, 5, "fe80::1"];
  const genIfs = g => {
    const ifs = {};
    for (let n = int(g, 6); n > 0; n--) {
      const list = [];
      for (let k = int(g, 4); k > 0; k--) {
        list.push(g() < 0.05 ? pick(g, [null, "str", 0]) : { address: pick(g, ADDRS), family: g() < 0.8 ? pick(g, ["IPv4", 4]) : pick(g, ["IPv6", 6, undefined, "ipv4"]), internal: g() < 0.15, netmask: "255.255.255.0" });
      }
      ifs[pick(g, IFNAMES)] = g() < 0.05 ? pick(g, [null, "", "xy"]) : list;
    }
    return ifs;
  };
  const lans = [{}, null, "ab", [[{ address: "10.0.0.1", family: "IPv4" }]], { eth0: 5 }, { eth0: {} }, { eth0: [{ address: "10.0.0.1", family: "IPv4" }, { address: "10.0.0.1", family: 4 }] }];
  const locals = [], searches = [];
  for (let i = 0; i < 300; i++) {
    const g = rng(70000 + i);
    const ifs = genIfs(g);
    lans.push(ifs);
    locals.push([pick(g, [null, "", 0, "10.9.9.9", "127.0.0.1", null, null]), ifs]);
    searches.push([pick(g, [null, "", 0, "10.9.9.9", "127.0.0.1", null, null, null]), ifs]);
  }

  const job = plain({ states: states.items, channel_maps: channelMaps, households: households.items, headers, lans, locals, searches });
  const got = csharp({ fn: "topology", ...job });
  same("parseZoneGroupState", states.labels, job.states, got.zones, job.states.map(s => tryOr(() => TOPO.parseZoneGroupState(s))));
  same("parseChannelMap", job.channel_maps.map(() => "channel map"), job.channel_maps, got.channel_maps,
    job.channel_maps.map(v => tryOr(() => Object.fromEntries(Object.entries(TOPO.parseChannelMap(v)).map(([k, s]) => [k, [...s]])))));
  same("Topology's rooms, groups, coordinators and signature", households.labels, job.households, got.households, job.households.map(c => tryOr(() => {
    const t = new TOPO.Topology({ include: c.include, exclude: c.exclude });
    t.all = new Map(TOPO.parseZoneGroupState(c.state).map(m => [m.uid, m]));
    return { rooms: t.rooms(), groups: t.groups(), signature: t.signature(), coordinators: c.uids.map(u => t.coordinatorOf(u)), members: c.uids.map(u => t.member(u)), allowed: c.names.map(n => t.allowed(n)) };
  })));
  same("parseHeaders", job.headers.map((_, i) => i < 7 ? "by hand" : `seed ${60000 + i - 7}`), job.headers, got.headers, job.headers.map(b => TOPO.parseHeaders(Buffer.from(b, "base64"))));
  same("lanAddresses", job.lans.map((_, i) => i < 7 ? "by hand" : `seed ${70000 + i - 7}`), job.lans, got.lans, job.lans.map(ifs => tryOr(() => TOPO.lanAddresses(ifs))));
  same("localIp", job.locals.map((_, i) => `seed ${70000 + i}`), job.locals, got.locals, job.locals.map(([p, ifs]) => tryOr(() => TOPO.localIp(p, ifs))));
  same("searchAddresses", job.searches.map((_, i) => `seed ${70000 + i}`), job.searches, got.searches, job.searches.map(([b, ifs]) => tryOr(() => TOPO.searchAddresses(b, ifs))));
});

test("SOAP: the envelope sent, and the answer read (arguments by name, or the player's fault)", { skip }, () => {
  const { metas, answers } = fakeAnswers();
  const requests = new Cases();
  const didl = DIDL.build("http://10.0.0.2:3500/stream/t1.flac?s=a&e=1", metas[0]);
  requests.add("device.js", { service: AVT, action: "Play", args: { InstanceID: 0, Speed: 1 } }, { service: AVT, action: "SetAVTransportURI", args: { InstanceID: 0, CurrentURI: "x-rincon:RINCON_A", CurrentURIMetaData: "" } },
    { service: AVT, action: "AddMultipleURIsToQueue", args: { InstanceID: 0, UpdateID: 0, NumberOfURIs: 2, EnqueuedURIs: "http://a/1 http://a/2", EnqueuedURIsMetaData: didl + " " + didl, ContainerURI: "", ContainerMetaData: "", DesiredFirstTrackNumberEnqueued: 3, EnqueueAsNext: 1 } },
    { service: CD, action: "Browse", args: { ObjectID: "Q:0", BrowseFlag: "BrowseDirectChildren", Filter: "dc:title,res,dc:creator,upnp:artist,upnp:album,upnp:albumArtURI", StartingIndex: 0, RequestedCount: 1000, SortCriteria: "" } },
    { service: AVT, action: "Seek", args: { InstanceID: 0, Unit: "REL_TIME", Target: DIDL.hms(125) } }, { service: ZGT, action: "GetZoneGroupState" });
  requests.add("by hand", { service: "s", action: "A", args: null }, { service: "s", action: "A", args: [] }, { service: "s", action: "A", args: ["x", "<y>"] }, { service: "s", action: "A", args: "ab" },
    { service: "s", action: "A", args: 5 }, { service: null, action: undefined, args: { 1: "one", b: "bee", 0: "zero" } }, { service: "a\"b", action: "x y", args: { k: null, l: [1, 2], m: {}, n: true, o: 0, p: "&<>\"'" } });
  for (let i = 0; i < 300; i++) {
    const seed = 80000 + i, g = rng(seed);
    const args = {};
    for (let k = int(g, 6); k > 0; k--) args[pick(g, ["InstanceID", "CurrentURI", "Target", "1", "x", "DesiredVolume"])] = g() < 0.3 ? pick(g, VALUES) : pick(g, TEXTS);
    requests.add(`seed ${seed}`, { service: pick(g, [AVT, CD, ZGT]), action: pick(g, ["Play", "Seek", "Browse", "X"]), args });
  }
  const responses = new Cases();
  for (const [action, service, args] of answers) responses.add(`fake ${action}`, { body: envelope(action, service, args), action });
  for (const c of [401, 402, 501, 600, 701, 702, 705, 710, 711, 714, 718, 800, 804, 999, 0, -5, 701.5, "abc", "", " 714 ", "0x2bd", "Infinity", "1e400", "7e2"]) {
    responses.add("fault", { body: fault(c), action: "Play" }, { body: fault(c, "Described & <escaped>"), action: "Play" });
  }
  const real = '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>';
  responses.add("real", { body: real + `<u:GetPositionInfoResponse xmlns:u="${AVT}"><Track>3</Track><TrackDuration>0:04:21</TrackDuration><TrackMetaData>${XML.escape(REAL_DIDL[0])}</TrackMetaData><TrackURI>x-sonos-spotify:a?sid=12&amp;flags=8224</TrackURI><RelTime>0:01:02</RelTime><AbsTime>NOT_IMPLEMENTED</AbsTime><RelCount>2147483647</RelCount><AbsCount>2147483647</AbsCount></u:GetPositionInfoResponse></s:Body></s:Envelope>`, action: "GetPositionInfo" },
    { body: real + `<u:GetZoneGroupStateResponse xmlns:u="${ZGT}"><ZoneGroupState>${XML.escape(REAL_ZGS[0])}</ZoneGroupState></u:GetZoneGroupStateResponse></s:Body></s:Envelope>`, action: "GetZoneGroupState" },
    { body: real + `<u:PlayResponse xmlns:u="${AVT}"></u:PlayResponse></s:Body></s:Envelope>`, action: "Play" },
    { body: real + `<u:OtherResponse xmlns:u="${AVT}"><A>1</A><B attr="x">2</B><@C>3</@C></u:OtherResponse></s:Body></s:Envelope>`, action: "Play" },
    { body: real + "<s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring></s:Fault></s:Body></s:Envelope>", action: "Play" },
    { body: real + "<s:Fault>text</s:Fault></s:Body></s:Envelope>", action: "Play" }, { body: real + "<s:Fault/><u:PlayResponse><X>1</X></u:PlayResponse></s:Body></s:Envelope>", action: "Play" },
    { body: real + "<s:Fault><detail>d</detail></s:Fault></s:Body></s:Envelope>", action: "Play" }, { body: real + "<s:Fault><detail><UPnPError/></detail></s:Fault></s:Body></s:Envelope>", action: "Play" },
    { body: real + "<s:Fault><detail><UPnPError><errorCode>714</errorCode><errorCode>715</errorCode></UPnPError></detail></s:Fault></s:Body></s:Envelope>", action: "Play" });
  for (const action of ["Play", "", "constructor", "toString", "__proto__", "hasOwnProperty", "isPrototypeOf", "0", "1", "length", "charAt", "map", "X", undefined, null, 5]) {
    for (const body of ["<s:Envelope><s:Body><A>1</A><PlayResponse><x>y</x></PlayResponse></s:Body></s:Envelope>", "<Envelope><Body>just text</Body></Envelope>",
      "<Envelope><Body><B>1</B></Body><Body><C>2</C></Body></Envelope>", "<Envelope><Body><R><x>1</x></R><R><y>2</y></R></Body></Envelope>",
      "<Envelope><Body><isPrototypeOf><q>1</q></isPrototypeOf><__toString><w>2</w></__toString></Body></Envelope>", "<Envelope><Body><1><a>1</a></1><Z><b>2</b></Z></Body></Envelope>",
      "<Envelope><Body></Body></Envelope>", "<Envelope/>", "", "garbage", null]) responses.add("by hand", { body, action });
  }
  for (let i = 0; i < 400; i++) {
    const seed = 85000 + i, g = rng(seed);
    const args = {};
    for (let k = int(g, 7); k > 0; k--) args[pick(g, ["Track", "TrackURI", "TrackMetaData", "Result", "1", "0", "x-y", "NumberReturned"])] = g() < 0.3 ? pick(g, VALUES) : pick(g, TEXTS);
    const action = pick(g, ["GetPositionInfo", "Browse", "Play", "X", "", "0"]);
    responses.add(`seed ${seed}`, { body: envelope(action, pick(g, [AVT, CD, ZGT, "a\"b"]), args), action: g() < 0.8 ? action : pick(g, ["Browse", "toString", "1"]) });
  }
  const seen = responses.items.slice();
  for (let i = 0; i < 800; i++) {
    const seed = 90000 + i, g = rng(seed);
    const c = pick(g, seen);
    responses.add(`seed ${seed}`, { body: typeof c.body === "string" ? mutate(g, c.body) : c.body, action: c.action });
  }
  const job = plain({ requests: requests.items, responses: responses.items });
  const got = csharp({ fn: "soap", ...job });
  same("buildRequest", requests.labels, job.requests, got.requests, job.requests.map(c => tryOr(() => SOAP.buildRequest(c.service, c.action, c.args))));
  same("parseResponse", responses.labels, job.responses, got.responses, job.responses.map(c => {
    try { return { out: SOAP.parseResponse(c.body, c.action) }; }
    catch (e) { return e instanceof SOAP.UPnPError ? { error: { code: e.code, description: e.description, message: e.message } } : { threw: true }; }
  }));
});
