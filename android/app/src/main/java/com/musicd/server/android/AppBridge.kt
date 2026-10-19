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
 *   MusicdApp.nativeLibrary() / setNativeLibrary(on)   the native Library wall (item 51), a preview: the switch in UI Settings
 *   MusicdApp.openLibrary(view, prefs, zoneId)   the native wall in the page's view of it (its query string: the sort and the
 *                                                focus), drawn to its UI Settings (JSON), its albums playing in that room
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
    fun nativeLibrary(): Boolean = Store.nativeLibrary(activity)

    @JavascriptInterface
    fun setNativeLibrary(on: Boolean) { Store.setNativeLibrary(activity, on) }

    @JavascriptInterface
    fun openLibrary(view: String, prefs: String, zoneId: String) {
        activity.runOnUiThread { NativeShell.open(ShellRoute.library(view, prefs, zoneId)) }
    }

    @JavascriptInterface
    fun checkUpdate() {
        activity.runOnUiThread { AppUpdate.check(activity, asked = true) }
    }
}
