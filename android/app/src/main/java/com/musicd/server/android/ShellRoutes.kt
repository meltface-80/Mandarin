package com.musicd.server.android

import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.musicd.server.client.ServerClient
import com.musicd.server.client.PitchforkHit
import com.musicd.server.client.ShellRoute
import com.musicd.server.client.WallPrefs

/*
 * The native screens' routes past NativeShell.kt's own (it draws nothing; nor does
 * this): the search (item 61), your playlists and one of them (item 65), the Dynamic
 * Playlists and one of them (item 66), Settings (item 76), each over
 * the page or over the screen that opened it, Back returning there.
 */
internal fun NavGraphBuilder.moreRoutes(nav: NavHostController, client: () -> ServerClient?, prefs: String?) {
    composable(ShellRoute.SEARCH, arguments = listOf(navArgument(ShellRoute.Q) { type = NavType.StringType; defaultValue = "" }, navArgument(ShellRoute.ZONE) { type = NavType.StringType; defaultValue = "" })) { entry ->
        SearchScreen(WallPrefs.parse(prefs), entry.arguments?.getString(ShellRoute.ZONE).orEmpty(), client,
            onBack = { nav.popBackStack() },
            onAlbum = { offset, z, list -> nav.navigate(ShellRoute.album(offset, z, "", AlbumLists.put(list), list.index)) },
            onNowPlaying = { id -> nav.navigate(ShellRoute.nowPlaying(id)) { launchSingleTop = true } },
            onRoom = NativeShell::roomChosen,
            onNav = { what -> navTap(nav, what) },
            // A Pitchfork review: its page in the app's own magazine (item 70).
            onPage = { what, arg ->
                when {
                    what == "review" && arg != null -> nav.navigate(ShellRoute.pitchfork(arg, NativeShell.zone))
                    // A service's artist: their albums in the app's own browser (item 73).
                    what == "service-artist" && arg != null -> runCatching { org.json.JSONObject(arg) }.getOrNull()?.let { j ->
                        nav.navigate(ShellRoute.serviceBrowser(j.optString("service"), NativeShell.zone, j.optString("id"), j.optString("name"))) }
                    else -> toPageOrNative(nav, what, arg)
                }
            }
        )
    }
    // Pitchfork (item 70): the magazine, or a review's page in it; an album the library has opens in its place, Find on Qobuz the app's browser in its place (item 73).
    composable(ShellRoute.PITCHFORK, arguments = listOf(navArgument(ShellRoute.REVIEW) { type = NavType.StringType; defaultValue = "" }, navArgument(ShellRoute.ZONE) { type = NavType.StringType; defaultValue = "" })) { entry ->
        val zone = entry.arguments?.getString(ShellRoute.ZONE).orEmpty()
        PitchforkScreen(WallPrefs.parse(prefs), PitchforkHit.parse(entry.arguments?.getString(ShellRoute.REVIEW)), client,
            onClose = { nav.popBackStack() },
            onAlbum = { offset -> nav.popBackStack(); nav.navigate(ShellRoute.album(offset, zone, "")) },
            onQobuz = { q -> nav.popBackStack(); nav.navigate(ShellRoute.serviceBrowser("qobuz", zone, q = q)) })
    }
    // The Qobuz and Tidal browsers (item 73), each opening kept while on the back stack (its entry's id); an album's page over it.
    composable(ShellRoute.SERVICE_BROWSER, arguments = listOf(navArgument(ShellRoute.SERVICE) { type = NavType.StringType }, navArgument(ShellRoute.ARTIST_ID) { type = NavType.StringType; defaultValue = "" },
        navArgument("name") { type = NavType.StringType; defaultValue = "" }, navArgument("q") { type = NavType.StringType; defaultValue = "" }, navArgument(ShellRoute.ZONE) { type = NavType.StringType; defaultValue = "" })) { entry ->
        val a = entry.arguments
        val zone = a?.getString(ShellRoute.ZONE).orEmpty()
        val kept = ServiceBrowsers.kept(entry.id, a?.getString(ShellRoute.SERVICE).orEmpty())
        ServiceBrowserScreen(kept, (a?.getString(ShellRoute.ARTIST_ID).orEmpty() to a?.getString("name").orEmpty()).takeIf { it.first.isNotEmpty() }, a?.getString("q").orEmpty(),
            WallPrefs.parse(prefs), client, onClose = { nav.popBackStack() }, onAlbum = { offset -> nav.navigate(ShellRoute.album(offset, zone, "")) })
    }
    // The record labels (item 71); a label's albums a wall over them.
    // Settings (item 76): its list, Setup's, Account and API Keys; a page it doesn't draw yet, the page's own over it.
    composable(ShellRoute.SETTINGS, arguments = listOf(navArgument(ShellRoute.PANE) { type = NavType.StringType; defaultValue = "home" })) { entry ->
        SettingsScreen(entry.arguments?.getString(ShellRoute.PANE).orEmpty(), client,
            onBack = { nav.popBackStack() },
            onOpen = { pane -> nav.navigate(ShellRoute.settings(pane)) },
            onPage = { pane -> NativeShell.overPage("settings-pane", pane) }
        )
    }
    composable(ShellRoute.LABELS, arguments = listOf(navArgument(ShellRoute.ZONE) { type = NavType.StringType; defaultValue = "" })) { entry ->
        val zone = entry.arguments?.getString(ShellRoute.ZONE).orEmpty()
        LabelsScreen(WallPrefs.parse(prefs), zone, client,
            onBack = { nav.popBackStack() },
            onLabel = { name -> nav.navigate(ShellRoute.wall("label", zone, name)) },
            onNowPlaying = { id -> nav.navigate(ShellRoute.nowPlaying(id)) { launchSingleTop = true } },
            onRoom = NativeShell::roomChosen,
            onNav = { what -> navTap(nav, what) },
            onPage = { what, arg -> toPageOrNative(nav, what, arg) }
        )
    }
    composable(ShellRoute.PLAYLISTS, arguments = listOf(navArgument(ShellRoute.ZONE) { type = NavType.StringType; defaultValue = "" })) { entry ->
        val zone = entry.arguments?.getString(ShellRoute.ZONE).orEmpty()
        PlaylistsScreen(WallPrefs.parse(prefs), zone, client,
            onBack = { nav.popBackStack() },
            onPlaylist = { id -> nav.navigate(ShellRoute.playlist(id, zone)) },
            onNowPlaying = { id -> nav.navigate(ShellRoute.nowPlaying(id)) { launchSingleTop = true } },
            onRoom = NativeShell::roomChosen,
            onNav = { what -> navTap(nav, what) },
            onPage = { what, arg -> toPageOrNative(nav, what, arg) }
        )
    }
    composable(ShellRoute.PLAYLIST, arguments = listOf(navArgument(ShellRoute.ID) { type = NavType.StringType }, navArgument(ShellRoute.ZONE) { type = NavType.StringType; defaultValue = "" })) { entry ->
        val zone = entry.arguments?.getString(ShellRoute.ZONE).orEmpty()
        PlaylistScreen(entry.arguments?.getString(ShellRoute.ID).orEmpty(), zone, client,
            // ← Playlists: the Playlists screen under it, or opened in its place when this came from Home or the page.
            onBack = { if (!nav.popBackStack(ShellRoute.PLAYLISTS, false)) { nav.popBackStack(); nav.navigate(ShellRoute.playlists(zone)) } },
            onHome = { navTap(nav, "home") },
            onNowPlaying = { id -> nav.navigate(ShellRoute.nowPlaying(id)) { launchSingleTop = true } },
            onRoom = NativeShell::roomChosen,
            onNav = { what -> navTap(nav, what) },
            onPage = { what, arg -> toPageOrNative(nav, what, arg) }
        )
    }
    composable(ShellRoute.SMART_PLAYLISTS, arguments = listOf(navArgument(ShellRoute.ZONE) { type = NavType.StringType; defaultValue = "" })) { entry ->
        val zone = entry.arguments?.getString(ShellRoute.ZONE).orEmpty()
        SmartPlaylistsScreen(WallPrefs.parse(prefs), zone, client,
            onBack = { nav.popBackStack() },
            onPlaylist = { id -> nav.navigate(ShellRoute.smartPlaylist(id, zone)) },
            onNowPlaying = { id -> nav.navigate(ShellRoute.nowPlaying(id)) { launchSingleTop = true } },
            onRoom = NativeShell::roomChosen,
            onNav = { what -> navTap(nav, what) },
            onPage = { what, arg -> smartPage(nav, prefs, zone, what, arg) }
        )
    }
    composable(ShellRoute.SMART_PLAYLIST, arguments = listOf(navArgument(ShellRoute.ID) { type = NavType.StringType }, navArgument(ShellRoute.ZONE) { type = NavType.StringType; defaultValue = "" })) { entry ->
        val zone = entry.arguments?.getString(ShellRoute.ZONE).orEmpty()
        SmartPlaylistScreen(entry.arguments?.getString(ShellRoute.ID).orEmpty(), WallPrefs.parse(prefs), zone, client,
            onBack = { if (!nav.popBackStack(ShellRoute.SMART_PLAYLISTS, false)) { nav.popBackStack(); nav.navigate(ShellRoute.smartPlaylists(zone)) } },
            onHome = { navTap(nav, "home") },
            onAlbum = { offset, z, list -> nav.navigate(ShellRoute.album(offset, z, "", AlbumLists.put(list), list.index)) },
            onNowPlaying = { id -> nav.navigate(ShellRoute.nowPlaying(id)) { launchSingleTop = true } },
            onRoom = NativeShell::roomChosen,
            onNav = { what -> navTap(nav, what) },
            onPage = { what, arg -> smartPage(nav, prefs, zone, what, arg) }
        )
    }
    // One of the phone's own albums (item 108): the album page, read from the phone and played on it.
    composable(ShellRoute.PHONE_ALBUM, arguments = listOf(navArgument(ShellRoute.KEY) { type = NavType.StringType }, navArgument(ShellRoute.ZONE) { type = NavType.StringType; defaultValue = "" })) { entry ->
        AlbumScreen(-1L, entry.arguments?.getString(ShellRoute.ZONE).orEmpty(), "", client, list = null, onStepTo = { _, _, _ -> },
            onBack = { nav.popBackStack() }, onPage = { what, arg -> toPageOrNative(nav, what, arg) }, onBooklet = { _, _ -> },
            onNowPlaying = { id -> nav.navigate(ShellRoute.nowPlaying(id)) { launchSingleTop = true } }, onRoom = NativeShell::roomChosen,
            onNav = { what -> navTap(nav, what) }, onAlbum = { id, z -> nav.navigate(ShellRoute.album(id, z, "")) },
            phone = entry.arguments?.getString(ShellRoute.KEY).orEmpty())
    }
}

/**
 * What a native screen hands to the page, unless the app draws it itself: an artist's page is native when the
 * Library wall is (item 52), opened over the screen that asked; the page's sheets ([NativeShell.OVERLAYS]) open over
 * the screen; everything else closes the screen and asks the page.
 */
internal fun toPageOrNative(nav: NavHostController, what: String, arg: String?) {
    if (what == "artist" && !arg.isNullOrEmpty()) { nav.navigate(ShellRoute.artist(arg, NativeShell.zone)); return }
    if (what == "label" && !arg.isNullOrEmpty()) { nav.navigate(ShellRoute.wall("label", NativeShell.zone, arg)); return }   // a label's albums (item 71)
    if (what == "phone-album" && !arg.isNullOrEmpty()) { nav.navigate(ShellRoute.phoneAlbum(arg, NativeShell.zone)); return }   // the phone's own album (item 108)
    // The page's sheets open over the screen that asked, as they do over the page's own screens; the rest closes it.
    if (what in NativeShell.OVERLAYS) { NativeShell.overPage(what, arg); return }
    nav.popBackStack()
    NativeShell.toPage(what, arg)
}

/**
 * The row along the foot on a native screen over the page, or over the native Home: every native screen over Home closes
 * (however deep: a wall, an album from it, an artist from that; item 63), else this one; Home, when it is the native one
 * underneath, is landed on ([NativeShell.landHome]), else the page's own button is tapped, once the page is in front.
 */
internal fun navTap(nav: NavHostController, what: String) {
    if (!nav.popBackStack(ShellRoute.HOME, false)) nav.popBackStack()
    // Search: the app's own over whatever is left (item 61), as the page's opens over Home.
    if (what == "search") NativeShell.openSearch("", NativeShell.zone)
    else if (what == "home" && nav.currentDestination?.route == ShellRoute.HOME) NativeShell.landHome() else NativeShell.toPage("nav", what)
}

/**
 * A Dynamic Playlist's screens hand over: Show albums (or Clear all) from a playlist's Focus opens the Library wall in
 * that view, which the page's wall and Home's Library row follow (the page's applyLibView; item 95); the rest as anywhere.
 */
private fun smartPage(nav: NavHostController, prefs: String?, zone: String, what: String, arg: String?) {
    if (what != "library-show" || arg == null) { toPageOrNative(nav, what, arg); return }
    NativeShell.libraryView = arg
    NativeShell.toPage("library-view", arg)
    nav.navigate(ShellRoute.library(arg, prefs.orEmpty(), zone))
}
