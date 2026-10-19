package com.musicd.server.android

import android.view.View
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
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
 * it is open: Now playing (N2) and an album's page (N3), opened by the page
 * ([AppBridge.openNowPlaying], [AppBridge.openAlbum]) when this phone has
 * them switched on. The album page's mini player opens the native Now
 * playing over it when that is on, else the page's own.
 */
internal object NativeShell {
    /** The shell's navigation, while it is on screen (set by [Shell]). */
    internal var nav: NavHostController? = null

    /** A native screen opened over the page. */
    fun open(route: String) { nav?.navigate(route) { launchSingleTop = true } }

    /** Runs a script on the page (set by [attach]). */
    private var page: ((String) -> Unit)? = null

    /**
     * Something a native screen hands back to the page, by name
     * (public/app/native-handoff.js): its own sheets, its room.
     */
    fun toPage(what: String, arg: String? = null) {
        val a = arg?.let { org.json.JSONObject.quote(it) } ?: "null"
        page?.invoke("window.__musicdNative && window.__musicdNative(${org.json.JSONObject.quote(what)}, $a)")
    }

    /** Back on a native screen: it closes, back to the page (true); on the page, the page's own Back (false). */
    fun back(): Boolean {
        val n = nav ?: return false
        if (ShellRoute.isWeb(n.currentDestination?.route)) return false
        return n.popBackStack()
    }

    /** [root] (the page's frame) with the shell laid over it, for setContentView; [page] runs a script on the page. */
    fun attach(activity: ComponentActivity, root: FrameLayout, page: (String) -> Unit): FrameLayout {
        this.page = page
        val shell = ComposeView(activity).apply {
            visibility = View.GONE
            setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
            setContent {
                MandarinTheme {
                    Shell(client = { Store.client(activity) }, nativeNowPlaying = { Store.nativeNowPlaying(activity) },
                        onRoute = { route -> visibility = if (ShellRoute.isWeb(route)) View.GONE else View.VISIBLE })
                }
            }
        }
        root.addView(shell, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        return root
    }
}

/** The screens by route; [onRoute] told each one shown, so the page shows through on its own. */
@Composable
private fun Shell(client: () -> ServerClient?, nativeNowPlaying: () -> Boolean, onRoute: (String?) -> Unit) {
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
            NowPlayingScreen(
                entry.arguments?.getString(ShellRoute.ZONE).orEmpty(), client, onBack = { nav.popBackStack() },
                // Another room from Play on: its Now playing in this one's place, and the page's room too.
                onRoom = { id ->
                    nav.navigate(ShellRoute.nowPlaying(id)) { popUpTo(ShellRoute.NOW_PLAYING) { inclusive = true } }
                    NativeShell.toPage("zone", id)
                },
                // The page's own sheets and screens (Share card, the album, an artist): back to the page, and it opens there.
                onPage = { what, arg -> nav.popBackStack(); NativeShell.toPage(what, arg) }
            )
        }
        composable(ShellRoute.ALBUM, arguments = listOf(
            navArgument(ShellRoute.OFFSET) { type = NavType.LongType },
            navArgument(ShellRoute.ZONE) { type = NavType.StringType; defaultValue = "" },
            navArgument(ShellRoute.LIT) { type = NavType.StringType; defaultValue = "" }
        )) { entry ->
            AlbumScreen(
                entry.arguments?.getLong(ShellRoute.OFFSET) ?: 0L, entry.arguments?.getString(ShellRoute.ZONE).orEmpty(), entry.arguments?.getString(ShellRoute.LIT).orEmpty(), client,
                onBack = { nav.popBackStack() },
                // The row along the foot: the page's own button, tapped, once the page is back in front.
                onNav = { what -> nav.popBackStack(); NativeShell.toPage("nav", what) },
                onPage = { what, arg -> nav.popBackStack(); NativeShell.toPage(what, arg) },
                // The mini player's tap: the native Now playing over the album when this phone has it on, else back to the page, whose own opens.
                onNowPlaying = { id -> if (nativeNowPlaying()) nav.navigate(ShellRoute.nowPlaying(id)) { launchSingleTop = true } else { nav.popBackStack(); NativeShell.toPage("now-playing", null) } },
                // A room chosen on its Play on: the page's room too, so its own bar follows.
                onRoom = { id -> NativeShell.toPage("zone", id) },
                // Another album of the library's, from the rows under the tracks: its own page over this one; Back returns here.
                onAlbum = { id, zone -> nav.navigate(ShellRoute.album(id, zone, entry.arguments?.getString(ShellRoute.LIT).orEmpty())) }
            )
        }
    }
}

/** One of the page's colours (Palette, ARGB) as Compose draws it. */
internal fun paletteColor(argb: Long): Color = Color(argb.toInt())

/**
 * The page's type: Manrope (public/fonts/manrope.woff2, the hifi palette's
 * `--font-sans`), the same file as a TrueType font (res/font/manrope.ttf,
 * written from the woff2 by fontTools; a variable font, its weight axis 200
 * to 800), so a native screen's text is the page's.
 */
private val manrope = FontFamily(
    Font(R.font.manrope, FontWeight.W300), Font(R.font.manrope, FontWeight.W400), Font(R.font.manrope, FontWeight.W500),
    Font(R.font.manrope, FontWeight.W600), Font(R.font.manrope, FontWeight.W700), Font(R.font.manrope, FontWeight.W800)
)

/** Material's type scale in Manrope. */
private fun typography(): Typography {
    val t = Typography()
    return Typography(
        displayLarge = t.displayLarge.copy(fontFamily = manrope), displayMedium = t.displayMedium.copy(fontFamily = manrope), displaySmall = t.displaySmall.copy(fontFamily = manrope),
        headlineLarge = t.headlineLarge.copy(fontFamily = manrope), headlineMedium = t.headlineMedium.copy(fontFamily = manrope), headlineSmall = t.headlineSmall.copy(fontFamily = manrope),
        titleLarge = t.titleLarge.copy(fontFamily = manrope), titleMedium = t.titleMedium.copy(fontFamily = manrope), titleSmall = t.titleSmall.copy(fontFamily = manrope),
        bodyLarge = t.bodyLarge.copy(fontFamily = manrope), bodyMedium = t.bodyMedium.copy(fontFamily = manrope), bodySmall = t.bodySmall.copy(fontFamily = manrope),
        labelLarge = t.labelLarge.copy(fontFamily = manrope), labelMedium = t.labelMedium.copy(fontFamily = manrope), labelSmall = t.labelSmall.copy(fontFamily = manrope)
    )
}

/** Material 3 in the page's graphite and brass (Palette, held to style.css by ShellTest), and its type. */
@Composable
private fun MandarinTheme(content: @Composable () -> Unit) {
    val c = ::paletteColor
    MaterialTheme(
        typography = typography(),
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
