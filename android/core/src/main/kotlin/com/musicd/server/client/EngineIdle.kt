package com.musicd.server.client

/**
 * Whether MusicD's own Tailscale engine (the app's child process) is kept running (item 202). Away it is the way to
 * the server and stays. At home it was kept joined and idle for as long as the app's process lived, so that leaving
 * the house needn't wait for it; on 26 Oct Android found it using 131 s of CPU in 300 s while the app sat in the
 * background after being swiped away, killed it, and killed Mandarin as its parent. At home it is now kept only while
 * the phone's player is playing (the one case where walking out needs it at once), and stopped once it has been idle
 * for [GRACE_MS]; away again, it is started in seconds, its sign-in kept on disk.
 */
class EngineIdle(private val clock: () -> Long) {
    enum class Verdict { KEEP, WAIT, STOP }

    private var idleSince: Long? = null

    /** The engine's fate now: [away] the way is away; [inUse] the phone's player is playing. */
    fun verdict(away: Boolean, inUse: Boolean): Verdict {
        if (away || inUse) { idleSince = null; return Verdict.KEEP }
        val now = clock()
        val from = idleSince ?: now.also { idleSince = it }
        return if (now - from >= GRACE_MS) Verdict.STOP else Verdict.WAIT
    }

    /** How long until the grace is up, for the next look; the whole grace while not idle. */
    fun remaining(): Long = idleSince?.let { (GRACE_MS - (clock() - it)).coerceAtLeast(0L) } ?: GRACE_MS

    companion object {
        const val GRACE_MS = 2 * 60_000L
    }
}
