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

/*
 * A Squeezelite player's Gapless and DSD (item 313): it goes on into the next track from its own buffer, so there is
 * nothing to set; at a change of rate it pauses as its own -r option says. The words are DevicePage.kt's too.
 */
const SLIM_GAPLESS_NOTE = "A Squeezelite player plays one track into the next from its own buffer: gapless as it is, nothing to set. Where the next track is at another rate, it pauses for as long as its -r option says (e.g. -r 44100-768000:500, half a second), so the DAC settles without a click.";
/* A Mandarin Bridge played Mandarin's continuous PCM (item 322, its device's continuous_pcm): its own note. */
const BRIDGE_GAPLESS_NOTE = "Mandarin plays this Bridge one continuous stream of PCM, as Roon plays a RAAT device: each track decoded by Mandarin (and upsampled, as its Output says), one on into the next while they are of one rate and depth, the DAC never let go between them; nothing to set. Where the next track is at another rate, the DAC is given half a second of silence at the new rate first, so it settles without a click. DSD goes as its file.";
const slimDsdNote = (takesDsd) => takesDsd
  ? "DSD files go to it as DSF, at the DSD rates that are on; it sends them to the DAC as its own -D option says (DoP or native), or as PCM. Any other goes as PCM."
  : "It doesn’t say it plays DSD, so DSD goes to it as PCM.";

/** A Squeezelite player's Gapless group, or a Mandarin Bridge's played continuous PCM ([pcm]): its note alone. */
function slimGapless(pcm) {
  return '<div class="cap-group"><span class="cap-label" data-parity="settings-device.cap-label">Gapless</span>' +
    '<div class="settings-note" data-parity="settings-device.note">' + esc(pcm ? BRIDGE_GAPLESS_NOTE : SLIM_GAPLESS_NOTE) + "</div></div>";
}
