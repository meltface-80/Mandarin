package com.musicd.server.client

import com.sun.net.httpserver.HttpServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.net.InetSocketAddress

/** The sign-in screen's server (bug list item 189), against a small stand-in for the server. */
class SignInServerTest {
    private lateinit var http: HttpServer
    private var id: String? = "ours"
    private val auth = HashMap<String, String?>()

    @Before fun start() {
        http = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        http.createContext("/") { ex ->
            val path = ex.requestURI.path
            auth[path] = ex.requestHeaders.getFirst("Authorization")
            ex.requestBody.readBytes()
            val (code, out) = when (path) {
                "/api/ping" -> if (id == null) 404 to JSONObject().put("error", "Not found") else 200 to JSONObject().put("ok", true).put("id", id)
                "/api/auth/setup" -> 200 to JSONObject().put("ok", true).put("token", "tok-new").put("username", "me")
                "/api/auth/join" -> 200 to JSONObject().put("ok", true).put("token", "tok-join")
                else -> 404 to JSONObject().put("error", "Not found")
            }
            val b = out.toString().toByteArray()
            ex.sendResponseHeaders(code, b.size.toLong())
            ex.responseBody.use { it.write(b) }
        }
        http.start()
    }

    @After fun stop() = http.stop(0)

    private fun here() = ServerAddress("127.0.0.1", http.address.port)

    @Test fun away_the_address_in_use_is_asked_not_home() {
        val home = ServerAddress("192.168.1.20", 8686)
        val away = ServerAddress("100.64.0.7", 8686)
        assertEquals(away, SignInServer.address(home, away))
        assertEquals(home, SignInServer.address(home, null))
    }

    @Test fun making_the_account_sends_this_phones_sign_in() {
        val s = SignInServer(here(), "tok-open-device", null)
        assertEquals("tok-new", s.creating().create("me", "password1", "Pixel", iterations = 1000).token)
        assertEquals("Bearer tok-open-device", auth["/api/auth/setup"])
        // A join (or a sign-in) is a device of its own: no token of another's sent with it.
        s.account().join("Pixel")
        assertNull(auth["/api/auth/join"])
    }

    @Test fun another_server_answering_is_not_ours() {
        assertTrue(SignInServer(here(), null, "ours").ours())
        id = "another"
        assertFalse(SignInServer(here(), null, "ours").ours())
        // Nothing kept yet, or a server from before ids: nothing to tell them apart by.
        assertTrue(SignInServer(here(), null, null).ours())
        id = null
        assertTrue(SignInServer(here(), null, "ours").ours())
    }
}
