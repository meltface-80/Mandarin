package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow

/** A parametric band as edited: its type (peak, low_shelf, high_shelf, low_pass, high_pass), frequency, gain and Q. */
data class EqBand(val type: String, val freq: Double, val gain: Double, val q: Double) {
    val pass: Boolean get() = type == "low_pass" || type == "high_pass"
    fun dsp() = Dsp.Band(type, freq, if (pass) 0.0 else gain, q)
    fun json(): JSONObject = JSONObject().put("type", type).put("freq", freq).put("gain", gain).put("q", q)
}

/** A headphone profile (AutoEq's, or one pasted), kept as the server gave it ([j]) and saved back so. */
class HeadphoneProfile(val j: JSONObject) {
    val name: String get() = j.optString("name").ifEmpty { "Profile" }
    val preamp: Double? get() = if (j.opt("preamp") is Number) j.optDouble("preamp") else null
    val bands: List<EqBand> get() = DspDraft.bands(j.optJSONArray("bands"))
    /** Under its name: AutoEq's, how many bands, its preamp. */
    val sub: String get() = (if (j.optString("source") == "autoeq") "AutoEq · " else "") + "${bands.size} band" + (if (bands.size == 1) "" else "s") + (preamp?.let { " · preamp " + DspDraft.db(it) } ?: "")
}

/** One of AutoEq's answers to a name: what it is, and whose measurement on what rig. */
data class HeadphoneResult(val id: String, val name: String, val sub: String)

/** The response curve as the page draws it (drawDsp): the frequencies across, the bands' dB at each, the headroom, the scale's top. */
class DspCurve(val freqs: List<Double>, val db: List<Double>, val pre: Double, val top: Double) {
    /** Where [f] falls across [w] (20 Hz at 0, 20 kHz at [w]); where [v] dB falls down [h] (+top at 0, −top at [h]). */
    fun x(f: Double, w: Float): Float = (w * (log10(f) - log10(20.0)) / (log10(20000.0) - log10(20.0))).toFloat()
    fun y(v: Double, h: Float): Float = (h * (top - v) / (2 * top)).toFloat()

    companion object {
        /** The lines down at these frequencies, those of the decades darker; labelled at the five. */
        val GRID = listOf(20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000)
        val STRONG = setOf(100, 1000, 10000)
        val LABELLED = setOf(20, 100, 1000, 10000, 20000)
        fun label(f: Int) = if (f >= 1000) "${f / 1000}k" else "$f"
    }
}

/**
 * The DSP block's edits for the device open now (the page's dspDraft, audio-devices-page.js renderDsp and headroomNote):
 * the PEQ's bands, the headroom (null: Auto) and the headphone profile, [dirty] once changed; Save sends [setting].
 */
data class DspDraft(val bands: List<EqBand>, val headroom: Double?, val headphone: HeadphoneProfile?, val dirty: Boolean = false) {
    /** Every band that runs: the headphone profile's, then the PEQ's. */
    val all: List<EqBand> get() = (headphone?.bands ?: emptyList()) + bands
    private fun dsp(auto: Boolean) = Dsp.Setting(true, headphone?.let { Dsp.Headphone(it.name, it.preamp, it.bands.map(EqBand::dsp)) }, bands.map(EqBand::dsp), if (auto) null else headroom)
    val peak: Double get() = Dsp.peakDb(all.map(EqBand::dsp), FS)
    /** What Auto would take. */
    val auto: Double get() = Dsp.headroom(dsp(true), FS)

    /** What is said of the headroom under its choice. */
    val headroomNote: String get() {
        val set = headroom
        if (set != null) return "Set by hand: " + db(set) + " before the bands. Auto would take " + db(auto) + "."
        if (all.isEmpty()) return "Auto: nothing to take yet."
        val own = headphone?.preamp
        val a = auto
        if (own != null && own == a) return "Auto: " + db(a) + " — the headphone profile's own preamp, which covers the bands' peak of " + db(peak) + "."
        return "Auto: " + db(a) + " before the bands — their peak together is " + db(peak) + ", and half a dB is kept under it so nothing clips." +
            (if (own != null) " The profile's own " + db(own) + " would not cover it." else "")
    }

    /** The curve: 241 frequencies from 20 Hz to 20 kHz, the bands' response there, the headroom taken, the scale's top (6 dB at least, in threes). */
    fun curve(): DspCurve {
        val freqs = (0..240).map { 10.0.pow(log10(20.0) + (log10(20000.0) - log10(20.0)) * it / 240) }
        val bs = all.map(EqBand::dsp)
        val r = freqs.map { Dsp.responseDb(bs, FS, it) }
        val pre = Dsp.headroom(dsp(false), FS)
        val top = max(6.0, ceil(max(r.maxOfOrNull { abs(it) } ?: 0.0, abs(pre)) / 3) * 3)
        return DspCurve(freqs, r, pre, top)
    }

    fun with(i: Int, b: EqBand) = copy(bands = bands.toMutableList().also { it[i] = b }, dirty = true)
    fun added() = if (bands.size >= Dsp.MAX_BANDS) this else copy(bands = bands + EqBand("peak", 1000.0, 0.0, 1.41), dirty = true)
    fun removed(i: Int) = copy(bands = bands.filterIndexed { k, _ -> k != i }, dirty = true)
    /** Auto, or set by hand at what Auto would take. */
    fun headroomAuto(on: Boolean) = copy(headroom = if (on) null else auto, dirty = true)

    /** The setting saved (PATCH {dsp: …}): on or off, the profile, the bands, the headroom. */
    fun setting(enabled: Boolean): JSONObject = JSONObject().put("enabled", enabled).put("headphone", headphone?.j ?: JSONObject.NULL)
        .put("peq", JSONObject().put("bands", JSONArray(bands.map(EqBand::json)))).put("headroom", headroom ?: "auto")

    companion object {
        const val FS = 48000.0
        val TYPES = listOf(Choice("peak", "Peak"), Choice("low_shelf", "Low shelf"), Choice("high_shelf", "High shelf"), Choice("low_pass", "Low-pass"), Choice("high_pass", "High-pass"))
        const val NONE = "None. A profile from AutoEq corrects a headphone’s measured response; pick yours, or paste one you have."
        const val NO_BANDS = "No bands yet. Add one for each correction: a peak at a frequency, a shelf below or above one, or a pass filter."
        const val SEARCH_HINT = "Headphone name — HD 650, Aria, AirPods…"
        const val PASTE_HINT = "Preamp: -6.1 dB\nFilter 1: ON LSC Fc 105 Hz Gain 6.4 dB Q 0.70\nFilter 2: ON PK Fc 8800 Hz Gain 5.1 dB Q 1.42"

        /** The draft from the device's setting as the server sent it. */
        fun from(dsp: JSONObject?): DspDraft {
            val hr = dsp?.opt("headroom")
            return DspDraft(bands(dsp?.optJSONObject("peq")?.optJSONArray("bands")), if (hr is Number) hr.toDouble() else null, dsp?.optJSONObject("headphone")?.let(::HeadphoneProfile))
        }

        fun bands(a: JSONArray?): List<EqBand> = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map {
            EqBand(it.optString("type", "peak"), it.optDouble("freq", 1000.0), it.optDouble("gain", 0.0), it.optDouble("q", 0.707))
        }

        /** dB as the page writes it: a sign (− for minus), one decimal. */
        fun db(v: Double): String = (if (v > 0) "+" else if (v < 0) "−" else "") + String.format(Locale.US, "%.1f dB", abs(v))

        /** A number in a band's field as the page shows it: whole without its point, else as it is ([q] to two places). */
        fun field(v: Double, q: Boolean = false): String {
            val x = if (q) Math.round(v * 100) / 100.0 else v
            return if (x == Math.floor(x) && abs(x) < 1e15) x.toLong().toString() else x.toString()
        }

        /** AutoEq's answers ({results: [{id, name, source, rig, form}]}). */
        fun results(j: JSONObject): List<HeadphoneResult> {
            val a = j.optJSONArray("results") ?: return emptyList()
            return (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map { r ->
                HeadphoneResult(r.optString("id"), r.optString("name"), listOf(r.optString("source"), r.optString("rig"), r.optString("form")).filter { it.isNotEmpty() }.joinToString(" · "))
            }
        }

        /** What the results' place says before or without answers. */
        fun resultsNote(q: String, busy: Boolean, error: String?, got: Int): String? = when {
            busy -> "Looking…"
            error != null -> error
            q.trim().length < 2 -> "Type a name. AutoEq has profiles for most headphones and earphones that have been measured."
            got == 0 -> "Nothing by that name. Try fewer words, or paste a profile."
            else -> null
        }

        fun saved(on: Boolean, phone: Boolean) = if (!on) "DSP is off" else if (phone) "DSP saved — the phone has it" else "DSP saved — on from the next track"
    }
}
