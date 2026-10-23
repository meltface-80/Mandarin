package com.musicd.server.android

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import com.musicd.server.client.SoloistFiles
import com.musicd.server.client.SoloistSocket
import org.json.JSONObject
import java.io.File

/**
 * Soloist on the phone, running (bug list item 148, [SoloistPhone]): started under proot with its sound
 * coming to [SoloistPhoneSound] and its control socket read by [SoloistSocket]; what it says kept here for the
 * screen. Signed in for the first time (by the Spotify app, over the Wi-Fi), its account is asked for lossless and it is
 * started again to take that up, as the server does. [announce] also offers it on the Wi-Fi through Android's own
 * service discovery, in case Soloist's own announcement doesn't get out of the app.
 */
internal object SoloistPhoneRun {
    @Volatile private var process: Process? = null
    @Volatile var sound: SoloistPhoneSound? = null
    @Volatile private var socket: SoloistSocket? = null
    @Volatile var zeroconf = 0
    @Volatile var ws = 0
    @Volatile var signedIn: Boolean? = null
    @Volatile var status = ""
    @Volatile var active = false
    @Volatile var track = ""
    @Volatile var expires = ""
    @Volatile var announced = ""
    private var nsd: NsdManager.RegistrationListener? = null
    private var last: Triple<String, String, Boolean>? = null

    fun running() = process?.isAlive == true

    /** Soloist started (one at a time) as [name], with the Soloist key [key]. Not on the main thread. */
    @Synchronized
    fun start(c: Context, key: String, name: String, noSeccomp: Boolean) {
        stop()
        val app = c.applicationContext
        val program = SoloistPhone.soloist(app) ?: throw IllegalStateException("Soloist isn't downloaded yet")
        SoloistPhone.secret = key
        last = Triple(key, name, noSeccomp)
        File(SoloistPhone.root(app), "tmp/shim.log").delete()
        val s = SoloistPhoneSound().also { it.start() }
        val env = mapOf("PULSE_SHIM_OUT" to "tcp:127.0.0.1:${s.port}", "PULSE_SHIM_LOG" to "/tmp/shim.log",
            "PULSE_SHIM_LIFELINE" to "1", "PULSE_SHIM_HIDE" to "--api-key")
        val args = listOf("--device-name", name, "--api-key", key, "--data-dir", SoloistPhone.DATA, "--cache-dir", "/var/soloist/cache",
            "--initial-volume", "100", "--ws", "127.0.0.1:0")
        SoloistPhone.note("start: $program ${args.joinToString(" ")}${if (noSeccomp) " (PROOT_NO_SECCOMP)" else ""}")
        val p = SoloistPhone.command(app, program, args, env, noSeccomp).start()
        process = p; sound = s
        zeroconf = 0; ws = 0; signedIn = null; status = ""; active = false; track = ""
        Thread({
            runCatching { p.inputStream.bufferedReader().forEachLine { line(app, it) } }
            val code = runCatching { p.waitFor() }.getOrDefault(-1)
            SoloistPhone.note("soloist: ended, exit $code${SoloistPhone.signal(code)}")
            shimTail(app)
            if (process === p) { process = null; socket?.close(); socket = null; s.close(); unannounce(app) }
        }, "soloist-out").apply { isDaemon = true; start() }
    }

    private val ANSI = Regex("\u001B\\[[0-9;]*[A-Za-z]")

    private fun line(c: Context, raw: String) {
        val l = raw.replace(ANSI, "")
        SoloistPhone.note("soloist| $l")
        Regex("websocket server listening on [0-9.]+:(\\d+)").find(l)?.let { m ->
            ws = m.groupValues[1].toInt()
            Thread { connect(c, ws) }.start()
        }
        Regex("Started ZeroConf service on port (\\d+)").find(l)?.let { zeroconf = it.groupValues[1].toInt() }
        Regex("client expires in (\\d+) days").find(l)?.let { expires = it.groupValues[1] + " days" }
    }

    private fun connect(c: Context, port: Int) {
        val sk = runCatching { SoloistSocket(port, SoloistPhone::note) { event(c, it) } }
            .getOrElse { SoloistPhone.note("socket: couldn't connect (${it.message})"); return }
        socket = sk
        SoloistPhone.note("socket: connected on $port")
    }

    private fun event(c: Context, e: JSONObject) {
        when (e.optString("type")) {
            "auth_state" -> {
                val now = e.optBoolean("logged_in")
                if (signedIn != now) SoloistPhone.note("soloist: ${if (now) "signed in to Spotify" else "not signed in"}")
                signedIn = now
                if (now) Thread { lossless(c) }.start()
            }
            "playback_state" -> {
                status = e.optString("status"); active = e.optBoolean("is_active")
                e.optJSONObject("item")?.let { track = describe(it) }
                if (e.has("logged_in")) signedIn = e.optBoolean("logged_in")
            }
            "track_changed" -> e.optJSONObject("item")?.let { track = describe(it); SoloistPhone.note("soloist: now $track") }
            "playback_changed" -> { status = e.optString("status"); SoloistPhone.note("soloist: $status") }
            "device_changed" -> active = e.optBoolean("is_active")
            "error" -> SoloistPhone.note("soloist error: ${e.optString("message")}")
        }
    }

    private fun describe(item: JSONObject): String {
        val d = item.optJSONObject("decorations") ?: return item.optString("uri")
        val title = d.optJSONObject("identity")?.optString("name").orEmpty()
        val artist = d.optJSONArray("creators")?.optJSONObject(0)?.optJSONObject("entity")?.optJSONObject("decorations")?.optJSONObject("identity")?.optString("name").orEmpty()
        return listOf(artist, title).filter { it.isNotEmpty() }.joinToString(" — ")
    }

    /** An account just signed in asked for lossless; if that changed its prefs, Soloist started again to take it up. */
    private fun lossless(c: Context) {
        val changed = runCatching { SoloistFiles.askLossless(SoloistPhone.data(c)) }.getOrElse { SoloistPhone.note("lossless: couldn't write prefs (${it.message})"); false }
        if (!changed) return
        SoloistPhone.note("lossless: asked for on the account just signed in; starting Soloist again to take it up")
        val (key, name, noSeccomp) = last ?: return
        runCatching { start(c, key, name, noSeccomp) }.onFailure { SoloistPhone.note("lossless: couldn't start again (${it.message})") }
    }

    private fun shimTail(c: Context) {
        val f = File(SoloistPhone.root(c), "tmp/shim.log")
        if (!f.exists()) return
        f.readLines().takeLast(15).forEach { SoloistPhone.note("shim| $it") }
    }

    fun command(name: String, extra: Map<String, Any> = emptyMap()): Boolean {
        val s = socket ?: return false
        return runCatching { s.command(name, extra) }.isSuccess
    }

    @Synchronized
    fun stop() {
        val p = process ?: return
        process = null
        socket?.close(); socket = null
        runCatching { p.destroy(); if (!p.waitFor(3, java.util.concurrent.TimeUnit.SECONDS)) p.destroyForcibly() }
        sound?.close()
        SoloistPhone.note("stop: Soloist stopped")
    }

    /** Offered on the Wi-Fi by Android as a Spotify Connect device (_spotify-connect._tcp, its zeroconf port, CPath /zc). */
    fun announce(c: Context, name: String) {
        if (zeroconf == 0) { SoloistPhone.note("announce: Soloist hasn't said its zeroconf port yet"); return }
        unannounce(c)
        val info = NsdServiceInfo().apply {
            serviceName = name; serviceType = "_spotify-connect._tcp"; port = zeroconf
            setAttribute("CPath", "/zc"); setAttribute("VERSION", "1.0"); setAttribute("Stack", "SP")
        }
        val l = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(i: NsdServiceInfo) { announced = i.serviceName; SoloistPhone.note("announce: on the Wi-Fi as \"${i.serviceName}\" (port $zeroconf)") }
            override fun onRegistrationFailed(i: NsdServiceInfo, code: Int) { SoloistPhone.note("announce: failed ($code)") }
            override fun onServiceUnregistered(i: NsdServiceInfo) { announced = "" }
            override fun onUnregistrationFailed(i: NsdServiceInfo, code: Int) {}
        }
        nsd = l
        c.getSystemService(NsdManager::class.java).registerService(info, NsdManager.PROTOCOL_DNS_SD, l)
    }

    fun unannounce(c: Context) {
        val l = nsd ?: return
        nsd = null
        runCatching { c.getSystemService(NsdManager::class.java).unregisterService(l) }
    }
}
