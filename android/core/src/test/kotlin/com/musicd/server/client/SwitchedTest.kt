package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A switch moves as it is tapped, the server's answer taking its place after (item 200): what each page shows meanwhile. */
class SwitchedTest {
    @Test fun `a device's page with a switch laid over it, the rest as it was`() {
        val d = DevicePage(JSONObject("""{"name":"Study","enabled":false,"can_toggle":true,"radio":false,"shared":true,"dsp":{"enabled":false,"gain":-3}}"""))
        val on = d.with(JSONObject().put("enabled", true))
        assertTrue(on.enabled); assertEquals("Study", on.name); assertTrue(on.shared); assertFalse(on.radio)
        assertFalse("the page it came from is as it was", d.enabled)
        val dsp = d.with(JSONObject().put("dsp", JSONObject().put("enabled", true).put("gain", -3)))
        assertTrue(dsp.dspOn); assertEquals(-3, dsp.dsp!!.getInt("gain"))
        assertTrue(d.with(JSONObject().put("radio", true)).radio)
    }

    @Test fun `the device list with one row switched, the others as they were`() {
        val list = AudioDevices.parse(JSONObject("""{"devices":[{"id":"a","name":"A","kind":"sonos","enabled":false},{"id":"b","name":"B","kind":"upnp","enabled":true}]}"""))
        val on = list.withEnabled("a", true)
        assertEquals(listOf(true, true), on.rows.map { it.enabled })
        assertEquals(listOf(false, true), list.rows.map { it.enabled })
        assertEquals(listOf(false, false), list.withEnabled("b", false).rows.map { it.enabled })
        assertEquals("a row not there changes nothing", list, list.withEnabled("zz", true))
    }

    @Test fun `the Album Scanner with its switch or Schedule's laid over it, the rest as it was`() {
        val st = JSONObject("""{"on":true,"schedule":{"on":false,"start":"01:00","end":"06:00"},"done":3,"albums":5}""")
        val s = Scanner.withScanner(st, JSONObject().put("schedule", true))!!
        assertTrue(s.getJSONObject("schedule").getBoolean("on"))
        assertTrue(s.getBoolean("on"))
        assertEquals(3, s.getInt("done"))
        assertEquals("06:00", s.getJSONObject("schedule").getString("end"))
        assertFalse("the state it came from is as it was", st.getJSONObject("schedule").getBoolean("on"))
        assertNull(Scanner.withScanner(null, JSONObject().put("schedule", true)))
        assertTrue(Scanner.withScanner(JSONObject(), JSONObject().put("on", true))!!.getBoolean("on"))
        val off = Scanner.withScanner(st, JSONObject().put("on", false))!!
        assertFalse(off.getBoolean("on")); assertFalse(off.getJSONObject("schedule").getBoolean("on")); assertEquals(5, off.getInt("albums"))
    }

    @Test fun `the account's status with the sign-in off or on, the rest kept`() {
        val st = Account.Status(setupRequired = false, canSetup = true, signedIn = true, username = "lewis", open = false, openHere = false)
        val off = st.withOpen(true)
        assertTrue(off.open); assertEquals("lewis", off.username); assertTrue(off.signedIn); assertFalse(off.setupRequired)
        assertFalse(off.withOpen(false).open)
        assertFalse("the status it came from is as it was", st.open)
    }

    @Test fun `the download settings with a key set as the bridge takes it`() {
        val s = DlSettings.parse(JSONObject("""{"quality":"original","location":"internal","wifiOnly":true,"limitGb":8,"autoPicks":false,"autoAotd":false,"autoRecent":0,"offlineMode":false}"""))
        assertEquals(true, s.with("offlineMode", "true").offlineMode)
        assertEquals("opus", s.with("quality", "opus").quality)
        assertEquals("sd", s.with("location", "sd").location)
        assertEquals(false, s.with("wifiOnly", "false").wifiOnly)
        assertEquals("a key the page doesn't switch leaves them as they are", s, s.with("limitGb", "16"))
        assertEquals(false, s.offlineMode)
    }
}
