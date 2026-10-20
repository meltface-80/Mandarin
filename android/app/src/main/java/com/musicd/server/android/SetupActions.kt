package com.musicd.server.android

import android.app.AlertDialog
import android.content.Context
import android.widget.Toast
import com.musicd.server.client.Choice
import com.musicd.server.client.ServerClient
import com.musicd.server.client.SetupSettings
import com.musicd.server.client.WallPrefs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/*
 * What Setup's native pages do besides draw (SettingsSetup.kt; bug list item 78): a list's choice put up as the phone's
 * own list, one of the server's settings read and saved, a setting the page keeps on this device handed to it and kept
 * here too; and the help behind each page's ⓘ, as the page words it.
 */

internal fun choiceWords(choices: List<Choice>, value: String): String = Choice.words(choices, value)

internal fun setupToast(context: Context, text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()

/** The phone's own list of [choices], as the WebView put up for a page's list: [current] ticked, [onPick] with the one tapped. */
internal fun pickChoice(context: Context, choices: List<Choice>, current: String, onPick: (String) -> Unit) {
    AlertDialog.Builder(context).setSingleChoiceItems(choices.map { it.words }.toTypedArray(), choices.indexOfFirst { it.value == current }) { d, i ->
        d.dismiss(); if (choices[i].value != current) onPick(choices[i].value)
    }.show()
}

/** One of the server's settings as it has it ([name]); none when it can't be reached. */
internal suspend fun readSetting(client: () -> ServerClient?, name: String): JSONObject? {
    val c = client() ?: return null
    return withContext(Dispatchers.IO) { runCatching { c.setting(name) }.getOrNull() }
}

/** A change to one of the server's settings saved: [said] once it is, [undo] and what went wrong if not; [then] with the answer. */
internal fun saveSetting(scope: CoroutineScope, context: Context, client: () -> ServerClient?, name: String, body: JSONObject, said: String?, undo: () -> Unit,
                        failed: String = "Couldn't save: ", then: (JSONObject) -> Unit = {}) {
    val c = client() ?: return
    scope.launch {
        val r = withContext(Dispatchers.IO) { runCatching { c.saveSetting(name, body).also { if (it.optString("error").isNotEmpty()) throw IllegalStateException(it.optString("error")) } } }
        r.onSuccess { said?.let { s -> setupToast(context, s) }; then(it) }.onFailure { undo(); setupToast(context, failed + (it.message ?: "no answer")) }
    }
}

/** The page's prefs as the app has them (its last word, or what it kept). */
internal fun pagePrefs(context: Context): WallPrefs = WallPrefs.parse(NativeShell.prefs ?: Store.homePrefs(context))

/** A setting the page keeps on this device ([name], as its prefs name it) changed here: handed to the page, kept by the app; the prefs now. */
internal fun setPagePref(context: Context, name: String, value: String): WallPrefs {
    NativeShell.toPage("page-pref", JSONObject().put("name", name).put("value", value).toString())
    val json = SetupSettings.prefsWith(NativeShell.prefs ?: Store.homePrefs(context), name, value)
    NativeShell.prefs = json
    Store.setHomePrefs(context, json)
    NativeShell.homeArgs.value = json to NativeShell.homeArgs.value.second
    return WallPrefs.parse(json)
}


internal const val PICKS_INFO = "Five records from your own library each day, by acts next to the ones you have been playing (Deezer's related-artists lists), or from the least-played corners of the library when there is no history yet. Steady until tomorrow. Not for me keeps an artist out for good."
internal const val HOUR_INFO = "The hour the daily build runs, in this server's local time (set TZ on the container). If the server is off at that hour, the build runs the next time it starts."
internal val LABELS_INFO = listOf(
    "Off by default. When on, each album's record label comes from its files' LABEL tag (or, for a library filed by label, from the folder at the depth set below): a Labels screen in the side menu, a label on the album page and share card, labels in search, a Record label filter in Library Focus and a Label of the week row on Home. An album whose files carry no label tag is looked up on MusicBrainz, then Discogs (with your token); the files' own tag always wins.",
    "When you open a record label, list its albums alphabetically or shuffle them.",
    "Hide labels that have fewer albums than this threshold. Useful if the scanner picks up one-off compilations from unexpected labels.",
    "Ask again about every album whose files carry no label tag, and look again for the logos not found before. The tags themselves are read by the library scan (Settings → Music folders).",
    "For local libraries filed in label folders. 0 = off (use each file's own label tag, the default). Otherwise the label is taken from the folder at this depth under your music root — e.g. /music/Jazz/Blue Note Records/Album is depth 2. Fixes reissues being split off under their pressing label (e.g. an album in your Blue Note folder showing as EMI Finland). Saving applies it at once.")
internal val UI_NAMES = listOf("Album & artist text", "Grid screen title", "Menu & Home Screen text", "Grid layout", "Tile size")
internal val UI_INFO = listOf(
    "The size of the album name and artist name under every tile — on the Home carousels and on every grid screen.",
    "The size of the title at the top of a grid screen, such as the one a Home carousel opens to, and of a playlist's name.",
    "The size of all the other text: the side menu, Home's greeting and row headings, Settings, the album and Now playing views, the queue and the player bar. The names under tiles and the grid screen title have their own settings.",
    "How album, playlist and label grid screens are laid out. Auto fits as many columns as the screen suits (and follows Tile size). 3 or 2 columns fixes the count on every screen. List shows one row per album.",
    "The size of album and label tiles on every screen. On the Home carousels it sets the tile width; on a grid screen in Auto layout it sets how many columns fit — bigger tiles, fewer columns. On a small screen a 10% step may not change the column count, only the carousels.")
internal const val DISPLAY_INFO = "An always-on screen at this server’s address followed by /display — point any tablet or TV browser at it. Rotates between album art, artist photos, an album review, artist bios and grids from your library, with a progress bar for the playing zone. On by default. When off it is off entirely: /display says only that it is turned off, with nothing running on it, and the server makes nothing for it."
internal const val SHELF_INFO = "Your collection as a record shop's shelf, at this server's address followed by /shelf, and in the side menu. Off on a new install; an install from before v1.0.2 keeps it on. When off it is off entirely: the side menu and the wall display don't offer it, /shelf says only that it is turned off, and the server makes nothing for it."
