package com.musicd.server.android

import java.util.concurrent.TimeUnit

/**
 * The Bridge's own log, for Mandarin's (item 291): GET /log, which the server fetches when the Mandarin app's log is
 * saved (Settings → Setup → Logging) and puts through its LogScrub. It is this app's lines of Android's log, the last
 * [LINES] of them (the player, the USB driver, a recording, an update, a crash), read as Android keeps them: an app may
 * read its own, no permission asked. Times in UTC.
 */
internal object BridgeLog {
    const val LINES = 2000

    /** The lines, the oldest first; what went wrong, where they can't be read. */
    fun text(): String = try {
        val p = ProcessBuilder("logcat", "-d", "-t", LINES.toString(), "-v", "threadtime", "-v", "UTC", "-v", "year", "--pid=${android.os.Process.myPid()}")
            .redirectErrorStream(true).start()
        val out = p.inputStream.bufferedReader().readText()
        if (!p.waitFor(10, TimeUnit.SECONDS)) p.destroy()
        out
    } catch (e: Exception) {
        "(the Bridge's log couldn't be read: ${e.message})\n"
    }
}
