package com.musicd.server.client

import org.junit.Test
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue

class RouteTest {
    private val home = "http://192.168.1.10:3500"
    private val away = "http://100.101.102.103:3500"

    @Test fun awayOffWifiWhateverAnswers() {
        assertTrue(Route.away(onWifi = false, homeAnswers = true))
        assertTrue(Route.away(onWifi = false, homeAnswers = false))
        assertTrue(Route.away(onWifi = true, homeAnswers = false))
        assertFalse(Route.away(onWifi = true, homeAnswers = true))
    }

    @Test fun homeThroughAnotherVpnOffWifi() {
        // Mobile data with a VPN into the home network: the home address answers, so home.
        assertFalse(Route.away(onWifi = false, homeAnswers = true, onVpn = true))
        // A VPN that doesn't reach home: away, as before.
        assertTrue(Route.away(onWifi = false, homeAnswers = false, onVpn = true))
    }

    @Test fun awayOnTheOwnTailscaleOnceSignedInToItUpOrNot() {
        // Off Wi-Fi, signed in to MusicD's own Tailscale: its address (127.0.0.1:34500), even before the engine is up, and
        // never the Tailscale app's (item 118: a stall left the app on the Tailscale app's address, which nothing answered).
        assertEquals(Route.Way(away = true, viaEngine = true), Route.way(onWifi = false, homeAnswers = false, awayAddress = true, ownSignedIn = true))
        // Not signed in to it: the server's Tailscale address, through the Tailscale app.
        assertEquals(Route.Way(away = true, viaEngine = false), Route.way(onWifi = false, homeAnswers = false, awayAddress = true, ownSignedIn = false))
        // Home: neither.
        assertEquals(Route.Way(away = false, viaEngine = false), Route.way(onWifi = true, homeAnswers = true, awayAddress = true, ownSignedIn = true))
        // No address away to reach the server on: home's (and offline once it doesn't answer).
        assertEquals(Route.Way(away = false, viaEngine = false), Route.way(onWifi = false, homeAnswers = false, awayAddress = false, ownSignedIn = true))
        // Another VPN into home, off Wi-Fi: home.
        assertEquals(Route.Way(away = false, viaEngine = false), Route.way(onWifi = false, homeAnswers = true, onVpn = true, awayAddress = true, ownSignedIn = true))
    }

    @Test fun streamsGoAwayAsOpus() {
        val u = "$home/stream/t12.flac?s=abcdefghijklmnopqrstuv"
        assertEquals("$away/stream/t12.flac?s=abcdefghijklmnopqrstuv&q=opus", Route.rewrite(u, home, away, true))
        assertEquals(u, Route.rewrite(u, home, away, false))
        // Original chosen for away: moved, but no Opus.
        assertEquals("$away/stream/t12.flac?s=abcdefghijklmnopqrstuv", Route.rewrite(u, home, away, true, opus = false))
        // Back home: lossless again.
        assertEquals(u, Route.rewrite("$away/stream/t12.flac?s=abcdefghijklmnopqrstuv&q=opus", home, away, false))
        // Already away: not asked twice.
        val a = "$away/stream/t12.flac?s=abcdefghijklmnopqrstuv&q=opus"
        assertEquals(a, Route.rewrite(a, home, away, true))
    }

    @Test fun aTrackKeepsTheFormatItStartedIn() {
        val u = "$home/stream/t12.flac?s=abcdefghijklmnopqrstuv"
        // Started away as Opus, home again mid-track: the rest is still Opus (from home).
        assertEquals("$u&q=opus", Route.rewrite(u, home, away, false, keepOpus = true))
        // Started at home as the original, away mid-track: the rest is the original (from away).
        assertEquals("$away/stream/t12.flac?s=abcdefghijklmnopqrstuv", Route.rewrite(u, home, away, true, opus = false))
    }

    @Test fun artMovesButStaysArt() {
        val u = "$home/api/image/al-3-0?size=600&s=abcdefghijklmnopqrstuv"
        assertEquals("$away/api/image/al-3-0?size=600&s=abcdefghijklmnopqrstuv", Route.rewrite(u, home, away, true))
    }

    @Test fun otherAddressesAndNoAwayAreLeftAlone() {
        val other = "https://is1-ssl.mzstatic.com/image/x.jpg"
        assertEquals(other, Route.rewrite(other, home, away, true))
        val u = "$home/stream/t1.flac?s=x"
        assertEquals(u, Route.rewrite(u, home, null, true))
    }

    @Test fun addressesFromTheServer() {
        assertEquals(ServerAddress("100.101.102.103", 3500), ServerAddress.fromUrl("http://100.101.102.103:3500"))
        val ts = ServerAddress.fromUrl("https://musicd.tail1234.ts.net")!!
        assertEquals(443, ts.port)
        assertEquals("https://musicd.tail1234.ts.net:443", ts.baseUrl)
        assertEquals(80, ServerAddress.fromUrl("http://musicd")!!.port)
        assertNull(ServerAddress.fromUrl("musicd:3500"))
        assertNull(ServerAddress.fromUrl(""))
    }
}
