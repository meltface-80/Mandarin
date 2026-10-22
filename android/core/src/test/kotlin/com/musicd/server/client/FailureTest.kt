package com.musicd.server.client

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Item 127: an album page said "failed to connect to /192.168.0.57 (port 3500) from /192.0.0.4 (port 37086) after 5000ms". */
class FailureTest {
    @Test fun `unreachable is said in words, without addresses`() {
        val t = java.net.SocketTimeoutException("failed to connect to /192.168.0.57 (port 3500) from /192.0.0.4 (port 37086) after 5000ms")
        assertEquals("Couldn't reach the server", Failure.said(t, "Couldn't load the album"))
        assertEquals("Couldn't reach the server", Failure.said(java.net.ConnectException("Failed to connect to /100.64.0.1:34500"), "x"))
    }

    @Test fun `only the unreachable is asked again`() {
        assertTrue(Failure.unreachable(java.net.SocketTimeoutException("timeout")))
        assertFalse(Failure.unreachable(ServerClient.ServerException(404, "Album not found")))
        assertFalse(Failure.unreachable(IllegalStateException()))
    }

    @Test fun `the server's own words are kept`() {
        assertEquals("Album not found", Failure.said(ServerClient.ServerException(404, "Album not found"), "x"))
        assertEquals("Couldn't load the album", Failure.said(IllegalStateException(), "Couldn't load the album"))
    }

    @Test fun `tied to the Wi-Fi only at home on it`() {
        assertTrue(Route.overWifi(away = false, onWifi = true))
        assertFalse(Route.overWifi(away = true, onWifi = true))    // someone else's Wi-Fi: away, over Tailscale
        assertFalse(Route.overWifi(away = false, onWifi = false))  // home through another VPN, off Wi-Fi
        assertFalse(Route.overWifi(away = true, onWifi = false))
    }
}
