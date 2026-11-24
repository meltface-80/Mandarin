package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** Setup's small pages as the page says them (item 78). */
class SetupSettingsTest {
    @Test fun `Smart Picks' words`() {
        assertEquals("Smart Picks will build at 04:00", SetupSettings.hourSaid(4))
        assertEquals("21:00", SetupSettings.HOURS[21].words)
    }

    @Test fun `UI Settings read from the page's prefs, and a change made in them`() {
        val p = WallPrefs.parse("""{"layout":"list","tile":"1.25","text":"1.1","title":"1","menu":"1.5"}""")
        assertEquals("1.1", SetupSettings.uiValue(p, "text"))
        assertEquals("1", SetupSettings.uiValue(p, "title"))
        assertEquals("1.5", SetupSettings.uiValue(p, "menu"))
        assertEquals("list", SetupSettings.uiValue(p, "layout"))
        assertEquals("1.25", SetupSettings.uiValue(p, "tile"))
        assertEquals("2", WallPrefs.parse(SetupSettings.prefsWith("""{"layout":"auto"}""", "layout", "2")).layout)
        assertEquals("1.25", SetupSettings.uiValue(WallPrefs.parse(SetupSettings.prefsWith(null, "text", "1.25")), "text"))
        assertEquals("every choice is one the prefs take", SetupSettings.TILE.map { it.value }, SetupSettings.TILE.map { SetupSettings.uiValue(WallPrefs.parse("""{"tile":"${it.value}"}"""), "tile") })
    }

    @Test fun `the server's Tailscale in words`() {
        val run = AwayState.parse(JSONObject("""{"available":true,"enabled":true,"state":"Running","serving":true,"online":true,"health":[],"dns_name":"mandarin.tail.ts.net","address":"http://100.1.2.3:8080","hostname":"mandarin"}"""))
        assertEquals("Connected", run.status)
        assertEquals("100.1.2.3:8080", run.shownAddress)
        assertEquals(null, run.warning)
        assertEquals("Running, but not online on the tailnet — the server is rebinding it, then starting it afresh", run.copy(online = false).warning)
        assertEquals("Tailscale warns: a; b", run.copy(health = listOf("a", "b")).warning)
        assertEquals("Connecting…", run.copy(serving = false).status)
        assertEquals("Off", run.copy(enabled = false).status)
        assertEquals("Not signed in yet", run.copy(state = "NeedsLogin").status)
        assertEquals(null, run.copy(state = "NeedsLogin", online = false).warning)
        assertEquals(true, run.connectedInfo(true).contains("under This phone below"))
        assertEquals(false, AwayState.parse(JSONObject("""{"available":false}""")).available)
    }

    @Test fun `a list shows the choice made, else the first, and nothing while the list is still empty`() {
        val hours = SetupSettings.HOURS
        assertEquals("21:00", Choice.words(hours, "21"))
        assertEquals("00:00", Choice.words(hours, "nope"))
        // Audio Devices' zones before they have come (item 100): the app crashed on the first of none.
        assertEquals("", Choice.words(emptyList(), "kitchen"))
    }
}
