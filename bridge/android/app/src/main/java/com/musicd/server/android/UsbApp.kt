package com.musicd.server.android

import android.app.Application
import android.os.Build
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

/**
 * The app's process. Its one job beyond holding the service: when the app
 * crashes, keep what went wrong (the stack trace) so the screen can show it
 * next time — a crash on a device across the room otherwise leaves nothing
 * to go on.
 */
class UsbApp : Application() {
    override fun onCreate() {
        super.onCreate()
        CrashLog.install(this)
        // Its own log kept on, in files that roll (item 389, BridgeLog.kt).
        BridgeLog.start(this)
    }
}

object CrashLog {
    private fun file(c: android.content.Context) = File(c.filesDir, "last-crash.txt")

    fun install(c: android.content.Context) {
        val app = c.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, e ->
            runCatching {
                val sw = StringWriter()
                e.printStackTrace(PrintWriter(sw))
                file(app).writeText(
                    "Mandarin Bridge ${BuildConfig.VERSION_NAME} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}) · " +
                        "${Build.MANUFACTURER} ${Build.MODEL}\nThread: ${thread.name}\n\n$sw"
                )
                // In its log too, before the process goes (item 389).
                BridgeLog.add("${java.time.Instant.now()} CRASH on thread ${thread.name}:\n$sw")
            }
            previous?.uncaughtException(thread, e)
        }
    }

    /** What the last crash left, the file kept, or null: for the log Mandarin fetches (BridgeLog.kt). */
    fun peek(c: android.content.Context): String? = file(c).takeIf { it.exists() }?.let { runCatching { it.readText() }.getOrNull() }?.takeIf { it.isNotBlank() }

    /** What the last crash left, taken (the file is deleted), or null. */
    fun take(c: android.content.Context): String? {
        val f = file(c)
        if (!f.exists()) return null
        val text = runCatching { f.readText() }.getOrNull()
        f.delete()
        return text?.takeIf { it.isNotBlank() }
    }
}
