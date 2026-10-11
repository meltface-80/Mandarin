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
        CrashLog.install(this)
        CrashLog.watchMainThread(this)
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
     * The page stopped and the app put it up again by itself (v0.8.42, see
     * [MainActivity]): kept the same way, for the next start to offer —
     * unless a crash or a freeze is already waiting to be (that says more).
     */
    fun keepPageNote(c: Context, what: String) {
        runCatching {
            val f = file(c.applicationContext)
            if (f.exists() && !f.readText().startsWith(PAGE)) return
            f.writeText(
                "$PAGE ${BuildConfig.VERSION_NAME} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}) · " +
                    "${Build.MANUFACTURER} ${Build.MODEL}\n${java.util.Date()}\n\n$what"
            )
        }
    }
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
            .setTitle(when { text.startsWith(FROZE) -> "Mandarin froze last time"; page -> "Mandarin's page stopped last time"; else -> "Mandarin stopped last time" })
            .setMessage((if (page) "The app put it up again by itself. " else "") + "Sharing the details helps get it fixed.\n\n" + text.take(1200))
            .setPositiveButton("Share details") { _, _ ->
                runCatching {
                    activity.startActivity(Intent.createChooser(
                        Intent(Intent.ACTION_SEND).setType("text/plain")
                            .putExtra(Intent.EXTRA_SUBJECT, when { text.startsWith(FROZE) -> "Mandarin freeze"; page -> "Mandarin page stopped"; else -> "Mandarin crash" })
                            .putExtra(Intent.EXTRA_TEXT, text),
                        "Share crash details"))
                }
            }
            .setNegativeButton("Close", null)
            .show()
    }
}
