package com.musicd.server.client

/**
 * Soloist on the phone's test screen (bug list items 148, 150): what to do next, in plain words, and which buttons do
 * anything now. The owner found the first screen's instructions hard to follow: a paragraph up front, every button
 * always pressable (Play and Announce while Soloist wasn't even running). Now the screen says one step at a time, and a
 * button is enabled only when pressing it can work.
 */
object SoloistSteps {
    /** How things stand, as the screen knows it. */
    data class State(
        val inBuild: Boolean = true,
        val busy: String = "",                 // a step under way ("Downloading Soloist… 4 MB"), or ""
        val linuxRuns: Boolean? = null,        // glibc ran under proot: null not tried yet
        val downloaded: Boolean = false,
        val soloistRuns: Boolean? = null,      // soloist --version: null not tried yet
        val readyFailed: String = "",          // why Get ready stopped, or ""
        val hasKey: Boolean = false,
        val name: String = "Mandarin phone",
        val running: Boolean = false,
        val stopped: String = "",              // why Soloist ended by itself, or ""
        val listening: Boolean = false,        // it said its zeroconf port: the Spotify app can find it
        val announced: Boolean = false,
        val signedIn: Boolean = false,
        val connected: Boolean = false,        // its control socket
        val playing: Boolean = false,
        val track: String = "",
        val verdict: String = "",              // "lossless 24-bit", "lossy", … or "" before enough is heard
    )

    /** The next step: a heading, what to do, and the buttons that work now. */
    data class Next(
        val heading: String, val text: String,
        val getReady: Boolean = false, val start: Boolean = false, val stop: Boolean = false,
        val announce: Boolean = false, val play: Boolean = false,
    )

    private const val SEND = "Tap Share report at the bottom and send it to me — it's something to fix on our side, not something you did."

    fun next(s: State): Next {
        val q = "“${s.name}”"
        return when {
            !s.inBuild -> Next("This app has no Soloist in it", "It was built without Soloist's Linux runtime, so there's nothing to try here.")
            s.busy.isNotEmpty() -> Next("Working…", s.busy, stop = s.running)
            s.readyFailed.isNotEmpty() -> Next("Getting ready didn't finish", "${s.readyFailed}\n\n$SEND", getReady = true)
            s.soloistRuns != true -> Next("Step 1 of 3 · Get ready",
                "Tap Get ready. It sets up Linux inside the app and downloads Soloist from Spotify (about 13 MB), then checks it runs. It takes under a minute.",
                getReady = true)
            !s.running && s.stopped.isNotEmpty() -> Next("Soloist stopped", "${s.stopped}\n\n$SEND", getReady = true, start = s.hasKey)
            !s.running && !s.hasKey -> Next("Step 2 of 3 · Your Soloist key",
                "Paste your Soloist key in the Soloist key box above — the same key that's in Mandarin's Settings → Services → Spotify on the server. Then tap Start.",
                getReady = true)
            !s.running -> Next("Step 2 of 3 · Start", "Tap Start. Soloist then runs on this phone while its notification shows, screen off or not.", getReady = true, start = true)
            !s.listening && !s.signedIn -> Next("Starting…", "Soloist is starting. This takes a few seconds.", stop = true)
            !s.signedIn -> Next("Step 3 of 3 · Choose $q in the Spotify app",
                "Once only, at home on Wi-Fi: open the Spotify app, play anything, tap the devices icon (the speaker at the bottom of the player) and choose $q." +
                    (if (s.announced) " It's being announced on the Wi-Fi now — give the list a few seconds." else " Not in the list? Tap Announce on Wi-Fi here, then look again.") +
                    " After this once, it signs itself in, at home or away.",
                stop = true, announce = !s.announced)
            !s.playing -> Next("Signed in · play something",
                "Paste a Spotify album or playlist link in the box below and tap Play — or, in the Spotify app, play to $q.",
                stop = true, play = s.connected)
            else -> Next("Playing on this phone",
                "${s.track.ifEmpty { "Spotify" }}\nSound: ${s.verdict.ifEmpty { "checking whether it's lossless…" }}\n\nLet it play a minute, then tap Share report so I can see how it went.",
                stop = true, play = s.connected)
        }
    }

    /** One line of the checklist: done (true), failed (false) or not yet (null). */
    data class Check(val text: String, val done: Boolean?)

    fun checklist(s: State): List<Check> = listOf(
        Check("Linux runs in the app", s.linuxRuns),
        Check("Soloist downloaded", if (s.downloaded) true else if (s.linuxRuns == true && s.readyFailed.isNotEmpty() && s.soloistRuns == null) false else null),
        Check("Soloist runs on this phone", s.soloistRuns?.let { it && s.stopped.isEmpty() } ?: if (s.stopped.isNotEmpty()) false else null),
        Check("Signed in to Spotify", if (s.signedIn) true else null),
        Check("Playing", if (s.playing) true else null),
        Check(if (s.verdict.startsWith("lossless")) "Lossless (${s.verdict.removePrefix("lossless ")})" else if (s.verdict == "lossy") "Lossless — no, lossy" else "Lossless",
            when { s.verdict.startsWith("lossless") -> true; s.verdict == "lossy" -> false; else -> null }),
    )
}
