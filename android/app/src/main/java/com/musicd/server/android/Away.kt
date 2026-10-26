package com.musicd.server.android

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.musicd.server.client.EngineIdle
import com.musicd.server.client.Route
import com.musicd.server.client.ServerAddress
import com.musicd.server.client.ServerId
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Home or away, followed as the phone's network changes.
 *
 * On the home Wi-Fi the app talks to the server on its home address. Off it —
 * mobile data, or someone else's Wi-Fi — it reaches the server over
 * MusicD's own Tailscale connection ([TailscaleEngine], signed in once on
 * Settings → System → Tailscale), and back again when the phone is home.
 * Away, the server offers only this phone to play on (no Sonos rooms), and
 * streams Opus 256 kbps; the whole library is there, not just downloads.
 *
 * If the phone hasn't signed in to MusicD's own connection, the Tailscale app
 * is asked instead with its own broadcast (the one Tasker uses); it doesn't
 * answer, so the only proof is the server answering on its Tailscale address.
 */
object Away {
    private const val TAG = "Away"
    private const val TAILSCALE = "com.tailscale.ipn"
    private const val TAILSCALE_RECEIVER = "com.tailscale.ipn.IPNReceiver"

    private val work = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val listeners = CopyOnWriteArrayList<(Boolean) -> Unit>()
    @Volatile private var watching = false
    /** The app, for a look at the way made on a timer ([lookAgain]). */
    @Volatile private var app: Context? = null
    @Volatile private var pending = false
    /** Tailscale was switched on by this app, so it may switch it off at home. */
    @Volatile private var weConnected = false

    /**
     * This run's first look at the way to the server (item 157): until it is made the way saved is the last run's — away
     * over the engine, 127.0.0.1:34500, after Android ended the app away from home — and every request failed on it.
     * Counted down once the way is decided and, over the engine, once it has been brought up (or tried).
     */
    private val firstLook = CountDownLatch(1)
    private val firstAsked = AtomicBoolean(false)
    /** MusicD's own Tailscale being brought up or put right, on its own thread ([repair]). */
    private val repairs = Executors.newSingleThreadExecutor()
    @Volatile private var repairing = false

    /** [l] hears `away` whenever it changes (on the main thread). */
    fun listen(l: (Boolean) -> Unit) { listeners += l }
    fun unlisten(l: (Boolean) -> Unit) { listeners -= l }

    /** Follow the phone's network from now on (once per process). */
    fun watch(context: Context) {
        val app = context.applicationContext
        this.app = app
        if (!watching) {
            watching = true
            val cm = app.getSystemService(ConnectivityManager::class.java)
            runCatching {
                cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                    override fun onAvailable(network: Network) = recheck(app)
                    // The Wi-Fi gone (walking out of the door): act now, not after the usual pause.
                    override fun onLost(network: Network) = recheck(app, soon = true)
                    override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = recheck(app)
                })
            }.onFailure { Log.w(TAG, "can't follow the network", it) }
            // The Wi-Fi too: poor, it can come and go while Android follows mobile data (item 127).
            HomeWifi.watch(app) { recheck(app, soon = true) }
        }
        // The first look at once (item 157): it used to wait the usual pause while the screens asked last run's way.
        if (firstLook.count > 0) lookFirst(app) else recheck(app)
    }

    private fun lookFirst(app: Context) { if (firstAsked.compareAndSet(false, true)) work.execute { check(app) } }

    /**
     * Before a request to the server (item 157): this run's first look at the way to it made, waited for up to [ms] —
     * and asked for now if nothing has (the player or a download starting the app with no screen). Blocking; on the main
     * thread it doesn't wait (nothing asks the server there).
     */
    fun awaitWay(c: Context, ms: Long = 6000) {
        if (firstLook.count == 0L || Looper.myLooper() == Looper.getMainLooper()) return
        lookFirst(c.applicationContext)
        runCatching { firstLook.await(ms, TimeUnit.MILLISECONDS) }
    }

    /** [check], then MusicD's own Tailscale's repair waited for, up to [ms] (the server looked for straight after). Blocking. */
    fun checkAndWait(c: Context, ms: Long = 20_000) {
        check(c)
        val until = System.currentTimeMillis() + ms
        while (repairing && System.currentTimeMillis() < until) runCatching { Thread.sleep(100) }
    }

    /**
     * Look again soon — changes come in bursts, so they're gathered for a
     * moment ([soon]: a lost network, gathered for less).
     */
    fun recheck(context: Context, soon: Boolean = false) {
        val app = context.applicationContext
        if (pending) {
            if (!soon) return
            main.removeCallbacks(pendingCheck ?: return)
        }
        pending = true
        val r = Runnable {
            pending = false
            work.execute { check(app) }
        }
        pendingCheck = r
        main.postDelayed(r, if (soon) 300L else 1500L)
    }
    @Volatile private var pendingCheck: Runnable? = null

    /**
     * A network the server could be reached over: Wi-Fi, Ethernet or mobile
     * data. A VPN alone doesn't count — another VPN app left on keeps a
     * "network" up with nothing under it (airplane mode, no SIM).
     */
    @Suppress("DEPRECATION")
    fun hasNetwork(c: Context): Boolean = runCatching {
        val cm = c.getSystemService(ConnectivityManager::class.java)
        cm.allNetworks.any { n ->
            val caps = cm.getNetworkCapabilities(n) ?: return@any false
            !caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) &&
                (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ||
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR))
        }
    }.getOrDefault(true)

    /** Where we are now, decided and stored. Blocking; not on the main thread. */
    @Synchronized
    fun check(c: Context): Boolean {
        val home = Store.server(c) ?: return looked(false)
        // No network at all: nothing to reach, so nothing is tried — before
        // v0.5.56 this started, rejoined and restarted Tailscale for minutes,
        // holding up every other look at the way to the server meanwhile.
        if (!hasNetwork(c)) return looked(Store.isAway(c))
        // Offline mode: the server isn't reached for, so no Tailscale either.
        if (Store.offlineMode(c)) return looked(Store.isAway(c))
        val awayAt = Store.awayAddress(c)
        val wasAway = Store.isAway(c)
        val wasEngine = Store.viaEngine(c)
        val wifi = onWifi(c)
        // Off Wi-Fi with a VPN up (another VPN into the home network, v0.6.16): the
        // home address is tried too, and used if it answers through it.
        val vpn = !wifi && onVpn(c)
        // Asked over the Wi-Fi: Android may be sending what it can over mobile data (item 127). Home till now and on its
        // Wi-Fi, three looks a second apart before going (item 157): one slow answer sent the phone away, at home.
        val homeAnswers = (wifi || vpn) && homeAnswers(home, Route.looksBeforeAway(wasAway, wifi), if (wifi) HomeWifi.network(c) else null, Store.serverId(c))
        // Away over MusicD's own Tailscale connection once the phone is signed in to it — the whole library,
        // streamed as Opus by the server, no Tailscale app needed — whether its engine is up yet or not.
        val ownSignedIn = TailscaleEngine.signedIn(c)
        val way = Route.way(wifi, homeAnswers, vpn, awayAddress = awayAt != null, ownSignedIn = ownSignedIn)
        val away = way.away
        HomeWifi.follow(c, Route.overWifi(away, wifi))

        val wasRunning = TailscaleEngine.alive()
        // The phone's addresses changed: the engine finds its way on the new network.
        if (wasRunning) TailscaleEngine.sendInterfaces()
        // The way taken at once, before it is connected (item 118): the screens and the player stop asking an address
        // the phone has left (the home one, off the Wi-Fi) while the way away comes up, which took 20 s and more.
        Store.setViaEngine(c, way.viaEngine)
        if (away != wasAway || way.viaEngine != wasEngine) {
            Log.i(TAG, if (away) "away: using ${Store.awayBase(c)}" else "home: using $home")
            Store.setAway(c, away)
            tell(away)
        }

        if (away && way.viaEngine && awayAt != null) {
            // Its engine joined and forwarding, on its own thread (item 157: this look held every other one — coming
            // home among them — for as long as a repair took, a minute and more).
            repair(c, "${awayAt.host}:${awayAt.port}", wasRunning)
        } else if (away && awayAt != null && !answers(awayAt, 3000)) {
            if (!tailscaleApp(c)) {
                // Neither MusicD's own Tailscale signed in nor the Tailscale app here: nothing more to try (item 157:
                // fifteen seconds of it, every twenty, for twelve minutes, holding up every other look meanwhile).
                AppLog.line("REACH", "away, and this phone isn't signed in to Tailscale: Settings → Away → Tailscale", anomaly = true)
            } else {
                // Not signed in to MusicD's own: ask the Tailscale app, then give it a little while.
                if (tailscale(c, connect = true)) weConnected = true
                val until = System.currentTimeMillis() + 15_000
                var ok = false
                while (!ok && System.currentTimeMillis() < until) {
                    try { Thread.sleep(1500) } catch (e: InterruptedException) { return looked(wasAway) }
                    ok = answers(awayAt, 3000)
                }
                if (ok) tell(away) else Log.i(TAG, "the server isn't answering on $awayAt either")
            }
        }
        if (!away) {
            // Home: the engine is kept only while the phone's player is playing, and stopped once it has been idle
            // a while (item 202, [engineAtHome]).
            if (homeAnswers && weConnected) {
                // Tailscale goes off if this app turned it on.
                tailscale(c, connect = false)
                weConnected = false
            }
        }
        if (!away && awayAt != null) engineAtHome(c, "${awayAt.host}:${awayAt.port}") else engineIdle.verdict(away = true, inUse = true)
        // Over the engine the first look is over once it has been brought up ([repair]).
        return if (away && way.viaEngine && awayAt != null) away else looked(away)
    }

    /** This run's first look made (item 157): the requests waiting on it go. */
    private fun looked(away: Boolean): Boolean { firstLook.countDown(); return away }

    /**
     * MusicD's own Tailscale joined and forwarding to [target] (come up again after the app was restarted, or afresh
     * after a stall), on its own thread: one at a time, and moot once a newer look has found the phone home. The
     * screens look for the server on it at once when it comes up.
     */
    private fun repair(c: Context, target: String, wasRunning: Boolean) {
        if (repairing) return
        repairing = true
        repairs.execute {
            try {
                if (Store.isAway(c) && Store.viaEngine(c)) {
                    if (TailscaleEngine.connectAway(c, target)) { if (!wasRunning) tell(true) }
                    else Log.i(TAG, "own Tailscale connection not up yet")
                }
            } finally {
                repairing = false
                firstLook.countDown()
            }
        }
    }

    /** The home address answering, asked up to [looks] times a second apart (item 157). */
    private fun homeAnswers(home: ServerAddress, looks: Int, over: Network?, kept: String?): Boolean {
        for (i in 1..looks) {
            if (answers(home, 1500, over, kept)) return true
            if (i < looks) try { Thread.sleep(1000) } catch (e: InterruptedException) { return false }
        }
        return false
    }

    /** The Tailscale app is on this phone (the manifest's queries let it be seen). */
    private fun tailscaleApp(c: Context): Boolean =
        runCatching { c.packageManager.getPackageInfo(TAILSCALE, 0); true }.getOrDefault(false)

    /** The listeners told the way now ([away]): changed, or come up (the screens look for the server on it again). */
    private fun tell(away: Boolean) { main.post { for (l in listeners) runCatching { l(away) } } }

    private val engineIdle = EngineIdle { SystemClock.elapsedRealtime() }

    /**
     * At home, the engine's fate (item 202): kept joined and forwarding while the phone's player is playing, so that
     * walking out keeps the music going; otherwise stopped once it has been idle for the grace. Before, it was kept for
     * as long as the app's process lived, and on 26 Oct Android ended the app for the engine's CPU while both sat in
     * the background. The next look is made on a timer, since nothing else need happen at home.
     */
    private fun engineAtHome(c: Context, target: String) {
        val playing = runCatching { PhonePlayerService.current?.offlineState()?.state == "playing" }.getOrDefault(false)
        when (engineIdle.verdict(away = false, inUse = playing)) {
            EngineIdle.Verdict.KEEP -> { keepReady(c, target); lookAgain(5 * 60_000L) }
            EngineIdle.Verdict.WAIT -> if (TailscaleEngine.alive()) lookAgain(engineIdle.remaining() + 500)
            EngineIdle.Verdict.STOP -> if (TailscaleEngine.alive()) TailscaleEngine.stop("idle at home for ${EngineIdle.GRACE_MS / 60_000} min")
        }
    }

    private val lookAgainRun = Runnable { app?.let { a -> work.execute { check(a) } } }

    /** The way looked at again in [inMs], once however often asked. */
    private fun lookAgain(inMs: Long) { main.removeCallbacks(lookAgainRun); main.postDelayed(lookAgainRun, inMs) }

    /**
     * MusicD's own Tailscale connection joined and its way to the server open, but unused, so the moment the Wi-Fi
     * goes the way away is already there. Only for a phone signed in to it; at home only while the phone plays
     * ([engineAtHome], item 202).
     */
    private fun keepReady(c: Context, target: String) {
        if (!TailscaleEngine.signedIn(c)) return
        if (TailscaleEngine.ready(target)) return
        // On its own thread: joining can take a few seconds, and the next check mustn't wait for it.
        warming.execute {
            runCatching { TailscaleEngine.prepare(c, target) }.onFailure { Log.i(TAG, "couldn't keep Tailscale ready: ${it.message}") }
        }
    }
    private val warming = Executors.newSingleThreadExecutor()

    /**
     * Before a download or a stream away: the way to the server is up. After the
     * app's process has been restarted the engine isn't running yet, so this
     * brings it back. Blocking; not on the main thread.
     */
    fun ensureRoute(c: Context) {
        if (Store.offlineMode(c)) return
        if (!Store.isAway(c) || !Store.viaEngine(c)) return
        val awayAt = Store.awayAddress(c) ?: return
        if (TailscaleEngine.alive() && answers(Store.awayBase(c) ?: return, 4000)) return
        if (!TailscaleEngine.connectAway(c, "${awayAt.host}:${awayAt.port}")) check(c)
    }

    /**
     * Away over the Tailscale app's address with no VPN up yet: nothing is sent (item 159). The address (100.x) is the
     * carriers' own range on mobile data too, and the app's sign-in went with every request before the Tailscale app
     * was connected. Blocking callers only.
     */
    fun notBeforeVpn(c: Context) {
        if (Store.isAway(c) && !Store.viaEngine(c) && !onVpn(c)) throw java.io.IOException("waiting for Tailscale to connect")
    }

    /** A VPN is up (another VPN app; MusicD's own Tailscale isn't one). */
    @Suppress("DEPRECATION")
    private fun onVpn(c: Context): Boolean {
        val cm = c.getSystemService(ConnectivityManager::class.java) ?: return false
        return runCatching {
            cm.allNetworks.any { n -> cm.getNetworkCapabilities(n)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true }
        }.getOrDefault(false)
    }

    /** On Wi-Fi or Ethernet (a VPN on top of it counts; mobile data doesn't). */
    private fun onWifi(c: Context): Boolean = HomeWifi.network(c) != null

    /**
     * The server answering at [a], asked [over] a network of its own (the Wi-Fi) or wherever Android sends it: its
     * /api/ping (item 157: answered at once, whatever the server is busy with), or /api/health on a server from before it.
     */
    private fun answers(a: ServerAddress, timeoutMs: Int, over: Network? = null, kept: String? = null): Boolean {
        val (code, body) = ask(a.baseUrl + "/api/ping", timeoutMs, over)
        // Answered, and as this phone's own server ([kept], item 158), not another at the same address.
        if (code == 200) return ServerId.ours(kept, ServerId.of(body)).also { if (!it) AppLog.line("REACH", "the home address answered as another server: not home", anomaly = true) }
        return code == 404 && ask(a.baseUrl + "/api/health", timeoutMs, over).first == 200
    }

    /** [url] asked: its status, and its body when 200 (-1 when nothing answered). Blocking. */
    private fun ask(url: String, timeoutMs: Int, over: Network? = null): Pair<Int, String?> = runCatching {
        val u = URL(url)
        val conn = (over?.openConnection(u) ?: u.openConnection()) as HttpURLConnection
        conn.connectTimeout = timeoutMs
        conn.readTimeout = timeoutMs
        try { val code = conn.responseCode; code to (if (code == 200) conn.inputStream.bufferedReader().use { it.readText() } else null) } finally { conn.disconnect() }
    }.getOrDefault(-1 to null)

    /**
     * This phone's server's id kept (item 158) once its sign-in has been taken there: asked of [base] when none is kept
     * yet, so that later another server at the home address isn't taken for home. Blocking.
     */
    fun learnId(c: Context, base: String) {
        if (Store.serverId(c) != null) return
        val id = ServerId.of(ask("$base/api/ping", 3000).second) ?: return
        if (runCatching { Store.client(c)?.getJson("/api/status") }.getOrNull() != null) Store.setServerId(c, id)
    }

    /** The server answering on the way in use now is this phone's own (or there is nothing to tell by). Blocking. */
    fun stillOurs(c: Context): Boolean {
        val base = Store.active(c)?.baseUrl ?: return true
        return ServerId.ours(Store.serverId(c), ServerId.of(ask("$base/api/ping", 3000).second))
    }

    private fun tailscale(c: Context, connect: Boolean): Boolean = runCatching {
        c.sendBroadcast(Intent(if (connect) "$TAILSCALE.CONNECT_VPN" else "$TAILSCALE.DISCONNECT_VPN")
            .setClassName(TAILSCALE, TAILSCALE_RECEIVER))
        true
    }.getOrElse { Log.i(TAG, "couldn't ask Tailscale: ${it.message}"); false }
}
