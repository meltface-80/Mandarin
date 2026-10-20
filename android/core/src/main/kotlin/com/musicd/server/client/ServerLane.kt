package com.musicd.server.client

import java.util.concurrent.Callable
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future

/**
 * The app's changes to what Home shows (Listen later, a favourite, the rows' order) made one call at a time, in the order
 * they were asked for, each made to the end whatever becomes of the screen that asked (bug list items 83 and 85). Home
 * waits for those under way ([drained]) before it reads its rows: read side by side, the read could be answered before the
 * change was made, and Home showed it only once the app was started again. Ask from the main thread, so the order asked
 * is the order made; wait for the answer off it.
 */
class ServerLane {
    private val one: ExecutorService = Executors.newSingleThreadExecutor { Thread(it, "server-lane").apply { isDaemon = true } }

    /** [call] made after every call asked for before. */
    fun <T> submit(call: () -> T): Future<T> = one.submit(Callable { call() })

    /** Done once every call asked for before is made. */
    fun drained(): Future<Unit> = one.submit(Callable { })
}
