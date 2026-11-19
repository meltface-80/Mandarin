package com.musicd.server.client

/*
 * Which room a screen follows, and the wait for the server when the app comes back on screen (bug list item 485).
 *
 * A screen is opened in a room and stays on show when the app goes offline (item 117); offline the phone is the one
 * room, so the screen follows the phone's. It used to ask for its own room still, and the phone answered with its own
 * player: kept as the server's room's, that stayed on Now playing after the server was back. And the app can be offline
 * for a moment only: off screen the Wi-Fi drops, the app's own Tailscale isn't up in ten seconds, and the server is
 * found again within two of the app being opened. For that moment the screen showed the phone's queue (a song of hours
 * before, where the room had another ready to play). So while the server is looked for, the screen keeps its room as
 * the server last told it.
 */

/** The room followed: [id], and whether it is asked for now ([ask]); not asked, the screen shows what was last answered. */
data class Followed(val id: String, val ask: Boolean)

object RoomFollowed {
    /**
     * The room the screen opened in [screen] follows. At home, its own. [offline], the phone's ([phone]) — but while the
     * server is still [looking]ed for, its own, not asked for: the phone has nothing to say of it ([PhoneRoom]), and the
     * server answers in a moment or the phone's room takes its place. [away] with the server answering, the phone's too
     * (item 487): it is the one room the server offers there, and another's is refused ([AwayRoom]). The phone's room not
     * yet known ([phone] empty), the screen's own.
     */
    fun of(screen: String, offline: Boolean, looking: Boolean, away: Boolean, phone: String): Followed = when {
        screen.isEmpty() -> Followed("", false)
        phone.isEmpty() || screen == phone -> Followed(screen, true)
        offline -> if (looking) Followed(screen, false) else Followed(phone, true)
        away -> Followed(phone, true)
        else -> Followed(screen, true)
    }
}

/**
 * The wait for the server as the app comes back on screen offline: begun there ([begin]), over when the look for the
 * server answers ([answered]) or there is none to wait for ([end]). Looks are numbered ([asked]), as one can be asked
 * for while another is out: the Wi-Fi back a moment after the screen, the look begun on the old way fails and the one
 * asked for since finds the server. A look that fails ends the wait only if none was asked for after it.
 */
class LookWait {
    private var asked = 0

    /** Waiting: the screens keep the server's rooms as last answered. */
    var waiting = false
        private set

    /** On screen again, offline, the server about to be looked for. */
    fun begin() { waiting = true }

    /** A look asked for: its number, for [answered]. */
    fun asked(): Int = ++asked

    /** Look [look] has its answer, the server [back] or not. */
    fun answered(look: Int, back: Boolean) { if (back || look == asked) waiting = false }

    /** No look to wait for: off screen, online, Offline mode, or no network. */
    fun end() { waiting = false }

    companion object {
        /**
         * The longest the screens wait, from when the way to the server last changed (item 487). At home the server is a
         * moment away, and its look can take a few seconds: six. [away], three: at the start that may only be the Wi-Fi
         * not yet awake (it was back half a second after the screen, and the wait then runs on as at home), but away for
         * good the room is the phone's whatever the look finds, and six seconds of the room left at home was too long.
         */
        fun mostMs(away: Boolean): Long = if (away) 3_000L else 6_000L
    }
}
