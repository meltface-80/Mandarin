package com.musicd.server.android

import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.musicd.server.client.ServerClient
import com.musicd.server.client.ShellRoute
import com.musicd.server.client.WallPrefs

/*
 * The native screens' routes past NativeShell.kt's own (it draws nothing; nor does
 * this): the search (item 61), your playlists and one of them (item 65), each over
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
}
