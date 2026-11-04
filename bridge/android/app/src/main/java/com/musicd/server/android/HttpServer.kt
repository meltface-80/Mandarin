package com.musicd.server.android

import android.util.Log
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.Executors

/**
 * The smallest HTTP/1.1 server a UPnP device needs: one request per
 * connection (closed after), the method, path and headers read, a body of
 * the length the request states, and a handler that answers with a status,
 * headers and bytes (or a file, sent as it is read: a capture). UPnP's own methods (SUBSCRIBE, UNSUBSCRIBE, NOTIFY)
 * come through like any other, which is why no library is used.
 */
class HttpServer(private val port: Int, private val handle: (Request) -> Response) {
    companion object {
        private const val TAG = "HttpServer"
        private const val BODY_MAX = 1024 * 1024
    }

    class Request(val method: String, val path: String, val query: String, val headers: Map<String, String>, val body: ByteArray, val from: String) {
        fun header(name: String): String? = headers[name.lowercase()]
    }

    class Response(val status: Int, val body: ByteArray = ByteArray(0), val type: String = "text/xml; charset=\"utf-8\"", val headers: Map<String, String> = emptyMap(),
                   val file: java.io.File? = null) {
        companion object {
            fun file(f: java.io.File, type: String, headers: Map<String, String> = emptyMap()) = Response(200, ByteArray(0), type, headers, f)
            fun text(status: Int, text: String, type: String = "text/xml; charset=\"utf-8\"", headers: Map<String, String> = emptyMap()) =
                Response(status, text.toByteArray(Charsets.UTF_8), type, headers)
        }
    }

    private var socket: ServerSocket? = null
    private val pool = Executors.newCachedThreadPool()
    @Volatile private var running = false

    fun start() {
        val s = ServerSocket(port).apply { reuseAddress = true }
        socket = s
        running = true
        Thread({
            while (running) {
                val c = try { s.accept() } catch (e: IOException) { if (running) Log.w(TAG, "accept", e); break }
                pool.execute { serve(c) }
            }
        }, "http-accept").apply { isDaemon = true; start() }
        Log.i(TAG, "listening on $port")
    }

    fun stop() {
        running = false
        runCatching { socket?.close() }
        pool.shutdownNow()
    }

    private fun serve(c: Socket) {
        c.use { sock ->
            try {
                sock.soTimeout = 10_000
                val input = BufferedInputStream(sock.getInputStream())
                val req = read(input, sock.inetAddress?.hostAddress ?: "") ?: return
                val res = try { handle(req) } catch (e: Throwable) { Log.w(TAG, "${req.method} ${req.path}", e); Response.text(500, "<error>${Xml.escape(e.message ?: e.javaClass.simpleName)}</error>") }
                val head = StringBuilder()
                    .append("HTTP/1.1 ").append(res.status).append(' ').append(reason(res.status)).append("\r\n")
                    .append("Server: Android/").append(android.os.Build.VERSION.RELEASE).append(" UPnP/1.0 MandarinBridge/").append(BuildConfig.VERSION_NAME).append("\r\n")
                    .append("Content-Type: ").append(res.type).append("\r\n")
                    .append("Content-Length: ").append(res.file?.length() ?: res.body.size.toLong()).append("\r\n")
                    .append("Connection: close\r\n")
                    .append("EXT:\r\n")
                for ((k, v) in res.headers) head.append(k).append(": ").append(v).append("\r\n")
                head.append("\r\n")
                val out = sock.getOutputStream()
                out.write(head.toString().toByteArray(Charsets.ISO_8859_1))
                if (req.method != "HEAD") { if (res.file != null) res.file.inputStream().use { it.copyTo(out, 1 shl 16) } else out.write(res.body) }
                out.flush()
            } catch (e: SocketTimeoutException) {
                // A connection opened and left: nothing to answer.
            } catch (e: IOException) {
                Log.i(TAG, "connection: ${e.message}")
            }
        }
    }

    /** The request line, the headers and the body; null when there is no request on the connection. */
    private fun read(input: InputStream, from: String): Request? {
        val head = ByteArrayOutputStream()
        var last4 = 0
        while (true) {
            val b = input.read()
            if (b < 0) return if (head.size() == 0) null else break
            head.write(b)
            last4 = ((last4 shl 8) or b) and 0xffffffff.toInt()
            if (last4 == 0x0d0a0d0a) break
            if (head.size() > 64 * 1024) throw IOException("header too long")
        }
        val lines = head.toString("ISO-8859-1").split("\r\n").filter { it.isNotEmpty() }
        if (lines.isEmpty()) return null
        val parts = lines[0].split(' ')
        if (parts.size < 2) throw IOException("bad request line: ${lines[0]}")
        val target = parts[1]
        val path = target.substringBefore('?')
        val query = if (target.contains('?')) target.substringAfter('?') else ""
        val headers = HashMap<String, String>()
        for (l in lines.drop(1)) {
            val i = l.indexOf(':')
            if (i > 0) headers[l.substring(0, i).trim().lowercase()] = l.substring(i + 1).trim()
        }
        val length = headers["content-length"]?.toIntOrNull() ?: 0
        if (length > BODY_MAX) throw IOException("body too long")
        val body = ByteArray(length)
        var got = 0
        while (got < length) {
            val n = input.read(body, got, length - got)
            if (n < 0) throw IOException("body cut short")
            got += n
        }
        return Request(parts[0].uppercase(), path, query, headers, body, from)
    }

    private fun reason(status: Int) = when (status) {
        200 -> "OK"; 202 -> "Accepted"; 400 -> "Bad Request"; 404 -> "Not Found"; 405 -> "Method Not Allowed"; 409 -> "Conflict"; 412 -> "Precondition Failed"; 500 -> "Internal Server Error"; else -> "OK"
    }
}
