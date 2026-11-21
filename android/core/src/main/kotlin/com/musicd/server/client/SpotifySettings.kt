package com.musicd.server.client

import org.json.JSONObject
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketTimeoutException

/**
 * Settings → Services → Spotify as the server keeps the account (GET /api/settings/spotify; bug list item 497), in the
 * words of the page's (settings-spotify.js).
 */
data class SpotifyAccount(
    val connected: Boolean,
    /** Who is signed in, under the block's title; nothing while signed out. */
    val status: String,
    /** Whether the saved albums are albums in the library. */
    val import: Boolean,
    /** Whether they are being brought in now (asked again shortly while they are). */
    val importing: Boolean,
    /** What the library holds of Spotify, under its buttons. */
    val importStatus: String,
) {
    val again: Boolean get() = connected && importing
}

object SpotifySettings {
    /** Where Spotify sends the sign-in back: this phone itself, which the app listens on while a sign-in is under way. */
    const val PORT = 43143
    const val PATH = "/mandarin-spotify"

    /** The account [j] as the server answered it; [at]: a moment (milliseconds) as the phone writes a date and time. */
    fun parse(j: JSONObject, at: (Long) -> String): SpotifyAccount {
        val on = j.optBoolean("connected")
        val user = j.optJSONObject("user")
        val who = user?.let { u -> u.optString("name").ifEmpty { u.optString("login") } }.orEmpty().ifEmpty { "your account" }
        val import = j.optBoolean("import")
        val importing = j.optBoolean("importing")
        val li = j.optJSONObject("last_import")
        val importStatus = when {
            !import -> "Off: your Spotify albums are not in the library. Switch on to show them."
            importing -> "Bringing your Spotify albums into the library…"
            li != null -> li.optInt("albums").let { n -> "$n Spotify album" + (if (n == 1) "" else "s") + " in the library · updated " + at(li.optLong("at")) }
            else -> "The library is brought up to date shortly."
        }
        return SpotifyAccount(on, if (on) "Signed in as $who" else "", import, importing, importStatus)
    }

    /** What is said once Update library now has finished ([j]: the server's answer). */
    fun updated(j: JSONObject) = "${j.optJSONObject("result")?.optInt("albums") ?: 0} Spotify albums in the library"

    /**
     * The address Spotify sends the browser back to, caught on this phone: one request on 127.0.0.1:[port] answered with
     * a page that says to go back to Mandarin, its address given back whole (the server reads its code and state). Null
     * when nothing came within [timeoutMs], or when [stop] says the sign-in was let go. Anything asked of another path
     * (the browser's icon) is answered 404 and waited past.
     */
    fun catchAnswer(timeoutMs: Int, port: Int = PORT, stop: () -> Boolean = { false }): String? =
        ServerSocket(port, 4, InetAddress.getByName("127.0.0.1")).use { server ->
            val until = System.currentTimeMillis() + timeoutMs
            server.soTimeout = 1000
            while (System.currentTimeMillis() < until && !stop()) {
                val s = try { server.accept() } catch (e: SocketTimeoutException) { continue }
                s.use { sock ->
                    sock.soTimeout = 5000
                    val line = sock.getInputStream().bufferedReader(Charsets.ISO_8859_1).readLine().orEmpty()
                    val target = line.split(' ').getOrNull(1).orEmpty()
                    val mine = target.startsWith("$PATH?") || target == PATH
                    val body = if (mine) DONE_PAGE else "Not found"
                    val head = "HTTP/1.1 ${if (mine) "200 OK" else "404 Not Found"}\r\nContent-Type: text/html; charset=utf-8\r\n" +
                        "Content-Length: ${body.toByteArray().size}\r\nConnection: close\r\n\r\n"
                    sock.getOutputStream().apply { write(head.toByteArray()); write(body.toByteArray()); flush() }
                    if (mine) return "http://127.0.0.1:$port$target"
                }
            }
            null
        }

    private const val DONE_PAGE = "<!doctype html><meta name=viewport content=\"width=device-width\"><title>Mandarin</title>" +
        "<body style=\"font-family:sans-serif;padding:2em;text-align:center\"><h2>Spotify approved Mandarin</h2><p>Go back to the Mandarin app to finish.</p>"

    const val INFO = "Sign in with your Spotify account: you approve Mandarin on Spotify's own page, and Mandarin keeps the sign-in token — never a password. Your saved Spotify albums become albums in the library. Playing them through Mandarin comes with the next Spotify update."
    const val IMPORT_INFO = "Every album you've saved on Spotify, however many, as an album here: on the walls, in search, in Smart Picks and Listen later. Brought up to date every six hours, and when you tap Update library now. Off until you switch it on. Off: none of them are in the library; switched on again, they are back at once."
}
