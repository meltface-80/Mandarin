package com.musicd.server.android

import android.app.Activity
import android.content.Intent
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.util.concurrent.Executors

/**
 * Soloist on the phone's test screen (bug list item 148), from its own "Soloist test" icon: whether Spotify's Soloist runs on this phone and plays lossless here, a step at a time —
 * Get ready (the Debian tree, glibc under proot, Soloist downloaded, its version), Start (signed in by choosing it once
 * in the Spotify app on the same Wi-Fi), Play (a Spotify address, through Soloist's own socket), and what came of it,
 * shared as a report. The key is kept on this phone only, and never in the report.
 */
class SoloistTestActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private val work = Executors.newSingleThreadExecutor()
    private lateinit var key: EditText
    private lateinit var name: EditText
    private lateinit var uri: EditText
    private lateinit var noSeccomp: CheckBox
    private lateinit var status: TextView
    private lateinit var logView: TextView
    @Volatile private var step = ""
    private val results = java.util.Collections.synchronizedMap(LinkedHashMap<String, String>())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences("soloist_test", MODE_PRIVATE)
        val dp = resources.displayMetrics.density
        fun px(v: Int) = (v * dp).toInt()
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(px(18), px(24), px(18), px(32)) }
        fun text(t: String, size: Float = 14f, color: Int = 0xFFBFC7CE.toInt()) = TextView(this).apply {
            text = t; textSize = size; setTextColor(color); setPadding(0, px(6), 0, px(6)); col.addView(this)
        }
        fun box(hint: String, value: String, type: Int) = EditText(this).apply {
            this.hint = hint; setText(value); inputType = type; setTextColor(0xFFFFFFFF.toInt()); setHintTextColor(0xFF6B7680.toInt()); col.addView(this)
        }
        fun row(vararg buttons: Pair<String, () -> Any?>) = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            for ((label, go) in buttons) addView(Button(this@SoloistTestActivity).apply { text = label; isAllCaps = false; setOnClickListener { go() } },
                LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            col.addView(this)
        }
        text("Soloist on this phone — test build", 20f, 0xFFFFFFFF.toInt())
        text("1 · Get ready sets up Linux for Soloist and downloads it from Spotify. 2 · Start runs it. The first time, at home " +
            "on the same Wi-Fi, choose its name once in the Spotify app's devices (Announce on Wi-Fi if it isn't listed). " +
            "Then play something: from the Spotify app, or paste a Spotify address below. Share report sends what happened.")
        key = box("Soloist key (the one in the server's Spotify settings)", prefs.getString("key", "").orEmpty(),
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        name = box("Name in the Spotify app", prefs.getString("name", "Mandarin phone").orEmpty(), InputType.TYPE_CLASS_TEXT)
        noSeccomp = CheckBox(this).apply { text = "proot without seccomp (try this if it ends with SIGSYS)"; setTextColor(0xFFBFC7CE.toInt()); isChecked = prefs.getBoolean("noSeccomp", false); col.addView(this) }
        row("1 · Get ready" to { run("Get ready") { getReady(false) } }, "Download again" to { run("Download") { getReady(true) } })
        row("2 · Start" to { start() }, "Stop" to { work.execute { SoloistPhoneRun.stop() } })
        row("Announce on Wi-Fi" to { SoloistPhoneRun.announce(applicationContext, name.text.toString().trim()) }, "Share report" to { share() })
        uri = box("spotify:album:… or an open.spotify.com link", prefs.getString("uri", "").orEmpty(), InputType.TYPE_CLASS_TEXT)
        row("Play" to { play() }, "Pause" to { SoloistPhoneRun.command("pause") }, "Resume" to { SoloistPhoneRun.command("play") }, "Next" to { SoloistPhoneRun.command("skip_next") })
        status = text("", 13f, 0xFFFFFFFF.toInt()).apply { typeface = Typeface.MONOSPACE }
        logView = text("", 10.5f).apply { typeface = Typeface.MONOSPACE; setTextIsSelectable(true) }
        setContentView(ScrollView(this).apply { setBackgroundColor(0xFF101418.toInt()); addView(col) })
        if (!SoloistPhone.inBuild(this)) results["Runtime"] = "not in this build (built without android/soloist/runtime.sh)"
        tick()
    }

    private fun save() = getSharedPreferences("soloist_test", MODE_PRIVATE).edit()
        .putString("key", key.text.toString().trim()).putString("name", name.text.toString().trim())
        .putString("uri", uri.text.toString().trim()).putBoolean("noSeccomp", noSeccomp.isChecked).apply()

    private fun run(label: String, block: () -> Unit) {
        save()
        if (step.isNotEmpty()) return
        step = label
        work.execute {
            try { block() } catch (e: Exception) { SoloistPhone.note("$label: ${e.javaClass.simpleName}: ${e.message}"); results[label] = "failed: ${e.message}" }
            step = ""
        }
    }

    private fun getReady(download: Boolean) {
        val c = applicationContext
        if (!SoloistPhone.inBuild(c)) throw IllegalStateException("this build has no Soloist runtime")
        SoloistPhone.note("device: ${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT}), " +
            "kernel ${System.getProperty("os.version")}, ${Build.SUPPORTED_ABIS.firstOrNull()}; app ${BuildConfig.VERSION_NAME}")
        SoloistPhone.note("runtime: " + SoloistPhone.versions(c).replace("\n", ", "))
        SoloistPhone.prepare(c)
        results["Debian tree"] = "ready"
        val ld = SoloistPhone.runOnce(c, "glibc", "/lib/ld-linux-aarch64.so.1", listOf("--version"), noSeccomp.isChecked)
        results["glibc under proot"] = if (ld == 0) "runs" else "failed (exit $ld${ld?.let { SoloistPhone.signal(it) } ?: ""})"
        if (download || SoloistPhoneFiles.binary(c) == null) {
            step = "Downloading Soloist…"
            SoloistPhoneFiles.download(c) { step = it }
        }
        results["Soloist downloaded"] = SoloistPhone.soloist(c) ?: "no"
        val v = SoloistPhone.runOnce(c, "version", SoloistPhone.soloist(c)!!, listOf("--version"), noSeccomp.isChecked)
        results["soloist --version"] = if (v == 0) "runs" else "failed (exit $v${v?.let { SoloistPhone.signal(it) } ?: ""})"
    }

    private fun start() {
        val k = key.text.toString().trim()
        if (k.isEmpty()) { results["Start"] = "needs the Soloist key"; return }
        run("Start") {
            SoloistPhone.prepare(applicationContext)
            SoloistPhoneRun.start(applicationContext, k, name.text.toString().trim().ifEmpty { "Mandarin phone" }, noSeccomp.isChecked)
            main.post { SoloistTestService.start(this) }
            results["Start"] = "started"
        }
    }

    /** A Spotify address as Soloist takes it: spotify:album:… as it is, an open.spotify.com link turned into one. */
    private fun play() {
        save()
        val raw = uri.text.toString().trim()
        val m = Regex("open\\.spotify\\.com/(?:intl-[a-z]+/)?(album|track|playlist|artist)/([A-Za-z0-9]+)").find(raw)
        val u = if (m != null) "spotify:${m.groupValues[1]}:${m.groupValues[2]}" else raw
        val sent = if (u.isEmpty()) SoloistPhoneRun.command("play") else SoloistPhoneRun.command("play", mapOf("uri" to u))
        SoloistPhone.note("play: ${u.ifEmpty { "(resume)" }} ${if (sent) "sent" else "not sent: Soloist's socket isn't connected"}")
    }

    private fun statusText(): String {
        val r = SoloistPhoneRun
        val s = r.sound
        val lines = mutableListOf<String>()
        if (step.isNotEmpty()) lines += "▶ $step"
        for ((k, v) in synchronized(results) { results.toList() }) lines += "$k: $v"
        lines += "Soloist: " + if (r.running()) "running" else "not running"
        if (r.running()) {
            lines += "  zeroconf port ${r.zeroconf.takeIf { it > 0 } ?: "—"} · socket ${r.ws.takeIf { it > 0 } ?: "—"}${if (r.announced.isNotEmpty()) " · announced" else ""}"
            lines += "  signed in: " + when (r.signedIn) { true -> "yes"; false -> "no — choose \"${name.text}\" in the Spotify app"; null -> "—" }
            if (r.expires.isNotEmpty()) lines += "  build expires in ${r.expires}"
            lines += "  playback: ${r.status.ifEmpty { "—" }}${if (r.active) " (here)" else ""}"
            if (r.track.isNotEmpty()) lines += "  track: ${r.track}"
        }
        if (s != null && s.streams > 0) {
            lines += "Sound: ${s.format}"
            lines += "  %.1f s played · %d KB · volume %d%%%s".format(s.frames / 44100.0, s.bytes / 1024, s.volume, if (s.corked) " · paused" else "")
            lines += "  underruns ${s.underruns} · ${s.verdict.ifEmpty { "not heard enough yet" }}"
        }
        return lines.joinToString("\n")
    }

    private fun tick() {
        status.text = statusText()
        logView.text = SoloistPhone.log.toList().takeLast(150).joinToString("\n")
        main.postDelayed(::tick, 1_000)
    }

    private fun share() {
        save()
        val report = "Soloist on this phone — test build report\n\n${statusText()}\n\nLog:\n" + SoloistPhone.log.joinToString("\n")
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_SUBJECT, "Soloist test report").putExtra(Intent.EXTRA_TEXT, report)
        startActivity(Intent.createChooser(send, "Share the report"))
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        super.onDestroy()
    }
}
