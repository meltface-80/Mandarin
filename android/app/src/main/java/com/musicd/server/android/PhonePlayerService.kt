package com.musicd.server.android

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.datasource.cache.CacheDataSink
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.CacheKeyFactory
import androidx.media3.datasource.cache.CacheWriter
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import com.musicd.server.client.Dsp
import org.json.JSONArray
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaLibraryService.LibraryParams
import androidx.media3.session.MediaLibraryService.MediaLibrarySession
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionError
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import com.musicd.server.client.CachePlan
import com.musicd.server.client.Phone
import com.musicd.server.client.ServerClient
import com.musicd.server.client.phoneCommands
import com.musicd.server.client.phoneHello
import com.musicd.server.client.phoneReport
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import kotlin.math.roundToInt

/**
 * "This phone": the phone as one of MusicD Server's zones.
 *
 * The server keeps the queue and sends commands (load an album, pause, skip,
 * seek, volume…), collected here with a long poll; ExoPlayer plays them
 * through the phone's speaker or headphones, and what it is doing goes back to
 * the server, which shows it like any Sonos room — on this phone's own page
 * and on every other device. Media3 provides the notification, lock screen,
 * headset buttons and Android Auto.
 *
 * Audio comes from the server's /stream addresses, the same ones Sonos is
 * given (FLAC up to 24-bit/48 kHz, anything higher converted on the server) —
 * or, for a track that has been downloaded, from the phone itself. Away from
 * home (see [Away]) the same addresses go to the server's Tailscale address
 * and ask for Opus 256 kbps, and a track cut off by the switch picks up
 * where it stopped.
 *
 * Downloaded albums also play with no server at all (ACTION_PLAY_LOCAL, from
 * the Downloads screen). While it plays those, the server's commands that
 * would rearrange a queue it doesn't know are ignored, and the plays are
 * kept to send once the server is reachable again.
 *
 * In the car, Android Auto browses it (see [Library]): Downloaded albums, and
 * with the server in reach Smart Picks and Random albums. A downloaded album
 * plays from the phone; a server album is played on "This phone" through the
 * server, like everywhere else, so the queue and history stay the server's.
 *
 * Started while the app is open; it stays running while it plays. Closed and
 * idle, it stops, and the phone drops out of the zone list shortly after.
 */
@OptIn(UnstableApi::class)
class PhonePlayerService : MediaLibraryService() {

    companion object {
        private const val TAG = "PhonePlayer"

        /** The name this phone goes by on the server ("Pixel 8"). */
        fun phoneName(): String {
            val maker = Build.MANUFACTURER.replaceFirstChar { it.uppercase() }
            val model = Build.MODEL
            return if (model.startsWith(maker, ignoreCase = true)) model else "$maker $model"
        }
        private const val AHEAD_MS = 5 * 60 * 1000
        private const val AHEAD_BYTES = 48 * 1024 * 1024

        /** Tracks cached ahead: how many are on the phone of how many wanted, and on which kind of network. */
        class Ahead(val cached: Int, val wanted: Int, val metered: Boolean)
        @Volatile var ahead = Ahead(0, 0, false)
            private set
        private const val RETRIES = 40
        const val FORMAT_OPUS = "opus"
        /** Opus decoded to float by the app's own libopus: 24/48 (v0.5.22). */
        const val FORMAT_OPUS24 = "opus24"
        const val FORMAT_LOSSLESS = "lossless"
        const val FORMAT_ORIGINAL = "original"
        private const val WAIT_MS = 25_000
        const val ACTION_PLAY_LOCAL = "com.musicd.server.android.action.PLAY_LOCAL"
        /** An album of the phone's own music (LocalMusic): EXTRA_KEY, EXTRA_INDEX (−1: the album), EXTRA_KIND. */
        const val ACTION_PLAY_PHONE = "com.musicd.server.android.action.PLAY_PHONE"
        const val EXTRA_KEY = "key"
        const val EXTRA_KIND = "kind"
        const val EXTRA_ALBUM = "album"
        const val EXTRA_INDEX = "index"

        // Android Auto's tree.
        private const val ROOT = "root"
        private const val DOWNLOADS = "downloads"
        private const val PICKS = "picks"
        private const val RANDOM = "random"
        private const val LOCAL = "dl:"     // a downloaded album: dl:<album id>
        private const val SERVER = "sv:"    // a library album: sv:<album id>

        /** The running player, for the offline page (OfflineApi) to drive and read. */
        @Volatile var current: PhonePlayerService? = null
            private set

        fun start(context: Context) {
            if (Store.token(context) == null) return
            runCatching { context.startService(Intent(context, PhonePlayerService::class.java)) }
                .onFailure { Log.w(TAG, "could not start the phone player", it) }
        }
    }

    private val main = Handler(Looper.getMainLooper())
    private val reports = Executors.newSingleThreadExecutor()
    private var session: MediaLibrarySession? = null
    private val browse = Executors.newFixedThreadPool(2)
    /** This phone's zone, from the server's hello. */
    @Volatile private var zoneId: String? = null
    /** The server answered the last time it was asked (its long poll is running). */
    @Volatile private var connected = false
    /** For the Downloads screen: a downloaded album played now goes through the server. */
    val serverInReach: Boolean get() = connected && zoneId != null
    /** Android Auto asked for a server album: the server's "load" answers it. */
    private var pendingLoad: SettableFuture<MediaSession.MediaItemsWithStartPosition>? = null
    private lateinit var player: ExoPlayer
    private lateinit var audio: AudioManager
    @Volatile private var running = false
    private var worker: Thread? = null
    private var seq = 0L
    private var reportPending = false
    /** Playing downloads from the Downloads screen rather than the server's queue. */
    private var localMode = false
    private var loggedKey: String? = null
    private var retries = 0
    /**
     * The format each track started in (true: the server's Opus), by its
     * address: the rest of a track fetched after a change of network must be
     * the same file as its start. Kept for the playing track and the next.
     */
    private val pinned = ConcurrentHashMap<String, Boolean>()

    override fun onCreate() {
        super.onCreate()
        audio = getSystemService(AudioManager::class.java)
        // A connection that has gone quiet (the Wi-Fi gone as you leave) is
        // given up on in seconds, not twenty — and fetched again at once.
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent("MusicDAndroid/${BuildConfig.VERSION_NAME}")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(5_000)
            .setReadTimeoutMs(8_000)
        Store.token(this)?.let { http.setDefaultRequestProperties(mapOf("Authorization" to "Bearer $it")) }
        // Each address is sent where the server is now — home or away — as
        // it's opened; downloaded tracks are files and go straight through. A
        // track keeps the format it started in (see [pinned]).
        val routed = ResolvingDataSource.Factory(http) { spec ->
            val key = spec.uri.toString()
            val opus = pinned.getOrPut(key) { Store.wantsOpus(this) }
            spec.withUri(Uri.parse(Store.localize(this, key, opus)))
        }
        // Through the phone's cache of tracks (StreamCache): what's there plays
        // from the phone, what isn't is fetched and kept as it plays. The tracks
        // after the playing one are fetched ahead into it (fetchAhead below).
        val cache = StreamCache.get(this)
        cacheSource = CacheDataSource.Factory()
            .setCache(cache)
            .setUpstreamDataSourceFactory(routed)
            .setCacheWriteDataSinkFactory(CacheDataSink.Factory().setCache(cache))
            .setCacheKeyFactory(CacheKeyFactory { spec -> keyFor(spec.uri.toString()) ?: spec.key ?: spec.uri.toString() })
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
        val sources = DefaultDataSource.Factory(this, cacheSource)

        // Held ahead in memory too: the playing track is fetched whole as fast
        // as the network allows (up to 5 minutes or 48 MB ahead), so leaving the
        // house is heard from what's on the phone — the tracks after it are in
        // the cache.
        val ahead = DefaultLoadControl.Builder()
            .setBufferDurationsMs(AHEAD_MS, AHEAD_MS, 1_500, 3_000)
            .setTargetBufferBytes(AHEAD_BYTES)
            .setPrioritizeTimeOverSizeThresholds(false)
            .build()
        // A fetch that fails (no network for a moment) is tried again quickly and
        // for a good while, from where it stopped, while the music plays on from
        // what's held — it only becomes an error after about a minute and a half.
        val retrying = object : DefaultLoadErrorHandlingPolicy(RETRIES) {
            override fun getRetryDelayMsFor(info: LoadErrorHandlingPolicy.LoadErrorInfo): Long {
                val d = super.getRetryDelayMsFor(info)
                if (d == C.TIME_UNSET) return d
                if (info.errorCount == 1) Away.recheck(this@PhonePlayerService)
                return minOf(500L * info.errorCount, 2_000L)
            }
        }

        // Media3's Opus decoder (libopus, built into the app) ahead of
        // Android's, and a float audio path: the server's Opus 256 decodes to
        // float — 24/48 into Android's mixer — where Android's decoder gives
        // 16-bit. Every other format decodes as before; a 24-bit file also
        // travels as float.
        // The DSP engine (DspSink) wraps the sink: every decoded buffer
        // becomes float, the phone's setting is run on it, then the mixer.
        dsp.apply(Dsp.parse(Store.dsp(this)?.let { runCatching { JSONObject(it) }.getOrNull() }))
        val engine = dsp
        val renderers = object : DefaultRenderersFactory(this) {
            override fun buildAudioSink(context: Context, enableFloatOutput: Boolean, enableAudioTrackPlaybackParams: Boolean): AudioSink =
                // Under the DSP: the USB sink (Stage 9.2), which plays through the
                // app's own driver when USB direct is on and a DAC is on the port,
                // and hands everything to Android's track otherwise.
                DspSink(UsbAudioSink(DefaultAudioSink.Builder(context).setEnableFloatOutput(true).setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams).build(), context).also { usbSink = it }, engine)
            override fun buildAudioRenderers(context: Context, extensionRendererMode: Int, mediaCodecSelector: androidx.media3.exoplayer.mediacodec.MediaCodecSelector,
                                             enableDecoderFallback: Boolean, audioSink: AudioSink, eventHandler: Handler,
                                             eventListener: androidx.media3.exoplayer.audio.AudioRendererEventListener, out: ArrayList<androidx.media3.exoplayer.Renderer>) {
                // DSD (Stage 9.3), ahead of the rest: DsdExtractor's chunks to the USB sink as they are.
                out.add(DsdRenderer(eventHandler, eventListener, audioSink))
                super.buildAudioRenderers(context, extensionRendererMode, mediaCodecSelector, enableDecoderFallback, audioSink, eventHandler, eventListener, out)
            }
        }
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)
            .setEnableAudioFloatOutput(true)
        // DSF and DFF files are read by the app's own extractor (Stage 9.3); everything else by Media3's.
        val extractors = androidx.media3.extractor.ExtractorsFactory {
            arrayOf<androidx.media3.extractor.Extractor>(DsdExtractor()) + androidx.media3.extractor.DefaultExtractorsFactory().createExtractors()
        }
        player = ExoPlayer.Builder(this, renderers)
            .setLoadControl(ahead)
            .setMediaSourceFactory(DefaultMediaSourceFactory(this, extractors).setDataSourceFactory(sources)
                .setLoadErrorHandlingPolicy(retrying))
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
                /* handleAudioFocus = */ true
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
        player.addListener(object : Player.Listener {
            override fun onEvents(p: Player, events: Player.Events) {
                reportSoon()
                bumpRevision()
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) { if (isPlaying) retries = 0 }
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) = fetchAheadSoon()
            override fun onTimelineChanged(timeline: androidx.media3.common.Timeline, reason: Int) { if (localMode) localRev++; fetchAheadSoon() }
            override fun onShuffleModeEnabledChanged(shuffleModeEnabled: Boolean) = fetchAheadSoon()
            override fun onRepeatModeChanged(repeatMode: Int) = fetchAheadSoon()
            override fun onPlayerError(error: PlaybackException) = resumeAfterError(error)
        })
        // Which decoder is at work: "libopus" is the app's own (float), a
        // "c2.android…" name is Android's. Shown on the format badge.
        player.addAnalyticsListener(object : AnalyticsListener {
            override fun onAudioDecoderInitialized(eventTime: AnalyticsListener.EventTime, decoderName: String, initializedTimestampMs: Long, initializationDurationMs: Long) {
                audioDecoder = decoderName
                reportSoon()
            }
        })
        Away.watch(this)
        // A new network (Wi-Fi or mobile data): a different number of tracks ahead.
        Away.listen(onNetwork)

        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val sp = UsbVolumePlayer(player).also { sessionPlayer = it }
        session = MediaLibrarySession.Builder(this, sp, Library()).setSessionActivity(open).build()
        // Media3 shows the notification and lock-screen controls (and keeps the
        // service in the foreground while it plays) only for sessions it has
        // been given. It's given them when a controller connects — Bluetooth,
        // Android Auto — but playback started in the app has none, so without
        // this it played with no controls at all.
        addSession(session!!)

        current = this
        running = true
        worker = Thread({ loop() }, "phone-commands").apply { isDaemon = true; start() }
        main.postDelayed(heartbeat, 10_000)
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_PLAY_PHONE) {
            playPhoneAlbum(intent.getStringExtra(EXTRA_KEY) ?: "", intent.getIntExtra(EXTRA_INDEX, -1), intent.getStringExtra(EXTRA_KIND) ?: "play_now")
        }
        if (intent?.action == ACTION_PLAY_LOCAL) {
            playDownloaded(intent.getIntExtra(EXTRA_ALBUM, 0), intent.getIntExtra(EXTRA_INDEX, 0))
        }
        return super.onStartCommand(intent, flags, startId)
    }

    /**
     * A downloaded album. With the server in reach it's played through the
     * server on this phone, like any album — so the whole MusicD page follows
     * it (Now playing, the bar at the bottom, the queue, history) — and the
     * tracks still come from the phone's own files ([mediaItem]). With no
     * server, or if it doesn't know the album, from the phone alone.
     */
    private fun playDownloaded(albumId: Int, index: Int) {
        val zone = zoneId
        val client = Store.client(this)
        if (!connected || zone == null || client == null) { playLocal(albumId, index); return }
        val a = DownloadStore.dirOf(this, albumId)?.let { DownloadStore.load(it) }
        // [index] counts the tracks on the phone; the server counts the album's.
        val trackId = localItems(albumId).getOrNull(index)?.mediaId?.toLongOrNull()
        val serverIndex = a?.tracks?.indexOfFirst { it.id == trackId }?.takeIf { it >= 0 } ?: 0
        browse.execute {
            runCatching {
                val body = JSONObject().put("offset", albumId).put("zone_or_output_id", zone).put("kind", "play_now")
                if (serverIndex > 0) client.post("/api/play-track", body.put("track", serverIndex), 10_000)
                else client.post("/api/play", body, 10_000)
            }.onFailure { e ->
                Log.i(TAG, "downloaded album $albumId from the phone alone: ${e.message}")
                main.post { playLocal(albumId, index) }
            }
        }
    }

    /**
     * An album of the phone's own music (LocalMusic, Stage 5): the whole album
     * ([index] −1) or one track, now, next, at the end, or shuffled. The
     * server never knows these files; the player holds them itself (local
     * mode) and tells the server what it is playing so the page shows it.
     */
    private fun playPhoneAlbum(key: String, index: Int, kind: String) {
        LocalMusic.load(this)
        var items = LocalMusic.mediaItems(this, key)
        if (items.isEmpty()) return
        val k = when (kind) { "queue", "add_to_queue" -> "queue"; "play_next", "add_next", "next" -> "add_next"; "shuffle" -> "shuffle"; else -> "play_now" }
        var start = 0
        if (index >= 0) {
            if (k == "play_now") start = index.coerceIn(0, items.size - 1) else items = listOfNotNull(items.getOrNull(index))
        }
        localPlay(items, start, if (k == "shuffle") "play_now" else k)
        if (k == "shuffle") player.shuffleModeEnabled = true
        localRev++
        reportSoon()
    }

    /** Items the phone holds itself onto the player: now (from [start]), next, or at the end. */
    private fun localPlay(items: List<MediaItem>, start: Int, kind: String) {
        if (items.isEmpty()) return
        localMode = true
        loggedKey = null
        val wasEmpty = player.mediaItemCount == 0
        when (kind) {
            "queue" -> player.addMediaItems(items)
            "add_next" -> player.addMediaItems((player.currentMediaItemIndex + 1).coerceAtMost(player.mediaItemCount), items)
            else -> {
                player.setMediaItems(items, start.coerceIn(0, items.size - 1), 0L)
                player.prepare()
                player.play()
            }
        }
        if (wasEmpty && kind != "play_now") { player.prepare(); player.play() }
        localRev++
        bumpRevision()
    }

    /** A downloaded album, from the phone's own storage, with no server. */
    private fun playLocal(albumId: Int, index: Int) {
        val items = localItems(albumId)
        if (items.isEmpty()) return
        localMode = true
        loggedKey = null
        player.setMediaItems(items, index.coerceIn(0, items.size - 1), 0L)
        player.prepare()
        player.play()
    }

    /** A downloaded album's tracks, as the player takes them. */
    private fun localItems(albumId: Int): List<MediaItem> {
        val dir = DownloadStore.dirOf(this, albumId) ?: return emptyList()
        val a = DownloadStore.load(dir) ?: return emptyList()
        val cover = File(dir, "cover.jpg").takeIf { it.exists() }?.let { Uri.fromFile(it) }
        return a.tracks.filter { it.done && File(dir, it.fileName()).exists() }.map { t ->
            MediaItem.Builder()
                .setUri(Uri.fromFile(File(dir, t.fileName())))
                .setMediaId(t.id.toString())
                .setMediaMetadata(MediaMetadata.Builder()
                    .setTitle(t.title).setArtist(t.artist).setAlbumTitle(a.title)
                    .apply { cover?.let { setArtworkUri(it) } }
                    // Which album and how long: the offline page shows both.
                    .setExtras(Bundle().apply {
                        putInt(EXTRA_ALBUM, albumId)
                        putDouble("duration", t.duration)
                        // For the server, which shows the phone's own list (report()).
                        a.imageKey?.let { putString("image_key", it) }
                        putString("ext", t.ext)
                        a.imageKey?.let { putString("image_key", it) }
                    })
                    .build())
                .build()
        }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Swiped away while idle: stop, and the phone leaves the zone list.
        if (!player.playWhenReady || player.mediaItemCount == 0) stopSelf()
    }

    override fun onDestroy() {
        if (current === this) current = null
        running = false
        Away.unlisten(onNetwork)
        fetchGen++
        writer?.cancel()
        fetcher.shutdownNow()
        worker?.interrupt()
        main.removeCallbacksAndMessages(null)
        session?.run {
            player.release()
            release()
        }
        session = null
        reports.shutdown()
        browse.shutdownNow()
        super.onDestroy()
    }

    // ------------------------------------------------------------ commands

    private fun loop() {
        var hello = false
        var failures = 0
        while (running) {
            val client = Store.client(this)
            if (client == null) { pause(5_000); continue }
            try {
                if (!hello) {
                    // A DSP setting changed offline goes with the hello, and the server keeps it.
                    val mine = if (Store.dspPending(this)) Store.dsp(this)?.let { runCatching { JSONObject(it) }.getOrNull() } else null
                    val h = client.phoneHello(deviceName(), mine)
                    if (mine != null) Store.setDspPending(this, false)
                    seq = h.seq
                    zoneId = h.zoneId
                    Store.setPhoneZone(this, h.zoneId)
                    Store.setAwayLearned(this, h.awayAddress)
                    h.dsp?.let { applyDsp(it) }
                    hello = true
                    // The queue from before this player was restarted (Android
                    // stops an idle one after a while): back, paused where it
                    // was — and nothing fetched until Play.
                    val resume = h.resume
                    if (resume != null) main.post { if (!localMode && player.mediaItemCount == 0) restore(resume) }
                    reportSoon()
                }
                sendOfflinePlays(client)
                connected = true
                if (failures > 0 || resumeWanted) serverBack()
                val batch = client.phoneCommands(seq, WAIT_MS)
                seq = batch.seq
                failures = 0
                if (batch.commands.isNotEmpty()) {
                    val done = CountDownLatch(1)
                    main.post {
                        for (c in batch.commands) runCatching { apply(c) }.onFailure { Log.w(TAG, "command ${c.op} failed", it) }
                        done.countDown()
                    }
                    // Not for ever: a busy main thread mustn't stop the commands for good.
                    done.await(10, java.util.concurrent.TimeUnit.SECONDS)
                }
            } catch (e: InterruptedException) {
                return
            } catch (e: ServerClient.ServerException) {
                connected = false
                if (e.signedOut) { main.post { stopSelf() }; return }
                if (e.status == 409) hello = false            // the server forgot us (restarted): start again
                failures++
                pause(minOf(15_000L, 1_000L * failures))
            } catch (e: Exception) {
                connected = false
                failures++
                if (failures == 1) Log.i(TAG, "server unreachable: ${e.message}")
                // Three in a row: the way to the server may have gone stale
                // (the phone slept; a tunnel that no longer carries anything).
                // Have it looked at and repaired, here on this thread, rather
                // than knocking on a dead door every few seconds.
                if (failures % 3 == 0) runCatching { Away.check(this) }
                pause(minOf(15_000L, 1_000L * failures))
            }
        }
    }

    /**
     * The server's queue from before this player was restarted: loaded and
     * left idle at its place, so it shows as paused and plays from there on
     * Play — no audio is fetched for a track nobody has asked to hear.
     */
    private fun restore(c: Phone.Command) {
        val items = c.items.map(::mediaItem)
        if (items.isEmpty()) return
        localMode = false
        player.setMediaItems(items, c.index.coerceIn(0, items.size - 1), (c.seconds * 1000).toLong())
        player.playWhenReady = false
        restored = true
        reportSoon()
    }

    /** The queue was put back but never prepared: idle with items is "paused", not "stopped". */
    private var restored = false

    /** Playback gave up while the server was away; start again once it is back. */
    @Volatile private var resumeWanted = false

    /** The server answers again after a spell away: pick up where the music stopped. */
    private fun serverBack() {
        if (!resumeWanted) return
        main.post {
            if (!resumeWanted || localMode || player.mediaItemCount == 0) return@post
            resumeWanted = false
            retries = 0
            if (player.playbackState == Player.STATE_IDLE || player.playerError != null) player.prepare()
            player.play()
            Log.i(TAG, "server back: playing on")
        }
    }

    /** Plays made with no server, once there is one. */
    private fun sendOfflinePlays(client: ServerClient) {
        val plays = DownloadStore.pendingPlays(this)
        if (plays.length() == 0) return
        runCatching {
            client.post("/api/phone/plays", JSONObject().put("plays", plays))
            DownloadStore.clearPlays(this, plays.length())
        }
    }

    private fun pause(ms: Long) {
        try { Thread.sleep(ms) } catch (e: InterruptedException) { running = false }
    }

    /** The phone's DSP engine: the setting from the server, run on what plays (DspSink). */
    private val dsp = DspEngine()
    /** The USB sink (Stage 9.2), once the player is built. */
    @Volatile private var usbSink: UsbAudioSink? = null
    /** Playing through the USB driver right now: "rate/bits", else null. */
    private fun usbNow(): String? = if (usbSink?.usb == true && UsbDriver.active) UsbDriver.describe() else null
    /**
     * A DSD track the DAC couldn't be given (UsbAudioSink.DsdUnplayable): DSD
     * is left out of what the phone says it takes, so the server sends such
     * tracks as PCM, until the DAC or the setting changes.
     */
    @Volatile private var dsdBroken = false
    /**
     * The USB DAC as a stream target for the server (Stage 9.3), while USB
     * direct is on and a DAC is on the port: the rates and depths it takes
     * and the DSD it can be given the way the setting says. Null otherwise —
     * the server then plans by the Sonos rule as before.
     */
    private fun usbCaps(): JSONObject? {
        if (!Store.usbDirect(this) || UsbDac.device() == null) return null
        val info = UsbDac.info() ?: return null
        val rates = sortedSetOf<Int>()
        for (s in info.streams) if (s.pcm) { rates.addAll(s.rates); if (s.rates.isEmpty() && s.continuous == null) rates.addAll(info.clockRates) }
        for (s in info.streams) s.continuous?.let { c -> for (r in listOf(44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000)) if (r in c[0]..c[1]) rates.add(r) }
        if (rates.isEmpty()) return null
        val bits = sortedSetOf<Int>(); for (s in info.streams) if (s.pcm) bits.add(s.bits)
        val caps = UsbDriver.dsdCaps(info)
        val dsd = when {
            dsdBroken -> emptyList()
            else -> when (Store.usbDsd(this)) { "pcm" -> emptyList(); "dop" -> caps.second; else -> (caps.first + caps.second).distinct().sorted() }
        }
        return JSONObject().put("rates", JSONArray(rates.toList())).put("bits", JSONArray(bits.toList())).put("dsd", JSONArray(dsd))
    }
    /** The USB level is what the slider drives: the DAC's own control, or software gain for a DAC without one — unless the volume is fixed. */
    private fun usbVolume(): Boolean = usbSink?.usb == true && UsbDriver.controlsVolume
    /** The phone's volume buttons, in USB direct: a step on the USB level. False when they are Android's to handle. */
    fun usbVolumeKey(up: Boolean): Boolean {
        if (!usbVolume()) return false
        UsbDriver.stepVolume(up)
        usbVolumeChanged()
        return true
    }
    /** The USB level, or the fixed/limit settings, changed: the page and the lock screen follow. */
    fun usbVolumeChanged() {
        reportSoon(); bumpRevision()
        main.post { sessionPlayer?.deviceChanged() }
    }
    /**
     * The player the media session sees. In USB direct with the slider
     * driving the level, it tells the session the volume is a remote
     * device's (0–100, the USB level) so the phone's volume buttons, the lock
     * screen and Bluetooth controls move the DAC, not Android's stream —
     * which plays nothing then.
     */
    @Volatile private var sessionPlayer: UsbVolumePlayer? = null
    private inner class UsbVolumePlayer(p: Player) : androidx.media3.common.ForwardingPlayer(p) {
        private val listeners = java.util.concurrent.CopyOnWriteArraySet<Player.Listener>()
        private val remote = androidx.media3.common.DeviceInfo.Builder(androidx.media3.common.DeviceInfo.PLAYBACK_TYPE_REMOTE).setMinVolume(0).setMaxVolume(100).build()
        private fun usb() = usbVolume()
        override fun addListener(listener: Player.Listener) { listeners.add(listener); super.addListener(listener) }
        override fun removeListener(listener: Player.Listener) { listeners.remove(listener); super.removeListener(listener) }
        override fun getAvailableCommands(): Player.Commands = super.getAvailableCommands().buildUpon()
            .addAll(Player.COMMAND_GET_DEVICE_VOLUME, Player.COMMAND_SET_DEVICE_VOLUME_WITH_FLAGS, Player.COMMAND_ADJUST_DEVICE_VOLUME_WITH_FLAGS).build()
        override fun isCommandAvailable(command: Int): Boolean = availableCommands.contains(command)
        override fun getDeviceInfo(): androidx.media3.common.DeviceInfo = if (usb()) remote else super.getDeviceInfo()
        override fun getDeviceVolume(): Int = if (usb()) UsbDriver.volume() else
            Math.round(audio.getStreamVolume(AudioManager.STREAM_MUSIC) * 100.0 / audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)).toInt()
        override fun isDeviceMuted(): Boolean = if (usb()) UsbDriver.isMuted() else Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && audio.isStreamMute(AudioManager.STREAM_MUSIC)
        private fun set(v: Int) { onPlayer { this@PhonePlayerService.apply(Phone.Command(0, "volume", value = v), fromPage = true); usbVolumeChanged() } }
        @Deprecated("flags") override fun setDeviceVolume(volume: Int) = set(volume)
        override fun setDeviceVolume(volume: Int, flags: Int) = set(volume)
        @Deprecated("flags") override fun increaseDeviceVolume() = set(deviceVolume + 5)
        override fun increaseDeviceVolume(flags: Int) = set(deviceVolume + 5)
        @Deprecated("flags") override fun decreaseDeviceVolume() = set(deviceVolume - 5)
        override fun decreaseDeviceVolume(flags: Int) = set(deviceVolume - 5)
        @Deprecated("flags") override fun setDeviceMuted(muted: Boolean) = setDeviceMuted(muted, 0)
        override fun setDeviceMuted(muted: Boolean, flags: Int) { onPlayer { this@PhonePlayerService.apply(Phone.Command(0, "mute", muted = muted), fromPage = true); usbVolumeChanged() } }
        /** The USB path came or went, or the level moved: the session re-reads the device. */
        fun deviceChanged() {
            val info = deviceInfo; val v = deviceVolume; val m = isDeviceMuted
            for (l in listeners) { runCatching { l.onDeviceInfoChanged(info); l.onDeviceVolumeChanged(v, m) } }
        }
    }
    /**
     * USB direct switched, or the DAC came or went: the sink decides per
     * track, so the current one is started again from where it is (a short
     * gap) and takes the new path. Called on the main thread.
     */
    fun usbChanged(force: Boolean = false) {
        if (session == null) return
        // The DAC, the switch or the DSD setting changed: what it can take is reported afresh.
        dsdBroken = false
        reportSoon()
        val wasUsb = usbSink?.usb == true
        val want = Store.usbDirect(this) && UsbDac.device() != null
        if (!force) {
            if (wasUsb == want && (wasUsb || !UsbDriver.active)) return
            if (!wasUsb && !want) return
        }
        if (player.mediaItemCount == 0) { if (!want) UsbDriver.close(); return }
        val idx = player.currentMediaItemIndex; val pos = player.currentPosition; val playing = player.playWhenReady
        player.stop()
        if (!want) UsbDriver.close()
        player.seekTo(idx, pos)
        player.prepare()
        player.playWhenReady = playing
        reportSoon()
        // The sink opens the stream on the next buffer; the session learns of the volume's new home shortly after.
        main.postDelayed({ sessionPlayer?.deviceChanged() }, 1500)
    }
    /** A setting from the server (hello, or a "dsp" command): run from the next buffer, kept for offline. */
    private fun applyDsp(json: JSONObject) {
        dsp.apply(Dsp.parse(json))
        Store.setDsp(this, json.toString())
        reportSoon()
    }

    /** Set on the phone's own Audio Devices page while offline: played at once, given to the server at the next hello. */
    fun setDspOffline(json: JSONObject) {
        Store.setDsp(this, json.toString())
        Store.setDspPending(this, true)
        main.post { applyDsp(json) }
    }

    /** The decoder at work on the current track (Media3's name for it), or null before the first. */
    @Volatile private var audioDecoder: String? = null
    /** Opus decoded by the app's libopus, to float — not Android's 16-bit decoder. */
    private fun floatOpus() = audioDecoder?.startsWith("libopus") == true

    /**
     * How [item] is being played, for the format badge on Now playing:
     * [FORMAT_OPUS] (the server's Opus 256 away, or an Opus download), else the
     * file as it is — [FORMAT_LOSSLESS] or its codec ("MP3") where the phone can
     * tell from a downloaded file, [FORMAT_ORIGINAL] for a stream (the server knows).
     */
    private fun formatOf(item: MediaItem?): String? {
        val uri = item?.localConfiguration?.uri ?: return null
        val ownExt = item.mediaMetadata.extras?.getString("ext")
        if (uri.scheme == "file" || ownExt != null) {
            return when (ownExt ?: uri.path.orEmpty().substringAfterLast('.').lowercase()) {
                "opus", "ogg" -> FORMAT_OPUS
                "flac", "wav", "aif", "aiff", "alac", "wv", "ape" -> FORMAT_LOSSLESS
                "mp3" -> "MP3"
                else -> null
            }
        }
        val opus = pinned[uri.toString()] ?: Store.wantsOpus(this)
        return if (opus) FORMAT_OPUS else FORMAT_ORIGINAL
    }

    // ------------------------------------------------------------ cached ahead

    private lateinit var cacheSource: CacheDataSource.Factory
    private val fetcher = Executors.newSingleThreadExecutor()
    @Volatile private var fetchGen = 0L
    @Volatile private var writer: CacheWriter? = null
    private val onNetwork: (Boolean) -> Unit = { fetchAheadSoon() }

    /**
     * A server stream's name in the cache: the track and its format —
     * whichever format is already wholly on the phone (played from there
     * wherever the phone is), else the one it's held to (see [pinned]), else
     * as a track starting now would be played. Null for anything else.
     */
    private fun keyFor(url: String): String? {
        val id = CachePlan.trackIdOf(url) ?: return null
        val variant = CachePlan.variantOf(url)
        pinned[url]?.let { return CachePlan.key(id, it, variant) }
        val opus = when {
            StreamCache.complete(this, CachePlan.key(id, false, variant)) -> false
            StreamCache.complete(this, CachePlan.key(id, true, variant)) -> true
            else -> Store.wantsOpus(this)
        }
        pinned[url] = opus
        return CachePlan.key(id, opus, variant)
    }

    /** The queue changed, a track began, the network or the settings changed: look again in a moment. */
    fun fetchAheadSoon() {
        main.removeCallbacks(fetchAhead)
        main.postDelayed(fetchAhead, 800)
    }

    private fun metered(): Boolean = runCatching {
        getSystemService(android.net.ConnectivityManager::class.java).isActiveNetworkMetered
    }.getOrDefault(true)

    /** The server addresses of the next [count] tracks in play order (shuffle and repeat included); null for downloads. */
    private fun upcoming(count: Int): List<String?> {
        val t = player.currentTimeline
        if (t.isEmpty || player.mediaItemCount == 0) return emptyList()
        val out = ArrayList<String?>()
        var i = player.currentMediaItemIndex
        val seen = HashSet<Int>()
        while (out.size < count) {
            i = t.getNextWindowIndex(i, player.repeatMode, player.shuffleModeEnabled)
            if (i == C.INDEX_UNSET || !seen.add(i) || i !in 0 until player.mediaItemCount) break
            val uri = player.getMediaItemAt(i).localConfiguration?.uri
            out += if (uri == null || uri.scheme == "file") null else uri.toString()
        }
        return out
    }

    /**
     * Like Plexamp: the next tracks — as many as Settings → Downloads says for
     * Wi-Fi or for mobile data — fetched into the cache one after another,
     * nearest first, while there's a queue to play. What's already there is
     * left alone; a change of plan stops the fetch under way and starts again.
     */
    private val fetchAhead = Runnable {
        if (!running) return@Runnable
        val isMetered = metered()
        val s = DownloadStore.settings(this)
        val count = if (isMetered) s.cacheMobile else s.cacheWifi
        val live = !localMode && player.mediaItemCount > 0
        val next = if (live) upcoming(count) else emptyList()
        // The playing track and the ones ahead keep their formats; the rest start afresh.
        val keep = HashSet<String>()
        player.currentMediaItem?.localConfiguration?.uri?.toString()?.let { keep += it }
        next.filterNotNull().forEach { keep += it }
        pinned.keys.retainAll(keep)

        val gen = ++fetchGen
        writer?.cancel()
        val wanted = next.filterNotNull().distinct()
        fetcher.execute {
            if (gen != fetchGen) return@execute
            val todo = CachePlan.toFetch(next, count) { url -> keyFor(url)?.let { StreamCache.complete(this, it) } ?: true }
            var failed = false
            for (url in todo) {
                if (gen != fetchGen || !running) return@execute
                val key = keyFor(url) ?: continue
                val w = CacheWriter(cacheSource.createDataSource(),
                    DataSpec.Builder().setUri(url).setKey(key).build(), null, null)
                writer = w
                try { w.cache() } catch (e: Exception) {
                    if (gen == fetchGen) { failed = true; Log.i(TAG, "couldn't fetch ahead: ${e.message}") }
                    break
                } finally { if (writer === w) writer = null }
                publishAhead(wanted, isMetered)
            }
            publishAhead(wanted, isMetered)
            // No network for the moment: try again shortly.
            if (failed && gen == fetchGen) main.postDelayed({ if (gen == fetchGen) fetchAheadSoon() }, 30_000)
        }
    }

    private fun publishAhead(wanted: List<String>, isMetered: Boolean) {
        val cached = wanted.count { url -> keyFor(url)?.let { StreamCache.complete(this, it) } == true }
        ahead = Ahead(cached, wanted.size, isMetered)
    }

    private fun mediaItem(it: Phone.Item): MediaItem {
        val meta = MediaMetadata.Builder()
            .setTitle(it.title)
            .setArtist(it.artist)
            .setAlbumTitle(it.album)
            .apply { it.artUrl?.let { u -> setArtworkUri(Uri.parse(Store.localize(this@PhonePlayerService, u))) } }
            // Which of the server's tracks it is, so a list the phone holds
            // itself can name it to the server (its cover, its album).
            .setExtras(android.os.Bundle().apply {
                it.trackId?.let { id -> putLong("track_id", id) }
                putDouble("duration", it.durationSeconds)
            })
            .build()
        // A downloaded copy plays in place of the stream.
        val local = DownloadStore.trackFile(this, it.trackId)
        return MediaItem.Builder()
            .setUri(if (local != null) Uri.fromFile(local) else Uri.parse(it.url))
            .setMediaId(it.trackId?.toString() ?: it.url)
            .setMediaMetadata(meta)
            .build()
    }

    /**
     * The network went (leaving the house, say): once the phone is on its
     * new route, carry on from the same place — a few tries, then give up.
     */
    private fun resumeAfterError(error: PlaybackException) {
        Log.i(TAG, "playback stopped: ${error.errorCodeName}")
        // A DSD track the DAC couldn't be given (Stage 9.3): the server is told
        // and sends the queue again with it as PCM; no point trying the same file.
        if (generateSequence<Throwable>(error) { it.cause }.any { UsbAudioSink.DsdUnplayable.matches(it) }) {
            Log.i(TAG, "DSD not playable here: asking for PCM")
            dsdBroken = true
            reportSoon()
            return
        }
        if (localMode || player.mediaItemCount == 0) return
        if (retries >= 4) {
            // Given up for now: the server is away longer than that (an update
            // is being applied, say). When it answers again, carry on from here.
            resumeWanted = resumeWanted || player.playWhenReady
            return
        }
        val wasPlaying = player.playWhenReady
        retries++
        Away.recheck(this)
        main.postDelayed({
            if (!running) return@postDelayed
            player.prepare()
            player.playWhenReady = wasPlaying
        }, 3000L * retries)
    }

    private fun ensurePrepared() {
        if (player.playbackState == Player.STATE_IDLE) player.prepare()
    }

    /** One command from the server, on the main thread. */
    private fun apply(c: Phone.Command, fromPage: Boolean = false) {
        if (c.op == "load" || c.op == "sync") localMode = false
        if (c.op in setOf("load", "sync", "stop", "clear")) restored = false
        // Playing downloads: the server's queue isn't the one playing, so its
        // queue edits don't apply (transport, volume and modes still do) —
        // except an album added to this list itself (v0.5.50: before, adding a
        // server album while a download played was dropped without a word).
        if (!fromPage && localMode && c.op in setOf("insert", "remove", "clear") && !(c.op == "insert" && c.local)) return
        when (c.op) {
            "load", "sync" -> {
                val items = c.items.map(::mediaItem)
                val waiting = pendingLoad
                if (waiting != null && c.op == "load" && items.isNotEmpty()) {
                    // Android Auto asked for this: it sets the items and plays.
                    pendingLoad = null
                    waiting.set(MediaSession.MediaItemsWithStartPosition(
                        items, c.index.coerceIn(0, items.size - 1), (c.seconds * 1000).toLong()))
                    return
                }
                if (items.isEmpty()) { player.clearMediaItems(); player.stop(); return }
                val index = c.index.coerceIn(0, items.size - 1)
                player.setMediaItems(items, index, (c.seconds * 1000).toLong())
                player.prepare()
                player.playWhenReady = c.play
            }
            "insert" -> {
                val at = c.at.coerceIn(0, player.mediaItemCount)
                player.addMediaItems(at, c.items.map(::mediaItem))
                if (c.play && !player.isPlaying) {
                    if (player.playbackState == Player.STATE_ENDED || player.playbackState == Player.STATE_IDLE) {
                        player.seekTo(at, 0)
                    }
                    ensurePrepared()
                    player.play()
                }
            }
            "remove" -> if (c.index in 0 until player.mediaItemCount) player.removeMediaItem(c.index)
            "clear" -> { player.clearMediaItems(); player.stop() }
            "play" -> {
                if (player.playbackState == Player.STATE_ENDED) player.seekTo(0, 0)
                ensurePrepared()
                player.play()
            }
            "pause" -> player.pause()
            "stop" -> { player.pause(); player.stop() }
            "next" -> player.seekToNextMediaItem()
            "previous" -> player.seekToPrevious()
            "seek" -> player.seekTo((c.seconds * 1000).toLong())
            "jump" -> if (c.index in 0 until player.mediaItemCount) {
                player.seekTo(c.index, 0)
                ensurePrepared()
                player.play()
            }
            "volume" -> if (usbVolume()) UsbDriver.setVolume(c.value) else {
                val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
                audio.setStreamVolume(AudioManager.STREAM_MUSIC, (c.value / 100.0 * max).roundToInt().coerceIn(0, max), 0)
            }
            "mute" -> if (usbVolume()) UsbDriver.setMute(c.muted) else audio.adjustStreamVolume(
                AudioManager.STREAM_MUSIC,
                if (c.muted) AudioManager.ADJUST_MUTE else AudioManager.ADJUST_UNMUTE, 0
            )
            "dsp" -> c.dsp?.let { applyDsp(it) }
            "mode" -> {
                player.shuffleModeEnabled = c.shuffle
                player.repeatMode = when (c.loop) {
                    "loop" -> Player.REPEAT_MODE_ALL
                    "loop_one" -> Player.REPEAT_MODE_ONE
                    else -> Player.REPEAT_MODE_OFF
                }
            }
            else -> Log.w(TAG, "unknown command ${c.op}")
        }
        reportSoon()
    }

    // ------------------------------------------------------------ reports

    private val heartbeat = object : Runnable {
        override fun run() {
            // While playing, the position and the volume keys' effect.
            if (player.isPlaying) {
                if (localMode) logLocalPlay()
                report()
            }
            if (running) main.postDelayed(this, 10_000)
        }
    }

    private fun reportSoon() {
        if (reportPending) return
        reportPending = true
        main.postDelayed({ reportPending = false; report() }, 300)
    }

    /** A downloaded track heard long enough to count, the same rule as the server's. */
    private fun logLocalPlay() {
        val item = player.currentMediaItem ?: return
        val key = item.mediaId + "@" + player.currentMediaItemIndex
        if (key == loggedKey) return
        val dur = if (player.duration > 0) player.duration / 1000.0 else 60.0
        if (player.currentPosition / 1000.0 >= minOf(30.0, maxOf(5.0, dur / 2))) {
            loggedKey = key
            item.mediaId.toLongOrNull()?.let { DownloadStore.addPlay(this, it) }
        }
    }

    /** What the player holds in local mode, numbered: sent to the server when it changes, so the page shows it. */
    @Volatile private var localRev = 0L
    private var localRevSent = -1L
    private fun localItemsJson(): JSONArray {
        val a = JSONArray()
        for (i in 0 until player.mediaItemCount) {
            val md = player.getMediaItemAt(i).mediaMetadata
            val x = md.extras
            a.put(JSONObject().put("title", md.title?.toString() ?: "").put("artist", md.artist?.toString() ?: "")
                .put("album", md.albumTitle?.toString() ?: "").put("image_key", x?.getString("image_key") ?: JSONObject.NULL)
                .put("album_key", x?.getString("album_key") ?: JSONObject.NULL).put("duration", x?.getDouble("duration", 0.0) ?: 0.0)
                .put("ext", x?.getString("ext") ?: JSONObject.NULL)
                .put("track_id", if (x != null && x.containsKey("track_id")) x.getLong("track_id") else JSONObject.NULL))
        }
        return a
    }

    /** Read the player (main thread), send it (background). */
    private fun report() {
        // Playing what the server doesn't hold (a download it doesn't know,
        // the phone's own music): the server is told the list itself, so the
        // page shows it like any queue.
        val count = player.mediaItemCount
        val local = localMode && count > 0
        val localItems = if (local && localRevSent != localRev) localItemsJson() else null
        val state = when {
            count == 0 -> "stopped"
            player.isPlaying -> "playing"
            player.playbackState == Player.STATE_BUFFERING && player.playWhenReady -> "loading"
            player.playbackState == Player.STATE_ENDED -> "stopped"
            player.playbackState == Player.STATE_IDLE && !player.playWhenReady -> if (restored) "paused" else "stopped"
            else -> "paused"
        }
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
        val muted = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && audio.isStreamMute(AudioManager.STREAM_MUSIC)
        val r = Phone.Report(
            index = if (count > 0) player.currentMediaItemIndex else -1,
            positionSeconds = player.currentPosition / 1000.0,
            durationSeconds = if (player.duration > 0) player.duration / 1000.0 else 0.0,
            state = state,
            shuffle = player.shuffleModeEnabled,
            loop = when (player.repeatMode) {
                Player.REPEAT_MODE_ALL -> "loop"
                Player.REPEAT_MODE_ONE -> "loop_one"
                else -> "disabled"
            },
            volume = if (usbVolume()) UsbDriver.volume() else (audio.getStreamVolume(AudioManager.STREAM_MUSIC) * 100.0 / max).roundToInt(),
            muted = if (usbVolume()) UsbDriver.isMuted() else muted,
            format = when (formatOf(player.currentMediaItem)) { FORMAT_OPUS -> if (floatOpus()) FORMAT_OPUS24 else FORMAT_OPUS; else -> "original" },
            dsp = dsp.active,
            usb = usbNow(),
            usbCaps = usbCaps(),
            local = local, localRev = localRev, localItems = localItems
        )
        val client = Store.client(this) ?: return
        val rev = localRev
        runCatching { reports.execute { runCatching { client.phoneReport(r) }.onSuccess { if (localItems != null) localRevSent = rev } } }
    }

    private fun deviceName(): String = phoneName()

    // ------------------------------------------------------------ Android Auto

    /** What Android Auto (and any other media browser) sees and plays. */
    private inner class Library : MediaLibrarySession.Callback {

        override fun onGetLibraryRoot(
            session: MediaLibrarySession, browser: MediaSession.ControllerInfo, params: LibraryParams?
        ): ListenableFuture<LibraryResult<MediaItem>> =
            Futures.immediateFuture(LibraryResult.ofItem(folder(ROOT, "Mandarin"), params))

        override fun onGetChildren(
            session: MediaLibrarySession, browser: MediaSession.ControllerInfo, parentId: String,
            page: Int, pageSize: Int, params: LibraryParams?
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
            val f = SettableFuture.create<LibraryResult<ImmutableList<MediaItem>>>()
            browse.execute {
                f.set(runCatching { LibraryResult.ofItemList(ImmutableList.copyOf(children(parentId)), params) }
                    .getOrElse { LibraryResult.ofError(SessionError.ERROR_IO) })
            }
            return f
        }

        override fun onSetMediaItems(
            mediaSession: MediaSession, controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>, startIndex: Int, startPositionMs: Long
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            val id = mediaItems.firstOrNull()?.mediaId ?: ""
            return when {
                id.startsWith(LOCAL) -> {
                    val album = id.removePrefix(LOCAL).toIntOrNull() ?: -1
                    val items = localItems(album)
                    if (items.isEmpty()) return Futures.immediateFailedFuture(IllegalStateException("not downloaded"))
                    // With the server in reach, through it (the phone's files still play):
                    // the car and the MusicD page show the same queue.
                    val zone = zoneId
                    val client = Store.client(this@PhonePlayerService)
                    if (connected && zone != null && client != null) return serverLoad(album, zone, client, items)
                    localMode = true
                    loggedKey = null
                    return Futures.immediateFuture(MediaSession.MediaItemsWithStartPosition(items, 0, 0L))
                }
                id.startsWith(SERVER) -> {
                    val album = id.removePrefix(SERVER).toIntOrNull()
                    val zone = zoneId
                    val client = Store.client(this@PhonePlayerService)
                    if (album == null || zone == null || client == null) {
                        return Futures.immediateFailedFuture(IllegalStateException("server not reachable"))
                    }
                    return serverLoad(album, zone, client, null)
                }
                else -> return super.onSetMediaItems(mediaSession, controller, mediaItems, startIndex, startPositionMs)
            }
        }

        /**
         * An album played on this phone through the server; its "load" command
         * answers. [fallback]: what to play if the server can't (a downloaded album).
         */
        private fun serverLoad(
            album: Int, zone: String, client: ServerClient, fallback: List<MediaItem>?
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            val fail = { f: SettableFuture<MediaSession.MediaItemsWithStartPosition>, e: Throwable ->
                if (fallback != null) {
                    localMode = true
                    loggedKey = null
                    f.set(MediaSession.MediaItemsWithStartPosition(fallback, 0, 0L))
                } else f.setException(e)
            }
            val f = SettableFuture.create<MediaSession.MediaItemsWithStartPosition>()
            pendingLoad?.cancel(false)
            pendingLoad = f
            browse.execute {
                runCatching {
                    client.post("/api/play", JSONObject().put("offset", album)
                        .put("zone_or_output_id", zone).put("kind", "play_now"), 20_000)
                }.onFailure { e -> main.post { if (pendingLoad === f) { pendingLoad = null; fail(f, e) } } }
            }
            // The server's answer comes as a "load" command; don't wait for ever.
            main.postDelayed({
                if (pendingLoad === f) { pendingLoad = null; fail(f, IllegalStateException("no answer")) }
            }, 15_000)
            return f
        }
    }

    /** One level of the tree. Runs off the main thread (it may ask the server). */
    private fun children(parentId: String): List<MediaItem> = when (parentId) {
        ROOT -> buildList {
            add(folder(DOWNLOADS, "Downloaded albums"))
            if (Store.client(this@PhonePlayerService) != null) {
                add(folder(PICKS, "Smart Picks"))
                add(folder(RANDOM, "Random albums"))
            }
        }
        DOWNLOADS -> DownloadStore.albums(this).filter { it.first.state == "done" }.map { (a, dir) ->
            album(LOCAL + a.id, a.title, a.artist, coverBytes(File(dir, "cover.jpg")))
        }
        PICKS -> serverAlbums("/api/smart-picks", "picks") { o ->
            Triple(o.optInt("offset"), o.optString("album"), o.optString("artist")) to o.optString("image_key")
        }
        RANDOM -> serverAlbums("/api/random-albums?count=20", "albums") { o ->
            Triple(o.optInt("offset"), o.optString("title"), o.optString("subtitle")) to o.optString("image_key")
        }
        else -> emptyList()
    }

    private fun serverAlbums(
        path: String, key: String, read: (JSONObject) -> Pair<Triple<Int, String, String>, String>
    ): List<MediaItem> {
        val client = Store.client(this) ?: return emptyList()
        val a = client.getJson(path, 10_000).optJSONArray(key) ?: return emptyList()
        return (0 until a.length()).map { i ->
            val (names, imageKey) = read(a.getJSONObject(i))
            val art = if (imageKey.isNotEmpty()) runCatching { client.bytes(client.imageUrl(imageKey, 300)) }.getOrNull() else null
            album(SERVER + names.first, names.second, names.third, art)
        }
    }

    private fun folder(id: String, title: String): MediaItem = MediaItem.Builder()
        .setMediaId(id)
        .setMediaMetadata(MediaMetadata.Builder()
            .setTitle(title).setIsBrowsable(true).setIsPlayable(false)
            .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_ALBUMS).build())
        .build()

    /** Covers go as bytes: Android Auto can't open the phone's files or the server's signed addresses. */
    private fun album(id: String, title: String, artist: String, art: ByteArray?): MediaItem = MediaItem.Builder()
        .setMediaId(id)
        .setMediaMetadata(MediaMetadata.Builder()
            .setTitle(title).setArtist(artist).setAlbumTitle(title)
            .setIsBrowsable(false).setIsPlayable(true)
            .setMediaType(MediaMetadata.MEDIA_TYPE_ALBUM)
            .apply { art?.let { setArtworkData(it, MediaMetadata.PICTURE_TYPE_FRONT_COVER) } }
            .build())
        .build()

    private fun coverBytes(f: File): ByteArray? = runCatching {
        if (!f.exists()) return null
        val o = android.graphics.BitmapFactory.Options().apply { inSampleSize = 4 }
        val bmp = android.graphics.BitmapFactory.decodeFile(f.path, o) ?: return null
        val out = java.io.ByteArrayOutputStream()
        bmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, 85, out)
        out.toByteArray()
    }.getOrNull()

    // ------------------------------------------------------------ offline page

    private val revisionLock = Object()
    @Volatile var revision = 1L
        private set

    private fun bumpRevision() {
        synchronized(revisionLock) { revision++; revisionLock.notifyAll() }
    }

    /** Wait (off the main thread) until something changes, or [ms] pass. */
    fun waitForChange(since: Long, ms: Long) {
        val until = System.currentTimeMillis() + ms
        synchronized(revisionLock) {
            while (revision == since) {
                val left = until - System.currentTimeMillis()
                if (left <= 0) break
                revisionLock.wait(left)
            }
        }
    }

    /** Run [f] with the player on the main thread and return its result (from any thread). */
    fun <T> onPlayer(f: (ExoPlayer) -> T): T? {
        if (Looper.myLooper() == Looper.getMainLooper()) return f(player)
        var out: T? = null
        val done = CountDownLatch(1)
        main.post { try { out = f(player) } finally { done.countDown() } }
        done.await(3, java.util.concurrent.TimeUnit.SECONDS)
        return out
    }

    /** Downloaded albums onto the player: now (from [startTrack] of the first), next, or at the end. */
    fun offlinePlay(albumIds: List<Int>, startTrack: Int, kind: String, onlyTrack: Int? = null): Boolean = onPlayer { p ->
        var items = albumIds.flatMap { localItems(it) }
        if (onlyTrack != null) items = listOfNotNull(items.getOrNull(onlyTrack))
        if (items.isEmpty()) return@onPlayer false
        localMode = true
        loggedKey = null
        val wasEmpty = p.mediaItemCount == 0
        when (kind) {
            "queue" -> p.addMediaItems(items)
            "add_next" -> p.addMediaItems((p.currentMediaItemIndex + 1).coerceAtMost(p.mediaItemCount), items)
            else -> {
                p.setMediaItems(items, startTrack.coerceIn(0, items.size - 1), 0L)
                p.prepare()
                p.play()
            }
        }
        if (wasEmpty && kind != "play_now") { p.prepare(); p.play() }
        bumpRevision()
        true
    } ?: false

    class OfflineItem(val trackId: Long?, val albumId: Int, val title: String, val artist: String,
                      val album: String, val imageKey: String?, val duration: Double,
                      /** The phone's own music: its album's key (LocalMusic). */
                      val albumKey: String? = null)

    class OfflineState(val state: String, val index: Int, val position: Double, val duration: Double,
                       val shuffle: Boolean, val loop: String, val volume: Int, val muted: Boolean,
                       val items: List<OfflineItem>, val revision: Long,
                       /** The current track's format ([formatOf]), for the badge. */
                       val format: String? = null,
                       /** The DSP engine is at work. */
                       val dsp: Boolean = false,
                       /** Through the USB driver: "rate/bits", else null. */
                       val usb: String? = null)

    /** What's playing, as the offline page shows it. */
    fun offlineState(): OfflineState? = onPlayer { p ->
        val items = (0 until p.mediaItemCount).map { i ->
            val m = p.getMediaItemAt(i)
            val md = m.mediaMetadata
            val x = md.extras
            OfflineItem(
                m.mediaId.toLongOrNull(), x?.getInt(EXTRA_ALBUM, -1) ?: -1,
                md.title?.toString() ?: "", md.artist?.toString() ?: "", md.albumTitle?.toString() ?: "",
                x?.getString("image_key"), x?.getDouble("duration", 0.0) ?: 0.0,
                x?.getString("album_key")
            )
        }
        val state = when {
            items.isEmpty() -> "stopped"
            p.isPlaying -> "playing"
            p.playbackState == Player.STATE_BUFFERING && p.playWhenReady -> "loading"
            p.playbackState == Player.STATE_ENDED -> "stopped"
            else -> "paused"
        }
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
        OfflineState(
            state, if (items.isEmpty()) -1 else p.currentMediaItemIndex,
            p.currentPosition / 1000.0, if (p.duration > 0) p.duration / 1000.0 else 0.0,
            p.shuffleModeEnabled,
            when (p.repeatMode) { Player.REPEAT_MODE_ALL -> "loop"; Player.REPEAT_MODE_ONE -> "loop_one"; else -> "disabled" },
            if (usbVolume()) UsbDriver.volume() else (audio.getStreamVolume(AudioManager.STREAM_MUSIC) * 100.0 / max).roundToInt(),
            if (usbVolume()) UsbDriver.isMuted() else Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && audio.isStreamMute(AudioManager.STREAM_MUSIC),
            items, revision, formatOf(p.currentMediaItem).let { if (it == FORMAT_OPUS && floatOpus()) FORMAT_OPUS24 else it },
            dsp.active, usbNow()
        )
    }

    /** The page's transport, volume and mode controls, offline — the same commands the server sends. */
    fun offlineCommand(c: Phone.Command) {
        onPlayer { apply(c, fromPage = true) }
        bumpRevision()
    }
}
