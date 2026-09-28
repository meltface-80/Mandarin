package com.musicd.server.android

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.NetworkInterface
import java.net.URL
import java.security.SecureRandom

/**
 * MusicD's own Tailscale connection on the phone: the engine in
 * android/musicdnet, shipped in the APK as libmusicdnet.so and run as a
 * separate program (the way Syncthing for Android runs its engine). It joins
 * your tailnet as the phone — no VPN, no Tailscale app — and gives the app a
 * port on 127.0.0.1 that leads to the server.
 *
 * The app talks to it over HTTP on 127.0.0.1 with a secret only the two of
 * them know. It stops when the app's process does (it watches its stdin).
 *
 * Test build: used only by the Tailscale test screen for now.
 */
object TailscaleEngine {
    private const val TAG = "TailscaleEngine"

    private var process: Process? = null
    private var port = 0
    private var secret = ""

    /** The engine's last few error-output lines (a crash says why here). */
    val stderrTail = java.util.concurrent.ConcurrentLinkedDeque<String>()

    private fun binary(c: Context) = File(c.applicationInfo.nativeLibraryDir, "libmusicdnet.so")

    fun installed(c: Context) = binary(c).exists()

    /** Start the engine if it isn't running. Blocking; not on the main thread. */
    @Synchronized
    fun ensureRunning(c: Context) {
        process?.let { if (it.isAlive) return }
        val bin = binary(c)
        if (!bin.exists()) throw IllegalStateException("The Tailscale engine isn't in this build (${bin.path})")
        val bytes = ByteArray(24).also { SecureRandom().nextBytes(it) }
        secret = bytes.joinToString("") { "%02x".format(it) }
        val dir = File(c.filesDir, "tailscale").apply { mkdirs() }
        val pb = ProcessBuilder(bin.path, "-dir", dir.path).redirectErrorStream(false)
        pb.environment()["MUSICDNET_SECRET"] = secret
        pb.environment()["HOME"] = dir.path
        pb.environment()["TMPDIR"] = c.cacheDir.path
        val p = pb.start()
        // First line: "CONTROL <port>".
        val line = p.inputStream.bufferedReader().readLine()
            ?: throw IllegalStateException("The engine didn't start: " + p.errorStream.bufferedReader().readText().take(500))
        port = line.removePrefix("CONTROL ").trim().toInt()
        process = p
        // Keep its error output flowing (a full pipe would stall it), and the tail of it.
        Thread({
            runCatching {
                p.errorStream.bufferedReader().forEachLine {
                    stderrTail.addLast(it)
                    while (stderrTail.size > 50) stderrTail.pollFirst()
                }
            }
        }, "musicdnet-stderr").apply { isDaemon = true; start() }
        Log.i(TAG, "engine running, control port $port")
        sendInterfaces()
    }

    @Synchronized
    fun stop() {
        process?.let { runCatching { it.outputStream.close() }; it.destroy() }
        process = null
    }

    /** The phone's network interfaces, for the engine (Android 11+ won't let it list them itself). */
    fun sendInterfaces() {
        val sb = StringBuilder()
        runCatching {
            for (ni in NetworkInterface.getNetworkInterfaces().toList()) {
                val flags = ArrayList<String>()
                if (ni.isUp) flags += "up"
                if (ni.isLoopback) flags += "loopback"
                if (ni.supportsMulticast()) flags += "multicast"
                if (flags.isEmpty()) flags += "none"
                val addrs = ni.interfaceAddresses.mapNotNull { ia ->
                    val a = ia.address ?: return@mapNotNull null
                    val host = when (a) {
                        is Inet6Address -> a.hostAddress?.substringBefore('%')
                        is Inet4Address -> a.hostAddress
                        else -> null
                    } ?: return@mapNotNull null
                    "$host/${ia.networkPrefixLength}"
                }
                sb.append(ni.name).append(' ').append(ni.index).append(' ').append(runCatching { ni.mtu }.getOrDefault(1500))
                    .append(' ').append(flags.joinToString("|")).append(' ').append(addrs.joinToString(",")).append('\n')
            }
        }
        runCatching { call("POST", "/interfaces", sb.toString()) }
    }

    /** One call to the engine. Returns (HTTP status, body). Blocking. */
    fun call(method: String, path: String, body: String? = null, timeoutMs: Int = 15_000): Pair<Int, String> {
        val c = URL("http://127.0.0.1:$port$path").openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = 3000
        c.readTimeout = timeoutMs
        c.setRequestProperty("X-Secret", secret)
        if (body != null) {
            c.doOutput = true
            c.outputStream.use { it.write(body.toByteArray()) }
        }
        try {
            val code = c.responseCode
            val text = (if (code >= 400) c.errorStream else c.inputStream)?.bufferedReader()?.readText() ?: ""
            return code to text
        } finally {
            c.disconnect()
        }
    }

    fun json(method: String, path: String, body: String? = null, timeoutMs: Int = 15_000): JSONObject {
        val (code, text) = call(method, path, body, timeoutMs)
        val j = runCatching { JSONObject(text) }.getOrDefault(JSONObject().put("error", text))
        return j.put("_status", code)
    }
}
