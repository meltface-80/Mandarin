package com.musicd.server.android

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.musicd.server.client.Route
import com.musicd.server.client.ServerAddress
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors

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
    @Volatile private var pending = false
    /** Tailscale was switched on by this app, so it may switch it off at home. */
    @Volatile private var weConnected = false

    /** [l] hears `away` whenever it changes (on the main thread). */
    fun listen(l: (Boolean) -> Unit) { listeners += l }
    fun unlisten(l: (Boolean) -> Unit) { listeners -= l }

    /** Follow the phone's network from now on (once per process). */
    fun watch(context: Context) {
        val app = context.applicationContext
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
        }
        recheck(app)
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
        val home = Store.server(c) ?: return false
        // No network at all: nothing to reach, so nothing is tried — before
        // v0.5.56 this started, rejoined and restarted Tailscale for minutes,
        // holding up every other look at the way to the server meanwhile.
        if (!hasNetwork(c)) return Store.isAway(c)
        // Offline mode: the server isn't reached for, so no Tailscale either.
        if (Store.offlineMode(c)) return Store.isAway(c)
        val awayAt = Store.awayAddress(c)
        val wasAway = Store.isAway(c)
        val wasEngine = Store.viaEngine(c)
        val wifi = onWifi(c)
        // Off Wi-Fi with a VPN up (another VPN into the home network, v0.6.16): the
        // home address is tried too, and used if it answers through it.
        val vpn = !wifi && onVpn(c)
        val homeAnswers = (wifi || vpn) && answers(home, 1500)
        var away = Route.away(wifi, homeAnswers, vpn)

        // Away: MusicD's own Tailscale connection first — the whole library,
        // streamed as Opus by the server, no Tailscale app needed.
        var engine = false
        val wasRunning = TailscaleEngine.alive()
        // The phone's addresses changed: the engine finds its way on the new network.
        if (wasRunning) TailscaleEngine.sendInterfaces()
        if (away && awayAt != null) {
            engine = TailscaleEngine.connectAway(c, "${awayAt.host}:${awayAt.port}")
            if (!engine) Log.i(TAG, "own Tailscale connection not up; trying the Tailscale app")
        }
        Store.setViaEngine(c, engine)

        if (away && !engine && awayAt != null && !answers(awayAt, 3000)) {
            // Not through yet: ask the Tailscale app, then give it a little while.
            if (tailscale(c, connect = true)) weConnected = true
            val until = System.currentTimeMillis() + 15_000
            var ok = false
            while (!ok && System.currentTimeMillis() < until) {
                try { Thread.sleep(1500) } catch (e: InterruptedException) { return wasAway }
                ok = answers(awayAt, 3000)
            }
            if (!ok) Log.i(TAG, "the server isn't answering on $awayAt either")
        }
        if (!away) {
            // Home: the engine stays joined, idle, so leaving the house needn't
            // wait for it to start (see [keepReady] below).
            if (homeAnswers && weConnected) {
                // Tailscale goes off if this app turned it on.
                tailscale(c, connect = false)
                weConnected = false
            }
        }
        // Away needs a way to the server; without one it's the phone's downloads (offline).
        away = away && (engine || awayAt != null)
        // (Also when the engine has just come up again after the app was restarted: the page reloads onto it.)
        if (away != wasAway || engine != wasEngine || (engine && !wasRunning)) {
            Log.i(TAG, if (away) "away: using ${Store.awayBase(c)}" else "home: using $home")
            Store.setAway(c, away)
            main.post { for (l in listeners) runCatching { l(away) } }
        }
        if (!away && awayAt != null) keepReady(c, "${awayAt.host}:${awayAt.port}")
        return away
    }

    /**
     * At home: MusicD's own Tailscale connection joined and its way to the
     * server open, but unused — so the moment the Wi-Fi goes, the way away is
     * already there. Idle, it costs little; it ends with the app's process.
     * Only for a phone signed in to it.
     */
    private fun keepReady(c: Context, target: String) {
        if (!TailscaleEngine.installed(c) || !TailscaleEngine.signedInBefore(c)) return
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

    /** A VPN is up (another VPN app; MusicD's own Tailscale isn't one). */
    @Suppress("DEPRECATION")
    private fun onVpn(c: Context): Boolean {
        val cm = c.getSystemService(ConnectivityManager::class.java) ?: return false
        return runCatching {
            cm.allNetworks.any { n -> cm.getNetworkCapabilities(n)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true }
        }.getOrDefault(false)
    }

    /** On Wi-Fi or Ethernet (a VPN on top of it counts; mobile data doesn't). */
    @Suppress("DEPRECATION")
    private fun onWifi(c: Context): Boolean {
        val cm = c.getSystemService(ConnectivityManager::class.java) ?: return false
        return runCatching {
            cm.allNetworks.any { n ->
                val caps = cm.getNetworkCapabilities(n) ?: return@any false
                !caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) &&
                    (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
            }
        }.getOrDefault(false)
    }

    private fun answers(a: ServerAddress, timeoutMs: Int): Boolean = runCatching {
        val conn = URL(a.baseUrl + "/api/health").openConnection() as HttpURLConnection
        conn.connectTimeout = timeoutMs
        conn.readTimeout = timeoutMs
        try { conn.responseCode == 200 } finally { conn.disconnect() }
    }.getOrDefault(false)

    private fun tailscale(c: Context, connect: Boolean): Boolean = runCatching {
        c.sendBroadcast(Intent(if (connect) "$TAILSCALE.CONNECT_VPN" else "$TAILSCALE.DISCONNECT_VPN")
            .setClassName(TAILSCALE, TAILSCALE_RECEIVER))
        true
    }.getOrElse { Log.i(TAG, "couldn't ask Tailscale: ${it.message}"); false }
}
