package com.musicd.server.client

/** How long to wait before asking again after [missed] answers missed in a row: 2 s, doubled each time, up to half a minute (item 119). */
object Retry {
    fun ms(missed: Int): Long = minOf(30_000L, 2_000L shl (missed - 1).coerceIn(0, 4))
}
