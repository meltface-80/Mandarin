package com.musicd.server.android

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * MusicD's own Tailscale connection: sign the phone in to your tailnet once,
 * and away from home the app reaches the server through it (see [Away]).
 * "Test connection" checks each step of the way — joined, server answering,
 * seen as away, a track's first half-megabyte — with timings, and a log to
 * copy and send back. A passing test keeps the address it used.
 *
 * Reached from Settings → System → Tailscale (app only).
 */
class TailscaleTestActivity : Activity() {

    private val main = Handler(Looper.getMainLooper())
    private val work = Executors.newSingleThreadExecutor()
    private lateinit var state: TextView
    private lateinit var target: EditText
    private lateinit var signIn: Button
    private lateinit var log: TextView
    private var authUrl: String? = null
    private val lines = StringBuilder()

    private val dp get() = resources.displayMetrics.density
    private fun px(v: Int) = (v * dp).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(px(20), px(20), px(20), px(24))
        }
        val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        head.addView(TextView(this).apply {
            text = "‹"; setTextColor(DIM); textSize = 34f
            setPadding(0, 0, px(14), px(4)); contentDescription = "Back"
            setOnClickListener { finish() }
        })
        head.addView(TextView(this).apply {
            text = "Tailscale"; setTextColor(WHITE); textSize = 24f; typeface = Typeface.DEFAULT_BOLD
        })
        col.addView(head)
        col.addView(note("Mandarin's own Tailscale connection — no Tailscale app, no VPN. Sign in below with the " +
            "same account as your server, once. Away from home (mobile data, other Wi-Fi) the app then reaches " +
            "your whole library through it, streamed as Opus 256 by the server."))

        state = TextView(this).apply { setTextColor(WHITE); textSize = 15f; setPadding(0, px(16), 0, px(8)) }
        col.addView(state)

        signIn = button("Sign in to Tailscale") { signIn() }
        col.addView(signIn)

        col.addView(label("Server's Tailscale address"))
        target = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            hint = "e.g. 100.101.102.103:3500"
            setHintTextColor(FAINT); setTextColor(WHITE); textSize = 16f
            Store.awayAddress(this@TailscaleTestActivity)?.let { setText("${it.host}:${it.port}") }
        }
        col.addView(target)

        col.addView(button("Test connection") { test() })
        col.addView(button("Copy log") { copyLog() })
        col.addView(button("Sign this phone out of Tailscale") { run("Sign out") { TailscaleEngine.json("POST", "/logout") } })

        log = TextView(this).apply {
            setTextColor(DIM); textSize = 12f; typeface = Typeface.MONOSPACE
            setPadding(0, px(16), 0, 0); setTextIsSelectable(true)
        }
        col.addView(log)

        val scroll = ScrollView(this).apply { setBackgroundColor(BG); isFillViewport = true; addView(col) }
        Insets.pad(scroll)
        setContentView(scroll)

        work.execute {
            step("Start engine") {
                TailscaleEngine.ensureRunning(this)
                TailscaleEngine.json("POST", "/start", JSONObject().put("Hostname", "musicd-phone").toString(), 30_000)
            }
        }
        refresh.run()
    }

    override fun onDestroy() {
        main.removeCallbacks(refresh)
        work.shutdownNow()
        super.onDestroy()
    }

    // ------------------------------------------------------------ state

    private val refresh = object : Runnable {
        override fun run() {
            work.execute {
                val st = runCatching { TailscaleEngine.json("GET", "/status", timeoutMs = 4000) }.getOrNull()
                main.post { show(st) }
            }
            main.postDelayed(this, 2000)
        }
    }

    private fun show(st: JSONObject?) {
        if (isFinishing) return
        if (st == null) { state.text = "Engine: not running"; return }
        val s = st.optString("state", "?")
        authUrl = st.optString("auth_url").takeIf { it.isNotEmpty() }
        val ips = st.optJSONArray("ips")?.let { a -> (0 until a.length()).joinToString(", ") { a.getString(it) } } ?: ""
        state.text = buildString {
            append("Tailscale: ").append(when (s) {
                "Running" -> "connected"
                "NeedsLogin" -> "needs you to sign in"
                "NeedsMachineAuth" -> "waiting for approval in the Tailscale admin console"
                "Starting" -> "starting…"
                "Stopped" -> "stopped"
                else -> s
            })
            if (ips.isNotEmpty()) append("\nThis phone: ").append(ips)
            st.optString("dns_name").takeIf { it.isNotEmpty() }?.let { append("\nName: ").append(it.trimEnd('.')) }
            st.optString("forward").takeIf { it.isNotEmpty() }?.let { append("\nForwarding ").append(it).append(" → ").append(st.optString("target")) }
            if (s == "Running" && st.has("online") && !st.optBoolean("online", true)) append("\nNot online on the tailnet (the tunnel may be stale — Test connection rebinds it)")
            st.optJSONArray("health")?.let { a -> if (a.length() > 0) append("\nTailscale warns: ").append((0 until a.length()).joinToString("; ") { a.getString(it) }) }
            st.optString("error").takeIf { it.isNotEmpty() }?.let { append("\nError: ").append(it) }
            append("\nEngine ").append(st.optString("version"))
        }
        signIn.visibility = if (s == "Running") View.GONE else View.VISIBLE
    }

    private fun signIn() {
        val link = authUrl
        if (link != null) { open(link); return }
        work.execute {
            val st = step("Ask for a sign-in link") { TailscaleEngine.json("POST", "/login", timeoutMs = 20_000) }
            val url = st?.optString("auth_url")?.takeIf { it.isNotEmpty() }
            main.post { if (url != null) open(url) else toast("No sign-in link yet — try again in a moment") }
        }
    }

    private fun open(url: String) {
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
            .onFailure { toast("Couldn't open the sign-in page") }
    }

    // ------------------------------------------------------------ the test

    private fun test() {
        val t = target.text.toString().trim().removePrefix("http://").removePrefix("https://").trimEnd('/')
        if (!t.contains(':')) { toast("Give the address with its port, e.g. 100.101.102.103:3500"); return }
        val token = Store.token(this)
        work.execute {
            say("—— Test connection to $t ——")
            val fw = step("Open the loopback port") { TailscaleEngine.json("POST", "/forward?target=$t&port=${TailscaleEngine.PORT}") } ?: return@execute
            val addr = fw.optString("addr").takeIf { it.isNotEmpty() } ?: return@execute say("FAIL: no port (${fw})")
            val base = "http://$addr"
            val probe = step("Probe the server directly") { TailscaleEngine.json("GET", "/probe", timeoutMs = 10_000) }
            if (probe?.optBoolean("ok") != true) return@execute say("FAIL: the server didn't answer over Tailscale")
            step("Health through the port") { JSONObject(get("$base/api/health", null)) }
            val auth = step("Signed in, and seen as away?") { JSONObject(get("$base/api/auth/status", token)) }
            if (auth?.optBoolean("signed_in") != true) say("NOTE: not signed in to Mandarin through Tailscale")
            if (auth?.optBoolean("away") != true) say("NOTE: the server doesn't see this phone as away")
            val lib = step("Library") { JSONObject(get("$base/api/library/albums?sort=album&count=1", token)) }
            val album = lib?.optJSONArray("albums")?.optJSONObject(0)?.optInt("offset") ?: return@execute say("FAIL: no albums")
            val detail = step("An album") { JSONObject(get("$base/api/download/album?offset=$album&quality=original", token)) }
            val path = detail?.optJSONArray("tracks")?.optJSONObject(0)?.optString("path") ?: return@execute say("FAIL: no track")
            step("First 512 KB of a track") {
                val t0 = System.nanoTime()
                val c = URL(base + path).openConnection() as HttpURLConnection
                c.setRequestProperty("Authorization", "Bearer $token")
                c.setRequestProperty("Range", "bytes=0-524287")
                c.connectTimeout = 10_000; c.readTimeout = 60_000
                val n = c.inputStream.use { it.readBytes().size }
                val code = c.responseCode
                c.disconnect()
                val secs = (System.nanoTime() - t0) / 1e9
                JSONObject().put("http", code).put("bytes", n).put("kB_per_s", (n / 1024.0 / secs).toInt())
            }
            say("PASS — everything answered over Mandarin's own Tailscale connection.")
            // Keep the address that worked, for away from home.
            val known = Store.awayAddress(this)
            if (known == null || "${known.host}:${known.port}" != t) Store.setAwayTyped(this, "http://$t")
            Away.recheck(this)
        }
    }

    private fun get(url: String, token: String?): String {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 10_000; c.readTimeout = 20_000
        if (token != null) c.setRequestProperty("Authorization", "Bearer $token")
        try {
            val code = c.responseCode
            val body = (if (code >= 400) c.errorStream else c.inputStream)?.bufferedReader()?.readText() ?: ""
            if (code >= 400) throw IllegalStateException("HTTP $code $body")
            return body
        } finally {
            c.disconnect()
        }
    }

    /** One timed step, logged. Returns its result, or null if it failed. */
    private fun step(name: String, f: () -> JSONObject): JSONObject? {
        val t0 = System.nanoTime()
        return try {
            val r = f()
            val ms = (System.nanoTime() - t0) / 1_000_000
            val status = r.optInt("_status", 200)
            r.remove("_status")
            val ok = status < 400
            say("${if (ok) "ok  " else "FAIL"} $name — ${ms} ms  ${r.toString().take(300)}")
            if (ok) r else null
        } catch (e: Exception) {
            say("FAIL $name — ${e.javaClass.simpleName}: ${e.message}")
            null
        }
    }

    private fun run(name: String, f: () -> JSONObject) { work.execute { step(name, f) } }

    private fun say(s: String) {
        synchronized(lines) { lines.append(s).append('\n') }
        main.post { log.text = synchronized(lines) { lines.toString() } }
    }

    private fun copyLog() {
        work.execute {
            val engineLog = runCatching { TailscaleEngine.call("GET", "/log", timeoutMs = 4000).second }.getOrDefault("(no engine log)")
            val text = "Mandarin ${BuildConfig.VERSION_NAME} Tailscale test\n\n" + synchronized(lines) { lines.toString() } +
                "\n—— engine errors ——\n" + TailscaleEngine.stderrTail.joinToString("\n") +
                "\n—— engine log ——\n" + engineLog.takeLast(20_000)
            main.post {
                getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Mandarin Tailscale test", text))
                toast("Log copied")
            }
        }
    }

    // ------------------------------------------------------------ bits

    private fun button(t: String, onClick: () -> Unit) = Button(this).apply {
        text = t; isAllCaps = false
        setOnClickListener { onClick() }
    }
    private fun label(t: String) = TextView(this).apply { text = t; setTextColor(DIM); textSize = 13f; setPadding(0, px(14), 0, px(4)) }
    private fun note(t: String) = TextView(this).apply { text = t; setTextColor(FAINT); textSize = 13f; setPadding(0, px(8), 0, 0) }
    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()

    private companion object {
        const val BG = 0xFF0E1012.toInt()
        const val WHITE = 0xFFFFFFFF.toInt()
        const val DIM = 0xFFBFC7CE.toInt()
        const val FAINT = 0xFF6B737A.toInt()
    }
}
