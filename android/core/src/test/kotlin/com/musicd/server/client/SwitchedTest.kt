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

    @Test fun `the scanner's settings with a switch laid over them, and measuring switched`() {
        val st = JSONObject("""{"settings":{"schedule":false,"enabled":true,"itunes":true},"progress":{"checked":3}}""")
        val s = Scanner.withSettings(st, JSONObject().put("schedule", true))!!
        assertTrue(s.getJSONObject("settings").getBoolean("schedule"))
        assertTrue(s.getJSONObject("settings").getBoolean("enabled"))
        assertEquals(3, s.getJSONObject("progress").getInt("checked"))
        assertFalse("the state it came from is as it was", st.getJSONObject("settings").getBoolean("schedule"))
        assertNull(Scanner.withSettings(null, JSONObject().put("schedule", true)))
        assertTrue(Scanner.withSettings(JSONObject(), JSONObject().put("enabled", true))!!.getJSONObject("settings").getBoolean("enabled"))
        val loud = Scanner.withMeasure(JSONObject("""{"settings":{"measure":false},"queued":4}"""), true)!!
        assertTrue(loud.getJSONObject("settings").getBoolean("measure")); assertEquals(4, loud.getInt("queued"))
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
