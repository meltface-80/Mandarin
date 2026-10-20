package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * This phone's USB DAC on its own page in Settings → Audio Devices, as the app's USB driver describes it (UsbDac.json in the
 * app): the page's renderUsb (audio-devices-page.js; bug list item 89) in what it shows and says.
 */
class UsbView(val j: JSONObject) {
    val attached: Boolean get() = j.optBoolean("attached")
    val permission: Boolean get() = j.optBoolean("permission")
    val direct: Boolean get() = j.optBoolean("direct")
    val fixed: Boolean get() = j.optBoolean("fixed")
    val limit: Int get() = j.optInt("limit", 80).let { if (it > 0) it else 80 }
    val dsdMode: String get() = j.optString("dsd_mode").ifEmpty { "native" }
    val error: String? get() = j.optString("error").takeIf { it.isNotEmpty() && !j.isNull("error") }
    val streamError: String? get() = j.optString("stream_error").takeIf { it.isNotEmpty() }
    private val info: JSONObject? get() = j.optJSONObject("info")
    val hasInfo: Boolean get() = info != null

    /** The DAC's name: its maker (where its name doesn't already say it) and its name. */
    val name: String get() = j.optJSONObject("device")?.let { d -> listOf(if (d.isNull("manufacturer")) "" else d.optString("manufacturer"), d.optString("name")).filter { it.isNotEmpty() }.joinToString(" ") }
        .orEmpty().ifEmpty { "USB audio device" }

    val rates: List<Int> get() = info?.optJSONArray("rates").ints()
    val bits: List<Int> get() = info?.optJSONArray("bits").ints()
    /** USB Audio Class 1 or 2, its speed, how it keeps time. */
    val classLine: String get() = info?.let { i ->
        "USB Audio Class " + (if (i.optInt("uac") == 2) "2" else "1") + i.optString("speed").let { s -> if (s.isNotEmpty() && s != "unknown") " · $s speed" else "" } + " · " + i.optString("sync")
    }.orEmpty()
    val dsdLine: String get() = if (info?.optBoolean("dsd") == true) "Native DSD offered" else "No native DSD in its descriptors (DoP may still work)"
    val volumeLine: String get() = if (info?.optBoolean("volume_control") == true) "The DAC has a USB volume control" else "No USB volume control (fixed at full)"
    val clock: String? get() = info?.let { if (it.isNull("current_rate") || it.optInt("current_rate") == 0) null else DevicePage.rateWord(it.optInt("current_rate")) + " kHz" }

    val directNote: String get() = if (direct) "On. Through the app’s own USB driver, at the track’s own rate." else "Off. The phone plays through Android’s mixer, at the mixer’s rate."
    val fixedNote: String get() = if (fixed) "On. The DAC is driven at full and the amplifier sets the level — for a DAC into a preamp. Not for headphones on a DAC with its own volume control."
        else if (info?.optBoolean("volume_control") == true) "Off. The volume slider and the phone’s volume buttons drive the DAC’s own control. It starts at 10% whenever USB direct goes on or the DAC is plugged in — never at the DAC’s own level."
        else "Off. This DAC has no USB volume control, so the slider and the phone’s volume buttons scale the samples before they go out — no longer bit-perfect. Switch on for bit-perfect at full."

    private val native: List<Int> get() = j.optJSONArray("dsd_native").ints()
    private val dop: List<Int> get() = j.optJSONArray("dsd_dop").ints()
    /** DSD to the DAC: shown with USB direct on, where it takes DSD natively or as DoP. */
    val showDsd: Boolean get() = direct && (native.isNotEmpty() || dop.isNotEmpty())
    val dsdChoices: List<Choice> get() = buildList {
        if (native.isNotEmpty()) { add(Choice("native", "Native")); add(Choice("native_le", "Native, words reversed")) }
        if (dop.isNotEmpty()) add(Choice("dop", "DoP"))
        add(Choice("pcm", "PCM from the server"))
    }
    val dsdNote: String get() {
        val nat = native.joinToString(", ") { "DSD$it" }; val d = dop.joinToString(", ") { "DSD$it" }
        return (if (nat.isNotEmpty()) "Natively: $nat. " else "") + (if (d.isNotEmpty()) "As DoP: $d. " else "") + when (dsdMode) {
            "pcm" -> "DSD files are converted to PCM on the server, as before."
            "dop" -> "DSD files go to the DAC as DoP (DSD over PCM), bit-perfect."
            else -> "DSD files go to the DAC as DSD, bit-perfect" + (if (dsdMode == "native_le") ", each 32-bit word the other way round — for a DAC that plays noise with the usual order" else "") + (if (d.isNotEmpty()) "; DoP where the rate isn’t native." else ".")
        }
    }

    /** What is being fed to the DAC now, and how it is going; none without a stream. */
    val streaming: String? get() {
        val st = j.optJSONObject("stream") ?: return null
        val s = st.optJSONObject("stats") ?: JSONObject()
        val what = if (!st.isNull("dsd") && st.optInt("dsd") > 0) "DSD" + st.optInt("dsd") + (if (st.optString("kind") == "dop") " as DoP" else " native")
            else DevicePage.rateWord(st.optInt("rate")) + " kHz · " + st.optInt("bits") + "-bit"
        val vol = if (fixed) " · fixed volume" else if (st.opt("level") is Number) " · volume " + st.optInt("level") + "%" + (if (st.optBoolean("software_volume")) " in software" else "") +
            (st.optJSONObject("volume_db")?.let { " (DAC range " + one(it.optDouble("min")) + " to " + one(it.optDouble("max")) + " dB)" } ?: "") else ""
        val u = s.optInt("underruns"); val e = s.optInt("errors")
        return what + vol + (if (s.opt("running") == false) " · paused" else "") +
            (if (s.optDouble("feedback", 0.0) != 0.0) " · feedback " + String.format(Locale.US, "%.3f", s.optDouble("feedback")) + " frames/packet" else "") +
            (if (u > 0) " · $u underrun" + (if (u == 1) "" else "s") else "") + (if (e > 0) " · $e error" + (if (e == 1) "" else "s") else "")
    }

    companion object {
        const val NOTHING = "Nothing on the USB port. Plug a DAC in and it shows here."
        const val ASK = "Android asks once whether Mandarin may use this device; a yes is remembered for it."
        const val READING = "Reading the DAC…"
        const val DIRECT_INFO = "The app plays through its own USB driver: the DAC is fed the track at its own rate and the DAC’s depth, Android’s mixer out of the way — bit-perfect with the DSP off. A rate the DAC doesn’t take goes through Android as before. Off, the phone plays through Android’s mixer, at the mixer’s rate."
        const val LIMIT_NOTE = "The most the volume can be set to through USB — the slider stops here, so the DAC is never driven to full by mistake."
        const val DIAGNOSTICS_NOTE = "Everything the DAC said about itself, as text — what a report needs."
        private fun JSONArray?.ints(): List<Int> = if (this == null) emptyList() else (0 until length()).map { optInt(it) }
        private fun one(v: Double) = String.format(Locale.US, "%.1f", v)
    }
}
