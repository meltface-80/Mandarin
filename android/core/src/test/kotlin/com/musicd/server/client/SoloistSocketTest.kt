package com.musicd.server.client

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.DataInputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class SoloistSocketTest {
    /** Soloist's side, as RFC 6455 has it: the handshake, then frames, unmasked out and masked in. */
    private class Server {
        val socket = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        val got = LinkedBlockingQueue<String>()
        val masked = LinkedBlockingQueue<Boolean>()
        private lateinit var out: OutputStream

        fun frame(op: Int, data: ByteArray, fin: Boolean = true) {
            val h = java.io.ByteArrayOutputStream()
            h.write((if (fin) 0x80 else 0) or op)
            when {
                data.size < 126 -> h.write(data.size)
                data.size < 65536 -> { h.write(126); h.write(data.size shr 8); h.write(data.size and 0xff) }
                else -> { h.write(127); for (s in 56 downTo 0 step 8) h.write(((data.size.toLong() shr s) and 0xff).toInt()) }
            }
            out.write(h.toByteArray()); out.write(data); out.flush()
        }

        fun run(greet: Server.() -> Unit) = Thread {
            val c = socket.accept()
            val input = DataInputStream(c.getInputStream()); out = c.getOutputStream()
            val head = StringBuilder()
            while (!head.endsWith("\r\n\r\n")) head.append(input.read().toChar())
            val key = Regex("Sec-WebSocket-Key: (\\S+)").find(head)!!.groupValues[1]
            val accept = Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1").digest((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").toByteArray()))
            out.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: $accept\r\n\r\n".toByteArray())
            greet()
            while (true) {
                val b0 = input.read(); if (b0 < 0) break
                val b1 = input.read()
                var n = (b1 and 0x7f).toLong()
                if (n == 126L) n = input.readUnsignedShort().toLong() else if (n == 127L) n = input.readLong()
                masked.add(b1 and 0x80 != 0)
                val m = ByteArray(4).also { input.readFully(it) }
                val d = ByteArray(n.toInt()).also { input.readFully(it) }
                for (i in d.indices) d[i] = (d[i].toInt() xor m[i % 4].toInt()).toByte()
                when (b0 and 0x0f) {
                    0x8 -> break
                    0xA -> got.add("pong " + String(d))
                    else -> got.add(String(d))
                }
            }
            c.close()
        }.apply { isDaemon = true; start() }
    }

    @Test fun `Soloist's events read, a long one and one in pieces, commands sent masked, a ping answered`() {
        val srv = Server()
        srv.run {
            frame(0x1, JSONObject().put("type", "playback_state").put("status", "idle").put("pad", "x".repeat(70_000)).toString().toByteArray())
            val auth = JSONObject().put("type", "auth_state").put("logged_in", true).put("pad", "y".repeat(300)).toString().toByteArray()
            frame(0x1, auth.copyOfRange(0, 100), fin = false); frame(0x0, auth.copyOfRange(100, auth.size))
            frame(0x9, "hi".toByteArray())
        }
        val events = LinkedBlockingQueue<JSONObject>()
        val s = SoloistSocket(srv.socket.localPort, {}) { events.add(it) }
        val first = events.poll(5, TimeUnit.SECONDS)!!
        assertEquals("playback_state", first.getString("type")); assertEquals(70_000, first.getString("pad").length)
        val second = events.poll(5, TimeUnit.SECONDS)!!
        assertEquals("auth_state", second.getString("type")); assertTrue(second.getBoolean("logged_in"))
        assertEquals("pong hi", srv.got.poll(5, TimeUnit.SECONDS))
        s.command("play", mapOf("uri" to "spotify:album:abc"))
        val play = JSONObject(srv.got.poll(5, TimeUnit.SECONDS)!!)
        assertEquals("command", play.getString("type")); assertEquals("play", play.getString("command")); assertEquals("spotify:album:abc", play.getString("uri"))
        s.command("seek", mapOf("position_ms" to 60_000, "pad" to "z".repeat(200)))
        assertEquals(60_000, JSONObject(srv.got.poll(5, TimeUnit.SECONDS)!!).getInt("position_ms"))
        assertTrue("every frame from the client masked", srv.masked.all { it })
        s.close()
    }
}
