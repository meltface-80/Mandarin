package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject

/**
 * A device's Output as recipes (item 320), as the page's app/device-recipes.js has them: a short list of named
 * settings, each with what it does for this device in words (its highest rate, its real bits, its DSD rate), the one
 * its settings are now marked; Custom where they are none of them. A pick sends its settings and nothing else. An
 * upsampled recipe is offered only above 48 kHz, a DSD one only where DSD is on. Custom opens Advanced, where every
 * row of the Output is. The words are the page's.
 */
object DeviceRecipes {
    /** One recipe: its id, its name, what it does for this device, the settings a pick sends (none for Custom), whether it is in use. */
    data class Recipe(val id: String, val name: String, val words: String, val output: Map<String, Any>?, val on: Boolean)

    const val TITLE = "Sound"
    const val ADVANCED = "Advanced"
    const val ADVANCED_OPEN = "Each row of the Output"
    const val ADVANCED_SHUT = "Set by the one above"

    // The upsampled recipes' settings: what a pick sends, and what the Output must be for it to be the one in use.
    private val UPSAMPLED: List<Pair<String, Map<String, Any>>> = listOf(
        "standard" to mapOf("mode" to "max", "filter" to "standard", "filter_hires" to "same", "phase" to "linear", "dither" to "flat", "dsd_out" to "off"),
        "gaussian" to mapOf("mode" to "max", "filter" to "gaussian", "filter_hires" to "gaussian-hires", "phase" to "linear", "dither" to "flat", "dsd_out" to "off"),
        "gaussian-min" to mapOf("mode" to "max", "filter" to "gaussian", "filter_hires" to "gaussian-hires", "phase" to "minimum", "dither" to "flat", "dsd_out" to "off"),
        "very-long" to mapOf("mode" to "max", "filter" to "very-long", "filter_hires" to "same", "phase" to "linear", "dither" to "ns5", "dsd_out" to "off"),
    )
    // A setting's value by its absence (the server's defaults).
    private val DEFAULTS = mapOf("mode" to "original", "filter" to "standard", "filter_hires" to "same", "phase" to "linear", "dither" to "flat", "dsd_out" to "off", "dsd_mod" to "7")

    /** The recipes of the device's answer [j] (its name, rates, DSD and Output), the one in use marked; Custom last. */
    fun of(j: JSONObject): List<Recipe> {
        val o = j.optJSONObject("output") ?: JSONObject()
        val name = j.optString("name").ifEmpty { "the device" }
        val cap = o.optInt("max_rate", 0)
        val top = ons(j.optJSONArray("rates"), "hz").filter { it % 44100 == 0 && (cap == 0 || it <= cap / 48000.0 * 44100) }.maxOrNull() ?: 0
        val bits = if (o.optInt("bits", 0) == 32 && o.optBoolean("flac32")) 32 else 24
        val realBits = o.optInt("real_bits", 0)
        val dsd = ons(j.optJSONArray("dsd"), "n").filter { it == 64 || it == 128 || it == 256 }.maxOrNull() ?: 0
        val list = mutableListOf<Recipe>()
        list += Recipe("bitperfect", "Bit-perfect", "The file as it is, wherever $name takes its rate and depth: nothing done to the samples. A rate it doesn’t take, the nearest it does, made by SoX.",
            mapOf("mode" to "original", "dsd_out" to "off"), false)
        if (top > 48000) {
            val k = khz(top)
            val at = if (realBits >= 20) "at $name’s $realBits real bits" else "at $bits bits"
            val words = mapOf(
                "standard" to ("Upsampled, Standard filter" to "Each track to the highest rate $name takes ($k kHz for a CD), $bits-bit, in SoX’s steep filter: flat to 21 kHz for a CD. ffmpeg’s flat dither."),
                "gaussian" to ("Upsampled, Gaussian" to "To $k kHz in the Gaussian filters, Mandarin’s own as it plays: a CD’s 100 dB down by 22.05 kHz, 1.8 ms of ringing either side of a sound; hi-res in Gaussian hi-res. Flat dither."),
                "gaussian-min" to ("Upsampled, Gaussian, minimum phase" to "As Gaussian, to $k kHz, in minimum phase: the same levels at every frequency, all the ringing after a sound. Flat dither."),
                "very-long" to ("Upsampled, Very long, shaped dither" to "To $k kHz in the Very long filter (1,048,577 taps: flat to 21.9 kHz for a CD, 284 dB down from 22.1 kHz), its last bit dithered $at, shaped of the 5th order: its noise moved above the audio band."),
            )
            for ((id, sets) in UPSAMPLED) list += Recipe(id, words.getValue(id).first, words.getValue(id).second, sets, false)
        }
        if (dsd > 0) {
            val (mhz, band) = when (dsd) { 64 -> "2.8224" to "−127"; 128 -> "5.6448" to "−163"; else -> "11.2896" to "−207" }
            list += Recipe("dsd", "DSD$dsd, 7th order", "Each track made DSD$dsd ($mhz MHz) as it plays: upsampled in Gaussian steep, then the 7th-order modulator, $band dB in the audio band.",
                mapOf("dsd_out" to dsd, "dsd_mod" to "7", "filter" to "gaussian-steep", "filter_hires" to "same", "phase" to "linear"), false)
        }
        val at = list.indexOfFirst { matches(it.output!!, o) }
        if (at >= 0) list[at] = list[at].copy(on = true)
        list += Recipe("custom", "Custom", "Set each of the rows under Advanced yourself.", null, at < 0)
        return list
    }

    /** Whether Advanced is open: opened by a tap ([opened]), or Custom in use. */
    fun advancedOpen(list: List<Recipe>, opened: Boolean): Boolean = opened || list.any { it.id == "custom" && it.on }

    /** The change a recipe picked makes: PATCH {output: its settings}; null for Custom (it opens Advanced) or the one in use. */
    fun pick(r: Recipe): JSONObject? = if (r.output == null || r.on) null
        else JSONObject().put("output", JSONObject().apply { r.output.forEach { (k, v) -> put(k, v) } })

    // Whether the Output [o] is a recipe's [sets]: each as the device has it, its absence its default; minphase the standard filter.
    private fun matches(sets: Map<String, Any>, o: JSONObject): Boolean = sets.all { (k, want) ->
        var have: Any? = o.opt(k)?.takeIf { it != JSONObject.NULL && it != "" } ?: DEFAULTS[k]
        if (k == "filter" && have == "minphase") have = "standard"
        if (want is Number && have is Number) want.toDouble() == have.toDouble() else want.toString() == have.toString()
    }

    // The values of [key] of the chips on.
    private fun ons(a: JSONArray?, key: String): List<Int> =
        if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }.filter { it.optBoolean("on") }.map { it.optInt(key) }

    // In kHz as the page writes it: 705.6, 352.8, 192.
    private fun khz(hz: Int): String = if (hz % 1000 == 0) (hz / 1000).toString() else (hz / 1000.0).toString()
}
