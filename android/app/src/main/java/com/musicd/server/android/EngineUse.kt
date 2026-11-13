package com.musicd.server.android

import android.content.Context
import android.os.Looper
import com.musicd.server.client.EngineExit
import com.musicd.server.client.EngineRest
import com.musicd.server.client.LogRedact
import com.musicd.server.client.ServerAddress
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * MusicD's own Tailscale engine in use, or not (item 404). On 13 Nov Android ended the app twice for the engine's CPU
 * while nothing but the app's long polls went through it: the app's at-home stop waited on main-thread timers that
 * Android froze with the app. The engine now stops itself (android/musicdnet, idle.go) once nothing real has gone
 * through it for a while and the app's lease has run out, and when it burns CPU with nothing passing through; here:
 *
 *  - the lease: renewed on a thread of its own while the app is on screen or the phone's player plays (a track the
 *    phone holds whole sends nothing through the engine for minutes), and frozen with the app, as it should be;
 *  - its stop said in the app's log from its note ([ended], or [leftOver] at the next start if the app was frozen
 *    or ended meanwhile), never kept as a crash;
 *  - brought back when it is used again ([revive]): a request while the app is in use, a stream, a download — not a
 *    look at the way, nor the phone player's long poll in the background ([EngineRest]).
 */
internal object EngineUse {
    val rest = EngineRest()
    @Volatile private var playing = false

    fun wanted(): Boolean = EngineRest.wanted(NativeShell.onScreen.value, playing)

    /** The phone's player playing or not (its onIsPlayingChanged); stopped, the engine at home is looked at now. */
    fun player(c: Context, isPlaying: Boolean) {
        playing = isPlaying
        if (isPlaying) renewSoon() else Away.lookAtEngine(c)
    }

    private val keeper = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "musicdnet-keep").apply { isDaemon = true } }
    @Volatile private var keeping = false

    /** A new engine process: no longer resting, and its lease given now and renewed while it is wanted. */
    fun started() {
        rest.started()
        if (!keeping) {
            keeping = true
            keeper.scheduleWithFixedDelay({ renew() }, EngineRest.RENEW_MS, EngineRest.RENEW_MS, TimeUnit.MILLISECONDS)
        }
        renewSoon()
    }

    private fun renewSoon() { keeper.execute { renew() } }

    private fun renew() {
        if (TailscaleEngine.alive() && wanted()) runCatching { TailscaleEngine.call("POST", "/keep?s=${EngineRest.LEASE_S}", timeoutMs = 3000) }
    }

    /** The engine ended with [code] (its watcher thread): true when it stopped itself, said in the log from its note. */
    fun ended(c: Context, code: Int): Boolean {
        rest.ended(code)
        if (!EngineExit.selfStop(code)) return false
        logNote(c)
        return true
    }

    /** A note of a stop of its own not yet logged (the app frozen or ended when it stopped): logged at the next start. */
    fun leftOver(c: Context) = logNote(c)

    @Synchronized
    private fun logNote(c: Context) {
        val f = File(File(c.filesDir, "tailscale"), "stopped.txt")
        if (!f.exists()) return
        val note = runCatching { EngineExit.parse(f.readText().take(16_384)) }.getOrNull()
        f.delete()
        if (note != null) AppLog.line("REACH", EngineExit.logLine(note) { LogRedact.line(it) }, anomaly = note.kind == "cpu")
    }

    /**
     * Before a request over the engine ([Away.notBeforeVpn]) or a stream from it ([forStream]): an engine that stopped
     * itself is brought back if the app is in use, or for [explicit] use (a stream), and waited for up to 15 s, so the
     * screens show nothing broken. Blocking; nothing on the main thread.
     */
    fun revive(c: Context, explicit: Boolean = false) {
        if (TailscaleEngine.forwarding() || !Store.isAway(c) || !Store.viaEngine(c) || Looper.myLooper() == Looper.getMainLooper()) return
        if (explicit || (rest.resting && wanted())) Away.revive(c)
    }

    /** A stream's address as it is opened (PhonePlayerService): over the engine, the engine up first. */
    fun forStream(c: Context, url: String): String {
        if (url.startsWith(ServerAddress("127.0.0.1", TailscaleEngine.PORT).baseUrl + "/")) revive(c, explicit = true)
        return url
    }
}
