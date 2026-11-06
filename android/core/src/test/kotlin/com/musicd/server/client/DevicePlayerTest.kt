package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A renderer's Player (item 306), as the page's app/device-player.js has it (test/device-player-page.test.js). */
class DevicePlayerTest {
    private fun page(extra: String, output: String) = DevicePage(JSONObject("""{"kind":"upnp","rates":[],"bits":[],"dsd":[]$extra,"output":$output}"""))

    @Test fun `shown where its own player was found, UPnP by its absence`() {
        assertNull("no MPD beside it: no Player", page("", """{"mode":"x2"}""").mpd)
        val upnp = page(""","mpd":"192.168.0.33:6600"""", """{"mode":"x2"}""")
        assertEquals("192.168.0.33:6600", upnp.mpd)
        assertFalse(upnp.ownPlayer)
        assertEquals("upnp", upnp.playerValue)
        assertEquals(listOf("UPnP", "Its own player"), upnp.players.map { it.label })
        assertEquals(Contract.labels["settings-device.player"], upnp.players.map { it.label })
        assertTrue(upnp.playerNote.startsWith("Each track is handed over by UPnP"))
    }

    @Test fun `its own player chosen says where, and a pick is a PATCH of player`() {
        val own = page(""","mpd":"192.168.0.33:6600"""", """{"mode":"x2","player":"mpd"}""")
        assertTrue(own.ownPlayer)
        assertEquals("mpd", own.playerValue)
        assertTrue(own.playerNote.contains("MPD, found at 192.168.0.33:6600"))
        assertEquals("""{"output":{"player":"upnp"}}""", own.segment("player", "upnp").toString())
    }
}
