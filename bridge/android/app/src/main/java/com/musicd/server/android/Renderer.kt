package com.musicd.server.android

import android.net.Uri
import android.os.Handler
import android.util.Log
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * The UPnP MediaRenderer over ExoPlayer: the three services' actions
 * answered, and their state evented.
 *
 * AVTransport keeps one track ([current]) and the one to follow it
 * ([next], SetNextAVTransportURI): both are in ExoPlayer's list, so the join
 * is gapless; when the player moves on by itself the next becomes the
 * current and the control point sees the new URI. A control point's call
 * comes on an HTTP thread and the player lives on the main one, so each
 * action runs there and waits for its answer ([onMain]).
 *
 * TransportState is STOPPED after Stop or a new URI until Play is called,
 * then follows the player: TRANSITIONING while it buffers, PLAYING,
 * PAUSED_PLAYBACK, STOPPED at the end — or STOPPED with the status
 * ERROR_OCCURRED when a track couldn't be played (no DAC on the port).
 *
 * RenderingControl's volume is the DAC's own USB volume control where it
 * has one and the volume isn't fixed; else 100, fixed, as the DAC's page
 * says. ConnectionManager's Sink is what the DAC takes (DacService.sink).
 */
class Renderer(private val main: Handler, private val player: ExoPlayer, private val sink: () -> String, private val changed: () -> Unit) {
    companion object {
        private const val TAG = "Renderer"
        private const val AVT_NS = "urn:schemas-upnp-org:metadata-1-0/AVT/"
        private const val RCS_NS = "urn:schemas-upnp-org:metadata-1-0/RCS/"
    }

    class Item(val uri: String, val meta: String) {
        val didl: Xml.Didl = Xml.parseDidl(meta)
        fun mediaItem(): MediaItem = MediaItem.Builder().setUri(Uri.parse(uri)).setMediaId(uri)
            .setMediaMetadata(MediaMetadata.Builder().setTitle(didl.title.ifEmpty { null }).setArtist(didl.artist.ifEmpty { null }).setAlbumTitle(didl.album.ifEmpty { null }).build()).build()
    }

    val avt = Events(Scpd.AVT)
    val rcs = Events(Scpd.RCS)
    val cms = Events(Scpd.CMS)

    // The transport, on the main thread only.
    @Volatile var current: Item? = null
        private set
    @Volatile var next: Item? = null
        private set
    private var stopped = true
    @Volatile var error: String? = null
        private set
    private var lastAvt: List<Pair<String, String>> = emptyList()
    private var lastRcs: List<Pair<String, String>> = emptyList()
    private var lastSink = ""

    /** The player's listener: every change evented, the next track's turn noticed. */
    val listener = object : Player.Listener {
        override fun onEvents(p: Player, events: Player.Events) { evented() }
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            // Moved on to the next track by itself (or by Next): it is the current one now, and the first is dropped.
            if (player.currentMediaItemIndex == 1 && next != null) {
                current = next; next = null
                runCatching { player.removeMediaItem(0) }
                error = null
            }
            evented()
        }
        override fun onIsPlayingChanged(isPlaying: Boolean) { if (isPlaying) error = null; evented() }
    }

    /** A track that couldn't be played: STOPPED, with the reason (DacService says what it was). */
    fun failed(why: String) { error = why; stopped = true; evented() }
    /** The track started again by the service (a DAC plugged in): playing, the error gone. */
    fun resumed() { error = null; stopped = false; evented() }

    // ------------------------------------------------------------ the state

    fun transportState(): String = when {
        current == null -> "NO_MEDIA_PRESENT"
        stopped -> "STOPPED"
        player.isPlaying -> "PLAYING"
        player.playbackState == Player.STATE_BUFFERING && player.playWhenReady -> "TRANSITIONING"
        player.playbackState == Player.STATE_ENDED -> "STOPPED"
        player.playbackState == Player.STATE_IDLE -> "STOPPED"
        player.playWhenReady -> "TRANSITIONING"
        else -> "PAUSED_PLAYBACK"
    }

    private fun durationSeconds(): Double {
        val d = player.duration
        if (d > 0 && d != androidx.media3.common.C.TIME_UNSET) return d / 1000.0
        return current?.didl?.durationSeconds ?: 0.0
    }
    private fun positionSeconds(): Double = if (stopped) 0.0 else player.currentPosition.coerceAtLeast(0) / 1000.0

    private fun avtVars(): List<Pair<String, String>> {
        val c = current; val n = next
        return listOf(
            "TransportState" to transportState(),
            "TransportStatus" to (if (error != null) "ERROR_OCCURRED" else "OK"),
            "PlaybackStorageMedium" to (if (c != null) "NETWORK" else "NONE"),
            "NumberOfTracks" to (if (c != null) "1" else "0"),
            "CurrentTrack" to (if (c != null) "1" else "0"),
            "CurrentTrackDuration" to Xml.hms(durationSeconds()),
            "CurrentMediaDuration" to Xml.hms(durationSeconds()),
            "CurrentTrackMetaData" to (c?.meta ?: ""),
            "CurrentTrackURI" to (c?.uri ?: ""),
            "AVTransportURI" to (c?.uri ?: ""),
            "AVTransportURIMetaData" to (c?.meta ?: ""),
            "NextAVTransportURI" to (n?.uri ?: ""),
            "NextAVTransportURIMetaData" to (n?.meta ?: ""),
            "CurrentPlayMode" to "NORMAL",
            "TransportPlaySpeed" to "1",
            "CurrentTransportActions" to actions()
        )
    }
    private fun actions(): String = when (transportState()) {
        "NO_MEDIA_PRESENT" -> ""
        "PLAYING" -> "Pause,Stop,Seek,Next,Previous"
        "PAUSED_PLAYBACK" -> "Play,Stop,Seek,Next,Previous"
        else -> "Play,Seek,Next,Previous"
    }
    private fun rcsVars(): List<Pair<String, String>> = listOf("Volume" to UsbDriver.volume().toString(), "Mute" to (if (UsbDriver.isMuted()) "1" else "0"))

    /** Something may have changed (the player, the DAC, a setting): whatever did is evented. Main thread. */
    fun evented() {
        val a = avtVars()
        if (a != lastAvt) {
            val diff = a.filter { (k, v) -> lastAvt.firstOrNull { it.first == k }?.second != v }
            lastAvt = a
            avt.changed(avt.lastChange(AVT_NS, diff))
        }
        val r = rcsVars()
        if (r != lastRcs) { lastRcs = r; rcs.changed(rcs.lastChange(RCS_NS, r, setOf("Volume", "Mute"))) }
        val s = sink()
        if (s != lastSink) { lastSink = s; cms.changed(cms.propertySet(listOf("SourceProtocolInfo" to "", "SinkProtocolInfo" to s, "CurrentConnectionIDs" to "0"))) }
        changed()
    }

    /** The whole state, for a new subscriber's first event. Any thread. */
    fun avtInitial(): String = avt.lastChange(AVT_NS, onMain { avtVars() })
    fun rcsInitial(): String = rcs.lastChange(RCS_NS, rcsVars(), setOf("Volume", "Mute"))
    fun cmsInitial(): String = cms.propertySet(listOf("SourceProtocolInfo" to "", "SinkProtocolInfo" to sink(), "CurrentConnectionIDs" to "0"))

    // ------------------------------------------------------------ actions

    /** The transport's state, from any thread. */
    fun stateNow(): String = onMain { transportState() }

    /** [f] on the main thread, its answer waited for (five seconds at most): the player is only ever touched there. */
    fun <T> onMain(f: () -> T): T {
        if (android.os.Looper.myLooper() == main.looper) return f()
        val done = CountDownLatch(1)
        var out: T? = null
        var err: Throwable? = null
        main.post { try { out = f() } catch (e: Throwable) { err = e } finally { done.countDown() } }
        if (!done.await(5, TimeUnit.SECONDS)) throw Soap.Fault(501, "the player didn't answer")
        err?.let { throw it }
        @Suppress("UNCHECKED_CAST")
        return out as T
    }

    private fun instance(a: Xml.Action) { if ((a.args["InstanceID"] ?: "0").trim() != "0") throw Soap.Fault(718, "Invalid InstanceID") }

    /** The answer to [a] (the response's arguments), or a [Soap.Fault]. */
    fun handle(service: String, a: Xml.Action): List<Pair<String, String>> = when (service) {
        "AVTransport" -> avTransport(a)
        "RenderingControl" -> renderingControl(a)
        "ConnectionManager" -> connectionManager(a)
        else -> throw Soap.Fault(401, "Invalid Action")
    }

    private fun avTransport(a: Xml.Action): List<Pair<String, String>> {
        instance(a)
        return when (a.name) {
            "SetAVTransportURI" -> onMain {
                val uri = a.args["CurrentURI"]?.trim() ?: ""
                if (uri.isEmpty()) throw Soap.Fault(716, "Resource not found")
                val playing = player.playWhenReady && !stopped
                current = Item(uri, a.args["CurrentURIMetaData"] ?: ""); next = null; error = null
                player.setMediaItem(current!!.mediaItem())
                player.prepare()
                // Playing on, as most renderers do, when it was; else stopped until Play.
                stopped = !playing
                player.playWhenReady = playing
                Log.i(TAG, "SetAVTransportURI $uri")
                evented(); emptyList()
            }
            "SetNextAVTransportURI" -> onMain {
                val uri = a.args["NextURI"]?.trim() ?: ""
                if (current == null && uri.isNotEmpty()) throw Soap.Fault(701, "Transition not available")
                next = if (uri.isEmpty()) null else Item(uri, a.args["NextURIMetaData"] ?: "")
                while (player.mediaItemCount > 1) player.removeMediaItem(player.mediaItemCount - 1)
                next?.let { player.addMediaItem(it.mediaItem()) }
                Log.i(TAG, "SetNextAVTransportURI ${uri.ifEmpty { "(none)" }}")
                evented(); emptyList()
            }
            "Play" -> onMain {
                if (current == null) throw Soap.Fault(701, "Transition not available")
                stopped = false; error = null
                if (player.playbackState == Player.STATE_IDLE) player.prepare()
                if (player.playbackState == Player.STATE_ENDED) player.seekTo(0, 0)
                player.play()
                evented(); emptyList()
            }
            "Pause" -> onMain { if (current == null) throw Soap.Fault(701, "Transition not available"); player.pause(); evented(); emptyList() }
            "Stop" -> onMain { stopped = true; player.stop(); evented(); emptyList() }
            "Seek" -> onMain {
                if (current == null) throw Soap.Fault(701, "Transition not available")
                val unit = a.args["Unit"] ?: ""
                val target = a.args["Target"] ?: ""
                when (unit) {
                    "REL_TIME", "ABS_TIME" -> player.seekTo((Xml.hmsToSeconds(target) * 1000).toLong())
                    "TRACK_NR" -> if (target.trim() != "1") throw Soap.Fault(711, "Illegal seek target")
                    else -> throw Soap.Fault(710, "Seek mode not supported")
                }
                evented(); emptyList()
            }
            "Next" -> onMain { if (next == null) throw Soap.Fault(711, "Nothing next"); player.seekToNextMediaItem(); evented(); emptyList() }
            "Previous" -> onMain { if (current == null) throw Soap.Fault(701, "Transition not available"); player.seekTo(0); evented(); emptyList() }
            "SetPlayMode" -> if ((a.args["NewPlayMode"] ?: "NORMAL") == "NORMAL") emptyList() else throw Soap.Fault(712, "Play mode not supported")
            "GetTransportInfo" -> onMain { listOf("CurrentTransportState" to transportState(), "CurrentTransportStatus" to (if (error != null) "ERROR_OCCURRED" else "OK"), "CurrentSpeed" to "1") }
            "GetPositionInfo" -> onMain {
                val c = current
                val pos = Xml.hms(positionSeconds())
                listOf("Track" to (if (c != null) "1" else "0"), "TrackDuration" to Xml.hms(durationSeconds()), "TrackMetaData" to (c?.meta ?: ""), "TrackURI" to (c?.uri ?: ""),
                    "RelTime" to pos, "AbsTime" to pos, "RelCount" to "2147483647", "AbsCount" to "2147483647")
            }
            "GetMediaInfo" -> onMain {
                val c = current; val n = next
                listOf("NrTracks" to (if (c != null) "1" else "0"), "MediaDuration" to Xml.hms(durationSeconds()), "CurrentURI" to (c?.uri ?: ""), "CurrentURIMetaData" to (c?.meta ?: ""),
                    "NextURI" to (n?.uri ?: ""), "NextURIMetaData" to (n?.meta ?: ""), "PlayMedium" to (if (c != null) "NETWORK" else "NONE"), "RecordMedium" to "NOT_IMPLEMENTED", "WriteStatus" to "NOT_IMPLEMENTED")
            }
            "GetDeviceCapabilities" -> listOf("PlayMedia" to "NETWORK", "RecMedia" to "NOT_IMPLEMENTED", "RecQualityModes" to "NOT_IMPLEMENTED")
            "GetTransportSettings" -> listOf("PlayMode" to "NORMAL", "RecQualityMode" to "NOT_IMPLEMENTED")
            "GetCurrentTransportActions" -> onMain { listOf("Actions" to actions()) }
            else -> throw Soap.Fault(401, "Invalid Action")
        }
    }

    private fun renderingControl(a: Xml.Action): List<Pair<String, String>> {
        instance(a)
        return when (a.name) {
            "GetVolume" -> listOf("CurrentVolume" to UsbDriver.volume().toString())
            "SetVolume" -> {
                val v = a.args["DesiredVolume"]?.trim()?.toDoubleOrNull()?.toInt() ?: throw Soap.Fault(402, "Invalid Args")
                if (UsbDriver.controlsVolume) UsbDriver.setVolume(v.coerceIn(0, 100))
                onMain { evented() }; emptyList()
            }
            "GetMute" -> listOf("CurrentMute" to (if (UsbDriver.isMuted()) "1" else "0"))
            "SetMute" -> {
                val m = a.args["DesiredMute"]?.trim()?.lowercase()
                if (UsbDriver.controlsVolume) UsbDriver.setMute(m == "1" || m == "true")
                onMain { evented() }; emptyList()
            }
            "ListPresets" -> listOf("CurrentPresetNameList" to "FactoryDefaults")
            "SelectPreset" -> emptyList()
            else -> throw Soap.Fault(401, "Invalid Action")
        }
    }

    private fun connectionManager(a: Xml.Action): List<Pair<String, String>> = when (a.name) {
        "GetProtocolInfo" -> listOf("Source" to "", "Sink" to sink())
        "GetCurrentConnectionIDs" -> listOf("ConnectionIDs" to "0")
        "GetCurrentConnectionInfo" -> listOf("RcsID" to "0", "AVTransportID" to "0", "ProtocolInfo" to "", "PeerConnectionManager" to "", "PeerConnectionID" to "-1", "Direction" to "Input", "Status" to "OK")
        else -> throw Soap.Fault(401, "Invalid Action")
    }
}
