package com.musicd.server.client

/**
 * MusicD's own Tailscale engine stopping itself (item 404): on 13 Nov Android ended the app twice for the engine's CPU,
 * with nothing but the app's long polls going through it, while the app's own stop waited on timers Android had frozen.
 * The engine (android/musicdnet, idle.go) now exits by itself when idle, with exit code [IDLE], or when busy on the CPU
 * with nothing passing through, [CPU], and leaves a note saying why ([parse]); the app logs it ([logLine]) rather than
 * keeping a crash note, and starts it again when it is wanted ([EngineRest]).
 */
object EngineExit {
    const val IDLE = 3
    const val CPU = 4

    /** The engine's own stop, not a crash or a kill. */
    fun selfStop(code: Int): Boolean = code == IDLE || code == CPU

    /** The engine's note: [kind] "idle" or "cpu", the watch's [why], its CPU seconds so far, what was busy, its last lines. */
    data class Note(val kind: String, val why: String, val cpu: String?, val busy: List<String>, val lines: List<String>)

    /** The note's text (one `key value` a line); null when it isn't one. Bounded, whatever is in the file. */
    fun parse(text: String): Note? {
        var kind: String? = null
        var why = ""
        var cpu: String? = null
        val busy = ArrayList<String>()
        val lines = ArrayList<String>()
        for (l in text.lineSequence().take(60)) {
            val key = l.substringBefore(' ')
            val v = l.substringAfter(' ', "").take(400)
            when (key) {
                "kind" -> kind = v
                "why" -> why = v
                "cpu" -> cpu = v
                "busy" -> if (busy.size < 10) busy += v
                "line" -> if (lines.size < 12) lines += v
            }
        }
        return Note(kind ?: return null, why, cpu, busy, lines)
    }

    /** The app's log line for [note], each of the engine's own lines through [redact] (addresses and names out). */
    fun logLine(note: Note, redact: (String) -> String): String =
        "the Tailscale engine stopped itself (" + (if (note.kind == "cpu") "CPU" else "idle") + ": " + note.why + "): cpu " +
            (note.cpu ?: "?") + " s" +
            (if (note.busy.isEmpty()) "" else "; what was busy: " + note.busy.joinToString(" | ") { redact(it) }) +
            (if (note.lines.isEmpty()) "" else "; its last lines: " + note.lines.joinToString(" | ") { redact(it) })
}

/**
 * Whether the engine is started again (item 404). Once it has stopped itself it rests: a look at the way to the server
 * (a network change, the phone player's retries of its long poll) doesn't bring it back, or the long polls it stopped
 * for would start it again every few minutes; only a use does — the app on screen, the phone's player playing, a stream
 * or a download.
 */
class EngineRest {
    @Volatile var resting = false
        private set

    /** The engine ended with [code]: resting if it stopped itself. */
    fun ended(code: Int) { if (EngineExit.selfStop(code)) resting = true }

    /** Started (again). */
    fun started() { resting = false }

    /** A look at the way may start it: it isn't resting, or it is [wanted]. */
    fun mayStart(wanted: Boolean): Boolean = !resting || wanted

    companion object {
        /** In use: the app on screen, or the phone's player playing (the lease the engine is given while so). */
        fun wanted(onScreen: Boolean, playing: Boolean): Boolean = onScreen || playing

        /** The lease, renewed each [RENEW_MS] while wanted: long enough to outlast a missed renewal. */
        const val LEASE_S = 180
        const val RENEW_MS = 60_000L
    }
}
