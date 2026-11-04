package com.musicd.server.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.Renderer as Media3Renderer
import androidx.media3.exoplayer.audio.AudioRendererEventListener
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.audio.ForwardingAudioSink
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorsFactory
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.InetAddress

/**
 * The renderer: this device as a UPnP MediaRenderer on the network, playing
 * what it is sent through Mandarin's USB driver and nothing else.
 *
 * ExoPlayer plays each URI with Mandarin's sinks under it — [DspSink] turning
 * every decode into float (the DSP off, no gain: untouched), [UsbAudioSink]
 * packing it for the DAC at the track's own rate and depth, or passing DSD
 * to it natively or as DoP. Where Mandarin's app would fall back to
 * Android's mixer (no DAC on the port, a format it doesn't take), this one
 * refuses ([UsbOnly]): the track stops with ERROR_OCCURRED and a reason on
 * the screen, and plays on by itself when a DAC is plugged in.
 *
 * What the DAC takes is what the renderer advertises ([sink]): a raw-PCM
 * entry per rate, so a control point that reads rates from ProtocolInfo
 * (Mandarin does) has them all, the containers Mandarin sends, and DSD where
 * the DAC takes it. Everything, with what plays now, is at /dac.json too.
 * A DAC plugged in or taken out changes the description's address, so a
 * control point that caches descriptions by address reads it afresh.
 *
 * A foreground service from its start to its stop, holding the device awake
 * ([Awake]) the whole time.
 */
@OptIn(UnstableApi::class)
class DacService : Service() {

    companion object {
        private const val TAG = "DacService"
        const val ACTION_TOGGLE = "com.musicd.usbdac.action.TOGGLE"
        const val ACTION_STOP = "com.musicd.usbdac.action.STOP"
        private const val CHANNEL = "player"
        private const val NOTIFICATION_ID = 1
        private const val AHEAD_MS = 5 * 60 * 1000
        private const val AHEAD_BYTES = 48 * 1024 * 1024
        private const val RETRIES = 40
        /** What [UsbOnly] says when there is no USB stream to play into. */
        const val NO_USB = "USB only"
        private val PCM_RATES = listOf(44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000)
        /** The containers Mandarin sends renderers, and the usual others, as MIME types. */
        private val CONTAINERS = listOf("audio/flac", "audio/x-flac", "audio/wav", "audio/x-wav", "audio/wave", "audio/aiff", "audio/x-aiff",
            "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/ogg", "audio/opus")
        private val DSD_MIMES = listOf("audio/x-dsf", "audio/x-dff", "audio/dsd", "audio/x-dsd")

        /** The running renderer, for the screen to read. */
        @Volatile var current: DacService? = null
            private set

        fun start(c: Context) {
            val i = Intent(c, DacService::class.java)
            runCatching { if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i) else c.startService(i) }
                .onFailure { Log.w(TAG, "could not start the player", it) }
        }

        fun stop(c: Context) { c.stopService(Intent(c, DacService::class.java)) }
    }

    internal val main = Handler(Looper.getMainLooper())
    lateinit var player: ExoPlayer
        private set
    lateinit var renderer: Renderer
        private set
    private var http: HttpServer? = null
    private var ssdp: Ssdp? = null
    @Volatile private var usbSink: UsbAudioSink? = null
    @Volatile internal var running = false
    private var retries = 0
    /** Why the player can't play right now (no DAC, say); null while it can. */
    @Volatile var playerError: String? = null
        private set
    /** What the DAC is fed, recorded when Mandarin asks (/capture): the evidence for its bit-perfect check. */
    private val capture by lazy { Capture(File(cacheDir, "capture"), ::captureAbout) }
    /** The address the renderer is at, or null off the network. */
    @Volatile var address: InetAddress? = null
        private set
    /** Who last asked something of the renderer (a control point's address), and when. */
    @Volatile var lastControl: Pair<String, Long>? = null
        private set
    @Volatile var lastSearch: Pair<String, Long>? = null
        private set

    val ready: Boolean get() = ::player.isInitialized && ::renderer.isInitialized
    /** Playing through the USB driver right now: "rate/bits" the DAC is fed ("dsd64", "dop64"), else null. */
    fun usbNow(): String? = if (usbSink?.usb == true && UsbDriver.active) UsbDriver.describe() else null
    fun baseUrl(): String? = address?.let { "http://${it.hostAddress}:${Store.PORT}" }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        current = this
        running = true
        Awake.hold(this)
        Net.holdMulticast(this)
        channel()
        foreground(notification())
        UsbDac.listen(onUsb)
        UsbDac.start(this)
        buildPlayer()
        renderer = Renderer(main, player, ::sink) { foreground(notification()) }
        player.addListener(renderer.listener)
        startNetwork()
        main.postDelayed(heartbeat, 10_000)
        Log.i(TAG, "started")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (ready) when (intent?.action) {
            ACTION_TOGGLE -> if (player.isPlaying) player.pause() else if (renderer.current != null) { if (player.playbackState == Player.STATE_IDLE) player.prepare(); player.play() }
            ACTION_STOP -> { stopSelf(); return START_NOT_STICKY }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        if (current === this) current = null
        running = false
        UsbDac.unlisten(onUsb)
        main.removeCallbacksAndMessages(null)
        runCatching { ssdp?.stop() }
        runCatching { http?.stop() }
        runCatching { player.release() }
        runCatching { capture.stop() }
        UsbDriver.close()
        Net.releaseMulticast()
        Awake.release()
        Log.i(TAG, "stopped")
        super.onDestroy()
    }

    // ------------------------------------------------------------ the player

    private fun buildPlayer() {
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent("MandarinUsb/${BuildConfig.VERSION_NAME}")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(5_000)
            .setReadTimeoutMs(8_000)
        val sources = DefaultDataSource.Factory(this, http)
        // The playing track fetched well ahead (up to 5 minutes or 48 MB), so a Wi-Fi hiccup is never heard.
        val ahead = DefaultLoadControl.Builder()
            .setBufferDurationsMs(AHEAD_MS, AHEAD_MS, 1_500, 3_000)
            .setTargetBufferBytes(AHEAD_BYTES)
            .setPrioritizeTimeOverSizeThresholds(false)
            .build()
        val retrying = object : DefaultLoadErrorHandlingPolicy(RETRIES) {
            override fun getRetryDelayMsFor(info: LoadErrorHandlingPolicy.LoadErrorInfo): Long {
                val d = super.getRetryDelayMsFor(info)
                return if (d == C.TIME_UNSET) d else minOf(500L * info.errorCount, 2_000L)
            }
        }
        // Mandarin's sinks, as its app stacks them (PhonePlayerService), with UsbOnly where Android's track would be.
        val engine = DspEngine()
        val renderers = object : DefaultRenderersFactory(this) {
            override fun buildAudioSink(context: Context, enableFloatOutput: Boolean, enableAudioTrackPlaybackParams: Boolean): AudioSink =
                DspSink(UsbAudioSink(UsbOnly(DefaultAudioSink.Builder(context).setEnableFloatOutput(true).build()), context).also { usbSink = it }, engine)
            override fun buildAudioRenderers(context: Context, extensionRendererMode: Int, mediaCodecSelector: MediaCodecSelector,
                                             enableDecoderFallback: Boolean, audioSink: AudioSink, eventHandler: Handler,
                                             eventListener: AudioRendererEventListener, out: ArrayList<Media3Renderer>) {
                // DSD ahead of the rest: DsdExtractor's chunks to the USB sink as they are.
                out.add(DsdRenderer(eventHandler, eventListener, audioSink))
                super.buildAudioRenderers(context, extensionRendererMode, mediaCodecSelector, enableDecoderFallback, audioSink, eventHandler, eventListener, out)
            }
        }
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)
            .setEnableAudioFloatOutput(true)
        // DSF and DFF files are read by Mandarin's extractor; everything else by Media3's.
        val extractors = ExtractorsFactory { arrayOf<Extractor>(DsdExtractor()) + DefaultExtractorsFactory().createExtractors() }
        player = ExoPlayer.Builder(this, renderers)
            .setLoadControl(ahead)
            .setMediaSourceFactory(DefaultMediaSourceFactory(this, extractors).setDataSourceFactory(sources).setLoadErrorHandlingPolicy(retrying))
            // No audio focus: the DAC is this device's only job, and nothing else's sound should pause it.
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), false)
            .setHandleAudioBecomingNoisy(false)
            .build()
        player.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) { if (isPlaying) { retries = 0; playerError = null } }
            override fun onPlayerError(error: PlaybackException) = afterError(error)
        })
    }

    /**
     * Where Android's own track would be: nothing. Raw PCM is claimed, so a
     * track is decoded and reaches the USB sink as PCM; a coded format (FLAC
     * itself) is not, so the decoder is never bypassed. PCM the USB sink
     * didn't take (no DAC on the port, a rate it hasn't) is refused here, so
     * the track stops with a reason rather than playing through the device's
     * own output at the mixer's rate.
     */
    @UnstableApi
    private class UsbOnly(inner: AudioSink) : ForwardingAudioSink(inner) {
        override fun supportsFormat(format: Format) = format.sampleMimeType == MimeTypes.AUDIO_RAW
        override fun getFormatSupport(format: Format): Int =
            if (format.sampleMimeType == MimeTypes.AUDIO_RAW) AudioSink.SINK_FORMAT_SUPPORTED_WITH_TRANSCODING else AudioSink.SINK_FORMAT_UNSUPPORTED
        override fun configure(inputFormat: Format, specifiedBufferSize: Int, outputChannels: IntArray?) {
            throw AudioSink.ConfigurationException(NO_USB, inputFormat)
        }
    }

    private fun afterError(error: PlaybackException) {
        Log.i(TAG, "playback stopped: ${error.errorCodeName}: ${error.cause?.message}")
        val causes = generateSequence<Throwable>(error) { it.cause }.toList()
        val why = when {
            // A DSD track the DAC couldn't be given as DSD: not a format for this DAC; the control point is told by the stop.
            causes.any { UsbAudioSink.DsdUnplayable.matches(it) } -> "The DAC couldn't take this DSD: " + (causes.first { UsbAudioSink.DsdUnplayable.matches(it) }.message ?: "").removePrefix("DSD: ")
            causes.any { it is AudioSink.ConfigurationException && it.message == NO_USB } -> when {
                UsbDac.device() == null -> "No DAC on the USB port"
                UsbDac.info() == null -> "Allow the app to use the DAC"
                else -> UsbDriver.lastError ?: "The DAC doesn't take this track's format"
            }
            else -> null
        }
        if (why != null) { playerError = why; renderer.failed(why); return }
        if (retries >= 4) { playerError = "Playback stopped: ${error.errorCodeName}"; renderer.failed(playerError!!); return }
        // The network, most likely: tried again from where it was, a few times.
        val wasPlaying = player.playWhenReady
        retries++
        main.postDelayed({
            if (!running) return@postDelayed
            player.prepare()
            player.playWhenReady = wasPlaying
        }, 3000L * retries)
    }

    // ------------------------------------------------------------ the DAC

    private val onUsb: () -> Unit = { main.post { usbChanged() } }

    /**
     * The DAC came or went, or a USB setting changed: what it takes is
     * advertised afresh (a new description address, an SSDP announcement),
     * and a track stopped for want of a DAC is started again from where it is.
     */
    fun usbChanged() {
        if (!ready) return
        renderer.evented()
        ssdp?.alive()
        foreground(notification())
        if (UsbDac.device() == null) { if (renderer.current != null) { player.stop(); UsbDriver.close() }; return }
        if (UsbDac.info() == null) return
        if (renderer.current != null && (playerError != null || player.playerError != null)) {
            val pos = player.currentPosition
            player.stop()
            player.seekTo(0, pos)
            playerError = null
            retries = 0
            player.prepare()
            player.playWhenReady = true
            renderer.resumed()
        }
    }

    /** The DAC as the renderer advertises it: the PCM rates it takes, the depths, and the DSD it can be given the way the setting says. */
    class Caps(val rates: List<Int>, val bits: List<Int>, val dsd: List<Int>, val native: List<Int>, val dop: List<Int>)

    fun caps(): Caps? {
        val info = UsbDac.info() ?: return null
        val rates = sortedSetOf<Int>()
        for (s in info.streams) if (s.pcm) { rates.addAll(s.rates); if (s.rates.isEmpty() && s.continuous == null) rates.addAll(info.clockRates) }
        for (s in info.streams) s.continuous?.let { c -> for (r in PCM_RATES) if (r in c[0]..c[1]) rates.add(r) }
        if (rates.isEmpty()) return null
        val bits = sortedSetOf<Int>(); for (s in info.streams) if (s.pcm) bits.add(s.bits)
        val (native, dop) = UsbDriver.dsdCaps(info)
        val dsd = when (Store.usbDsd(this)) { "pcm" -> emptyList(); "dop" -> dop; else -> (native + dop).distinct().sorted() }
        return Caps(rates.toList(), bits.toList(), dsd, native, dop)
    }

    /** ConnectionManager's Sink: what the DAC takes, as ProtocolInfo entries; the floor (44.1 and 48, 16-bit) with no DAC. */
    fun sink(): String {
        val c = caps()
        val entries = ArrayList<String>()
        val rates = c?.rates ?: listOf(44100, 48000)
        val deep = (c?.bits?.maxOrNull() ?: 16) >= 24
        for (r in rates) {
            entries.add("http-get:*:audio/L16;rate=$r;channels=2:*")
            if (deep) entries.add("http-get:*:audio/L24;rate=$r;channels=2:*")
        }
        for (m in CONTAINERS) entries.add("http-get:*:$m:*")
        if (c != null && c.dsd.isNotEmpty()) for (m in DSD_MIMES) entries.add("http-get:*:$m:*")
        return entries.joinToString(",")
    }

    /** /dac.json: the DAC, what it takes, and what it is being fed. */
    fun dacJson(): JSONObject {
        val c = caps()
        val d = UsbDac.device()
        val info = UsbDac.info()
        val o = JSONObject().put("model", Scpd.MODEL).put("version", BuildConfig.VERSION_NAME).put("mandarin", BuildConfig.MANDARIN_VERSION)
            .put("name", Store.friendlyName(this)).put("udn", Store.udn(this))
        val dac = JSONObject().put("attached", d != null).put("permission", info != null)
        if (d != null) dac.put("device", d.productName ?: "USB audio device").put("manufacturer", d.manufacturerName ?: JSONObject.NULL).put("vendor_id", d.vendorId).put("product_id", d.productId)
        if (info != null) dac.put("uac", info.uac).put("speed", info.speed).put("volume_control", info.volumeControl).put("fixed", UsbDriver.fixed(this))
            .put("dsd_mode", Store.usbDsd(this))
        if (c != null) dac.put("rates", JSONArray(c.rates)).put("bits", JSONArray(takenBits(c.bits))).put("dac_bits", JSONArray(c.bits))
            .put("dsd", JSONArray(c.dsd)).put("dsd_native", JSONArray(c.native)).put("dsd_dop", JSONArray(c.dop))
        o.put("dac", dac)
        // A recording of what the DAC is fed, made when asked (Capture.kt): the server's bit-perfect check.
        o.put("capture", "/capture")
        val s = UsbDriver.current
        o.put("now", if (s == null || !UsbDriver.active) JSONObject.NULL else JSONObject().put("rate", s.rate).put("bits", s.bits).put("kind", s.kind)
            .put("dsd", if (s.dsd) s.dsdMultiple else 0).put("transport", if (ready) renderer.stateNow() else "STOPPED")
            .put("stats", UsbDriver.stats() ?: JSONObject.NULL))
        return o
    }

    /**
     * The depths the renderer takes (/dac.json's "bits", what Mandarin may send it): every one up to the DAC's widest
     * format, a shallower sample going to the DAC in that format. The DAC's own formats are "dac_bits".
     */
    private fun takenBits(dacBits: List<Int>): List<Int> {
        val widest = dacBits.maxOrNull() ?: return dacBits
        return (listOf(16, 24, 32).filter { it <= widest } + dacBits).distinct().sorted()
    }

    // ------------------------------------------------------------ the network

    /**
     * The description's address: the hash of everything said of the DAC in it (the sink, and /dac.json's word on the
     * DAC: depths, DSD, volume control, fixed), so any change of DAC or of how it is given is a new address — read
     * again at once by a control point that caches by it (Mandarin does) when the announcement says so.
     */
    private fun location(): String? = baseUrl()?.let {
        val dac = dacJson().optJSONObject("dac")?.toString() ?: ""
        "$it/description.xml?caps=" + Integer.toHexString((sink() + "|" + dac).hashCode())
    }

    private fun startNetwork() {
        address = Net.lanAddress()
        try {
            http = HttpServer(Store.PORT, ::route).also { it.start() }
        } catch (e: Exception) { Log.w(TAG, "http", e); playerError = "Couldn't open port ${Store.PORT}: ${e.message}" }
        try {
            ssdp = Ssdp(Store.udn(this), ::location) { address?.let { Net.interfaceOf(it) } }.also { it.start() }
        } catch (e: Exception) { Log.w(TAG, "ssdp", e) }
    }

    private fun route(r: HttpServer.Request): HttpServer.Response {
        val path = r.path
        when {
            path == "/description.xml" && (r.method == "GET" || r.method == "HEAD") -> {
                lastSearch = Pair(r.from, System.currentTimeMillis())
                return HttpServer.Response.text(200, Scpd.description(Store.friendlyName(this), Store.udn(this), Build.MODEL))
            }
            path.startsWith("/scpd/") && r.method == "GET" -> return when (path) {
                "/scpd/AVTransport.xml" -> HttpServer.Response.text(200, Scpd.avTransport)
                "/scpd/RenderingControl.xml" -> HttpServer.Response.text(200, Scpd.renderingControl)
                "/scpd/ConnectionManager.xml" -> HttpServer.Response.text(200, Scpd.connectionManager)
                else -> HttpServer.Response.text(404, "")
            }
            path.startsWith("/control/") && r.method == "POST" -> return control(r, path.removePrefix("/control/"))
            path.startsWith("/event/") && (r.method == "SUBSCRIBE" || r.method == "UNSUBSCRIBE") -> return events(r, path.removePrefix("/event/"))
            path == "/dac.json" && r.method == "GET" -> return HttpServer.Response.text(200, dacJson().toString(2), "application/json")
            path == "/capture" || path.startsWith("/capture.") -> return captureRoute(r, path)
            path == "/" && r.method == "GET" -> return HttpServer.Response.text(200, "${Store.friendlyName(this)} — ${Scpd.MODEL} ${BuildConfig.VERSION_NAME}\n${renderer.onMain { statusLine() }}\n\nUPnP MediaRenderer; the DAC at /dac.json.\n", "text/plain; charset=\"utf-8\"")
        }
        return HttpServer.Response.text(404, "")
    }

    /** /capture (Capture.kt): start, ask, fetch, stop a recording of what the DAC is fed. */
    private fun captureRoute(r: HttpServer.Request, path: String): HttpServer.Response {
        val json = "application/json"
        return when {
            path == "/capture" && r.method == "POST" -> {
                if (UsbDac.info() == null) return HttpServer.Response.text(409, JSONObject().put("error", "no DAC on the port").toString(), json)
                val asked = runCatching { JSONObject(String(r.body, Charsets.UTF_8)).optInt("seconds", 30) }.getOrDefault(30)
                if (!capture.start(asked)) return HttpServer.Response.text(409, capture.status().put("error", "a capture is running").toString(), json)
                HttpServer.Response.text(202, capture.status().toString(), json)
            }
            path == "/capture" && r.method == "GET" -> HttpServer.Response.text(200, capture.status().toString(), json)
            path == "/capture" && r.method == "DELETE" -> { capture.stop(); HttpServer.Response.text(200, capture.status().toString(), json) }
            path == "/capture.wav" && r.method == "GET" && capture.wav.isFile -> HttpServer.Response.file(capture.wav, "audio/wav")
            path == "/capture.wav.json" && r.method == "GET" && capture.sidecar.isFile -> HttpServer.Response.file(capture.sidecar, json)
            else -> HttpServer.Response.text(404, "")
        }
    }

    /** What a capture says of where it was made, as it starts: the DAC, the DSD setting, the track and where in it. */
    private fun captureAbout(): JSONObject {
        val track = renderer.onMain { JSONObject().put("uri", renderer.current?.uri ?: JSONObject.NULL).put("position_ms", player.currentPosition) }
        return JSONObject().put("device", dacJson().optJSONObject("dac") ?: JSONObject()).put("dsd_setting", Store.usbDsd(this)).put("track", track)
    }

    private fun control(r: HttpServer.Request, service: String): HttpServer.Response {
        lastControl = Pair(r.from, System.currentTimeMillis())
        val type = when (service) { "AVTransport" -> Scpd.AVT; "RenderingControl" -> Scpd.RCS; "ConnectionManager" -> Scpd.CMS; else -> return HttpServer.Response.text(404, "") }
        val action = try { Xml.parseSoap(String(r.body, Charsets.UTF_8)) } catch (e: Exception) { null }
            ?: return HttpServer.Response.text(400, Soap.fault(402, "Invalid Args"))
        return try {
            val out = renderer.handle(service, action)
            HttpServer.Response.text(200, Soap.response(type, action.name, out))
        } catch (e: Soap.Fault) {
            HttpServer.Response.text(500, Soap.fault(e.code, e.description))
        } catch (e: Exception) {
            Log.w(TAG, "${action.name}", e)
            HttpServer.Response.text(500, Soap.fault(501, e.message ?: "Action Failed"))
        }
    }

    private fun events(r: HttpServer.Request, service: String): HttpServer.Response {
        val ev = when (service) { "AVTransport" -> renderer.avt; "RenderingControl" -> renderer.rcs; "ConnectionManager" -> renderer.cms; else -> return HttpServer.Response.text(404, "") }
        val sid = r.header("sid")
        if (r.method == "UNSUBSCRIBE") return HttpServer.Response.text(if (sid != null && ev.unsubscribe(sid)) 200 else 412, "")
        val initial = { when (service) { "AVTransport" -> renderer.avtInitial(); "RenderingControl" -> renderer.rcsInitial(); else -> renderer.cmsInitial() } }
        val got = ev.subscribe(sid, r.header("callback"), r.header("timeout"), initial) ?: return HttpServer.Response.text(412, "")
        return HttpServer.Response(200, ByteArray(0), "text/xml; charset=\"utf-8\"", mapOf("SID" to got.first, "TIMEOUT" to "Second-${got.second}"))
    }

    // ------------------------------------------------------------ notification

    private val heartbeat = object : Runnable {
        override fun run() {
            if (ready) renderer.evented()
            foreground(notification())
            // The address may have come (Wi-Fi joined after the start) or changed: the announcement says where.
            val a = Net.lanAddress()
            if (a != null && a != address) { address = a; ssdp?.alive() }
            if (running) main.postDelayed(this, 10_000)
        }
    }

    private fun channel() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.channel_name), NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) })
    }

    private fun foreground(n: Notification) {
        runCatching {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
            else startForeground(NOTIFICATION_ID, n)
        }.onFailure { Log.w(TAG, "foreground", it) }
    }

    /** One line on what the renderer is doing, for the notification and the screen. */
    fun statusLine(): String {
        val dac = UsbDac.info()?.name
        return when {
            address == null -> "No network: the renderer can't be found"
            playerError != null -> playerError!!
            UsbDac.device() == null -> "No DAC on the USB port"
            UsbDac.info() == null -> "Allow the app to use the DAC"
            !ready -> "Starting…"
            else -> when (renderer.transportState()) {
                "PLAYING" -> "Playing" + (usbNow()?.let { " · USB $it" } ?: "") + (dac?.let { " · $it" } ?: "")
                "TRANSITIONING" -> "Loading…"
                "PAUSED_PLAYBACK" -> "Paused" + (dac?.let { " · $it" } ?: "")
                else -> "Ready" + (dac?.let { " · $it" } ?: "") + " · “${Store.friendlyName(this)}” at ${address?.hostAddress}"
            }
        }
    }

    private fun notification(): Notification {
        if (!ready) return Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.app_name)).setContentText("Starting…").setOngoing(true).build()
        val d = renderer.current?.didl
        val title = d?.title?.takeIf { it.isNotBlank() } ?: getString(R.string.app_name)
        val sub = listOfNotNull(d?.artist?.takeIf { it.isNotBlank() }, d?.album?.takeIf { it.isNotBlank() }).joinToString(" — ")
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        fun act(action: String, label: String, code: Int): Notification.Action {
            val pi = PendingIntent.getService(this, code, Intent(this, DacService::class.java).setAction(action), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            return Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_notification), label, pi).build()
        }
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(if (sub.isNotEmpty()) "$sub · ${statusLine()}" else statusLine())
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(act(ACTION_TOGGLE, if (player.isPlaying) "Pause" else "Play", 1))
            .addAction(act(ACTION_STOP, "Stop renderer", 3))
            .build()
    }
}
