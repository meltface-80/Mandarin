/*
 * Settings → Audio Devices (app/audio-devices.js): a device's Gapless (item 300). Albums as one stream: an album's
 * tracks go to the device as one stream, start to end, where Mandarin makes what it plays (an upsampling, or PCM as
 * DSD): gapless however the device joins files. The words are the Android app's too (core DevicePage.kt). Loaded
 * before app/audio-devices.js, whose page it draws into; the switch is app/audio-devices-dsp.js's.
 */
const ALBUM_STREAM_NOTE = (on) => on
  ? "An album’s tracks go to this device as one stream, start to end: gapless however it joins files. Mandarin shows each track as it plays; the device’s own app shows the album as one. A skip starts the stream again at that track."
  : "Each track goes as a file of its own, the next handed over before it ends: gapless as far as this device joins them. Turn on where a device clicks, pauses or squeals between tracks.";

/** The Gapless group for the device's Output [o]: its switch and its note. */
function gaplessGroup(o) {
  // Dimmed through its own player (item 306): MPD plays one track into the next itself.
  return '<div class="cap-group' + (o.player === "mpd" ? " is-dim" : "") + '"><span class="cap-label" data-parity="settings-device.cap-label">Gapless</span>' +
    '<div class="settings-row" style="margin-top:8px"><span class="settings-label" data-parity="settings-device.name">Albums as one stream</span>' +
    '<label class="switch" data-parity="settings-device.album-stream"><input type="checkbox" data-dev-albumstream' + (o.album_stream ? " checked" : "") + ' aria-label="Albums as one stream">' +
    '<span class="switch-track"><span class="switch-thumb"></span></span></label></div>' +
    '<div class="settings-note" data-parity="settings-device.note">' + esc(ALBUM_STREAM_NOTE(!!o.album_stream)) + "</div></div>";
}
