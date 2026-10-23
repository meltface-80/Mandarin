package com.musicd.server.client

import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.DataInputStream
import java.io.OutputStream
import java.net.Socket
import java.security.SecureRandom
import java.util.Base64

/**
 * Soloist on the phone (bug list item 148): the line to Soloist, its control WebSocket on 127.0.0.1,
 * spoken directly (the app has no WebSocket library): text frames of one JSON object each. Soloist sends its whole
 * state on connecting, then events (auth_state, playback_state, track_changed, playback_changed, error); this side sends
 * commands ({"type":"command","command":"play","uri":…}), as the server's Soloist.Socket.cs does.
 */
class SoloistSocket(private val port: Int, private val note: (String) -> Unit, private val onEvent: (JSONObject) -> Unit) {
    private val socket = Socket("127.0.0.1", port)
    private val out: OutputStream = socket.getOutputStream()
    private val input = DataInputStream(BufferedInputStream(socket.getInputStream()))
    private val random = SecureRandom()

    init {
        socket.soTimeout = 10_000
        val key = Base64.getEncoder().encodeToString(ByteArray(16).also { random.nextBytes(it) })
        out.write(("GET / HTTP/1.1\r\nHost: 127.0.0.1:$port\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
            "Sec-WebSocket-Key: $key\r\nSec-WebSocket-Version: 13\r\n\r\n").toByteArray())
        out.flush()
        val status = readLine()
        if (!status.contains(" 101")) throw IllegalStateException("Soloist's socket answered: $status")
        while (readLine().isNotEmpty()) { /* the rest of the answer's head */ }
        socket.soTimeout = 0
        Thread({ runCatching { readFrames() }.onFailure { note("socket: closed (${it.message})") } }, "soloist-socket").apply { isDaemon = true; start() }
    }

    private fun readLine(): String {
        val sb = StringBuilder()
        while (true) {
            val c = input.read()
            if (c < 0) throw java.io.EOFException("socket closed")
            if (c == '\n'.code) return sb.toString().trimEnd('\r')
            sb.append(c.toChar())
        }
    }

    private fun readFrames() {
        val message = java.io.ByteArrayOutputStream()
        while (true) {
            val b0 = input.readUnsignedByte(); val b1 = input.readUnsignedByte()
            var len = (b1 and 0x7f).toLong()
            if (len == 126L) len = input.readUnsignedShort().toLong() else if (len == 127L) len = input.readLong()
            val mask = if (b1 and 0x80 != 0) ByteArray(4).also { input.readFully(it) } else null
            val data = ByteArray(len.toInt()).also { input.readFully(it) }
            if (mask != null) for (i in data.indices) data[i] = (data[i].toInt() xor mask[i % 4].toInt()).toByte()
            when (b0 and 0x0f) {
                0x8 -> return
                0x9 -> frame(0xA, data)
                0x1, 0x0 -> {
                    message.write(data)
                    if (b0 and 0x80 != 0) {
                        val text = message.toString("UTF-8"); message.reset()
                        runCatching { onEvent(JSONObject(text)) }.onFailure { note("socket: unreadable event (${it.message})") }
                    }
                }
            }
        }
    }

    @Synchronized private fun frame(op: Int, data: ByteArray) {
        val mask = ByteArray(4).also { random.nextBytes(it) }
        val head = java.io.ByteArrayOutputStream()
        head.write(0x80 or op)
        when {
            data.size < 126 -> head.write(0x80 or data.size)
            data.size < 65536 -> { head.write(0x80 or 126); head.write(data.size shr 8); head.write(data.size and 0xff) }
            else -> { head.write(0x80 or 127); for (s in 56 downTo 0 step 8) head.write(((data.size.toLong() shr s) and 0xff).toInt()) }
        }
        head.write(mask)
        out.write(head.toByteArray())
        out.write(ByteArray(data.size) { (data[it].toInt() xor mask[it % 4].toInt()).toByte() })
        out.flush()
    }

    /** {"type":"command","command":[name]} with [extra] fields. */
    fun command(name: String, extra: Map<String, Any> = emptyMap()) {
        val j = JSONObject().put("type", "command").put("command", name)
        for ((k, v) in extra) j.put(k, v)
        frame(0x1, j.toString().toByteArray())
    }

    fun close() { runCatching { frame(0x8, ByteArray(0)) }; runCatching { socket.close() } }
}
