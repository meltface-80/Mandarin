package com.musicd.server.android

import android.app.AlertDialog
import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Build
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

/**
 * The app's process. Its one job: when MusicD crashes, keep what went wrong
 * (the stack trace) so the next start can show it and offer to share it —
 * a crash on a phone otherwise leaves nothing to go on.
 */
class MusicDApp : Application() {
    override fun onCreate() {
        super.onCreate()
        AppLog.start(this)   // logging, if switched on (Settings → Setup, item 121)
        CrashLog.install(this)
        CrashLog.watchMainThread(this)
        ExitNote.keep(this)
        leftovers()
    }

    /** What a test build that's gone left in the app's own storage (item 152): its folder and its settings, once. */
    private fun leftovers() {
        val dir = File(filesDir, "soloist")
        if (!dir.exists()) return
        Thread({ runCatching { dir.walkBottomUp().forEach { it.setWritable(true); it.delete() }; deleteSharedPreferences("soloist_test") } }, "leftovers")
            .apply { isDaemon = true; start() }
    }
}

object CrashLog {
    private fun file(c: Context) = File(c.filesDir, "last-crash.txt")

    fun install(c: Context) {
        val app = c.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, e ->
            runCatching {
                val sw = StringWriter()
                e.printStackTrace(PrintWriter(sw))
                AppLog.crash("CRASH on ${thread.name}: $sw")
                file(app).writeText(
                    "Mandarin ${BuildConfig.VERSION_NAME} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}) · " +
                        "${Build.MANUFACTURER} ${Build.MODEL}\nThread: ${thread.name}\n\n$sw"
                )
            }
            previous?.uncaughtException(thread, e)
        }
    }

    /**
     * A frozen app leaves no crash behind — it just sits there (the start-up
     * logo, until it's force-stopped). So the main thread is watched: if it
     * hasn't answered for 10 s, what it's stuck on is kept the same way as a
     * crash, and the next start offers it to share.
     */
    fun watchMainThread(c: Context) {
        val app = c.applicationContext
        val main = android.os.Handler(android.os.Looper.getMainLooper())
        Thread({
            var stuckFor = 0
            var kept = false
            while (true) {
                val answered = java.util.concurrent.atomic.AtomicBoolean(false)
                main.post { answered.set(true) }
                try { Thread.sleep(2_000) } catch (e: InterruptedException) { return@Thread }
                if (answered.get()) { stuckFor = 0; kept = false; continue }
                stuckFor += 2
                if (stuckFor == 4) AppLog.line("APP", "FREEZE: the screen hasn't answered for 4 s, at: " +
                    android.os.Looper.getMainLooper().thread.stackTrace.take(12).joinToString(" < "), anomaly = true)
                if (stuckFor >= 10 && !kept) {
                    kept = true
                    runCatching {
                        val trace = android.os.Looper.getMainLooper().thread.stackTrace.joinToString("\n") { "  at $it" }
                        file(app).writeText(
                            "$FROZE ${BuildConfig.VERSION_NAME} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}) · " +
                                "${Build.MANUFACTURER} ${Build.MODEL}\nThe screen stopped answering for $stuckFor s at:\n\n$trace"
                        )
                    }
                }
            }
        }, "main-watch").apply { isDaemon = true; start() }
    }
    private const val FROZE = "Mandarin froze"

    /**
     * Something the next start should say though nothing crashed: Android
     * ending the app, playback giving up away from home, the Tailscale engine
     * ending (bug list item 34). Added to what is already waiting, a crash or
     * a freeze included, so the order they came in is kept.
     */
    @Synchronized
    fun keepNote(c: Context, what: String) {
        AppLog.line("APP", "note kept for the next start: $what", anomaly = true)
        runCatching {
            val f = file(c.applicationContext)
            val before = if (f.exists()) f.readText().take(6000) else ""
            f.writeText(
                if (before.isNotBlank()) "$before\n\n$what"
                else "$NOTE ${BuildConfig.VERSION_NAME} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}) · " +
                    "${Build.MANUFACTURER} ${Build.MODEL}\n\n$what"
            )
        }
    }
    private const val NOTE = "Mandarin stopped in the background"
    /** A note an app before item 111 kept when its page stopped: still offered once. */
    private const val PAGE = "Mandarin's page stopped"

    /** After a crash (or a freeze): say so, once, and offer the details to share. */
    fun offer(activity: Activity) {
        val f = file(activity)
        if (!f.exists()) return
        val text = runCatching { f.readText() }.getOrDefault("")
        f.delete()
        if (text.isBlank()) return
        val page = text.startsWith(PAGE)
        AlertDialog.Builder(activity)
            .setTitle(when { text.startsWith(FROZE) -> "Mandarin froze last time"; page -> "Mandarin's page stopped last time"; text.startsWith(NOTE) -> "$NOTE last time"; else -> "Mandarin stopped last time" })
            .setMessage((if (page) "The app put it up again by itself. " else "") + "Sharing the details helps get it fixed.\n\n" + text.take(1200))
            .setPositiveButton("Share details") { _, _ ->
                runCatching {
                    activity.startActivity(Intent.createChooser(
                        Intent(Intent.ACTION_SEND).setType("text/plain")
                            .putExtra(Intent.EXTRA_SUBJECT, when { text.startsWith(FROZE) -> "Mandarin freeze"; page -> "Mandarin page stopped"; text.startsWith(NOTE) -> NOTE; else -> "Mandarin crash" })
                            .putExtra(Intent.EXTRA_TEXT, text),
                        "Share crash details"))
                }
            }
            .setNegativeButton("Close", null)
            .show()
    }
}
