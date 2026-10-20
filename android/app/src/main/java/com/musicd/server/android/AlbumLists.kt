package com.musicd.server.android

import com.musicd.server.client.NavList

/**
 * The lists albums were opened from (a Home row, the Library wall, a box
 * set's discs), held for the album page's previous and next: the screen
 * that opens an album hands its list over ([put]), the route names it by a short id (a list of hundreds is no address), and the
 * page of each album stepped to carries the same id with its own place.
 */
internal object AlbumLists {
    private val lists = HashMap<String, NavList>()
    private var next = 1

    /** [list] held under a new id, which the route carries. */
    @Synchronized fun put(list: NavList): String {
        if (lists.size > 32) lists.clear()   // the few last are all a session steps through
        val id = "l${next++}"
        lists[id] = list
        return id
    }

    /** The list [id] names, at [at]; null without one. */
    @Synchronized fun get(id: String?, at: Int): NavList? {
        val l = lists[id ?: return null] ?: return null
        return if (at in l.items.indices) l.copy(index = at) else null
    }
}
