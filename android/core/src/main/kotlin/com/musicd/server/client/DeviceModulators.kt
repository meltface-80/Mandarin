package com.musicd.server.client

import org.json.JSONObject

/**
 * With PCM as DSD on, the modulator a track is made DSD with (item 303), as the page's app/device-modulators.js has
 * it: one row, opening the list of modulators, each with what it measured; one not made at the DSD rate set greyed
 * out, the seventh order used there instead (the server's Upsample/DsdOut.cs). The words are the page's.
 */
object DeviceModulators {
    /** One modulator: the value the server keeps, its name, what it measured, and the DSD multiples it is made at. */
    data class Mod(val value: String, val name: String, val note: String, val at: List<Int>)

    val ALL: List<Mod> = listOf(
        Mod("7", "7th order", "Mandarin’s default. Its noise held down through the audio band (−207 dB at DSD256), rising above 20 kHz (−124 dB from 20 to 50 kHz).", listOf(64, 128, 256)),
        Mod("7w", "7th order wide", "DSD128 and DSD256. Its noise held down to 50 kHz: from 20 to 50 kHz −151 dB at DSD256, 27 dB under the 7th’s; in the band −151 dB, below what 24 bits carry.", listOf(128, 256)),
        Mod("9", "9th order", "DSD64 and DSD128. Quieter in the band (−136 dB at DSD64, 9 dB under the 7th’s; −181 dB at DSD128); a little more above 20 kHz; a fifth more work.", listOf(64, 128)),
    )

    const val NOTE = "How the PCM is made one bit a sample: where its noise goes. Each measured with a tone at SACD’s level; each holds to 75% modulation with no reset."

    /** The modulator used at DSD[n] for the setting [v]: the one set where it is made there, else the seventh order. */
    fun used(v: String?, n: Int): Mod = ALL.firstOrNull { it.value == v && n in it.at } ?: ALL[0]

    /** The row: its label, the rate it is for, and the modulator in use. */
    data class Row(val label: String, val sub: String, val value: String)

    fun row(v: String?, n: Int): Row = Row("Modulator", "PCM made DSD$n", used(v, n).name)

    /** The list's title at DSD[n]. */
    fun title(n: Int): String = "Modulator for DSD$n"

    /** A choice of the list at DSD[n]: its name (with "not at DSD[n]" where it isn't made there), and whether it can be picked. */
    data class Choice(val value: String, val name: String, val note: String, val offered: Boolean)

    fun choices(n: Int): List<Choice> = ALL.map { m -> (n in m.at).let { Choice(m.value, if (it) m.name else "${m.name} — not at DSD$n", m.note, it) } }

    /** The change a modulator picked makes: PATCH {output: {dsd_mod: v}}. */
    fun pick(v: String): JSONObject = JSONObject().put("output", JSONObject().put("dsd_mod", v))
}
