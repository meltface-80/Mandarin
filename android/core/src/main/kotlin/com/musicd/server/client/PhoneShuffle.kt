package com.musicd.server.client

import kotlin.random.Random

/**
 * Shuffle on the phone's own player (bug list item 194): an album of the phone's music, or a download in the phone's
 * room offline. It put the album on the player in its order, from track 1, and switched the player's shuffle on: the
 * first track was always track 1, and the shuffle stayed on for every album played after it. Now it is as the server
 * shuffles an album: the tracks go on in a shuffled order, so the first is any of them, and the player's own shuffle
 * (Now playing's button) is left as it was.
 */
object PhoneShuffle {
    const val KIND = "shuffle"

    /** [items] as they go onto the player for [kind]: in a shuffled order for a shuffle, else as they are. */
    fun <T> order(items: List<T>, kind: String?, random: Random = Random.Default): List<T> =
        if (kind == KIND) items.shuffled(random) else items
}
