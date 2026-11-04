package com.musicd.server.android

import android.content.Context
import android.net.wifi.WifiManager
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface

/** The network the renderer lives on: its own address, and leave to hear multicast. */
object Net {
    private var multicast: WifiManager.MulticastLock? = null

    /** The device's IPv4 address on the LAN (Wi-Fi first, then Ethernet, then any), or null with no network. */
    fun lanAddress(): InetAddress? {
        val ifaces = runCatching { NetworkInterface.getNetworkInterfaces()?.toList() }.getOrNull() ?: return null
        val up = ifaces.filter { runCatching { it.isUp && !it.isLoopback }.getOrDefault(false) }
        fun pick(f: (NetworkInterface) -> Boolean): InetAddress? = up.filter(f).flatMap { it.inetAddresses.toList() }
            .firstOrNull { it is Inet4Address && !it.isLoopbackAddress && !it.isLinkLocalAddress }
        return pick { it.name.startsWith("wlan") } ?: pick { it.name.startsWith("eth") } ?: pick { true }
    }

    /** The interface that carries [address], for multicast to leave by. */
    fun interfaceOf(address: InetAddress): NetworkInterface? = runCatching { NetworkInterface.getByInetAddress(address) }.getOrNull()

    /** Android drops multicast packets the apps haven't asked for: this asks, while the player runs. */
    @Synchronized
    fun holdMulticast(c: Context) {
        if (multicast != null) return
        val wm = c.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return
        multicast = wm.createMulticastLock("MandarinUsb:ssdp").apply { setReferenceCounted(false); acquire() }
    }

    @Synchronized
    fun releaseMulticast() {
        runCatching { multicast?.takeIf { it.isHeld }?.release() }
        multicast = null
    }
}
