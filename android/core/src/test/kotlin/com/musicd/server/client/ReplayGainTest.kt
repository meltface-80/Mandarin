package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The same choices as the server's test/loudness.test.js, on the phone's copy. */
class ReplayGainTest {
    private val info = ReplayGain.Info(-6.0, 0.5, -4.0, 0.9)

    @Test fun `track, album and the fall-backs`() {
        assertEquals(-6.0, ReplayGain.gainDb(info, "track")!!, 1e-9)
        assertEquals(-4.0, ReplayGain.gainDb(info, "album")!!, 1e-9)
        assertEquals(-4.0, ReplayGain.gainDb(ReplayGain.Info(null, null, -4.0, 0.9), "track")!!, 1e-9)
        assertEquals(-6.0, ReplayGain.gainDb(ReplayGain.Info(-6.0, 0.5, null, null), "album")!!, 1e-9)
        assertNull(ReplayGain.gainDb(ReplayGain.Info(null, null, null, null), "track"))
        assertNull(ReplayGain.gainDb(null, "track"))
    }

    @Test fun `the peak keeps a gain from clipping, after the pre-amp`() {
        assertEquals(6.0, ReplayGain.gainDb(ReplayGain.Info(10.0, 0.5, null, null), "track")!!, 1e-9)
        assertEquals(-4.0, ReplayGain.gainDb(info, "track", 2.0)!!, 1e-9)
        assertNull(ReplayGain.gainDb(ReplayGain.Info(0.02, null, null, null), "track"))
    }

    @Test fun `auto takes the album's in order, the track's shuffled or alone`() {
        assertEquals("album", ReplayGain.kindFor("auto", false, true))
        assertEquals("track", ReplayGain.kindFor("auto", true, true))
        assertEquals("track", ReplayGain.kindFor("auto", false, false))
        assertEquals("album", ReplayGain.kindFor("album", true, false))
    }

    @Test fun `the setting and album json read`() {
        val s = ReplayGain.Setting.parse(JSONObject("""{"mode":"auto","preamp":3}"""))
        assertEquals("auto", s.mode); assertEquals(3.0, s.preamp, 1e-9)
        assertEquals("off", ReplayGain.Setting.parse(JSONObject("""{"mode":"loud"}""")).mode)
        val i = ReplayGain.Info.parse(JSONObject("""{"track_gain":-6.5,"track_peak":0.8,"album_gain":null}"""))!!
        assertEquals(-6.5, i.trackGain!!, 1e-9); assertNull(i.albumGain)
        assertEquals(0.5, ReplayGain.linear(-6.0206), 1e-4)
        assertEquals(1.0, ReplayGain.linear(null), 1e-12)
    }
}
