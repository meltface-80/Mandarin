package com.musicd.server.android

import android.content.Context
import com.musicd.server.client.ServerAddress
import com.musicd.server.client.ServerClient

/**
 * What the app remembers: which server, this phone's sign-in to it, and the
 * last room. The sign-in token is kept per server, in the app's private
 * storage, and is dropped when the server changes.
 *
 * Away from home the same server is reached on its Tailscale address (see
 * [Away]); the sign-in is the same one, so it belongs to the home address.
 */
object Store {
    private const val PREFS = "musicd"
    private const val KEY_HOST = "host"
    private const val KEY_PORT = "port"
    private const val KEY_ZONE = "zone"
    private const val KEY_TOKEN = "token"
    private const val KEY_TOKEN_FOR = "token_for"
    private const val KEY_USER = "username"
    private const val KEY_AWAY_LEARNED = "away_learned"
    private const val KEY_AWAY_TYPED = "away_typed"
    private const val KEY_AWAY_NOW = "away_now"
    private const val KEY_DSP = "dsp"
    private const val KEY_LOCAL_FOLDER = "local_folder"

    fun server(context: Context): ServerAddress? {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val host = p.getString(KEY_HOST, null) ?: return null
        val port = p.getInt(KEY_PORT, ServerAddress.DEFAULT_PORT)
        return ServerAddress(host, port)
    }

    fun setServer(context: Context, address: ServerAddress) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_HOST, address.host)
            .putInt(KEY_PORT, address.port)
            .apply()
    }

    /** This phone's sign-in to the current server, or null. */
    fun token(context: Context): String? {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val server = server(context)?.toString() ?: return null
        return if (p.getString(KEY_TOKEN_FOR, null) == server) p.getString(KEY_TOKEN, null) else null
    }

    fun username(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_USER, null)

    fun setToken(context: Context, token: String?, username: String? = null) {
        val e = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        if (token == null) e.remove(KEY_TOKEN).remove(KEY_TOKEN_FOR)
        else e.putString(KEY_TOKEN, token).putString(KEY_TOKEN_FOR, server(context)?.toString())
        if (username != null) e.putString(KEY_USER, username)
        e.apply()
    }

    /** The phone's DSP setting as the server last sent it (JSON), kept so it applies offline too. */
    fun dsp(context: Context): String? = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_DSP, null)
    fun setDsp(context: Context, json: String?) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().apply { if (json == null) remove(KEY_DSP) else putString(KEY_DSP, json) }.apply()
    }

    /** The folder of music files on the phone (a document tree URI), chosen in Settings → Downloads. */
    /** USB direct (Stage 9): play through the app's own USB driver when a DAC is on the port. */
    fun usbDirect(context: Context): Boolean = prefs(context).getBoolean("usb_direct", false)
    fun setUsbDirect(context: Context, on: Boolean) { prefs(context).edit().putBoolean("usb_direct", on).apply() }
    /** The DAC's USB volume as last set (0–100), or -1 when it has never been set: the driver then starts low. */
    fun usbVolume(context: Context): Int = prefs(context).getInt("usb_volume", -1)
    fun setUsbVolume(context: Context, pct: Int) { prefs(context).edit().putInt("usb_volume", pct.coerceIn(0, 100)).apply() }
    /**
     * Fixed volume with USB direct: the DAC at full, the amplifier's knob for
     * the level. Unset, it follows the DAC: fixed for one with no USB volume
     * control, the slider for one with (the DragonFly).
     */
    fun usbFixed(context: Context, default: Boolean): Boolean =
        prefs(context).let { if (it.contains("usb_fixed")) it.getBoolean("usb_fixed", default) else default }
    fun setUsbFixed(context: Context, on: Boolean) { prefs(context).edit().putBoolean("usb_fixed", on).apply() }
    /** The most the USB volume may be set to (0–100), so a DAC on headphones can never be driven to full. */
    fun usbLimit(context: Context): Int = prefs(context).getInt("usb_limit", 80).coerceIn(1, 100)
    fun setUsbLimit(context: Context, pct: Int) { prefs(context).edit().putInt("usb_limit", pct.coerceIn(1, 100)).apply() }

    fun localFolder(context: Context): String? = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_LOCAL_FOLDER, null)
    fun setLocalFolder(context: Context, uri: String?) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().apply { if (uri == null) remove(KEY_LOCAL_FOLDER) else putString(KEY_LOCAL_FOLDER, uri) }.apply()
    }

    fun lastPort(context: Context): Int =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_PORT, ServerAddress.DEFAULT_PORT)

    fun zone(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_ZONE, null)

    fun setZone(context: Context, zoneId: String?) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_ZONE, zoneId).apply()
    }

    // ------------------------------------------------------------ away

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** The server's Tailscale address: typed on the connect screen, else as the server said. */
    fun awayAddress(context: Context): ServerAddress? {
        val p = prefs(context)
        val s = p.getString(KEY_AWAY_TYPED, null) ?: p.getString(KEY_AWAY_LEARNED, null) ?: return null
        return ServerAddress.fromUrl(s)
    }

    fun awayTyped(context: Context): String? = prefs(context).getString(KEY_AWAY_TYPED, null)

    fun setAwayTyped(context: Context, url: String?) {
        prefs(context).edit().apply { if (url.isNullOrBlank()) remove(KEY_AWAY_TYPED) else putString(KEY_AWAY_TYPED, url) }.apply()
    }

    fun setAwayLearned(context: Context, url: String?) {
        if (url == prefs(context).getString(KEY_AWAY_LEARNED, null)) return
        prefs(context).edit().apply { if (url.isNullOrBlank()) remove(KEY_AWAY_LEARNED) else putString(KEY_AWAY_LEARNED, url) }.apply()
    }

    /** Away from home right now (and there's an away address to use). */
    fun isAway(context: Context): Boolean =
        prefs(context).getBoolean(KEY_AWAY_NOW, false) && (awayAddress(context) != null || viaEngine(context))

    /** Away through the app's own Tailscale connection (127.0.0.1:34500), not the Tailscale app. */
    fun viaEngine(context: Context): Boolean = prefs(context).getBoolean("away_engine", false)

    fun setViaEngine(context: Context, on: Boolean) {
        if (viaEngine(context) != on) prefs(context).edit().putBoolean("away_engine", on).apply()
    }

    /** Where the server is away from home: the app's own connection, or its Tailscale address. */
    fun awayBase(context: Context): ServerAddress? =
        if (viaEngine(context)) ServerAddress("127.0.0.1", TailscaleEngine.PORT) else awayAddress(context)

    fun setAway(context: Context, away: Boolean) {
        prefs(context).edit().putBoolean(KEY_AWAY_NOW, away).apply()
    }

    /** The address to use now: home, or the Tailscale one away. */
    fun active(context: Context): ServerAddress? =
        if (isAway(context)) awayBase(context) else server(context)

    /** Would a track starting now be played as the server's Opus (away, with Opus chosen)? */
    fun wantsOpus(context: Context): Boolean =
        isAway(context) && DownloadStore.settings(context).awayQuality == DownloadStore.QUALITY_OPUS

    /**
     * A server address (stream, cover) moved to the address in use now.
     * [opus]: the format a track is held to (it started that way); null — as a
     * track starting now would be.
     */
    fun localize(context: Context, url: String, opus: Boolean? = null): String {
        val home = server(context)?.baseUrl ?: return url
        return com.musicd.server.client.Route.rewrite(url, home, awayBase(context)?.baseUrl, isAway(context),
            opus = opus ?: (DownloadStore.settings(context).awayQuality == DownloadStore.QUALITY_OPUS),
            keepOpus = opus == true)
    }

    /** This phone's zone id on the server ("PHONE_…"), as its last hello said. */
    fun phoneZone(context: Context): String =
        prefs(context).getString("phone_zone", null) ?: "PHONE_offline"

    fun setPhoneZone(context: Context, zoneId: String) {
        if (prefs(context).getString("phone_zone", null) != zoneId) prefs(context).edit().putString("phone_zone", zoneId).apply()
    }

    /** A client for the server, signed in — null until both are known. */
    fun client(context: Context): ServerClient? {
        val address = active(context) ?: return null
        val token = token(context) ?: return null
        return ServerClient(address, token = token)
    }
}
