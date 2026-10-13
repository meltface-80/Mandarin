"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { built } = require("./server");
const { score } = require("./score");

// The C# server's (Playback/Topology.cs, Didl.cs, Phones.Commands.cs; lib/sonos/ and lib/server/playback.js until v0.8.50).
const skip = built();

const ZGS = `<ZoneGroupState><ZoneGroups>
<ZoneGroup Coordinator="RINCON_A" ID="RINCON_A:1">
 <ZoneGroupMember UUID="RINCON_A" ZoneName="Kitchen" Location="http://10.0.0.5:1400/xml/device_description.xml"/>
 <ZoneGroupMember UUID="RINCON_B" ZoneName="Dining" Location="http://10.0.0.6:1400/xml/device_description.xml"/>
</ZoneGroup>
<ZoneGroup Coordinator="RINCON_C" ID="RINCON_C:2">
 <ZoneGroupMember UUID="RINCON_C" ZoneName="Lounge" Location="http://10.0.0.7:1400/xml/device_description.xml" ChannelMapSet="RINCON_C:LF,LF;RINCON_D:RF,RF"/>
 <ZoneGroupMember UUID="RINCON_SUB" ZoneName="Lounge" Invisible="1" Location="http://10.0.0.8:1400/xml/device_description.xml"/>
</ZoneGroup>
</ZoneGroups></ZoneGroupState>`;

test("ZoneGroupState: rooms, groups, satellites and stereo pairs", { skip }, () => {
  const z = score({ fn: "topology", states: [ZGS] }).zones[0];
  assert.equal(z.length, 4);
  const dining = z.find(m => m.name === "Dining");
  assert.equal(dining.coordinatorUid, "RINCON_A");
  assert.equal(dining.ip, "10.0.0.6");
  assert.equal(z.find(m => m.uid === "RINCON_SUB").invisible, true);
  assert.equal(z.find(m => m.uid === "RINCON_C").stereoPair, true);
});

test("DIDL carries the descriptor Sonos insists on, and parses back", { skip }, () => {
  const d = score({ fn: "didl", builds: [{ uri: "http://h:1/stream/t5.flac", meta: { title: "A & B", artist: "X", album: "Y", duration: 125, mime: "audio/flac" } }] }).built[0];
  assert.match(d, /RINCON_AssociatedZPUDN/);
  assert.match(d, /http-get:\*:audio\/flac:\*/);
  const [it] = score({ fn: "didl", docs: [d] }).items[0];
  assert.equal(it.title, "A & B");
  assert.equal(it.duration, 125);
  assert.equal(it.uri, "http://h:1/stream/t5.flac");
});

test("a queued URL says which library track it is", { skip }, () => {
  assert.deepEqual(score({ fn: "uris", uris: ["http://10.0.0.2:3500/stream/t42.flac", "x-sonos-spotify:abc"] }).tracks, [42, null]);
});
