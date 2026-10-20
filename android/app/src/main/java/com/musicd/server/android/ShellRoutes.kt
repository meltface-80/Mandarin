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
 * Playlists and one of them (item 66), each over
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
            onPage = { what, arg -> if (what == "review" && arg != null) nav.navigate(ShellRoute.pitchfork(arg, NativeShell.zone)) else toPageOrNative(nav, what, arg) }
        )
    }
    // Pitchfork (item 70): the magazine, or a review's page in it; an album the library has opens in its place, Find on Qobuz is the page's browser over Home.
    composable(ShellRoute.PITCHFORK, arguments = listOf(navArgument(ShellRoute.REVIEW) { type = NavType.StringType; defaultValue = "" }, navArgument(ShellRoute.ZONE) { type = NavType.StringType; defaultValue = "" })) { entry ->
        val zone = entry.arguments?.getString(ShellRoute.ZONE).orEmpty()
        PitchforkScreen(WallPrefs.parse(prefs), PitchforkHit.parse(entry.arguments?.getString(ShellRoute.REVIEW)), client,
            onClose = { nav.popBackStack() },
            onAlbum = { offset -> nav.popBackStack(); nav.navigate(ShellRoute.album(offset, zone, "")) },
            onQobuz = { q -> if (!nav.popBackStack(ShellRoute.HOME, false)) nav.popBackStack(); NativeShell.toPage("qobuz-search", q) })
    }
    // The record labels (item 71); a label's albums a wall over them.
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
            onPage = { what, arg -> toPageOrNative(nav, what, arg) }
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
            onPage = { what, arg -> toPageOrNative(nav, what, arg) }
        )
    }
}
