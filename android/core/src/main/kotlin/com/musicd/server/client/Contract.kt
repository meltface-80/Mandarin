// Written by tools/quality/parity.js from docs/specs/screens.json (npm run parity -- write); never by hand.
package com.musicd.server.client

/**
 * The screens contract's labels (docs/specs/native-parity.md): what each
 * native control is called, aloud too, one per state, as the page calls it.
 */
object Contract {
    val labels: Map<String, List<String>> = mapOf(
        "now-playing.back" to listOf("Back"),
        "now-playing.share" to listOf("Share card"),
        "now-playing.tab-now-playing" to listOf("Now playing"),
        "now-playing.tab-queue" to listOf("Queue"),
        "now-playing.artist" to listOf("{artist}"),
        "now-playing.album" to listOf("Open album: {album}"),
        "now-playing.seek" to listOf("Seek"),
        "now-playing.shuffle" to listOf("Shuffle", "Shuffle on"),
        "now-playing.previous" to listOf("Previous track"),
        "now-playing.playpause" to listOf("Play", "Pause"),
        "now-playing.next" to listOf("Next track"),
        "now-playing.repeat" to listOf("Repeat off", "Repeat queue", "Repeat track"),
        "now-playing.device" to listOf("Choose device"),
        "now-playing.device-room" to listOf("{room}"),
        "now-playing.group" to listOf("Group zones…"),
        "now-playing.power" to listOf("Device power…"),
        "now-playing.pause-all" to listOf("Pause all zones"),
        "now-playing.mute-all" to listOf("Mute all zones"),
        "now-playing.unmute-all" to listOf("Unmute all zones"),
        "now-playing.volume" to listOf("Volume"),
        "now-playing.volume-slider" to listOf("Volume"),
        "now-playing.volume-down" to listOf("Volume down"),
        "now-playing.volume-up" to listOf("Volume up"),
    )

    /** [key]'s label in [state], each {…} in it filled from [fill] in turn. */
    fun label(key: String, state: Int = 0, vararg fill: String): String {
        val all = labels[key] ?: throw IllegalArgumentException("$key: not a control of the contract")
        var i = 0
        return Regex("\\{[^}]+}").replace(all[state.coerceIn(0, all.size - 1)]) { fill.getOrElse(i++) { "" } }
    }
}
