package com.musicd.server.android

import android.view.View
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.musicd.server.client.ServerClient
import com.musicd.server.client.ShellRoute
import com.musicd.server.client.WallPrefs

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

    /** Whether the app draws the Library wall, the walls and an artist's page itself (item 52; the switch in UI Settings), as last told by the page. */
    @Volatile var nativeLibrary = false
    /** Whether the app draws Home itself (item 57; its switch in UI Settings). */
    @Volatile var nativeHome = false
    /** The Library's view as the page last opened its wall with ([AppBridge.openLibrary]) or the app chose: Home's Library row is the head of that list. */
    @Volatile var libraryView = ""
    /** Home's arguments as the page last gave them ([homeShown]): the UI Settings as JSON, and the room; the native Home follows them. */
    val homeArgs = mutableStateOf("" to "")
    /** The page in front of the native Home (its menu, its search, a wall of its own in Home's place): the shell out of sight while Home is the route. */
    val pageFront = mutableStateOf(false)
    /** The page's UI Settings as JSON, and its room, as last handed over with a wall ([AppBridge.openLibrary], openWall): the walls opened from native screens draw to them. */
    @Volatile var prefs: String? = null
    @Volatile var zone: String = ""

    /** Runs a script on the page (set by [attach]). */
    private var page: ((String) -> Unit)? = null
    /** Puts the page over the shell (true) or the shell over the page (set by [attach]). */
    private var lift: ((Boolean) -> Unit)? = null
    /** Whether the page is over the shell, for one of its sheets ([overPage]). */
    @Volatile var lifted = false
        private set

    /**
     * The page's sheets that open over whatever screen is on (the Share card, Add to playlist, the album editor,
     * Group zones, Device power, a Dynamic Playlist's name): a native screen asks for one with [overPage], not [toPage].
     */
    val OVERLAYS = setOf("share", "album-share", "album-playlist", "album-playlist-tracks", "albums-playlist", "album-edit", "group", "power", "smart-save")

    /**
     * Something a native screen hands back to the page, by name
     * (public/app/native-handoff.js): its own sheets, its room.
     */
    fun toPage(what: String, arg: String? = null) {
        val a = arg?.let { org.json.JSONObject.quote(it) } ?: "null"
        page?.invoke("window.__musicdNative && window.__musicdNative(${org.json.JSONObject.quote(what)}, $a)")
    }

    /**
     * One of the page's sheets ([OVERLAYS]) over the native screen that asked for it, as the page draws it over its
     * own screens (bug list item 54): the screen stays where it is, the page comes over it with nothing but the sheet
     * showing (its `native-over` class, public/app/native-handoff.js), and goes under again when the sheet closes
     * ([AppBridge.overlayClosed]).
     */
    fun overPage(what: String, arg: String? = null) {
        lifted = true
        val a = arg?.let { org.json.JSONObject.quote(it) } ?: "null"
        page?.invoke("window.__musicdNativeOver && window.__musicdNativeOver(${org.json.JSONObject.quote(what)}, $a)")
    }

    /**
     * The page has painted itself clear but for the sheet ([AppBridge.overlayShown]): now it comes in front. Not before:
     * put in front as it was asked, it showed a frame of Home's covers first (bug list item 55).
     */
    fun overlayShown() {
        if (lifted) lift?.invoke(true)
    }

    /**
     * The page's sheet closed ([AppBridge.overlayClosed]): the native screen is in front again, and only then is the
     * page let paint its own screens again (its `native-over` class taken off here), so none of them shows on the way.
     */
    fun overlayClosed() {
        if (!lifted) return
        lifted = false
        lift?.invoke(false)
        page?.invoke("document.documentElement.classList.remove(\"native-over\")")
    }

    /**
     * The page is on Home with nothing of its own over it ([front]; public/app/native-home.js), or something of its own
     * has come over it: the native Home comes in front (opened over the page, or shown again), or goes out of sight for
     * the page's own screen, the route staying Home underneath (a native screen over Home is left as it is).
     */
    fun homeShown(front: Boolean, prefs: String, zone: String) {
        this.prefs = prefs; this.zone = zone
        homeArgs.value = prefs to zone
        pageFront.value = !front
        val n = nav ?: return
        if (front && ShellRoute.isWeb(n.currentDestination?.route)) n.navigate(ShellRoute.home(prefs, zone)) { launchSingleTop = true }
    }

    /** The row's button on the native Home: Home itself goes to its top; the rest are the page's own buttons (the page comes in front as it opens what they open). */
    fun homeNav(what: String) { if (what == "home") HomeKept.toTop = true else toPage("nav", what) }

    /** Native Home switched off (its switch in UI Settings): back to the page, whatever is over Home going with it. */
    fun leaveHome() {
        val n = nav ?: return
        if (!ShellRoute.isWeb(n.currentDestination?.route)) n.popBackStack(ShellRoute.WEB, false)
    }

    /**
     * Back on a native screen: it closes (true); on the page, on Home (the page's to answer for: what it has over Home
     * closes, else the app goes to the back), or one of the page's sheets over a native screen, the page's own Back (false).
     */
    fun back(): Boolean {
        if (lifted) return false
        val n = nav ?: return false
        val route = n.currentDestination?.route
        if (ShellRoute.isWeb(route) || route == ShellRoute.HOME) return false
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
                    Shell(client = { Store.client(activity) }, onShown = { shown -> visibility = if (shown) View.VISIBLE else View.GONE })
                }
            }
        }
        root.addView(shell, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        // The page's view is the frame's first; over the shell for a sheet it shows through nothing but the sheet, so its ground goes clear.
        val web = root.getChildAt(0)
        val ground = (web.background as? android.graphics.drawable.ColorDrawable)?.color
        lift = { up ->
            if (up) { web.setBackgroundColor(android.graphics.Color.TRANSPARENT); root.bringChildToFront(web) }
            else { ground?.let { web.setBackgroundColor(it) }; root.bringChildToFront(shell) }
        }
        return root
    }
}

/**
 * What a native screen hands to the page, unless the app draws it itself: an artist's page is native when the
 * Library wall is (item 52), opened over the screen that asked; the page's sheets ([NativeShell.OVERLAYS]) open over
 * the screen; everything else closes the screen and asks the page.
 */
private fun toPageOrNative(nav: NavHostController, what: String, arg: String?) {
    if (what == "artist" && !arg.isNullOrEmpty() && NativeShell.nativeLibrary) { nav.navigate(ShellRoute.artist(arg, NativeShell.zone)); return }
    // The page's sheets open over the screen that asked, as they do over the page's own screens; the rest closes it.
    if (what in NativeShell.OVERLAYS) { NativeShell.overPage(what, arg); return }
    nav.popBackStack()
    NativeShell.toPage(what, arg)
}

/**
 * The row along the foot on a native screen over the page, or over the native Home: the screen closes; Home, when it is
 * the native one underneath, goes to its top (as the page's does), else the page's own button is tapped, once the page is in front.
 */
private fun navTap(nav: NavHostController, what: String) {
    nav.popBackStack()
    if (what == "home" && nav.currentDestination?.route == ShellRoute.HOME) HomeKept.toTop = true else NativeShell.toPage("nav", what)
}

/** The screens by route; [onShown] told whether the shell is on screen (a native route, and not the page in front of Home), so the page shows through on its own. */
@Composable
private fun Shell(client: () -> ServerClient?, onShown: (Boolean) -> Unit) {
    val nav = rememberNavController()
    val prefs = NativeShell.prefs
    DisposableEffect(nav) {
        NativeShell.nav = nav
        onDispose { if (NativeShell.nav === nav) NativeShell.nav = null }
    }
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    val front by NativeShell.pageFront
    LaunchedEffect(route, front) { onShown(!ShellRoute.isWeb(route) && !(route == ShellRoute.HOME && front)) }
    NavHost(navController = nav, startDestination = ShellRoute.WEB) {
        // The page at a path: drawn by the WebView under the shell, so nothing here.
        composable(ShellRoute.WEB, arguments = listOf(navArgument(ShellRoute.PATH) { type = NavType.StringType; defaultValue = "/" })) { }
        // Home (N5, item 57): over the page's own Home, which stays underneath for its Back and its own screens; its rows' walls,
        // Smart Picks and an album's page open over it, and Back comes back to it as it was.
        composable(ShellRoute.HOME, arguments = listOf(navArgument(ShellRoute.PREFS) { type = NavType.StringType; defaultValue = "" }, navArgument(ShellRoute.ZONE) { type = NavType.StringType; defaultValue = "" })) {
            val args by NativeShell.homeArgs
            HomeScreen(WallPrefs.parse(args.first), args.second, client,
                onAlbum = { offset, zone, list -> nav.navigate(ShellRoute.album(offset, zone, "home", AlbumLists.put(list), list.index)) },
                onWall = { kind, filter -> nav.navigate(ShellRoute.wall(kind, args.second, filter)) },
                onLibrary = { nav.navigate(ShellRoute.library(NativeShell.libraryView, args.first, args.second)) },
                onPicks = { nav.navigate(ShellRoute.picks(args.second)) },
                onNowPlaying = { id -> nav.navigate(ShellRoute.nowPlaying(id)) { launchSingleTop = true } },
                onRoom = { id -> NativeShell.toPage("zone", id) },
                onNav = NativeShell::homeNav,
                // The page's sheets over this screen; its screens (a playlist, a label, the phone's own album) in front of it, Home staying.
                onPage = { what, arg -> if (what in NativeShell.OVERLAYS) NativeShell.overPage(what, arg) else NativeShell.toPage(what, arg) }
            )
        }
        composable(ShellRoute.PICKS, arguments = listOf(navArgument(ShellRoute.ZONE) { type = NavType.StringType; defaultValue = "" })) { entry ->
            val zone = entry.arguments?.getString(ShellRoute.ZONE).orEmpty()
            PicksScreen(WallPrefs.parse(prefs), zone, client,
                onBack = { nav.popBackStack() },
                onAlbum = { offset, z -> nav.navigate(ShellRoute.album(offset, z, "")) },
                onNowPlaying = { id -> nav.navigate(ShellRoute.nowPlaying(id)) { launchSingleTop = true } },
                onRoom = { id -> NativeShell.toPage("zone", id) },
                onNav = { what -> navTap(nav, what) },
                onPage = { what, arg -> toPageOrNative(nav, what, arg) }
            )
        }
        composable(ShellRoute.NOW_PLAYING, arguments = listOf(navArgument(ShellRoute.ZONE) { type = NavType.StringType })) { entry ->
            NowPlayingScreen(
                entry.arguments?.getString(ShellRoute.ZONE).orEmpty(), client, onBack = { nav.popBackStack() },
                // Another room from Play on: its Now playing in this one's place, and the page's room too.
                onRoom = { id ->
                    nav.navigate(ShellRoute.nowPlaying(id)) { popUpTo(ShellRoute.NOW_PLAYING) { inclusive = true } }
                    NativeShell.toPage("zone", id)
                },
                // The page's own sheets (Share card, Group zones, Device power) over this screen; its screens (the album, an artist) in its place.
                onPage = { what, arg -> toPageOrNative(nav, what, arg) }
            )
        }
        // The Library wall (N4, item 51): opened by the page in its view of it; an album's page over it, Back returning here.
        composable(ShellRoute.LIBRARY, arguments = listOf(
            navArgument(ShellRoute.VIEW) { type = NavType.StringType; defaultValue = "" },
            navArgument(ShellRoute.PREFS) { type = NavType.StringType; defaultValue = "" },
            navArgument(ShellRoute.ZONE) { type = NavType.StringType; defaultValue = "" }
        )) { entry ->
            LibraryScreen(
                entry.arguments?.getString(ShellRoute.VIEW).orEmpty(), WallPrefs.parse(entry.arguments?.getString(ShellRoute.PREFS)),
                entry.arguments?.getString(ShellRoute.ZONE).orEmpty(), client,
                onBack = { nav.popBackStack() },
                onAlbum = { offset, zone, list -> nav.navigate(ShellRoute.album(offset, zone, "library", AlbumLists.put(list), list.index)) },
                // The view changed here: the page's own wall and Home's Library row follow.
                onView = { q -> NativeShell.toPage("library-view", q) },
                onNowPlaying = { id -> nav.navigate(ShellRoute.nowPlaying(id)) { launchSingleTop = true } },
                onRoom = { id -> NativeShell.toPage("zone", id) },
                onNav = { what -> navTap(nav, what) },
                onPage = { what, arg -> toPageOrNative(nav, what, arg) }
            )
        }
        // The walls Home links to (L5) and an artist's page (L4), item 52: each over the page, or over the screen that opened it.
        composable(ShellRoute.WALL, arguments = listOf(navArgument(ShellRoute.KIND) { type = NavType.StringType }, navArgument(ShellRoute.ZONE) { type = NavType.StringType; defaultValue = "" },
            navArgument(ShellRoute.FILTER) { type = NavType.StringType; defaultValue = "" })) { entry ->
            val zone = entry.arguments?.getString(ShellRoute.ZONE).orEmpty()
            WallScreen(entry.arguments?.getString(ShellRoute.KIND).orEmpty(), entry.arguments?.getString(ShellRoute.FILTER).orEmpty(), WallPrefs.parse(prefs), zone, client,
                onBack = { nav.popBackStack() },
                onAlbum = { offset, z, list -> nav.navigate(ShellRoute.album(offset, z, "", AlbumLists.put(list), list.index)) },
                onNowPlaying = { id -> nav.navigate(ShellRoute.nowPlaying(id)) { launchSingleTop = true } },
                onRoom = { id -> NativeShell.toPage("zone", id) },
                onNav = { what -> navTap(nav, what) },
                onPage = { what, arg -> toPageOrNative(nav, what, arg) }
            )
        }
        composable(ShellRoute.ARTIST, arguments = listOf(navArgument("name") { type = NavType.StringType; defaultValue = "" }, navArgument(ShellRoute.ZONE) { type = NavType.StringType; defaultValue = "" })) { entry ->
            val zone = entry.arguments?.getString(ShellRoute.ZONE).orEmpty()
            ArtistScreen(entry.arguments?.getString("name").orEmpty(), WallPrefs.parse(prefs), zone, client,
                onBack = { nav.popBackStack() },
                onAlbum = { offset, z, list -> nav.navigate(ShellRoute.album(offset, z, "", AlbumLists.put(list), list.index)) },
                onNowPlaying = { id -> nav.navigate(ShellRoute.nowPlaying(id)) { launchSingleTop = true } },
                onRoom = { id -> NativeShell.toPage("zone", id) },
                onNav = { what -> navTap(nav, what) },
                onPage = { what, arg -> toPageOrNative(nav, what, arg) }
            )
        }
        composable(ShellRoute.ALBUM, arguments = listOf(
            navArgument(ShellRoute.OFFSET) { type = NavType.LongType },
            navArgument(ShellRoute.ZONE) { type = NavType.StringType; defaultValue = "" },
            navArgument(ShellRoute.LIT) { type = NavType.StringType; defaultValue = "" },
            navArgument(ShellRoute.NAV) { type = NavType.StringType; defaultValue = "" },
            navArgument(ShellRoute.AT) { type = NavType.IntType; defaultValue = -1 }
        )) { entry ->
            val lit = entry.arguments?.getString(ShellRoute.LIT).orEmpty()
            val navId = entry.arguments?.getString(ShellRoute.NAV).orEmpty()
            AlbumScreen(
                entry.arguments?.getLong(ShellRoute.OFFSET) ?: 0L, entry.arguments?.getString(ShellRoute.ZONE).orEmpty(), lit, client,
                list = AlbumLists.get(navId.ifEmpty { null }, entry.arguments?.getInt(ShellRoute.AT) ?: -1),
                // Previous, next, or a disc of the box: that album's page in this one's place, in the same list.
                onStepTo = { offset, zone, l -> nav.navigate(ShellRoute.album(offset, zone, lit, AlbumLists.put(l), l.index)) { popUpTo(ShellRoute.ALBUM) { inclusive = true } } },
                onBack = { nav.popBackStack() },
                // The row along the foot: back to the native wall it came from (Library), or to the native Home (at its top, as the page's); else the page's own button, tapped, once the page is back in front.
                onNav = { what ->
                    if (what == "home" && nav.popBackStack(ShellRoute.HOME, false)) HomeKept.toTop = true
                    else if (!(what == "library" && nav.popBackStack(ShellRoute.LIBRARY, false))) { nav.popBackStack(); NativeShell.toPage("nav", what) }
                },
                onPage = { what, arg -> toPageOrNative(nav, what, arg) },
                // A booklet: its pages over the album; Back returns here.
                onBooklet = { offset, b -> nav.navigate(ShellRoute.booklet(offset, b.id, b.name, b.pages)) },
                // The mini player's tap: the native Now playing over the album.
                onNowPlaying = { id -> nav.navigate(ShellRoute.nowPlaying(id)) { launchSingleTop = true } },
                // A room chosen on its Play on: the page's room too, so its own bar follows.
                onRoom = { id -> NativeShell.toPage("zone", id) },
                // Another album of the library's, from the rows under the tracks: its own page over this one; Back returns here.
                onAlbum = { id, zone -> nav.navigate(ShellRoute.album(id, zone, lit)) }
            )
        }
        // An album's booklet (item 42): its pages one under another over the album; Back returns there. Never declared here until
        // item 59, so every booklet tapped brought the app down ("destination … cannot be found"); ShellTest holds every route to a screen now.
        composable(ShellRoute.BOOKLET, arguments = listOf(
            navArgument(ShellRoute.OFFSET) { type = NavType.LongType },
            navArgument(ShellRoute.BOOKLET_ID) { type = NavType.StringType },
            navArgument(ShellRoute.NAME) { type = NavType.StringType; defaultValue = "" },
            navArgument(ShellRoute.PAGES) { type = NavType.IntType; defaultValue = 0 }
        )) { entry ->
            BookletScreen(entry.arguments?.getLong(ShellRoute.OFFSET) ?: 0L, entry.arguments?.getString(ShellRoute.BOOKLET_ID).orEmpty(),
                entry.arguments?.getString(ShellRoute.NAME).orEmpty(), entry.arguments?.getInt(ShellRoute.PAGES) ?: 0, client, onBack = { nav.popBackStack() })
        }
    }
}
