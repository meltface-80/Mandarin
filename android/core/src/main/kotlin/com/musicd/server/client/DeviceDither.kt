package com.musicd.server.client

import org.json.JSONObject

/**
 * When Mandarin makes the PCM (upsampled, not made DSD), how its last bit is rounded (item 301), as the page's
 * app/device-dither.js has it: the DAC's real bits (as sent, or 23 to 20), and the dither, one row opening its list,
 * each with what it measured (the server's Upsample/Dither.cs). The words are the page's.
 */
object DeviceDither {
    /** One dither: the value the server keeps, its name, what it measured. */
    data class Dither(val value: String, val name: String, val note: String)

    val ALL: List<Dither> = listOf(
        Dither("flat", "Flat", "Mandarin’s default: triangular dither, its noise even at every frequency. −130 dB in the audio band; −117 dB in all."),
        Dither("ns3", "Shaped, 3rd order", "Its noise moved above the audio band: −192 dB in the band, 62 dB under Flat; −104 dB in all, 13 dB more than Flat."),
        Dither("ns5", "Shaped, 5th order", "More moved: −233 dB in the band, 103 dB under Flat; −93 dB in all, 24 dB more than Flat."),
    )

    const val NOTE = "How the last bit is rounded when Mandarin makes the PCM. Measured with a tone at half scale at 705.6 kHz and 20 bits. Shaped is made at 88.2 kHz and up; at 44.1 and 48 kHz there is no room above the band to move the noise to, so Flat."
    const val REAL_BITS_NOTE = "How many bits the DAC itself resolves, above its own noise: from its measured dynamic range, (dB − 1.76) ÷ 6.02. The dither goes in at that bit; the bits below it are left at zero. As sent: at the word’s own depth."

    /** The DAC's real bits to choose from: as sent, 23 to 20. */
    val REAL_BITS: List<SegChoice> = listOf(SegChoice("sent", "As sent")) + listOf(23, 22, 21, 20).map { SegChoice("$it", "$it") }

    /** The dither in use for the setting [v]: flat by its absence. */
    fun used(v: String?): Dither = ALL.firstOrNull { it.value == v } ?: ALL[0]

    /** The row: its label, at which bit, and the dither in use. */
    data class Row(val label: String, val sub: String, val value: String)

    fun row(v: String?, realBits: Int): Row = Row("Dither", if (realBits > 0) "At $realBits bits" else "At the word’s depth", used(v).name)

    const val TITLE = "Dither"

    /** The change a dither picked makes: PATCH {output: {dither: v}}. */
    fun pick(v: String): JSONObject = JSONObject().put("output", JSONObject().put("dither", v))

    /** The change real bits picked make: PATCH {output: {real_bits: 20}} (or "sent"). */
    fun pickBits(v: String): JSONObject = JSONObject().put("output", JSONObject().put("real_bits", v.toIntOrNull() ?: v))

    /** Headroom when upsampling (item 348, the page's headroomGroup): Auto or Off, and what each does. */
    const val HEADROOM_TITLE = "Headroom when upsampling"
    val HEADROOM: List<SegChoice> = listOf(SegChoice("auto", "Auto"), SegChoice("off", "Off"))
    fun headroomNote(off: Boolean): String = if (off) "Nothing is turned down: a track mastered to full scale may be clipped where it is upsampled. Now playing’s line turns red when it is."
        else "A track whose peaks between its samples would go over full scale when it is upsampled is turned down by just enough, and half a dB more: from its true peak, as the loudness scan or an upsampling of it measured it. Tracks that don’t need it keep their level; DSD has 2.9 dB of room of its own."

    /** The change a headroom picked makes: PATCH {output: {headroom: "auto" | "off"}}. */
    fun pickHeadroom(v: String): JSONObject = JSONObject().put("output", JSONObject().put("headroom", v))
}
