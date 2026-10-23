package com.musicd.server.client

import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketTimeoutException

/**
 * Spotify's sign-in caught on this phone (bug list item 143): Spotify sends the browser back to a loopback address
 * (http://127.0.0.1:43143/mandarin-spotify?code=…&state=…, the only kind it allows without HTTPS), so while a sign-in is
 * under way the app listens there itself, answers the browser with a page saying it is done, and hands the whole
 * address to the server, which finishes the sign-in with it. Nothing else is answered, and only for [timeoutMs].
 */
class SpotifyCatch(private val port: Int = PORT, private val path: String = PATH) {
    companion object {
        const val PORT = 43143
        const val PATH = "/mandarin-spotify"
        /** What the browser is shown once the address is caught. */
        const val DONE = "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width\">" +
            "<title>Mandarin</title><body style=\"font:16px system-ui;padding:24px\">Signed in to Spotify. Go back to Mandarin.</body>"
    }

    /** The address Spotify sent the browser to (its path and query on [port]), or null when none came within [timeoutMs]. */
    fun await(timeoutMs: Int): String? {
        ServerSocket(port, 4, InetAddress.getByName("127.0.0.1")).use { server ->
            val until = System.currentTimeMillis() + timeoutMs
            while (true) {
                val left = (until - System.currentTimeMillis()).toInt()
                if (left <= 0) return null
                server.soTimeout = left
                val socket = try { server.accept() } catch (_: SocketTimeoutException) { return null }
                socket.use { s ->
                    s.soTimeout = 5_000
                    val line = s.getInputStream().bufferedReader().readLine().orEmpty()
                    val target = line.split(' ').getOrNull(1).orEmpty()
                    val ours = target.startsWith("$path?")
                    val body = if (ours) DONE else "Not here"
                    val bytes = body.toByteArray()
                    s.getOutputStream().apply {
                        write(("HTTP/1.1 ${if (ours) "200 OK" else "404 Not Found"}\r\nContent-Type: text/html; charset=utf-8\r\n" +
                            "Content-Length: ${bytes.size}\r\nConnection: close\r\n\r\n").toByteArray())
                        write(bytes)
                        flush()
                    }
                    if (ours) return "http://127.0.0.1:$port$target"
                }
            }
        }
    }
}
