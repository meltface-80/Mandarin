/*
 * Settings → Audio Devices (app/audio-devices.js): a renderer's Player (item 306), where its own player (MPD) was
 * found beside it: UPnP, as before, or its own player, which Mandarin hands the queue and which plays one track into
 * the next by itself. The words are the Android app's too (core DevicePage.kt). Loaded before app/audio-devices.js,
 * whose page it draws into; the segment is app/audio-devices-dsp.js's, as the others are.
 */
const PLAYER_NOTE = (own, at) => own
  ? "Mandarin hands this device’s own player (MPD, found at " + at + ") the queue, each track as Mandarin makes it, and it plays one into the next by itself: gapless, as it plays its own library. Mandarin follows where it is from what it says."
  : "Each track is handed over by UPnP, the next before it ends. This device also has its own player (MPD), which plays a queue one track into the next by itself.";

/** The Player group for the device [d] and its Output [o]: UPnP or its own player, and its note. */
function playerGroup(d, o) {
  const own = o.player === "mpd";
  return '<div class="cap-group"><span class="cap-label" data-parity="settings-device.cap-label">Player</span>' +
    '<div class="seg" data-seg="player">' + [["upnp", "UPnP"], ["mpd", "Its own player"]].map(([v, label]) =>
      '<button type="button" data-parity="settings-device.player" class="seg-btn' + ((v === "mpd") === own ? " is-on" : "") + '" data-seg-v="' + v + '">' + label + "</button>").join("") + "</div>" +
    '<div class="settings-note" data-parity="settings-device.note">' + esc(PLAYER_NOTE(own, d.mpd)) + "</div></div>";
}
