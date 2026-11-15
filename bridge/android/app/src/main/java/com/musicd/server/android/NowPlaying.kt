package com.musicd.server.android

import java.math.BigDecimal

/**
 * What Now Playing shows (item 430), the screen the app opens on: the track Mandarin plays on this Bridge, as its
 * request said it (Said.kt), with its cover; the format the DAC is fed; the DAC it plays to. Until Mandarin has played
 * a track here ([firstRun]) it shows how to set the Bridge up instead, the settings cog circled. Plain Kotlin, no
 * Android, so it is unit-tested on the JVM (NowPlayingTest); NowPlayingScreen.kt draws it.
 */
class NowPlaying(
    /** Never played yet: the setup help shown. */
    val firstRun: Boolean,
    /** The track, or null: nothing playing. */
    val track: Track?,
    /** The format badge ("24-bit / 192 kHz", "DSD128"), or null for none. */
    val format: String?,
    /** The line at the foot: the DAC it plays to, or that there is none. */
    val dac: String
) {
    /** A track as Mandarin said it: [art], its cover's address, "" for none. */
    class Track(val title: String, val artist: String, val album: String, val art: String)

    /** What the DAC is fed now (Mandarin's USB driver): its rate and depth; [dsd], the DSD multiple (0 for PCM); [dop], DSD as DoP. */
    class Feed(val rate: Int, val bits: Int, val dsd: Int = 0, val dop: Boolean = false)

    /** The placeholder's words when there is no track. */
    val idle: String get() = if (firstRun) NOTHING_YET else NOTHING

    companion object {
        const val NOTHING = "Nothing playing"
        const val NOTHING_YET = "Nothing playing yet"
        const val NO_DAC = "No DAC plugged in"
        const val SETUP_TITLE = "Set up this Bridge"
        const val SETUP_LEAD = "This phone plays Mandarin’s music to the USB DAC plugged into it."

        /**
         * What the screen shows: [playedOnce] whether Mandarin has played here yet (Store.playedOnce); the transport's
         * [state] and the track it holds ([title] and the rest, null with none); [feed] what the DAC is fed, null with
         * no stream; [dac] the DAC's name, null with none plugged in.
         */
        fun of(playedOnce: Boolean, state: String, title: String?, artist: String?, album: String?, art: String?, feed: Feed?, dac: String?): NowPlaying {
            val held = state != "NO_MEDIA_PRESENT" && listOf(title, artist, album).any { !it.isNullOrBlank() }
            val track = if (!held) null else Track(title?.trim().orEmpty().ifEmpty { "Untitled" }, artist?.trim().orEmpty(), album?.trim().orEmpty(), art?.trim().orEmpty())
            return NowPlaying(
                firstRun = !playedOnce && state != "PLAYING",
                track = track,
                format = if (track == null) null else feed?.let { format(it) },
                dac = dacLine(dac)
            )
        }

        /** "Playing to SMSL SU-1", or that no DAC is plugged in. */
        fun dacLine(dac: String?): String = dac?.trim()?.takeIf { it.isNotEmpty() }?.let { "Playing to $it" } ?: NO_DAC

        /** The badge: "24-bit / 192 kHz", "16-bit / 44.1 kHz"; "DSD128", "DSD64 (DoP)"; null where nothing is fed. */
        fun format(f: Feed): String? = when {
            f.dsd > 0 -> "DSD${f.dsd}" + (if (f.dop) " (DoP)" else "")
            f.rate <= 0 || f.bits <= 0 -> null
            else -> "${f.bits}-bit / ${khz(f.rate)} kHz"
        }

        /**
         * Whether covers [a] and [b] are the same picture: their addresses apart from the query, which carries the size
         * and a signature that changes; a new track of the same album keeps the cover it has, fetched once.
         */
        fun sameCover(a: String, b: String): Boolean = a.isNotEmpty() && a.substringBefore('?') == b.substringBefore('?')

        /** A rate in kHz as it is said: 44.1, 192, 352.8. */
        fun khz(rate: Int): String = BigDecimal(rate).movePointLeft(3).stripTrailingZeros().toPlainString()

        /**
         * The setup help's three steps, each a run of words and whether they stand out (brass, bold); [name], this
         * Bridge's name on the network, as Mandarin's Settings → Audio Devices lists it.
         */
        fun steps(name: String): List<List<Pair<String, Boolean>>> = listOf(
            listOf("Tap " to false, "⚙ Settings" to true, " (top left): plug in your DAC, give this Bridge a name and adjust the settings to suit." to false),
            listOf("In the " to false, "Mandarin app" to true, ": " to false, "Settings → Audio Devices" to true, ", find " to false,
                "Mandarin Bridge (${name.trim()})" to true, " and switch it on." to false),
            listOf("Choose it as the room to play to. What it plays shows here." to false)
        )
    }
}
