package com.musicd.server.android

import android.app.Activity
import android.content.Context
import android.os.Build
import android.os.Process
import android.os.SystemClock
import com.musicd.server.client.GateWatch
import com.musicd.server.client.HttpTransport
import com.musicd.server.client.ServerClient
import com.musicd.server.client.Transport
import com.musicd.server.client.UiTrace
import org.json.JSONObject
import java.io.File
import java.io.FileWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * The log build's log (bug list item 116; the branch 116-android-log-build alone, never merged): what the app's screens
 * did and when (UiTrace's findings marked "!!"), each request to the server with its answer and how long it took, the
 * way to the server found and lost, the app's own logcat (the phone's player, the services, a crash's trace), and now
 * and then the server's health and the phone's player. Kept in files/devlog, the last two files of [FILE_BYTES] each;
 * Settings → Updates saves it to Downloads/Mandarin ([save]).
 */
internal object DevLog {
    private const val FILE_BYTES = 3L * 1024 * 1024
    private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "devlog").apply { isDaemon = true } }
    private val stamp = SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.UK)
    @Volatile private var dir: File? = null
    @Volatile private var started = false
    private var out: FileWriter? = null
    /** The screens' watch (findings marked "!!"). Main thread only. */
    val trace = UiTrace()
    /** The last tap, for how long a move took after it; what was shown last, for the taps' lines. */
    @Volatile var lastTap = 0L
    @Volatile var shownLast = "start"

    /** Started with the app's process (MusicDApp): the session's head, then the app's logcat. */
    fun start(c: Context) {
        if (started) return
        started = true
        dir = File(c.filesDir, "devlog").apply { mkdirs() }
        line("APP", "started: Mandarin ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}) log build, ${Build.MANUFACTURER} ${Build.MODEL}, " +
            "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}), pid ${Process.myPid()}")
        Thread({ logcat() }, "devlog-logcat").apply { isDaemon = true; start() }
    }

    /** A line of [cat]; [anomaly] marks it "!!" so it is found in the file at once. */
    fun line(cat: String, msg: String, anomaly: Boolean = false) {
        val at = System.currentTimeMillis()
        val text = "${synchronized(stamp) { stamp.format(Date(at)) }} ${if (anomaly) "!!" else "  "} ${cat.padEnd(6)} $msg\n"
        io.execute { write(text) }
    }

    /** A crash, written at once (the process is going): its trace. */
    fun crash(text: String) {
        val d = dir ?: return
        runCatching { FileWriter(File(d, "current.log"), true).use { it.write("${synchronized(stamp) { stamp.format(Date()) }} !! APP    $text\n") } }
    }

    /** UiTrace's findings, each an anomaly. */
    fun found(findings: List<UiTrace.Finding>) { for (f in findings) line("UI", f.text, anomaly = true) }

    private fun write(text: String) {
        val d = dir ?: return
        runCatching {
            val f = File(d, "current.log")
            if (f.length() > FILE_BYTES) { out?.close(); out = null; f.renameTo(File(d, "previous.log")) }
            val w = out ?: FileWriter(File(d, "current.log"), true).also { out = it }
            w.write(text)
            w.flush()
        }
    }

    /** The app's own logcat (Info and above), as it comes: the player, the services, Android's word on the app, a crash. */
    private fun logcat() {
        runCatching {
            val p = ProcessBuilder("logcat", "-v", "threadtime", "--pid=${Process.myPid()}", "-T", "1", "*:I").redirectErrorStream(true).start()
            p.inputStream.bufferedReader().forEachLine { l -> if (l.isNotBlank()) io.execute { write("                       LOGCAT $l\n") } }
        }.onFailure { line("APP", "logcat can't be read: ${it.message}", anomaly = true) }
    }

    /**
     * [t]'s requests and answers, each logged with how long it took ([who]: the server, or the phone answering offline);
     * a slow answer (2 s or more) and an error marked.
     */
    fun net(t: Transport, who: String): Transport = object : Transport {
        override fun json(method: String, path: String, body: JSONObject?, timeout: Int): JSONObject = timed("$method $path") { t.json(method, path, body, timeout) }
        override fun bytes(path: String, timeout: Int): ByteArray = timed("GET $path") { t.bytes(path, timeout) }
        private fun <T> timed(what: String, ask: () -> T): T {
            val t0 = SystemClock.elapsedRealtime()
            val shown = what.take(200)
            try {
                val r = ask()
                val ms = SystemClock.elapsedRealtime() - t0
                val size = when (r) { is ByteArray -> " ${r.size} B"; else -> "" }
                // A wait for a change (zone-state's wait_for) is held by the server on purpose: never slow.
                line("NET", "$who $shown → ok in $ms ms$size", anomaly = ms >= 2_000 && "wait_for=" !in what)
                return r
            } catch (e: Exception) {
                val ms = SystemClock.elapsedRealtime() - t0
                val why = (e as? ServerClient.ServerException)?.let { "HTTP ${it.status} ${it.message}" } ?: "${e.javaClass.simpleName}: ${e.message}"
                line("NET", "$who $shown → $why after $ms ms", anomaly = true)
                throw e
            }
        }
    }

    /** The server's client as Store makes it, logged. */
    fun server(baseUrl: String, token: String, shut: () -> Unit): Transport = net(GateWatch(HttpTransport(baseUrl, token), shut), "server")

    /**
     * Now and then while the app is on screen (every five minutes, and on coming back): the server's health and status,
     * the way to it, the phone's player, the app's memory. Off the main thread.
     */
    fun snapshot(c: Context) {
        val app = c.applicationContext
        // The slow frames are the screens' watch's, read on its own thread.
        main.post { trace.slowFrames().takeIf { it.isNotEmpty() }?.let { slow -> line("UI", "slow frames (34–100 ms) since the last snapshot, by screen: " + slow.entries.joinToString { "${it.key} ${it.value}" }) } }
        Thread({
            val rt = Runtime.getRuntime()
            val mem = "memory ${(rt.totalMemory() - rt.freeMemory()) / 1_048_576} of ${rt.maxMemory() / 1_048_576} MB"
            val way = "way: " + (if (OfflineNow.on) "offline (${OfflineNow.kind.value})" else if (Store.isAway(app)) "away" + (if (Store.viaEngine(app)) " over MusicD's Tailscale" else "") else "home") +
                ", ${Store.active(app)?.baseUrl ?: "no address"}, network ${if (Away.hasNetwork(app)) "up" else "none"}"
            line("SNAP", "$way; $mem")
            val c2 = Store.client(app)
            if (c2 != null && !OfflineNow.on) {
                runCatching { c2.getJson("/api/health") }.onSuccess { h -> line("SNAP", "server health: version ${h.optString("version")}, ${h.toString().take(300)}") }
                runCatching { c2.getJson("/api/status") }.onSuccess { s ->
                    val scan = s.optJSONObject("scan")
                    line("SNAP", "server status: ${s.optInt("index_count")} albums indexed, scan " + (if (scan?.optBoolean("running") == true) "running" else "idle") +
                        ", Sonos rooms ${s.optJSONObject("sonos")?.optInt("rooms") ?: 0}, data kept ${s.optBoolean("data_persistent", true)}, offline ${s.optBoolean("offline")}")
                }
                runCatching { c2.zones() }.onSuccess { z -> line("SNAP", "rooms: ${z.zones.size}, last ${z.lastZone ?: "none"}") }
            }
            PhonePlayerService.current?.offlineState()?.let { p ->
                line("SNAP", "phone player: ${p.state}, track ${p.index} of ${p.items.size}, at ${p.position} of ${p.duration}, volume ${p.volume}, revision ${p.revision}")
            } ?: line("SNAP", "phone player: not running")
        }, "devlog-snap").apply { isDaemon = true; start() }
    }

    /** How big the log is, and from when, for Settings → Updates. */
    fun about(): String {
        val d = dir ?: return "No log yet"
        val files = listOf(File(d, "previous.log"), File(d, "current.log")).filter { it.exists() }
        val bytes = files.sumOf { it.length() }
        val from = files.firstOrNull()?.lastModified()?.let { SimpleDateFormat("d MMM HH:mm", Locale.UK).format(Date(it)) }
        return if (bytes == 0L) "No log yet" else "${bytes / 1024} KB" + (from?.let { ", the oldest file last written $it" } ?: "")
    }

    /** The whole log saved to Downloads/Mandarin as mandarin-log-<when>.txt; its name, or null. */
    fun save(a: Activity, done: (String?) -> Unit) {
        line("APP", "log saved from Settings → Updates")
        io.execute {
            val d = dir
            val all = java.io.ByteArrayOutputStream()
            if (d != null) for (f in listOf(File(d, "previous.log"), File(d, "current.log"))) if (f.exists()) f.inputStream().use { it.copyTo(all) }
            val text = all.toByteArray()
            val name = "mandarin-log-" + SimpleDateFormat("yyyy-MM-dd-HHmmss", Locale.UK).format(Date()) + ".txt"
            val ok = ShareBridge(a).saveDownload(text, name, "text/plain")
            a.runOnUiThread { done(if (ok) name else null) }
        }
    }

    /** The log emptied. */
    fun clear() {
        io.execute {
            out?.close(); out = null
            dir?.let { d -> File(d, "previous.log").delete(); File(d, "current.log").delete() }
        }
        line("APP", "log cleared")
    }

    private val main = android.os.Handler(android.os.Looper.getMainLooper())
    /** The snapshots' timer. */
    private val timer = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "devlog-timer").apply { isDaemon = true } }
    @Volatile private var snapping: java.util.concurrent.ScheduledFuture<*>? = null

    /** Snapshots every five minutes while [c]'s screens are on. */
    fun snapshots(c: Context, on: Boolean) {
        snapping?.cancel(false)
        snapping = if (on) timer.scheduleWithFixedDelay({ snapshot(c) }, 0, 5, TimeUnit.MINUTES) else null
    }
}
