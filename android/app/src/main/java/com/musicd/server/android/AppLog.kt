package com.musicd.server.android

import android.app.Activity
import android.content.Context
import android.os.Build
import android.os.SystemClock
import com.musicd.server.client.GateWatch
import com.musicd.server.client.WayTransport
import com.musicd.server.client.LogRedact
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
 * The app's log (bug list item 121; the log build's, item 116, made a setting): off unless switched on in Settings →
 * Setup → Logging, and then nothing is collected at all. On, it keeps what the app's screens did and when (UiTrace's
 * findings marked "!!"), each request to the server with how long it took, the way to the server found and lost, the
 * app's own lines of Android's log (the phone's player, the services, a crash), and now and then the server's health and
 * the phone's player; and the server keeps its own (Diagnostics.cs), fetched as the log is saved. Every line goes
 * through LogRedact before it is written: no address, name, title, search, file or key is kept. Kept in files/applog,
 * the last two files of [FILE_BYTES] each; switched off, deleted, and the server's with it.
 */
internal object AppLog {
    private const val FILE_BYTES = 3L * 1024 * 1024
    /** The app's own tags in Android's log, the only ones read (with a crash's). */
    private val TAGS = listOf("Away", "TailscaleEngine", "PhonePlayer", "NowPlaying", "MainActivity", "Downloads", "AutoDownloads", "AppUpdate",
        "AppBackup", "LocalMusic", "OfflineSite", "ShareBridge", "StreamCache", "UsbDac", "UsbDriver")
    private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "applog").apply { isDaemon = true } }
    private val stamp = SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.UK)
    @Volatile private var dir: File? = null
    @Volatile private var app: Context? = null
    @Volatile private var logcat: Process? = null
    /** The Tailscale engine's CPU time at the last snapshot (item 202). */
    @Volatile private var lastEngineCpu: Double? = null
    private var out: FileWriter? = null
    /** Switched on (Settings → Setup → Logging); off, nothing is collected. */
    @Volatile var on = false
        private set
    /** The screens' watch (findings marked "!!"). Main thread only. */
    val trace = UiTrace()
    /** The last tap, for how long a move took after it; what was shown last, for the taps' lines. */
    @Volatile var lastTap = 0L
    @Volatile var shownLast = "start"

    /** With the app's process (MusicDApp): collecting if switched on. */
    fun start(c: Context) {
        app = c.applicationContext
        dir = File(c.filesDir, "applog")
        if (Store.logging(c)) begin()
    }

    /** Switched on or off in Settings → Setup: off deletes the log, the server's too. */
    fun switch(c: Context, to: Boolean) {
        Store.setLogging(c, to)
        if (to) begin() else { on = false; logcat?.destroy(); logcat = null; deleteFiles() }
        tellServer(c, to)
    }

    private fun begin() {
        if (on) return
        dir?.mkdirs()
        on = true
        line("APP", "logging on: Mandarin ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}), Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
        Thread({ readLogcat() }, "applog-logcat").apply { isDaemon = true; start() }
    }

    /** The server's own log switched on or off with the app's (when it can be reached; asked again with each snapshot). */
    private fun tellServer(c: Context, to: Boolean) {
        Thread({ runCatching { Store.client(c.applicationContext)?.post("/api/diagnostics", JSONObject().put("on", to)) } }, "applog-server").apply { isDaemon = true; start() }
    }

    /** A line of [cat], without personal data; [anomaly] marks it "!!" so it is found in the file at once. Nothing while off. */
    fun line(cat: String, msg: String, anomaly: Boolean = false) {
        if (!on) return
        val at = System.currentTimeMillis()
        val text = "${synchronized(stamp) { stamp.format(Date(at)) }} ${if (anomaly) "!!" else "  "} ${cat.padEnd(6)} ${LogRedact.line(msg)}\n"
        io.execute { write(text) }
    }

    /** A crash, written at once (the process is going): its trace, a line at a time without personal data. */
    fun crash(text: String) {
        val d = dir ?: return
        if (!on) return
        val safe = text.lines().joinToString("\n") { LogRedact.line(it) }
        runCatching { FileWriter(File(d, "current.log"), true).use { it.write("${synchronized(stamp) { stamp.format(Date()) }} !! APP    $safe\n") } }
    }

    /** UiTrace's findings, each an anomaly. */
    fun found(findings: List<UiTrace.Finding>) {
        for (f in findings) {
            // The same finding twice in the same moment (a frame's stall came twice, 20 October) is written once.
            if (f.text == lastFound?.text && f.atMs - (lastFound?.atMs ?: 0) < 50) continue
            lastFound = f
            line("UI", f.text, anomaly = true)
        }
    }
    @Volatile private var lastFound: UiTrace.Finding? = null

    private fun write(text: String) {
        val d = dir ?: return
        if (!on) return
        runCatching {
            val f = File(d, "current.log")
            if (f.length() > FILE_BYTES) { out?.close(); out = null; f.renameTo(File(d, "previous.log")) }
            val w = out ?: FileWriter(File(d, "current.log"), true).also { out = it }
            w.write(text)
            w.flush()
        }
    }

    /** The app's own lines of Android's log (its tags, Info and above, and a crash's), each without personal data, while on. */
    private fun readLogcat() {
        runCatching {
            val filter = TAGS.map { "$it:I" } + listOf("AndroidRuntime:E", "*:S")
            val p = ProcessBuilder(listOf("logcat", "-v", "threadtime", "--pid=${android.os.Process.myPid()}", "-T", "1") + filter).redirectErrorStream(true).start()
            logcat = p
            p.inputStream.bufferedReader().forEachLine { l -> if (on && l.isNotBlank()) { val s = LogRedact.line(l); io.execute { write("                       LOGCAT $s\n") } } }
        }.onFailure { line("APP", "Android's log can't be read: ${it.javaClass.simpleName}", anomaly = true) }
    }

    /**
     * [t]'s requests and answers, each logged with how long it took ([who]: the server, or the phone answering offline);
     * a slow answer (2 s or more) and an error marked.
     */
    fun net(t: Transport, who: String): Transport = object : Transport {
        override fun json(method: String, path: String, body: JSONObject?, timeout: Int): JSONObject = timed("$method $path", timeout) { t.json(method, path, body, timeout) }
        override fun bytes(path: String, timeout: Int): ByteArray = timed("GET $path", timeout) { t.bytes(path, timeout) }
        private fun <T> timed(what: String, timeout: Int, ask: () -> T): T {
            if (!on) return ask()
            val t0 = SystemClock.elapsedRealtime()
            val shown = what.take(200)
            try {
                val r = ask()
                val ms = SystemClock.elapsedRealtime() - t0
                val size = when (r) { is ByteArray -> " ${r.size} B"; else -> "" }
                // A wait for a change (zone-state's wait_for, the phone's commands' wait) is held by the server on purpose: never slow.
                line("NET", "$who $shown → ok in $ms ms$size", anomaly = UiTrace.slowAnswer(what, ms))
                return r
            } catch (e: Exception) {
                val ms = SystemClock.elapsedRealtime() - t0
                val why = (e as? ServerClient.ServerException)?.let { "HTTP ${it.status} ${it.message}" } ?: "${e.javaClass.simpleName}: ${e.message}"
                // Ended long after its own timeout: the phone slept through it (not a fault of the server's).
                if (UiTrace.slept(ms, timeout)) line("NET", "$who $shown → $why after $ms ms (the phone slept meanwhile)")
                else line("NET", "$who $shown → $why after $ms ms", anomaly = true)
                throw e
            }
        }
    }

    /** The server's client as Store makes it, logged while on: at the address [base] gives at each request, [ready] first (item 157). */
    fun server(base: () -> String, token: String, ready: () -> Unit, shut: () -> Unit): Transport = net(GateWatch(WayTransport(base, token, ready), shut), "server")

    /**
     * Now and then while the app is on screen (every five minutes, and on coming back): the server's health and status,
     * the way to it, the phone's player, the app's memory; and the server's own log switched on if it wasn't. Off the
     * main thread.
     */
    fun snapshot(c: Context) {
        if (!on) return
        val app = c.applicationContext
        // The slow frames are the screens' watch's, read on its own thread.
        main.post { trace.slowFrames().takeIf { it.isNotEmpty() }?.let { slow -> line("UI", "slow frames (34–100 ms) since the last snapshot, by screen: " + slow.entries.joinToString { "${it.key} ${it.value}" }) } }
        Thread({
            val rt = Runtime.getRuntime()
            val mem = "memory ${(rt.totalMemory() - rt.freeMemory()) / 1_048_576} of ${rt.maxMemory() / 1_048_576} MB"
            val way = "way: " + (if (OfflineNow.on) "offline (${OfflineNow.kind.value})" else if (Store.isAway(app)) "away" + (if (Store.viaEngine(app)) " over MusicD's Tailscale" else " over the Tailscale app") else "home") +
                ", network ${if (Away.hasNetwork(app)) "up" else "none"}"
            line("SNAP", "$way; $mem")
            val c2 = Store.client(app)
            if (c2 != null && !OfflineNow.on) {
                runCatching { c2.getJson("/api/health") }.onSuccess { h ->
                    line("SNAP", "server: version ${h.optString("version")}, ${h.optInt("albums")} albums, ${h.optInt("rooms")} rooms, ffmpeg ${h.optBoolean("ffmpeg")}")
                }
                runCatching { c2.getJson("/api/status") }.onSuccess { s ->
                    val scan = s.optJSONObject("scan")
                    line("SNAP", "server status: scan " + (if (scan?.optBoolean("running") == true) "running" else "idle") +
                        ", data kept ${s.optBoolean("data_persistent", true)}, offline ${s.optBoolean("offline")}")
                }
                runCatching { c2.zones() }.onSuccess { z -> line("SNAP", "rooms: ${z.zones.size}, the last " + (if (z.lastZone?.startsWith("PHONE_") == true) "this phone" else if (z.lastZone == null) "none" else "a room of the server's")) }
                runCatching { if (!c2.getJson("/api/diagnostics").optBoolean("on")) c2.post("/api/diagnostics", JSONObject().put("on", true)) }
            }
            PhonePlayerService.current?.offlineState()?.let { p ->
                line("SNAP", "phone player: ${p.state}, track ${p.index} of ${p.items.size}, at ${p.position} of ${p.duration}, volume ${p.volume}, revision ${p.revision}")
            } ?: line("SNAP", "phone player: not running")
            // The engine's CPU time, and how much since the last snapshot (item 202: Android ended the app for it, unseen).
            line("SNAP", "engine: " + (TailscaleEngine.cpuSeconds()?.let { cpu ->
                val since = lastEngineCpu?.let { " (+%.1f s since the last snapshot)".format(cpu - it) }.orEmpty()
                lastEngineCpu = cpu
                "running, cpu %.1f s%s".format(cpu, since)
            } ?: run { lastEngineCpu = null; "not running" }))
        }, "applog-snap").apply { isDaemon = true; start() }
    }

    /** How much is logged, and since when, for Settings → Setup. */
    fun about(): String {
        val d = dir ?: return "Nothing logged yet"
        val files = listOf(File(d, "previous.log"), File(d, "current.log")).filter { it.exists() }
        val bytes = files.sumOf { it.length() }
        val from = files.firstOrNull()?.let { f -> f.useLines { it.firstOrNull()?.take(18) } }
        return if (bytes == 0L) "Nothing logged yet" else "${(bytes + 1023) / 1024} KB logged" + (from?.let { ", since $it" } ?: "")
    }

    /**
     * The log saved to Downloads/Mandarin as mandarin-log-<when>.txt: the app's, then the server's (fetched now, each line
     * through LogRedact again); its name, or null.
     */
    fun save(a: Activity, done: (String?) -> Unit) {
        line("APP", "log saved from Settings → Setup")
        io.execute {
            val d = dir
            val all = java.io.ByteArrayOutputStream()
            all.write("Mandarin's log: the app's, then the server's. It is made without personal data; please look through it before you send it.\n\n— The app —\n".toByteArray())
            if (d != null) for (f in listOf(File(d, "previous.log"), File(d, "current.log"))) if (f.exists()) f.inputStream().use { it.copyTo(all) }
            val server = runCatching { Store.client(a)?.bytes("/api/diagnostics/log")?.toString(Charsets.UTF_8) }.getOrNull()
            all.write("\n— The server (times in UTC) —\n".toByteArray())
            all.write((server?.lines()?.joinToString("\n") { LogRedact.line(it) } ?: "(the server couldn't be reached: its log isn't here)").toByteArray())
            val name = "mandarin-log-" + SimpleDateFormat("yyyy-MM-dd-HHmmss", Locale.UK).format(Date()) + ".txt"
            val ok = ShareBridge(a).saveDownload(all.toByteArray(), name, "text/plain")
            a.runOnUiThread { done(if (ok) name else null) }
        }
    }

    /** The log emptied, the server's too; collecting goes on. */
    fun clear(c: Context) {
        io.execute { deleteFiles() }
        Thread({ runCatching { Store.client(c.applicationContext)?.post("/api/diagnostics/clear", JSONObject()) } }, "applog-server").apply { isDaemon = true; start() }
        line("APP", "log cleared")
    }

    private fun deleteFiles() {
        io.execute {
            runCatching { out?.close() }
            out = null
            dir?.let { d -> File(d, "previous.log").delete(); File(d, "current.log").delete() }
        }
    }

    private val main = android.os.Handler(android.os.Looper.getMainLooper())
    /** The snapshots' timer. */
    private val timer = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "applog-timer").apply { isDaemon = true } }
    @Volatile private var snapping: java.util.concurrent.ScheduledFuture<*>? = null

    /** Snapshots every five minutes while [c]'s screens are on, and logging is. */
    fun snapshots(c: Context, on: Boolean) {
        snapping?.cancel(false)
        snapping = if (on && this.on) timer.scheduleWithFixedDelay({ snapshot(c) }, 0, 5, TimeUnit.MINUTES) else null
    }
}
