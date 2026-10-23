package com.musicd.server.android

import android.app.Activity
import android.content.Intent
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.musicd.server.client.SoloistSteps
import java.util.concurrent.Executors

/**
 * Soloist on the phone's test screen (bug list items 148, 150), from its own "Soloist test" icon: whether Spotify's
 * Soloist runs on this phone and plays lossless here. One step at a time (core SoloistSteps): a box at the top says
 * what to do next in plain words, a checklist says what's done, and a button is enabled only when pressing it can work.
 * The fields, the controls, then Share report; the rarely needed (download again, proot's seccomp, the log) last. The
 * key is kept on this phone only, and never in the report.
 */
class SoloistTestActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private val work = Executors.newSingleThreadExecutor()
    private lateinit var key: EditText
    private lateinit var name: EditText
    private lateinit var uri: EditText
    private lateinit var noSeccomp: CheckBox
    private lateinit var heading: TextView
    private lateinit var next: TextView
    private lateinit var checks: TextView
    private lateinit var sound: TextView
    private lateinit var logView: TextView
    private val buttons = HashMap<String, Button>()
    private var showLog = false

    // How Get ready went, for the steps.
    @Volatile private var busy = ""
    @Volatile private var linuxRuns: Boolean? = null
    @Volatile private var soloistRuns: Boolean? = null
    @Volatile private var readyFailed = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences("soloist_test", MODE_PRIVATE)
        val dp = resources.displayMetrics.density
        fun px(v: Int) = (v * dp).toInt()
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(px(18), px(24), px(18), px(40)) }
        fun text(t: String, size: Float = 14f, color: Int = 0xFFBFC7CE.toInt(), into: LinearLayout = col) = TextView(this).apply {
            text = t; textSize = size; setTextColor(color); setPadding(0, px(4), 0, px(4)); into.addView(this)
        }
        fun label(t: String) = text(t, 12f, 0xFF8A949C.toInt()).apply { setPadding(0, px(14), 0, 0) }
        fun box(hint: String, value: String, type: Int) = EditText(this).apply {
            this.hint = hint; setText(value); inputType = type; setTextColor(0xFFFFFFFF.toInt()); setHintTextColor(0xFF6B7680.toInt()); col.addView(this)
        }
        fun row(vararg named: Pair<String, () -> Any?>) = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            for ((label, go) in named) addView(Button(this@SoloistTestActivity).apply {
                text = label; isAllCaps = false; setOnClickListener { go(); tick() }; buttons[label] = this
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            col.addView(this)
        }

        text("Spotify on this phone", 22f, 0xFFFFFFFF.toInt())
        text("A test of Soloist, Spotify's own player, running inside Mandarin.", 13f)
        // What to do next, in a box of its own.
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(px(14), px(12), px(14), px(14))
            background = GradientDrawable().apply { cornerRadius = px(12).toFloat(); setColor(0xFF1C2329.toInt()); setStroke(px(1), 0xFFB08D57.toInt()) }
        }
        col.addView(card, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = px(14) })
        heading = text("", 17f, 0xFFE8C98F.toInt(), card).apply { typeface = Typeface.DEFAULT_BOLD }
        next = text("", 15f, 0xFFFFFFFF.toInt(), card)
        checks = text("", 14f).apply { setPadding(0, px(12), 0, 0); setLineSpacing(0f, 1.25f) }
        sound = text("", 12.5f).apply { typeface = Typeface.MONOSPACE }

        label("Soloist key")
        key = box("the key from Mandarin's Spotify settings", prefs.getString("key", "").orEmpty(), InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        label("Its name in the Spotify app")
        name = box("Mandarin phone", prefs.getString("name", "Mandarin phone").orEmpty(), InputType.TYPE_CLASS_TEXT)
        row("Get ready" to { run("Get ready") { getReady(false) } }, "Start" to { start() }, "Stop" to { work.execute { SoloistPhoneRun.stop() } })
        row("Announce on Wi-Fi" to { SoloistPhoneRun.announce(applicationContext, nameNow()) })
        label("A Spotify album or playlist (link or spotify: address)")
        uri = box("https://open.spotify.com/album/…", prefs.getString("uri", "").orEmpty(), InputType.TYPE_CLASS_TEXT)
        row("Play" to { play() }, "Pause" to { SoloistPhoneRun.command("pause") }, "Resume" to { SoloistPhoneRun.command("play") }, "Next" to { SoloistPhoneRun.command("skip_next") })
        row("Share report" to { share() })

        label("If something's wrong")
        row("Download Soloist again" to { run("Download") { getReady(true) } }, "Show log" to { showLog = !showLog; buttons["Show log"]?.text = if (showLog) "Hide log" else "Show log" })
        noSeccomp = CheckBox(this).apply {
            text = "Run without proot's seccomp (only if a report says SIGSYS)"; setTextColor(0xFFBFC7CE.toInt()); isChecked = prefs.getBoolean("noSeccomp", false); col.addView(this)
        }
        logView = text("", 10.5f).apply { typeface = Typeface.MONOSPACE; setTextIsSelectable(true) }
        setContentView(ScrollView(this).apply { setBackgroundColor(0xFF101418.toInt()); addView(col) })
        tick()
    }

    private fun nameNow() = name.text.toString().trim().ifEmpty { "Mandarin phone" }

    private fun save() = getSharedPreferences("soloist_test", MODE_PRIVATE).edit()
        .putString("key", key.text.toString().trim()).putString("name", nameNow())
        .putString("uri", uri.text.toString().trim()).putBoolean("noSeccomp", noSeccomp.isChecked).apply()

    private fun run(label: String, block: () -> Unit) {
        save()
        if (busy.isNotEmpty()) return
        busy = "$label…"
        work.execute {
            try { block() } catch (e: Exception) {
                SoloistPhone.note("$label: ${e.javaClass.simpleName}: ${e.message}")
                if (readyFailed.isEmpty()) readyFailed = "$label stopped: ${e.message}"
            }
            busy = ""
        }
    }

    private fun getReady(download: Boolean) {
        val c = applicationContext
        readyFailed = ""; linuxRuns = null; soloistRuns = null
        SoloistPhone.note("device: ${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT}), " +
            "kernel ${System.getProperty("os.version")}, ${Build.SUPPORTED_ABIS.firstOrNull()}; app ${BuildConfig.VERSION_NAME}")
        SoloistPhone.note("runtime: " + SoloistPhone.versions(c).replace("\n", ", "))
        busy = "Setting up Linux in the app…"
        SoloistPhone.prepare(c)
        val ld = SoloistPhone.runOnce(c, "glibc", "/lib/ld-linux-aarch64.so.1", listOf("--version"), noSeccomp.isChecked)
        linuxRuns = ld == 0
        if (ld != 0) { readyFailed = "Linux didn't run in the app (exit $ld${ld?.let { SoloistPhone.signal(it) } ?: ""})."; return }
        if (download || SoloistPhoneFiles.binary(c) == null) {
            busy = "Downloading Soloist from Spotify…"
            SoloistPhoneFiles.download(c) { busy = it }
        }
        busy = "Checking Soloist runs…"
        val said = mutableListOf<String>()
        val v = SoloistPhone.runOnce(c, "version", SoloistPhone.soloist(c)!!, listOf("--version"), noSeccomp.isChecked) { said += it }
        soloistRuns = v == 0
        if (v != 0) readyFailed = "Soloist couldn't start (exit $v${v?.let { SoloistPhone.signal(it) } ?: ""})." +
            (said.lastOrNull { it.isNotBlank() }?.let { " It said: $it" } ?: "")
    }

    private fun start() {
        val k = key.text.toString().trim()
        if (k.isEmpty()) return
        run("Start") {
            SoloistPhone.prepare(applicationContext)
            SoloistPhoneRun.start(applicationContext, k, nameNow(), noSeccomp.isChecked)
            main.post { SoloistTestService.start(this) }
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

    private fun state(): SoloistSteps.State {
        val r = SoloistPhoneRun
        return SoloistSteps.State(
            inBuild = SoloistPhone.inBuild(this), busy = busy, linuxRuns = linuxRuns, downloaded = SoloistPhoneFiles.binary(this) != null,
            soloistRuns = soloistRuns, readyFailed = readyFailed, hasKey = key.text.isNotBlank(), name = nameNow(),
            running = r.running(), stopped = r.stopped, listening = r.zeroconf > 0, announced = r.announced.isNotEmpty(),
            signedIn = r.signedIn == true, connected = r.ws > 0 && r.running(), playing = r.status == "playing" && r.active,
            track = r.track, verdict = r.sound?.verdict.orEmpty())
    }

    private fun soundText(): String {
        val s = SoloistPhoneRun.sound ?: return ""
        if (s.streams == 0) return ""
        return "Sound: ${s.format}\n%.1f s heard · %d KB · volume %d%%%s · underruns %d".format(s.frames / 44100.0, s.bytes / 1024, s.volume,
            if (s.corked) " · paused" else "", s.underruns)
    }

    private fun mark(c: SoloistSteps.Check) = (when (c.done) { true -> "✓  "; false -> "✗  "; null -> "○  " }) + c.text

    private fun tick() {
        main.removeCallbacksAndMessages(null)
        val st = state()
        val n = SoloistSteps.next(st)
        heading.text = n.heading
        next.text = n.text
        checks.text = SoloistSteps.checklist(st).joinToString("\n", transform = ::mark)
        sound.text = soundText()
        sound.visibility = if (sound.text.isEmpty()) View.GONE else View.VISIBLE
        val on = mapOf("Get ready" to n.getReady, "Start" to n.start, "Stop" to n.stop, "Announce on Wi-Fi" to n.announce,
            "Play" to n.play, "Pause" to n.play, "Resume" to n.play, "Next" to n.play, "Download Soloist again" to n.getReady)
        for ((label, b) in buttons) { val e = on[label] ?: true; b.isEnabled = e; b.alpha = if (e) 1f else 0.4f }
        logView.visibility = if (showLog) View.VISIBLE else View.GONE
        if (showLog) logView.text = SoloistPhone.log.toList().takeLast(150).joinToString("\n")
        main.postDelayed(::tick, 1_000)
    }

    private fun share() {
        save()
        val st = state()
        val report = "Spotify on this phone (Soloist) — report\n\n${SoloistSteps.next(st).heading}\n" +
            SoloistSteps.checklist(st).joinToString("\n", transform = ::mark) + "\n${soundText()}\n\nLog:\n" + SoloistPhone.log.joinToString("\n")
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_SUBJECT, "Soloist report").putExtra(Intent.EXTRA_TEXT, report)
        startActivity(Intent.createChooser(send, "Share the report"))
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        super.onDestroy()
    }
}
