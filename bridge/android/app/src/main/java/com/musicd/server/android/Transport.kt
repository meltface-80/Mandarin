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
 * The transport over ExoPlayer (item 315): what Mandarin tells the Bridge to play, over SlimProto (Slim.kt), where
 * before UPnP's AVTransport told it (Renderer.kt, gone). It keeps one track ([current]) and the one to follow it
 * ([next]): both are in ExoPlayer's list, so the join is gapless; when the player moves on by itself the next becomes
 * the current. Mandarin's word comes on the SlimProto thread and the player lives on the main one, so each step runs
 * there and waits for its answer ([onMain]). [changed] is told of every change, the player's or the DAC's.
 *
 * Its state, in the words the screen and /dac.json have always used: NO_MEDIA_PRESENT, STOPPED (after Stop or a new
 * track until Play), TRANSITIONING while it buffers, PLAYING, PAUSED_PLAYBACK — STOPPED with [error] when a track
 * couldn't be played (no DAC on the port).
 */
class Transport(private val main: Handler, private val player: ExoPlayer, private val changed: () -> Unit) {
    companion object {
        private const val TAG = "Transport"
        const val MODEL = "Mandarin Bridge"
    }

    /** A track: its address, and what Mandarin said of it (title, artist, album) for the screen and the notification. */
    class Item(val uri: String, val title: String = "", val artist: String = "", val album: String = "") {
        fun mediaItem(): MediaItem = MediaItem.Builder().setUri(Uri.parse(uri)).setMediaId(uri)
            .setMediaMetadata(MediaMetadata.Builder().setTitle(title.ifEmpty { null }).setArtist(artist.ifEmpty { null }).setAlbumTitle(album.ifEmpty { null }).build()).build()
    }

    // The transport, on the main thread only.
    @Volatile var current: Item? = null
        private set
    @Volatile var next: Item? = null
        private set
    private var stopped = true
    @Volatile var error: String? = null
        private set

    /** The player's listener: every change told, the next track's turn noticed. */
    val listener = object : Player.Listener {
        override fun onEvents(p: Player, events: Player.Events) { changed() }
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            // Moved on to the next track by itself: it is the current one now, and the first is dropped.
            if (player.currentMediaItemIndex == 1 && next != null) {
                current = next; next = null
                runCatching { player.removeMediaItem(0) }
                error = null
            }
            changed()
        }
        override fun onIsPlayingChanged(isPlaying: Boolean) { if (isPlaying) error = null; changed() }
    }

    /** A track that couldn't be played: STOPPED, with the reason (DacService says what it was). */
    /** Whether [error] is the track's (its format, a DSD the DAC can't take) rather than the DAC's or the network's. */
    @Volatile var trackFailed = false
    fun failed(why: String, track: Boolean = false) { error = why; trackFailed = track; stopped = true; changed() }
    /** The track started again by the service (a DAC plugged in): playing, the error gone. */
    fun resumed() { error = null; stopped = false; changed() }

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

    /** The transport's state, from any thread. */
    fun stateNow(): String = onMain { transportState() }

    /** How far into the track it is, in milliseconds (0 stopped). Main thread. */
    fun positionMs(): Long = if (stopped) 0 else player.currentPosition.coerceAtLeast(0)

    /** Buffered enough to start, waiting for Play (a track set to wait). Main thread. */
    fun readyToStart(): Boolean = current != null && player.playbackState == Player.STATE_READY && !player.playWhenReady

    /** Played to the end of everything it had. Main thread. */
    fun ended(): Boolean = current != null && player.playbackState == Player.STATE_ENDED && next == null

    /** [f] on the main thread, its answer waited for (five seconds at most): the player is only ever touched there. */
    fun <T> onMain(f: () -> T): T {
        if (android.os.Looper.myLooper() == main.looper) return f()
        val done = CountDownLatch(1)
        var out: T? = null
        var err: Throwable? = null
        main.post { try { out = f() } catch (e: Throwable) { err = e } finally { done.countDown() } }
        if (!done.await(5, TimeUnit.SECONDS)) throw IllegalStateException("the player didn't answer")
        err?.let { throw it }
        @Suppress("UNCHECKED_CAST")
        return out as T
    }

    // ------------------------------------------------------------ Mandarin's word

    /** [item] to play, the one before forgotten: started at once where [start], else waiting for [play]. */
    fun set(item: Item, start: Boolean) = onMain {
        current = item; next = null; error = null
        player.setMediaItem(item.mediaItem())
        player.prepare()
        stopped = !start
        player.playWhenReady = start
        Log.i(TAG, "set ${item.uri}${if (start) "" else " (waiting)"}")
        changed()
    }

    /** [item] to follow the one playing, gapless; null: nothing after it. */
    fun setNext(item: Item?) = onMain {
        next = item
        while (player.mediaItemCount > 1) player.removeMediaItem(player.mediaItemCount - 1)
        item?.let { player.addMediaItem(it.mediaItem()) }
        Log.i(TAG, "next ${item?.uri ?: "(none)"}")
        changed()
    }

    fun play() = onMain {
        if (current == null) return@onMain
        stopped = false; error = null
        if (player.playbackState == Player.STATE_IDLE) player.prepare()
        if (player.playbackState == Player.STATE_ENDED) player.seekTo(0, 0)
        player.play()
        changed()
    }

    fun pause() = onMain { if (current != null) player.pause(); changed() }

    /** The track playing told afresh (Mandarin's continuous PCM, item 322: the run goes on into its next track): what it is, for the screen and notification. */
    fun retitle(title: String, artist: String, album: String) = onMain {
        val c = current ?: return@onMain
        current = Item(c.uri, title, artist, album)
        changed()
    }

    /** Stopped, and what it played forgotten (SlimProto's strm q). */
    fun stop() = onMain {
        stopped = true; current = null; next = null
        player.stop(); player.clearMediaItems()
        changed()
    }
}
