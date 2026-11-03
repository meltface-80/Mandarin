package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject

/** One of a device's capabilities as a chip: a rate (Hz), a depth or a DSD multiple, on or not, and where that came from. */
data class CapChip(val kind: String, val value: Int, val label: String, val on: Boolean, val source: String) {
    /** The mark after an on chip: ✓ confirmed, ✎ yours, ◆ known for the model or advertised. */
    val mark: String? get() = if (on) DevicePage.MARK[source] else null
    /** Not sent as DSD: drawn dashed. */
    val later: Boolean get() = source == "later"
}

/** A choice of a segmented control (Output's mode and depth): its value, its words, whether it can't be chosen now. */
data class SegChoice(val value: String, val label: String, val off: Boolean = false)

/**
 * A device's page in Settings → Audio Devices as the server answers it (GET /api/audio-devices/:id): the page's renderDetail
 * and renderLevelling (audio-devices.js, audio-devices-page.js; bug list item 89) in what they show and say. [j] is the
 * answer itself; the changes are PATCHes of it.
 */
class DevicePage(val j: JSONObject) {
    /** This page with [patch] laid over it (a switch tapped, item 200): shown at once, the server's own answer taking its place. */
    fun with(patch: JSONObject): DevicePage = DevicePage(JSONObject(j.toString()).apply { patch.keys().forEach { k -> put(k, patch.get(k)) } })

    val id: String get() = j.optString("id")
    val name: String get() = j.optString("name")
    val kind: String get() = j.optString("kind")
    val online: Boolean get() = j.optBoolean("online")
    val enabled: Boolean get() = j.optBoolean("enabled")
    val canToggle: Boolean get() = j.optBoolean("can_toggle")
    val editable: Boolean get() = j.optBoolean("editable")
    val renamed: Boolean get() = j.optBoolean("renamed")
    val networkName: String get() = j.optString("network_name")

    /** Under the name: its model (or the profile's) and maker, or what a phone is. */
    val desc: String get() = listOf(j.optString("model").ifEmpty { j.optJSONObject("profile")?.optString("label").orEmpty() }, j.optString("manufacturer"))
        .filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { if (kind == "phone") "A phone running the Mandarin app" else "" }

    val onNote: String get() = if (enabled) "Offered as a zone: in the zone picker and everywhere you play." else when (kind) {
        "upnp" -> "Not offered as a zone. A device found on the network stays off until you turn it on."
        "local" -> "Not offered as a zone. A sound device on this computer stays off until you turn it on."
        else -> "Not offered as a zone."
    }

    /** Random album radio, per zone: shown for a device on that plays. */
    val showRadio: Boolean get() = j.has("radio") && enabled && j.opt("playable") != false
    val radio: Boolean get() = j.optBoolean("radio")
    val radioNote: String get() = if (radio) "On. When this device’s queue ends, whole random albums keep coming — ones you haven’t played in the last two months." else "Off. When this device’s queue ends, it stops."

    /** A phone others at home may play to. */
    val showShared: Boolean get() = kind == "phone" && j.has("shared")
    val shared: Boolean get() = j.optBoolean("shared")
    val sharedNote: String get() = if (shared) "On. Your other devices at home can play here." else "Off. Only this phone plays to itself."

    /** The note under the name's field (a phone's is named on the phone): its network name, and a Sonos's own name kept. */
    val nameNote: String get() = if (kind == "phone") "Named in the app on the phone." else "On the network: $networkName"
    val sonosNameNote: String get() = if (kind == "sonos") " · A name for Mandarin only; the Sonos app keeps its own." else ""

    /** About's rows, each its name and value ([at]: a moment as the phone writes it). */
    fun about(at: (Long) -> String): List<Pair<String, String>> = listOf(
        "Model" to j.optString("model"), "Made by" to j.optString("manufacturer"), "Firmware" to j.optString("firmware"), "Address" to j.optString("ip"),
        "Device" to (if (kind == "local") j.optString("location") else ""), "Found by" to j.optString("found_by"),
        "Standard" to (if (kind == "upnp") (if (j.optBoolean("openhome")) "UPnP AV + OpenHome" else "UPnP AV / DLNA") else ""),
        "Updates" to (if (kind == "upnp" && j.optBoolean("playable")) (if (j.optString("events") == "live") "Sent by the device (events)" else "Read every few seconds") else ""),
        "Last seen" to (if (online) "Now" else when_(j.optLong("last_seen"), at)), "First seen" to when_(j.optLong("first_seen"), at),
    ).filter { it.second.isNotEmpty() }

    /** What is wrong with it, said in red under About. */
    fun troubles(at: (Long) -> String): List<String> = buildList {
        if (kind == "upnp" && !j.optBoolean("playable")) add("This device offers no AVTransport service, so it cannot be played to.")
        else if (kind == "upnp" && j.opt("takes_flac") == false) add("This device doesn’t take FLAC, which is how Mandarin sends audio for now, so it isn’t offered as a zone yet.")
        j.optJSONObject("last_error")?.optString("message")?.takeIf { it.isNotEmpty() }?.let { add("Last trouble (" + when_(j.optJSONObject("last_error")!!.optLong("at"), at) + "): " + it) }
    }

    val rates: List<CapChip> get() = chips("rates", "rate") { o -> o.optInt("hz").let { it to rateWord(it) } }
    val bits: List<CapChip> get() = chips("bits", "bits") { o -> o.optInt("n").let { it to "$it-bit" } }
    val dsd: List<CapChip> get() = chips("dsd", "dsd") { o -> o.optInt("n").let { it to "DSD$it" } }
    val containers: List<String> get() = j.optJSONArray("containers").strings()
    val takesDsd: Boolean get() = "dsd" in containers
    /** Rates and depths can be tapped where the device is editable; DSD too where it takes DSD files. */
    fun chipEditable(c: CapChip) = editable && (c.kind != "dsd" || takesDsd)
    val formats: String get() = containers.joinToString(", ") { it.uppercase() }
    val legend: String get() = (if (editable) "Tap a rate or depth to change what Mandarin may send it. " else "") + "✓ confirmed by the device · ◆ known for this model · ✎ you set it."

    /** The notes under Capabilities, by kind, and the profile's own. */
    val capNotes: List<String> get() = buildList {
        if (kind == "upnp") add(if (takesDsd) "DSD files go to it as they are, at the DSD rates that are on; any other goes as PCM. If DSD doesn’t play, tap it off."
            else "It doesn’t say it takes DSD files, so DSD goes to it as PCM.")
        if (kind == "sonos") add("Sonos plays up to 24-bit/48 kHz. Mandarin’s 24/48 rule applies; nothing to set here.")
        if (kind == "phone") add("At home the phone plays the file as it is; away from home, Opus 256 kbps.")
        // A Mac's (item 155) is found by Core Audio, Linux's by ALSA.
        if (kind == "local") add(if (j.optString("found_by").startsWith("This Mac")) "Mandarin sets the device to each track’s rate and holds it while it plays, so nothing else is mixed in; Core Audio carries up to 24 bits exactly. DSD goes as PCM."
            else "Mandarin sends the rates that are on; ALSA converts its 32-bit samples to the depth the device takes. DSD goes as PCM.")
        j.optJSONObject("profile")?.optString("notes")?.takeIf { it.isNotEmpty() }?.let { add(it) }
    }

    /**
     * The change a chip tapped makes (PATCH {caps: {user: …}}): DSD may all go off (it then goes as PCM); a rate or a depth
     * must leave one on, else null.
     */
    fun tapped(c: CapChip): JSONObject? {
        val all = when (c.kind) { "rate" -> rates; "bits" -> bits; else -> dsd }
        val on = all.filter { if (it.value == c.value) !it.on else it.on }.map { it.value }
        if (on.isEmpty() && c.kind != "dsd") return null
        val key = when (c.kind) { "rate" -> "rates"; "bits" -> "bits"; else -> "dsd" }
        return JSONObject().put("caps", JSONObject().put("user", JSONObject().put(key, JSONArray(on))))
    }

    /** Output: for a renderer or a sound device of the server's. */
    val showOutput: Boolean get() = kind == "upnp" || kind == "local"
    private val output: JSONObject get() = j.optJSONObject("output") ?: JSONObject()
    val mode: String get() = output.optString("mode", "original")
    val outBits: String get() = output.opt("bits")?.toString() ?: "auto"
    val flac32: Boolean get() = output.optBoolean("flac32")
    val has32: Boolean get() = bits.any { it.value == 32 && it.on }
    val modes: List<SegChoice> get() = listOf(SegChoice("original", "Original"), SegChoice("x2", "×2"), SegChoice("x4", "×4"), SegChoice("max", "Max"))
    /** The filter upsampling uses (item 237): SoX's as it plays, or one as long as the track, made ahead. */
    val filter: String get() = output.optString("filter", "standard")
    val showFilter: Boolean get() = mode != "original"
    val filters: List<SegChoice> get() = listOf(SegChoice("standard", "Standard"), SegChoice("whole", "Whole track"))
    val filterNote: String get() = if (filter == "whole") "One filter as long as the track, made ahead of playing (some 30 seconds a track); a track not yet made plays with the standard filter. Tracks from the library, ×2 to ×16."
        else "SoX’s filter, made as it plays."
    /** The highest rate its owner allows (item 240), by 48 kHz's family; 0 for Auto. 44.1 kHz's is held to the rate that matches. */
    val maxRate: Int get() = output.optInt("max_rate", 0)
    private fun capFor(hz: Int): Int = if (maxRate == 0) Int.MAX_VALUE else if (hz % 44100 == 0) maxRate / 48000 * 44100 else maxRate
    private val caps: List<Int> get() {
        val top48 = rates.filter { it.on }.maxOfOrNull { if (it.value % 44100 == 0) it.value / 44100 * 48000 else it.value } ?: 0
        return listOf(96000, 192000, 384000, 768000).filter { it < top48 || it == maxRate }
    }
    val showMaxRate: Boolean get() = caps.isNotEmpty()
    val maxRateValue: String get() = if (maxRate == 0) "auto" else maxRate.toString()
    val maxRates: List<SegChoice> get() = listOf(SegChoice("auto", "Auto")) + caps.map { SegChoice(it.toString(), "${it / 1000}k") }
    val maxRateNote: String get() = if (maxRate == 0) "As high as the device takes."
        else "Nothing goes above ${maxRate / 1000} kHz (${rateWord(maxRate / 48000 * 44100)} kHz for music in 44.1’s family), upsampled or not."

    /** How the making goes (item 239): the tracks made and kept, the one being made, those waiting; null unless whole. */
    val wholeLine: String? get() = if (filter == "whole") wholeStatus else null
    private val wholeStatus: String? get() {
        val w = output.optJSONObject("whole") ?: return null
        val made = w.optInt("made")
        val parts = mutableListOf(if (made == 1) "1 track made" else "$made tracks made")
        w.optString("making").takeIf { it.isNotEmpty() && !w.isNull("making") }?.let { parts += "making “$it”" }
        w.optInt("waiting").takeIf { it > 0 }?.let { parts += "$it waiting" }
        return parts.joinToString(" · ")
    }
    /** DSD sent as PCM (item 241): its modulator's noise above the cut taken off; 0 for Off. */
    val dsdLowpass: Int get() = output.optInt("dsd_lowpass", 0)
    val dsdLowpassValue: String get() = if (dsdLowpass == 0) "off" else dsdLowpass.toString()
    val dsdLowpasses: List<SegChoice> get() = listOf(SegChoice("off", "Off"), SegChoice("50000", "50 kHz"), SegChoice("30000", "30 kHz"))
    val dsdLowpassNote: String get() = if (dsdLowpass != 0) "DSD this device is sent as PCM has the modulator’s noise above ${dsdLowpass / 1000} kHz taken off; below it, as recorded. DSD it takes as DSD goes as it is."
        else "DSD this device is sent as PCM keeps the modulator’s noise up to the top of the rate it goes at. DSD it takes as DSD goes as it is."
    /** PCM as DSD (item 243): the multiple each track is made at ahead of playing; 0 for Off. Offered where the device takes DSD. */
    val dsdOut: Int get() = output.optInt("dsd_out", 0)
    val dsdOutValue: String get() = if (dsdOut == 0) "off" else dsdOut.toString()
    val showDsdOut: Boolean get() = dsd.any { it.on }
    val dsdOuts: List<SegChoice> get() = listOf(SegChoice("off", "Off")) + listOf(64, 128, 256).map { n -> SegChoice("$n", "DSD$n", off = dsd.none { it.value == n && it.on }) }
    val dsdOutNote: String get() = if (dsdOut != 0) "Each track of the library that isn’t DSD is made DSD$dsdOut ahead of playing, by Mandarin’s seventh-order modulator, and sent as a DSF; a track not yet made goes as PCM, and so do Qobuz and Tidal. Making takes a while: DSD256 can take longer than the track."
        else "PCM goes to this device as PCM. Set, each track of the library that isn’t DSD is made DSD ahead of playing and sent as a DSF."
    val dsdOutLine: String? get() = if (dsdOut != 0) wholeStatus else null
    val depths: List<SegChoice> get() = listOf(SegChoice("auto", "Auto"), SegChoice("24", "24"), SegChoice("32", "32", off = !flac32))
    val outputInfo: String get() = "Original sends the file as stored wherever this device takes its rate, depth and format; above its ceiling, FLAC at the highest rate it takes. Upsampling stays in the file's family (44.1 → 88.2 → 176.4; 48 → 96 → 192), runs in 64-bit float, and goes out at " +
        (if (has32 && flac32) "24 or 32 bits" else "24 bits") + "."

    /** What a 16/44.1 file becomes with the mode set. */
    val example: String get() {
        val top = rates.filter { it.on && it.value % 44100 == 0 && it.value <= capFor(it.value) }.maxOfOrNull { it.value } ?: 0
        val rate = when (mode) { "x2" -> minOf(88200, if (top > 0) top else 44100); "x4" -> minOf(176400, if (top > 0) top else 44100); "max" -> if (top > 0) top else 44100; else -> 44100 }
        if (mode == "original" || rate <= 44100) return "A 16-bit/44.1 kHz file plays as it is."
        val b = if (has32 && flac32 && outBits != "24") 32 else 24
        return "A 16-bit/44.1 kHz file plays as $b-bit/${rateWord(rate)} kHz FLAC" + (if (rate == 176400) " (×4)" else if (rate == 88200) " (×2)" else "") + "."
    }

    /** The change a segment tapped makes (PATCH {output: {mode|filter|bits: …}}). */
    fun segment(name: String, v: String): JSONObject = JSONObject().put("output", JSONObject().put(name, if ((name == "bits" || name == "max_rate" || name == "dsd_lowpass" || name == "dsd_out") && v != "auto" && v != "off") v.toInt() else v))

    val canFixVolume: Boolean get() = j.optBoolean("can_fix_volume")
    val volumeFixed: Boolean get() = j.optBoolean("volume_fixed")
    val fixedNote: String get() = if (kind == "local") (if (volumeFixed) "The audio goes to the device at full level, untouched; set the volume on the DAC or amplifier. Mandarin shows no slider for it."
            else "Mandarin’s slider and mute scale the audio before it reaches the device; at 100% it is untouched. Turn on to set the volume on the DAC or amplifier instead.")
        else if (volumeFixed) "The volume is set on the device itself (its knob, or its line out on fixed), so Mandarin shows no slider for it."
        else "Mandarin’s slider and mute drive the device. Turn on if the device’s volume is fixed — a WiiM on fixed line out, a Poly feeding a Mojo."

    /** Volume levelling, where the server offers it: Off, Track, Album or Auto, then the target and the unknown's adjustment. */
    val levelling: JSONObject? get() = j.optJSONObject("levelling")
    val levelMode: String get() = levelling?.optString("mode", "off") ?: "off"
    val levelInfo: String get() = "ReplayGain. Track plays every track at the same level. Album plays every record at the same level, its quiet and loud songs as they were made. Auto is Album while a record plays in order and Track when tracks from different records follow one another — a shuffle, a playlist, radio. Gains come from the files’ ReplayGain tags, or from Measure ReplayGain (Settings → Library Scanner); a track’s peak keeps it from being turned up into clipping. " +
        (if (kind == "phone") "The app applies the gain itself, to streams and downloads alike." else "The gain goes into the stream: each track is sent as FLAC with it applied. Off sends every file as it is.") +
        " A change is heard straight away, from where the music is."

    val dsp: JSONObject? get() = j.optJSONObject("dsp")
    /** DSP: on a renderer, a sound device of the server's, or a phone, where the server sends it. */
    val showDsp: Boolean get() = (kind == "upnp" || kind == "local" || kind == "phone") && dsp != null
    val dspOn: Boolean get() = dsp?.optBoolean("enabled") == true
    val dspInfo: String get() = if (kind == "phone") "The app runs the headphone profile and the bands on everything this phone plays — the server's stream, Opus away from home, downloads — in 64-bit float, out through Bluetooth, USB or the speaker as float."
        else "Every track is decoded to 64-bit float, the headroom taken, upsampled if set, the bands run, then dithered to " + (if (flac32 && has32 && outBits != "24") "32" else "24") + " bits. Off, the device gets the file as stored (or the conversion the Output settings ask for)."
    val dspNote: String get() = if (dspOn) "On. A headphone profile and up to ten bands, on everything it plays." else if (kind == "phone") "Off. The app plays what it is given as it is." else "Off. The device gets the file as stored."

    /** Forget: for one not on the network (or not connected, a sound device of the server's). */
    val forgetName: String get() = if (kind == "local") "Not connected" else "Not on the network"

    private fun chips(key: String, kind: String, read: (JSONObject) -> Pair<Int, String>): List<CapChip> {
        val a = j.optJSONArray(key) ?: return emptyList()
        return (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map { o -> read(o).let { (v, w) -> CapChip(kind, v, w, o.optBoolean("on"), o.optString("source")) } }
    }

    companion object {
        val MARK = mapOf("verified" to "✓", "user" to "✎", "profile" to "◆", "advertised" to "◆")
        val SOURCE = mapOf("verified" to "Confirmed by the device", "user" to "You set it", "profile" to "Known for this model", "advertised" to "The device advertises it",
            "floor" to "Every renderer takes this", "sonos" to "Sonos plays this", "phone" to "The phone plays this", "later" to "Not sent as DSD", "off" to "Not offered")
        const val SHARED_INFO = "At home, your other devices list this phone as a player while the Mandarin app is running on it, and can play to it and change its volume. Away from home it plays for itself only."
        const val TARGET_INFO = "How loud every track is brought to. −14 LUFS is about the level streaming services play at; lower numbers play quieter and leave more room for loud peaks."
        const val UNKNOWN_INFO = "For a track with no ReplayGain tags that hasn’t been measured: a fixed change instead, so it doesn’t jump out louder than the levelled tracks around it."
        const val FORGET_NOTE = "Its name and settings go. If it turns up again it starts afresh."
        val LEVEL_MODES = listOf(Choice("off", "Off"), Choice("track", "Track"), Choice("album", "Album"), Choice("auto", "Auto"))
        /** −14 to −25 LUFS, −14 the default. */
        val TARGETS = (-14 downTo -25).map { Choice("$it", "$it LUFS" + if (it == -14) " (Default)" else "") }
        /** 0 to −12 dB, −5 the default. */
        val UNKNOWNS = (0 downTo -12).map { Choice("$it", "$it dB" + if (it == -5) " (Default)" else "") }

        /** A rate in kHz as the page writes it: 44.1, 48, 176.4. */
        fun rateWord(hz: Int): String = (hz / 1000.0).let { if (it == Math.floor(it)) it.toLong().toString() else it.toString() }
        private fun when_(ms: Long, at: (Long) -> String) = if (ms > 0) at(ms) else "—"
        private fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else (0 until length()).map { optString(it) }
        fun forgetAsk(name: String) = "Forget “$name”?\n\nIts name and settings go. If it turns up again it starts afresh."
        fun levelSaid(mode: String) = "Volume levelling: " + (LEVEL_MODES.firstOrNull { it.value == mode }?.words ?: "")
        fun radioSaid(name: String, on: Boolean) = if (on) "Random album radio is on for $name" else "Random album radio is off for $name"
        fun sharedSaid(name: String, on: Boolean) = if (on) "Your other devices can play to $name" else "Only $name plays to itself now"
    }
}
