package com.musicd.server.android

import android.view.View
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.musicd.server.client.Palette
import com.musicd.server.client.ServerClient
import com.musicd.server.client.ShellRoute

/**
 * The native app's frame (stage N0 of docs/specs/plan-android-native.md):
 * Compose, its navigation and Mandarin's own colours, laid over the page.
 *
 * The page keeps its WebView exactly as before, underneath; the shell is a
 * Compose view on top of it, shown only while a native screen is on. Its
 * first route is `web/{path}`, the page, so the shell starts out of sight.
 * The native screens are routes of their own, each drawn over the page while
 * it is open: Now playing (N2), opened by the page ([AppBridge.openNowPlaying])
 * when this phone has it switched on.
 */
internal object NativeShell {
    /** The shell's navigation, while it is on screen (set by [Shell]). */
    internal var nav: NavHostController? = null

    /** A native screen opened over the page. */
    fun open(route: String) { nav?.navigate(route) { launchSingleTop = true } }

    /** Back on a native screen: it closes, back to the page (true); on the page, the page's own Back (false). */
    fun back(): Boolean {
        val n = nav ?: return false
        if (ShellRoute.isWeb(n.currentDestination?.route)) return false
        return n.popBackStack()
    }

    /** [root] (the page's frame) with the shell laid over it, for setContentView. */
    fun attach(activity: ComponentActivity, root: FrameLayout): FrameLayout {
        val shell = ComposeView(activity).apply {
            visibility = View.GONE
            setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
            setContent {
                MandarinTheme {
                    Shell(client = { Store.client(activity) }, onRoute = { route -> visibility = if (ShellRoute.isWeb(route)) View.GONE else View.VISIBLE })
                }
            }
        }
        root.addView(shell, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        return root
    }
}

/** The screens by route; [onRoute] told each one shown, so the page shows through on its own. */
@Composable
private fun Shell(client: () -> ServerClient?, onRoute: (String?) -> Unit) {
    val nav = rememberNavController()
    DisposableEffect(nav) {
        NativeShell.nav = nav
        onDispose { if (NativeShell.nav === nav) NativeShell.nav = null }
    }
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    LaunchedEffect(route) { onRoute(route) }
    NavHost(navController = nav, startDestination = ShellRoute.WEB) {
        // The page at a path: drawn by the WebView under the shell, so nothing here.
        composable(ShellRoute.WEB, arguments = listOf(navArgument(ShellRoute.PATH) { type = NavType.StringType; defaultValue = "/" })) { }
        composable(ShellRoute.NOW_PLAYING, arguments = listOf(navArgument(ShellRoute.ZONE) { type = NavType.StringType })) { entry ->
            NowPlayingScreen(entry.arguments?.getString(ShellRoute.ZONE).orEmpty(), client, onBack = { nav.popBackStack() })
        }
    }
}

/** Material 3 in the page's graphite and brass (Palette, held to style.css by ShellTest). */
@Composable
private fun MandarinTheme(content: @Composable () -> Unit) {
    val c = { argb: Long -> Color(argb.toInt()) }
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = c(Palette.ACCENT), onPrimary = c(Palette.ON_ACCENT),
            secondary = c(Palette.ACCENT_TEXT), onSecondary = c(Palette.ON_ACCENT),
            background = c(Palette.BG), onBackground = c(Palette.TEXT),
            surface = c(Palette.BG), onSurface = c(Palette.TEXT),
            surfaceVariant = c(Palette.BG_ELEV), onSurfaceVariant = c(Palette.TEXT_DIM),
            outline = c(Palette.BORDER), outlineVariant = c(Palette.BORDER),
            error = c(Palette.DANGER)
        ),
        content = content
    )
}
