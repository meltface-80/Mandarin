package com.musicd.server.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The ways an app may ask Android for a track, tried on a player's own output (item 434). */
class OwnDacWaysTest {
    private fun way(key: String, float: Boolean = true) = OwnDacWays.Way(key, key, float) { _, _, _ -> throw IllegalStateException("not in a test") }

    /** A FiiO R7's own lines, as its log had them for Mandarin Bridge 0.3.16. */
    private val r7 = listOf(
        "11-15 21:57:14.469 16102 16137 E AudioTrack: set(): streamType -1, sampleRate 176400, format 0x5, channelMask 0x3, frameCount 61472, flags #0",
        "11-15 21:57:14.574 16102 16137 D AudioTrack: config_audio_params:mSampleRate=176400 mFormat=5 check AudioFlinger sampleRate=44100 format=5 p2d=0",
        "11-15 21:57:14.574 16102 16137 E AudioTrack: config_audio_params:goto create retrack for sample rate or format not match",
        "11-15 21:57:14.597 16102 16137 D AudioTrack: config_audio_params:mSampleRate=176400 mFormat=5 check AudioFlinger sampleRate=44100 format=5 p2d=0 updateParams=0 isOutputDeviceChange=0"
    )

    @Test fun fiiosWordOnTheRateItWentOutAt() {
        assertEquals("176.4 kHz went out at 44.1", 44100, OwnDacWays.saidRate(r7, 176400))
        assertEquals("nothing said of 96 kHz", 0, OwnDacWays.saidRate(r7, 96000))
        val direct = r7 + "11-15 22:30:00.100 16102 16137 D AudioTrack: config_audio_params:mSampleRate=88200 mFormat=5 check AudioFlinger sampleRate=88200 format=5 p2d=0"
        assertEquals("the last said: 88.2 went out at 88.2", 88200, OwnDacWays.saidRate(direct, 88200))
        assertEquals("a phone says nothing of it", 0, OwnDacWays.saidRate(listOf("I AudioTrack: start"), 96000))
    }

    @Test fun onlyTheLinesSinceTheTry() {
        val before = r7.take(2)
        assertEquals(r7.drop(2), OwnDacWays.newer(r7, before))
        assertEquals("nothing before: all of them", r7, OwnDacWays.newer(r7, emptyList()))
        assertEquals("the window moved past it: all of them", r7, OwnDacWays.newer(r7, listOf("gone")))
    }

    @Test fun followedByEitherWord() {
        val w = way("music_stream")
        assertFalse("an R7 as media: 44.1 both ways", OwnDacWays.Tried(w, 96000, 44100, null, 44100).followed)
        assertTrue("FiiO said the track's own rate: a direct output", OwnDacWays.Tried(w, 96000, 44100, null, 96000).followed)
        assertTrue("Android's music output at the track's rate", OwnDacWays.Tried(w, 96000, 96000, null, 0).followed)
        assertFalse("couldn't be tried", OwnDacWays.Tried(w, 96000, 96000, "rate not taken").followed)
        assertEquals("fed: FiiO's word first", 96000, OwnDacWays.Tried(w, 96000, 44100, null, 96000).fed)
    }

    @Test fun theWayPlayedBy() {
        val media = way("media"); val stream16 = way("music_stream_16", float = false); val stream = way("music_stream")
        assertNull("none followed", OwnDacWays.chosen(listOf(OwnDacWays.Tried(media, 96000, 44100, null, 44100))))
        assertNull("a 16-bit way is never played by: a 24-bit sample wouldn't be whole",
            OwnDacWays.chosen(listOf(OwnDacWays.Tried(stream16, 96000, 44100, null, 96000))))
        assertEquals("the first float way that followed", stream, OwnDacWays.chosen(listOf(
            OwnDacWays.Tried(media, 96000, 44100, null, 44100), OwnDacWays.Tried(stream16, 88200, 44100, null, 88200),
            OwnDacWays.Tried(stream, 176400, 44100, null, 176400))))
    }

    @Test fun eachWayAtARateOfItsOwn() {
        val taken = listOf(44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000)
        val rates = OwnDacWays.ratesFor(6, taken, 44100)
        assertEquals(6, rates.distinct().size)
        assertFalse("never the rate the output is at already", 44100 in rates)
        assertEquals("a phone at 48 kHz taking 48 alone: tried at 96 all the same", listOf(96000, 96000), OwnDacWays.ratesFor(2, listOf(48000), 48000))
    }

    @Test fun mandarinToldTheRatesTheWayReaches() {
        val taken = listOf(44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000)
        assertEquals("UAPP's stopped at 192: so would ours", listOf(44100, 88200, 96000, 176400, 192000),
            OwnDac.advertised(taken, true, 0, listOf(44100, 88200, 96000, 176400, 192000)))
        assertEquals("stays at 44.1: that alone", listOf(44100), OwnDac.advertised(taken, false, 44100, emptyList()))
        // Above 192 kHz Android sends an ordinary track to a direct output (item 434): those that reached the DAC too.
        assertEquals("stays at 44.1, but 352.8 and 384 reached the DAC", listOf(44100, 352800, 384000),
            OwnDac.advertised(taken, false, 44100, listOf(44100, 352800, 384000)))
    }
}
