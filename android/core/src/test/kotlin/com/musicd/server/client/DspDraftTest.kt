package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The DSP block's draft against the page's own numbers (public/biquad.js, item 89). */
class DspDraftTest {
    private val setting = JSONObject("""{"enabled":true,"headroom":"auto",
        "headphone":{"name":"HD 650","source":"autoeq","preamp":-6.1,"bands":[{"type":"low_shelf","freq":105,"gain":6.4,"q":0.7},{"type":"peak","freq":8800,"gain":5.1,"q":1.42}]},
        "peq":{"bands":[{"type":"peak","freq":1000,"gain":-3,"q":1.41},{"type":"high_pass","freq":20,"gain":0,"q":0.7}]}}""")

    @Test fun `the curve, the peak and Auto's headroom are the page's`() {
        val d = DspDraft.from(setting)
        val c = d.curve()
        // biquad.js response() at the 0th, 60th, 120th, 180th and 240th of the page's 241 frequencies.
        val want = listOf(3.287350, 2.759829, -1.056914, 0.299174, 0.084139)
        for ((k, i) in listOf(0, 60, 120, 180, 240).withIndex()) assertEquals(want[k], c.db[i], 1e-5)
        assertEquals(112.468265, c.freqs[60], 1e-5)
        assertEquals(5.952466, d.peak, 1e-5)
        assertEquals(-6.5, d.auto, 1e-9)
        assertEquals(-6.5, c.pre, 1e-9)
        assertEquals(9.0, c.top, 1e-9)
        assertEquals("Auto: −6.5 dB before the bands — their peak together is +6.0 dB, and half a dB is kept under it so nothing clips. The profile's own −6.1 dB would not cover it.", d.headroomNote)
        assertEquals("AutoEq · 2 bands · preamp −6.1 dB", d.headphone!!.sub)
    }

    @Test fun `edits, the headroom set by hand, and what Save sends`() {
        val d = DspDraft.from(setting).headroomAuto(false)
        assertTrue(d.dirty)
        assertEquals(-6.5, d.headroom!!, 1e-9)
        assertEquals("Set by hand: −6.5 dB before the bands. Auto would take −6.5 dB.", d.headroomNote)
        val e = d.added().removed(0).with(0, EqBand("low_pass", 18000.0, 4.0, 0.7))
        assertEquals(listOf("low_pass", "peak"), e.bands.map { it.type })
        val s = e.setting(true)
        assertEquals(-6.5, s.getDouble("headroom"), 1e-9)
        assertEquals("HD 650", s.getJSONObject("headphone").getString("name"))
        assertEquals(2, s.getJSONObject("peq").getJSONArray("bands").length())
        assertEquals("auto", DspDraft(emptyList(), null, null).setting(false).getString("headroom"))
        assertTrue(DspDraft(emptyList(), null, null).setting(false).isNull("headphone"))
        assertEquals("Auto: nothing to take yet.", DspDraft(emptyList(), null, null).headroomNote)
        assertEquals(10, (1..12).fold(DspDraft(emptyList(), null, null)) { a, _ -> a.added() }.bands.size)
    }

    @Test fun `a band's numbers as the page shows them, AutoEq's answers, and what is said`() {
        assertEquals("105", DspDraft.field(105.0))
        assertEquals("105.5", DspDraft.field(105.5))
        assertEquals("1.41", DspDraft.field(1.4142, q = true))
        assertEquals("+3.0 dB", DspDraft.db(3.0))
        assertEquals("0.0 dB", DspDraft.db(0.0))
        val r = DspDraft.results(JSONObject("""{"results":[{"id":"a","name":"HD 650","source":"oratory1990","rig":"","form":"over-ear"}]}"""))
        assertEquals(HeadphoneResult("a", "HD 650", "oratory1990 · over-ear"), r[0])
        assertEquals("Looking…", DspDraft.resultsNote("hd", true, null, 0))
        assertEquals("Nothing by that name. Try fewer words, or paste a profile.", DspDraft.resultsNote("hd", false, null, 0))
        assertNull(DspDraft.resultsNote("hd", false, null, 1))
        assertEquals("DSP saved — on from the next track", DspDraft.saved(true, false))
    }
}
