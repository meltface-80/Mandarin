package com.musicd.server.android

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log

/**
 * Home over the Wi-Fi (bug list item 127). With the Wi-Fi still up but judged poor, Android sends new connections
 * over mobile data, which can't reach the server's home address: on 22 October at 06:48 every new request failed for
 * half a minute ("failed to connect to /…:3500 from /192.0.0.4", mobile data's address) while those already open on
 * the Wi-Fi went on answering, and the app stayed home, rightly. So at home on the Wi-Fi the app's connections are
 * tied to it (the screens', the player's streams, downloads); away, or the Wi-Fi gone, they are let go at once.
 * Which way is [com.musicd.server.client.Route.overWifi]'s; [Away] says when.
 */
internal object HomeWifi {
    private const val TAG = "HomeWifi"
    @Volatile private var bound: Network? = null

    /** The Wi-Fi (or Ethernet) network the phone is on, if any: not a VPN. */
    @Suppress("DEPRECATION")
    fun network(c: Context): Network? = runCatching {
        val cm = c.getSystemService(ConnectivityManager::class.java) ?: return null
        cm.allNetworks.firstOrNull { n ->
            val caps = cm.getNetworkCapabilities(n) ?: return@firstOrNull false
            !caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) &&
                (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
        }
    }.getOrNull()

    /** The app's connections over the Wi-Fi ([on]), or wherever Android sends them. */
    fun follow(c: Context, on: Boolean) {
        val cm = c.getSystemService(ConnectivityManager::class.java) ?: return
        val want = if (on) network(c) else null
        if (want == bound) return
        if (!runCatching { cm.bindProcessToNetwork(want) }.getOrDefault(false)) { Log.i(TAG, "couldn't tie the app to the Wi-Fi"); return }
        bound = want
        AppLog.line("REACH", if (want != null) "the app's connections go over the Wi-Fi (home)" else "the app's connections go wherever Android sends them")
    }

    /** Follow the Wi-Fi itself, which isn't always the network Android follows: [changed] when it comes or goes. */
    fun watch(c: Context, changed: () -> Unit) {
        val cm = c.getSystemService(ConnectivityManager::class.java) ?: return
        val wifi = NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build()
        runCatching {
            cm.registerNetworkCallback(wifi, object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) = changed()
                override fun onLost(network: Network) {
                    // Tied to a Wi-Fi that is gone, nothing would reach anywhere: let go now, then look again.
                    if (network == bound) follow(c, false)
                    changed()
                }
            })
        }.onFailure { Log.w(TAG, "can't follow the Wi-Fi", it) }
    }
}
