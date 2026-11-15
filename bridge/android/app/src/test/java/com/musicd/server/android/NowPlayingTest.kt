package com.musicd.server.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Now Playing's model (item 430): first run or set up, a track or none, the format badge and the DAC line. */
class NowPlayingTest {
    private val feed = NowPlaying.Feed(192000, 24)

    private fun np(playedOnce: Boolean = true, state: String = "PLAYING", title: String? = "Along Came Betty", artist: String? = "Art Blakey",
                   album: String? = "Moanin'", art: String? = "http://m/api/image/k?size=600&e=1&s=x", f: NowPlaying.Feed? = feed, dac: String? = "SMSL SU-1") =
        NowPlaying.of(playedOnce, state, title, artist, album, art, f, dac)

    @Test fun neverPlayedIsTheFirstRun() {
        val n = np(playedOnce = false, state = "NO_MEDIA_PRESENT", title = null, artist = null, album = null, art = null, f = null)
        assertTrue(n.firstRun)
        assertNull(n.track)
        assertEquals("Nothing playing yet", n.idle)
    }

    @Test fun playedOnceIsSetUpForGood() {
        val n = np(playedOnce = true, state = "NO_MEDIA_PRESENT", title = null, artist = null, album = null, art = null, f = null)
        assertFalse(n.firstRun)
        assertNull(n.track)
        assertEquals("Nothing playing", n.idle)
    }

    @Test fun aTrackPlayingIsSetUpEvenBeforeTheFlagIsKept() {
        assertFalse(np(playedOnce = false, state = "PLAYING").firstRun)
        assertTrue("loading the very first track: still the help", np(playedOnce = false, state = "TRANSITIONING").firstRun)
    }

    @Test fun aTrackIsShownAsMandarinSaidIt() {
        val t = np().track!!
        assertEquals("Along Came Betty", t.title)
        assertEquals("Art Blakey", t.artist)
        assertEquals("Moanin'", t.album)
        assertEquals("http://m/api/image/k?size=600&e=1&s=x", t.art)
    }

    @Test fun pausedStillShowsTheTrack() {
        assertEquals("Along Came Betty", np(state = "PAUSED_PLAYBACK").track?.title)
    }

    @Test fun nothingHeldIsNothingPlaying() {
        assertNull(np(state = "NO_MEDIA_PRESENT").track)
        assertNull("a track with nothing said of it", np(title = " ", artist = null, album = "").track)
        assertNull("no badge with no track", np(state = "NO_MEDIA_PRESENT").format)
    }

    @Test fun aTrackWithNoTitleIsUntitled() {
        assertEquals("Untitled", np(title = "").track?.title)
        assertEquals("", np(art = null).track?.art)
    }

    @Test fun theBadgeSaysWhatTheDacIsFed() {
        assertEquals("24-bit / 192 kHz", np().format)
        assertEquals("16-bit / 44.1 kHz", NowPlaying.format(NowPlaying.Feed(44100, 16)))
        assertEquals("32-bit / 352.8 kHz", NowPlaying.format(NowPlaying.Feed(352800, 32)))
        assertEquals("DSD128", NowPlaying.format(NowPlaying.Feed(176400, 32, dsd = 128)))
        assertEquals("DSD64 (DoP)", NowPlaying.format(NowPlaying.Feed(176400, 24, dsd = 64, dop = true)))
        assertNull("nothing fed", NowPlaying.format(NowPlaying.Feed(0, 0)))
        assertNull("no stream, no badge", np(f = null).format)
    }

    @Test fun kilohertzAsTheyAreSaid() {
        assertEquals("44.1", NowPlaying.khz(44100))
        assertEquals("48", NowPlaying.khz(48000))
        assertEquals("192", NowPlaying.khz(192000))
        assertEquals("705.6", NowPlaying.khz(705600))
    }

    @Test fun theDacLine() {
        assertEquals("Playing to SMSL SU-1", np().dac)
        assertEquals("No DAC plugged in", np(dac = null).dac)
        assertEquals("No DAC plugged in", np(dac = "  ").dac)
        assertEquals("the DAC line shows on first run too", "No DAC plugged in", np(playedOnce = false, state = "NO_MEDIA_PRESENT", dac = null).dac)
    }

    @Test fun theSetupStepsNameThisBridge() {
        val steps = NowPlaying.steps("FiiO R7 USB")
        assertEquals(3, steps.size)
        assertTrue("the Bridge as Mandarin lists it, in brass", ("Mandarin Bridge (FiiO R7 USB)" to true) in steps[1])
        assertTrue(("⚙ Settings" to true) in steps[0])
        assertTrue(("Settings → Audio Devices" to true) in steps[1])
        assertEquals("Choose it as the room to play to. What it plays shows here.", steps[2].joinToString("") { it.first })
    }

    @Test fun aNewTrackOfTheSameAlbumKeepsItsCover() {
        assertTrue(NowPlaying.sameCover("http://m/api/image/k1?size=600&e=1&s=a", "http://m/api/image/k1?size=600&e=2&s=b"))
        assertFalse(NowPlaying.sameCover("http://m/api/image/k1?size=600&e=1&s=a", "http://m/api/image/k2?size=600&e=1&s=a"))
        assertFalse("none is never the same", NowPlaying.sameCover("", ""))
    }
}
