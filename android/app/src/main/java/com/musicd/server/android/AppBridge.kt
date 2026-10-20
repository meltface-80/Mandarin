package com.musicd.server.android

import android.app.Activity
import android.webkit.JavascriptInterface
import com.musicd.server.client.ShellRoute

/**
 * What the server's page can ask of the app about itself — only inside the
 * app; browsers and the iPhone home-screen app have no such object.
 *
 *   MusicdApp.version()       this app's version, e.g. "0.3.4"
 *   MusicdApp.checkUpdate()   look for a newer app now, and offer it (older pages)
 *   MusicdApp.tailscaleTest() the Tailscale screen
 *
 * One Update button for the server and the app (the page's updater):
 *   MusicdApp.pageHandlesUpdates()      the page offers the app's updates, so the app doesn't
 *   MusicdApp.lookForAppUpdate(force)   look on GitHub; then window.__musicdAppUpdateChanged()
 *   MusicdApp.appUpdateStatus()         → {"current", "latest", "available", "installing"}
 *   MusicdApp.installAppUpdate()        download it and open Android's installer
 *
 * The screen held still while the page loads again under it ([PageCurtain], v1.0.7):
 *   MusicdApp.holdScreen()     before something that puts the page up afresh (the Offline switch)
 *   MusicdApp.screenShown()    the new page shows what the old one did: let it be seen
 *
 * The native screens ([NativeShell], docs/specs/plan-android-native.md), always on since item 47:
 *   MusicdApp.nativeNowPlaying()          → true: the app draws Now playing itself (a page from before item 47 asks)
 *   MusicdApp.setNativeNowPlaying(on)     nothing: there is no switch any more (an older page's Settings has one)
 *   MusicdApp.openNowPlaying(zoneId)      the native Now playing of that room, over the page
 *   MusicdApp.nativeAlbum() / setNativeAlbum(on)   the native album page, likewise
 *   MusicdApp.openAlbum(offset, zoneId, lit)   the native page of that album, its buttons playing in that room;
 *                                              lit: the row's button lit under it ("home", "library", ""); two arguments from an older page
 *   MusicdApp.openAlbumIn(offset, zoneId, lit, nav)   the same, in the list it was opened from (nav: {items: [{offset, title}], index},
 *                                                     JSON; "" for none), for its previous and next
 *   MusicdApp.nativeLibrary() / setNativeLibrary(on)   → true / nothing: the native Library wall, always the app's since item 64
 *   MusicdApp.openLibrary(view, prefs, zoneId)   the native wall in the page's view of it (its query string: the sort and the
 *                                                focus), drawn to its UI Settings (JSON), its albums playing in that room
 *   MusicdApp.openWall(kind, prefs, zoneId)   a wall Home links to (item 52): later, favourites, history, unplayed or random
 *   MusicdApp.openArtist(name, prefs, zoneId)   an artist's page (item 52)
 *   MusicdApp.nativeHome() / setNativeHome(on)   → true / nothing: the native Home, likewise
 *   MusicdApp.nativeSearch() / setNativeSearch(on)   → true / nothing: the native search, likewise (an older page's Settings has switches)
 *   MusicdApp.openSearch(q, prefs, zoneId)   the native search, with the words to start from ("" for none), the UI Settings and the room
 *   MusicdApp.openPlaylists(prefs, zoneId) / openPlaylist(id, prefs, zoneId)   your playlists, or one of them, natively (item 65)
 *   MusicdApp.homeShown(front, prefs, zoneId)   the page is on Home with nothing of its own over it (front), or something
 *                                               of its own has come over it (the menu, the search, a wall): the app's Home
 *                                               in front, or the page (public/app/native-home.js); with the UI Settings and the room
 */
class AppBridge(private val activity: Activity) {
    companion object {
        const val NAME = "MusicdApp"
        /** The page in front offers the app's updates itself (with the server's). */
        @Volatile var pageOffersUpdates = false
    }

    @JavascriptInterface
    fun version(): String = BuildConfig.VERSION_NAME

    @JavascriptInterface
    fun tailscaleTest() {
        activity.runOnUiThread { activity.startActivity(android.content.Intent(activity, TailscaleTestActivity::class.java)) }
    }

    @JavascriptInterface
    fun pageHandlesUpdates() { pageOffersUpdates = true }

    @JavascriptInterface
    fun lookForAppUpdate(force: Boolean) {
        AppUpdate.lookup(force) {
            (activity as? MainActivity)?.tellPage("window.__musicdAppUpdateChanged && window.__musicdAppUpdateChanged()")
        }
    }

    @JavascriptInterface
    fun appUpdateStatus(): String = AppUpdate.statusJson()

    @JavascriptInterface
    fun installAppUpdate() {
        activity.runOnUiThread { AppUpdate.installNow(activity) }
    }

    @JavascriptInterface
    fun holdScreen() { PageCurtain.want() }

    @JavascriptInterface
    fun screenShown() { activity.runOnUiThread { PageCurtain.down() } }

    @JavascriptInterface
    fun nativeNowPlaying(): Boolean = true

    @JavascriptInterface
    fun setNativeNowPlaying(on: Boolean) { }

    @JavascriptInterface
    fun openNowPlaying(zoneId: String) { activity.runOnUiThread { NativeShell.open(ShellRoute.nowPlaying(zoneId)) } }

    @JavascriptInterface
    fun nativeAlbum(): Boolean = true

    @JavascriptInterface
    fun setNativeAlbum(on: Boolean) { }

    @JavascriptInterface
    fun openAlbum(offset: Int, zoneId: String) { openAlbum(offset, zoneId, "") }

    @JavascriptInterface
    fun openAlbum(offset: Int, zoneId: String, lit: String) { openAlbumIn(offset, zoneId, lit, "") }

    @JavascriptInterface
    fun openAlbumIn(offset: Int, zoneId: String, lit: String, nav: String) {
        val list = com.musicd.server.client.NavList.parse(nav.ifEmpty { null })
        val id = list?.let { AlbumLists.put(it) }.orEmpty()
        activity.runOnUiThread { NativeShell.open(ShellRoute.album(offset.toLong(), zoneId, lit, id, list?.index ?: -1)) }
    }

    @JavascriptInterface
    fun nativeLibrary(): Boolean = true

    @JavascriptInterface
    fun setNativeLibrary(on: Boolean) { }

    @JavascriptInterface
    fun nativeHome(): Boolean = true

    @JavascriptInterface
    fun setNativeHome(on: Boolean) { }

    @JavascriptInterface
    fun nativeSearch(): Boolean = true

    @JavascriptInterface
    fun setNativeSearch(on: Boolean) { }

    @JavascriptInterface
    fun openSearch(q: String, prefs: String, zoneId: String) {
        NativeShell.prefs = prefs; NativeShell.zone = zoneId
        activity.runOnUiThread { NativeShell.openSearch(q, zoneId) }
    }

    @JavascriptInterface
    fun openPlaylists(prefs: String, zoneId: String) {
        NativeShell.prefs = prefs; NativeShell.zone = zoneId
        activity.runOnUiThread { NativeShell.openPlaylists(zoneId) }
    }

    @JavascriptInterface
    fun openPlaylist(id: String, prefs: String, zoneId: String) {
        NativeShell.prefs = prefs; NativeShell.zone = zoneId
        activity.runOnUiThread { NativeShell.openPlaylist(id, zoneId) }
    }

    @JavascriptInterface
    fun homeShown(front: Boolean, prefs: String, zoneId: String) { Store.setHomePrefs(activity, prefs); activity.runOnUiThread { NativeShell.homeShown(front, prefs, zoneId) } }

    @JavascriptInterface
    fun openLibrary(view: String, prefs: String, zoneId: String) {
        NativeShell.prefs = prefs; NativeShell.zone = zoneId; NativeShell.libraryView = view
        activity.runOnUiThread { NativeShell.open(ShellRoute.library(view, prefs, zoneId)) }
    }

    @JavascriptInterface
    fun openWall(kind: String, prefs: String, zoneId: String) {
        NativeShell.prefs = prefs; NativeShell.zone = zoneId
        activity.runOnUiThread { NativeShell.open(ShellRoute.wall(kind, zoneId)) }
    }

    @JavascriptInterface
    fun openArtist(name: String, prefs: String, zoneId: String) {
        NativeShell.prefs = prefs; NativeShell.zone = zoneId
        activity.runOnUiThread { NativeShell.open(ShellRoute.artist(name, zoneId)) }
    }

    /** One of the page's sheets, asked for over a native screen ([NativeShell.overPage]), is painted, the page clear round it: the page comes in front. */
    @JavascriptInterface
    fun overlayShown() { activity.runOnUiThread { NativeShell.overlayShown() } }

    /** That sheet has closed: the screen is in front again. */
    @JavascriptInterface
    fun overlayClosed() { activity.runOnUiThread { NativeShell.overlayClosed() } }

    @JavascriptInterface
    fun checkUpdate() {
        activity.runOnUiThread { AppUpdate.check(activity, asked = true) }
    }
}
