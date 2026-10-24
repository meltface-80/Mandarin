package com.musicd.server.client

import com.sun.net.httpserver.HttpServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import java.net.InetSocketAddress

/**
 * Item 157: the app started with the way to the server it had when Android ended it (away, 127.0.0.1:34500), found it
 * was home a moment later, and the screens' clients went on asking the old address: the Library said "Couldn't load:
 * Failed to connect to /127.0.0.1:34500" until it was opened again.
 */
class WayTransportTest {
    private val servers = ArrayList<HttpServer>()

    /** A stand-in server that says [who] it is. */
    private fun server(who: String): String {
        val h = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        h.createContext("/") { ex ->
            val b = JSONObject().put("who", who).put("auth", ex.requestHeaders.getFirst("Authorization") ?: "").toString().toByteArray()
            ex.sendResponseHeaders(200, b.size.toLong()); ex.responseBody.use { it.write(b) }
        }
        h.start(); servers += h
        return "http://127.0.0.1:${h.address.port}"
    }

    @After fun stop() { for (s in servers) s.stop(0) }

    @Test fun `a client made on the old way asks the new one`() {
        val away = server("away"); val home = server("home")
        var now = away
        val c = ServerClient(ServerAddress.parse(away, ""), token = "tok", transport = WayTransport({ now }, "tok"))
        assertEquals("away", c.getJson("/api/health").getString("who"))
        now = home   // the way changed: home
        assertEquals("home", c.getJson("/api/health").getString("who"))
        assertEquals("Bearer tok", c.getJson("/api/health").getString("auth"))
    }

    @Test fun `the first look at the way is waited for before each request`() {
        val home = server("home")
        val order = ArrayList<String>()
        var now = "http://127.0.0.1:1"   // the way saved from before: nothing there
        val t = WayTransport({ order += "base"; now }, null, ready = { order += "ready"; now = home })
        assertEquals("home", t.json("GET", "/api/health", null, 3000).getString("who"))
        assertEquals(listOf("ready", "base"), order)
    }
}
