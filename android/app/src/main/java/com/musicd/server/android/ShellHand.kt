package com.musicd.server.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import com.musicd.server.client.NowAlbum
import com.musicd.server.client.ServerClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/*
 * What the screens once handed to the page (public/app/native-handoff.js), the app's own since bug list item 111.
 */

/**
 * [what] handed on by a screen, [arg] its detail: the row's buttons ("nav"), the Library's view, the room chosen or
 * grouped, the share card's service, the update offer's Update or Later. What only told the page to catch up
 * ("library-changed", "reload", "page-pref") has nothing left to tell: each screen reads its own afresh.
 */
internal fun handOn(what: String, arg: String?) {
    when (what) {
        "nav" -> NativeShell.nav?.let { navTap(it, arg.orEmpty()) }
        "library-view" -> NativeShell.setLibraryView(arg.orEmpty())
        "share-service" -> NativeShell.keep("shareService", arg)
        "zone", "group-settled" -> NativeShell.keepZone(arg)
        "update" -> UpdateNow.tap(arg == "now")
    }
}

/**
 * The album of what is playing in [zone] (Now playing's album tapped), as the page finds it (core NowAlbum): by the
 * playing track's own id, else [album] searched for in the library and matched by [artist]. Its offset, or null.
 */
internal suspend fun findNowAlbum(client: () -> ServerClient?, zone: String, album: String, artist: String): Long? {
    val c = client() ?: return null
    return withContext(Dispatchers.IO) {
        runCatching { NowAlbum.playing(c.getJson("/api/album/now-playing?zone=" + Uri.encode(zone))) }.getOrNull()
            ?: album.takeIf { it.isNotEmpty() }?.let { a -> runCatching { NowAlbum.match(c.getJson(NowAlbum.searchPath(a)), a, artist) }.getOrNull() }
    }
}

/** The side menu's Shelf: the server's own page of it, a screen for a wall, in the phone's browser. */
internal fun openShelf(context: Context) {
    val base = Store.active(context)?.baseUrl ?: return
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$base/shelf")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}
