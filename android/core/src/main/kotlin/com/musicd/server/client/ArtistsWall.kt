package com.musicd.server.client

import java.net.URLEncoder

/**
 * The Artists wall (bug list item 130): every act an album of the library's is credited to, as a grid of round
 * pictures with their names, read a page at a time from /api/artists. Its order (A to Z, most albums first, or at
 * random), found by part of a name, and each act's picture: their own once the server has found one (item 129),
 * else their first album's cover.
 */
object ArtistsWall {
    /** As many as a page of the wall reads. */
    const val PAGE = 120

    /** The orders, as /api/artists names them, in the order the Sort button goes round them. */
    val SORTS = listOf("az", "albums", "random")

    /** What the Sort button says of an order. */
    fun sortWord(sort: String): String = when (sort) { "albums" -> "Most albums"; "random" -> "Random"; else -> "A–Z" }

    /** The order after [sort], the Sort button tapped. */
    fun nextSort(sort: String): String = SORTS[(SORTS.indexOf(sort).coerceAtLeast(0) + 1) % SORTS.size]

    /** The address of a page: from [offset], in [sort] order ([seed] for a random one), found by [find] when it says anything. */
    fun path(sort: String, offset: Int, find: String = "", seed: Int = 1): String =
        "/api/artists?sort=" + (if (sort in SORTS) sort else "az") + "&offset=" + offset.coerceAtLeast(0) + "&limit=$PAGE" +
            (if (sort == "random") "&seed=$seed" else "") + (if (find.isBlank()) "" else "&q=" + URLEncoder.encode(find.trim(), "UTF-8").replace("+", "%20"))

    /** The picture a tile shows: their own, else their first album's cover. */
    fun art(a: Artist): String? = a.photoKey ?: a.imageKey

    /** Under a name: how many albums. */
    fun subtitle(a: Artist): String = if (a.albumCount == 1) "1 album" else "${a.albumCount} albums"

    /** The heading: "Artists", and how many once the first page has said ("Artists · 312"). */
    fun heading(total: Int?): String = if (total == null) "Artists" else "Artists · $total"

    /** Said when a find matches no one. */
    fun none(find: String): String = "No artist matches “${find.trim()}”"

    /** Whether more can be read after [have] of [total]. */
    fun more(have: Int, total: Int): Boolean = have < total
}
