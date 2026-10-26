package com.musicd.server.android

/*
 * The phone's player dormant while idle (bug list item 203). Off screen and not playing for five minutes it asked to
 * stop (stopSelf), and on 26 Oct that did nothing three times over: Android keeps a media service bound (its media
 * controls, Bluetooth's browsing, Android Auto), and a bound service isn't ended by stopSelf. So it stayed up for
 * twenty idle minutes, its heartbeat every ten seconds and its long poll of the server's commands every 25 s, and said
 * it was stopping every five minutes. Now it goes dormant: the heartbeat and the long poll end, the server's hello is
 * owed again, and stopSelf is still asked, for Android to end it once nothing has it bound. Anything that needs it
 * wakes it: a start (play from the app, a download), a controller connecting, a player event (a Bluetooth play).
 */

/** Idle: the loops end and the service asks to stop; the player and the session stay for whoever has them bound. */
internal fun PhonePlayerService.dormant() {
    if (!running) return
    AppLog.line("APP", "the phone player stops: off screen, not playing for five minutes (dormant while Android keeps it bound)")
    running = false
    connected = false
    worker?.interrupt(); worker = null
    stopSelf()
}

/** Needed again: the long poll and the heartbeat start, as at the service's start; nothing while it runs or once it is destroyed. */
internal fun PhonePlayerService.wake() {
    if (running || PhonePlayerService.current !== this) return
    running = true
    worker = Thread({ loop() }, "phone-commands").apply { isDaemon = true; start() }
    main.postDelayed(heartbeat, 10_000)
    AppLog.line("APP", "the phone player wakes")
}
