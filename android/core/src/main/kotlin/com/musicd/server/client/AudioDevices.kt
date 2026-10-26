package com.musicd.server.client

import org.json.JSONObject

/** A player on Settings → Audio Devices' list (the page's renderList, audio-devices.js; bug list item 89). */
data class DeviceRow(
    val id: String,
    val name: String,
    /** sonos, phone, upnp or local: the row's icon. */
    val kind: String,
    /** What it is, its name on the network where yours differs, and "hidden": under its name. */
    val sub: String,
    /** Playing, Paused, Idle or Offline. */
    val state: String,
    val playing: Boolean,
    val online: Boolean,
    /** Whether it can be switched off (a renderer, a sound device of the server's): its switch on the row. */
    val canToggle: Boolean,
    val enabled: Boolean,
    val hidden: Boolean,
) {
    /** Switched off: shown as Off, dimmed. */
    val off: Boolean get() = canToggle && !enabled
    /** What the row says at its right. */
    val stateShown: String get() = if (off) "Off" else state
}

/** The list as the server answered (GET /api/audio-devices): its rows, away from home or not, what can't be opened, what went wrong. */
data class DeviceList(val rows: List<DeviceRow>, val away: Boolean, val localNote: String, val error: String) {
    /** This list with the device [id] switched [on] (its row's switch tapped, item 200): shown at once, the list read again after. */
    fun withEnabled(id: String, on: Boolean): DeviceList = copy(rows = rows.map { if (it.id == id) it.copy(enabled = on) else it })

    val shown: List<DeviceRow> get() = rows.filter { !it.hidden }
    val hidden: List<DeviceRow> get() = rows.filter { it.hidden }
}

object AudioDevices {
    const val AWAY_ONLY = "Away from home, this phone is the only player — and it shows here once the app has started playing."
    const val NOTHING = "Nothing found yet — the network is being searched."
    const val HIDE_NOTE = "Tick the devices to hide. Hidden ones are listed below; tick one to bring it back."
    const val ZONE_INFO = "Choose which room, renderer or phone the Play, Queue and transport controls target."
    const val DEVICES_INFO = "Every player Mandarin can see: Sonos rooms, phones running the app, and UPnP/DLNA renderers found on the network. Tap one for its name and what it can play. The network is searched every minute; Look again searches now. Hide / unhide takes devices you don't use off this list (ticked, then OK); hidden ones are listed again, under Hidden, when you tap it next, and a tick brings one back."
    const val WAVEFORM_INFO = "Off by default. Draws the shape of the track on the Now playing progress bar and the wall display, read from the audio itself. The first play of a track decodes it (a second or two); every result is stored, so it is instant afterwards."

    /** A device's state as the row says it. */
    fun stateWord(state: String, online: Boolean) = when (state) { "playing" -> "Playing"; "paused" -> "Paused"; else -> if (online) "Idle" else "Offline" }

    /** The line under a device's name: its model (or the profile's), its network name where renamed, and "hidden". */
    fun sub(d: JSONObject): String = listOf(
        d.optString("model").ifEmpty { d.optJSONObject("profile")?.optString("label").orEmpty() },
        if (d.optBoolean("renamed")) d.optString("network_name") else "",
        if (d.optBoolean("hidden")) "hidden" else "",
    ).filter { it.isNotEmpty() }.joinToString(" · ")

    fun row(d: JSONObject) = DeviceRow(d.optString("id"), d.optString("name"), d.optString("kind"), sub(d), stateWord(d.optString("state"), d.optBoolean("online")),
        d.optString("state") == "playing", d.optBoolean("online"), d.optBoolean("can_toggle"), d.optBoolean("enabled"), d.optBoolean("hidden"))

    /** The sound devices on the server's own computer it isn't allowed to open, and how to let it (v0.6.18); none otherwise. */
    fun localNote(local: JSONObject?, away: Boolean): String {
        if (away || local == null || local.optBoolean("off")) return ""
        if (local.optString("platform") != "linux" || local.optInt("count") > 0 || !(local.optBoolean("hidden") || local.optBoolean("docker"))) return ""
        return if (local.optBoolean("docker")) "To play through a USB DAC or speakers plugged into the computer Mandarin runs on, start its container with --device /dev/snd and --privileged."
        else "This computer has sound devices Mandarin isn’t allowed to open: add the user Mandarin runs as to the audio group."
    }

    fun parse(j: JSONObject): DeviceList {
        val a = j.optJSONArray("devices")
        val rows = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it)?.let(::row) }
        val away = j.optBoolean("away")
        return DeviceList(rows, away, localNote(j.optJSONObject("local"), away), "")
    }

    /** Under the rows: how many are hidden. */
    fun hiddenCount(n: Int) = "$n" + (if (n == 1) " device hidden" else " devices hidden")

    /** Away from home, under the rows: the phone alone, or with no network at all. */
    fun awayNote(offline: Boolean) = if (offline) "No network: this phone is the player, through its speaker, headphones, Bluetooth or a USB DAC. Sonos rooms and streamers come back with the network."
        else "Away from home, this phone is the only player. Sonos rooms and streamers are shown at home."

    /** The Hide / unhide button's words: Hide / unhide, then Cancel until a row is ticked, then OK. */
    fun hideWord(hiding: Boolean, picked: Int) = if (!hiding) "Hide / unhide" else if (picked > 0) "OK" else "Cancel"

    /** What is said once the ticks are applied ([hid] hidden, [shown] shown again; the page's applyHide notice). */
    fun hideSaid(hid: Int, shown: Int): String {
        val parts = buildList {
            if (hid > 0) add("$hid" + (if (hid == 1) " device hidden" else " devices hidden"))
            if (shown > 0) add("$shown" + (if (shown == 1) " device shown again" else " devices shown again"))
        }
        return parts.joinToString(", ") + ".\n\n" + (if (hid > 0)
            "A hidden device stays off this list; one that can be switched off has been, so it leaves the zone picker too. To bring one back, tap Hide / unhide again: hidden devices are listed at the bottom under Hidden. Tick the one you want and tap OK."
        else "They are back on the list, switched off until you switch them on.")
    }

    /** What the server says of Waveform (GET /api/settings/waveform), as the page's note under its switch. */
    fun waveformNote(on: Boolean) = if (on) "On. Each track is analysed the first time it plays and kept, so it is instant after that." else "Off. The progress bar stays a plain line."

    /** What is said when a device is switched on or off from its row or its page. */
    fun enabledSaid(name: String, on: Boolean) = if (on) "$name is on — it’s in the zone picker now" else "$name is off"
}
