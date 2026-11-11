package com.musicd.server.android

import android.content.Context
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * The Bridge's own log, kept as Mandarin's server keeps its own (item 389): always, in plain-text files that roll, in
 * the app's own folder (Logs/MandarinBridge_log.txt the newest, then .01 to .10 older, 2 MB each), so a restart or a
 * crash loses none of it. Before, it was what Android still held of this run alone (item 291), and a crash's lines
 * went with the process. This app's lines of Android's log are read as they come (an app may read its own, no
 * permission asked), times in UTC with the year, and a crash is added with its stack.
 *
 * GET /log answers the newest of them, and the last crash's; Mandarin's server fetches it and puts it through its
 * LogScrub (Admin/BridgeLogs.cs).
 */
internal object BridgeLog {
    const val LINES = 2000
    const val NAME = "MandarinBridge_log"
    const val FILES = 10
    private const val FILE_BYTES = 2L * 1024 * 1024
    private const val TEXT_BYTES = 1024 * 1024
    private val lock = Any()
    @Volatile private var dir: File? = null

    private fun fileAt(d: File, n: Int) = File(d, if (n == 0) "$NAME.txt" else "$NAME.%02d.txt".format(n))

    /** Kept from now: Android's log of this process read as it comes, into the files. */
    fun start(c: Context) {
        if (dir != null) return
        val d = File(c.filesDir, "Logs").apply { mkdirs() }
        dir = d
        synchronized(lock) {
            if (!fileAt(d, 0).exists()) fileAt(d, 0).writeText(header())
        }
        Thread({
            try {
                val p = ProcessBuilder("logcat", "-v", "threadtime", "-v", "UTC", "-v", "year", "--pid=${android.os.Process.myPid()}")
                    .redirectErrorStream(true).start()
                p.inputStream.bufferedReader().forEachLine { add(it) }
            } catch (e: Exception) {
                add("(the Bridge's log stopped being read: ${e.message})")
            }
        }, "bridge-log").apply { isDaemon = true }.start()
    }

    private fun header(): String =
        "# Mandarin Bridge ${BuildConfig.VERSION_NAME} (build ${BuildConfig.COMMIT}) log, begun ${java.time.Instant.now()}\n" +
            "# System: Android ${android.os.Build.VERSION.RELEASE} (API ${android.os.Build.VERSION.SDK_INT}), " +
            "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}\n" +
            "# Time zone: ${java.util.TimeZone.getDefault().id}; every time below is UTC\n"

    /** A line added to the newest file, the files rolled past [FILE_BYTES]. */
    fun add(line: String) {
        val d = dir ?: return
        synchronized(lock) {
            runCatching {
                val f = fileAt(d, 0)
                if (f.length() > FILE_BYTES) {
                    fileAt(d, FILES).delete()
                    for (n in FILES - 1 downTo 0) if (fileAt(d, n).exists()) fileAt(d, n).renameTo(fileAt(d, n + 1))
                    fileAt(d, 0).writeText(header())
                }
                fileAt(d, 0).appendText(line + "\n")
            }
        }
    }

    /** The newest lines, the oldest first, then the last crash where there was one; what went wrong, where they can't be read. */
    fun text(c: Context): String {
        val d = dir ?: return fromLogcat()
        val kept = synchronized(lock) {
            val parts = ArrayList<String>()
            var room = TEXT_BYTES.toLong()
            for (n in 0..FILES) {
                if (room <= 0) break
                val f = fileAt(d, n)
                if (!f.exists()) continue
                val bytes = f.readBytes()
                val from = maxOf(0, bytes.size - room.toInt())
                var start = from
                if (from > 0) { val nl = bytes.indexOf('\n'.code.toByte(), from); start = if (nl < 0) bytes.size else nl + 1 }
                parts.add(String(bytes, start, bytes.size - start, Charsets.UTF_8))
                room -= (bytes.size - from)
            }
            parts.reversed().joinToString("")
        }
        val crash = CrashLog.peek(c)
        return if (crash == null) kept else "$kept\n# The last crash, as the app kept it:\n$crash\n"
    }

    private fun ByteArray.indexOf(b: Byte, from: Int): Int {
        for (i in from until size) if (this[i] == b) return i
        return -1
    }

    /** As before: what Android still holds of this run, where the files aren't kept. */
    private fun fromLogcat(): String = try {
        val p = ProcessBuilder("logcat", "-d", "-t", LINES.toString(), "-v", "threadtime", "-v", "UTC", "-v", "year", "--pid=${android.os.Process.myPid()}")
            .redirectErrorStream(true).start()
        val out = p.inputStream.bufferedReader().readText()
        if (!p.waitFor(10, TimeUnit.SECONDS)) p.destroy()
        out
    } catch (e: Exception) {
        "(the Bridge's log couldn't be read: ${e.message})\n"
    }
}
