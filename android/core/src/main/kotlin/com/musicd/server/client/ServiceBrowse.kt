package com.musicd.server.client

import org.json.JSONArray
import org.json.JSONObject

/*
 * The Qobuz and Tidal browsers, typed (the group B of old/plan-android-native.md, B2; bug list item 73): a
 * service's tabs, a page of albums (new releases, a featured list, a search's, an artist's) with what the status line
 * says of it, and an artist's head; as the page's service-browser*.js read and say them.
 */

/** A tab: its id, its word, and what it asks for ("new-releases", or a "featured" list by its id). */
data class ServiceTab(val id: String, val label: String, val kind: String)

/** A page of a service's albums: the albums, the artists a search found, how many in all, whether more follow and how many a page holds; an artist's head. */
data class ServicePage(val albums: List<ServiceAlbum>, val artists: List<ServiceArtist>, val total: Int, val hasMore: Boolean, val limit: Int,
                       val days: Int, val artistName: String, val artistImage: String?, val biography: String) {
    companion object {
        fun parse(service: String, j: JSONObject): ServicePage {
            val ar = j.optJSONObject("artist")
            return ServicePage(ServiceBrowse.albums(service, j.optJSONArray("albums")), ServiceBrowse.artists(service, j.optJSONArray("artists")),
                j.optInt("total", 0), j.optBoolean("has_more"), j.optInt("limit", ServiceBrowse.PAGE_SIZE).takeIf { it > 0 } ?: ServiceBrowse.PAGE_SIZE,
                j.optInt("days", 30), ar?.optString("name").orEmpty(), ar?.optString("image")?.takeIf { it.isNotEmpty() && it != "null" }, j.optString("biography"))
        }
    }
}

object ServiceBrowse {
    const val PAGE_SIZE = 50

    /** The service's name as the browser shows it. */
    fun name(service: String) = if (service == "tidal") "Tidal" else "Qobuz"

    /** The tabs the browser opens with: Qobuz's five; Tidal's New Releases, its own lists following when it says them ([lists]). */
    fun tabs(service: String): List<ServiceTab> = if (service == "tidal") listOf(ServiceTab("new-releases", "New Releases", "new-releases"))
        else listOf(ServiceTab("new-releases", "New Releases", "new-releases"), ServiceTab("best-sellers", "Best Sellers", "featured"), ServiceTab("most-streamed", "Most Streamed", "featured"),
            ServiceTab("press-awards", "Press Awards", "featured"), ServiceTab("editor-picks", "Editor's Picks", "featured"))

    /** Tidal's lists (/api/tidal/lists) after New Releases; none said, the tabs as they were. */
    fun lists(tabs: List<ServiceTab>, j: JSONObject): List<ServiceTab> {
        val a = j.optJSONArray("lists") ?: return tabs
        val more = (0 until a.length()).mapNotNull { a.optJSONObject(it) }.filter { it.optString("id").isNotEmpty() && it.optString("label").isNotEmpty() }
            .map { ServiceTab(it.optString("id"), it.optString("label"), "featured") }
        return if (more.isEmpty()) tabs else listOf(tabs.first()) + more
    }

    /** The address a view asks: a tab's list, a search's page, an artist's page, from [offset]. */
    fun tabPath(service: String, tab: ServiceTab) = if (tab.kind == "new-releases") "/api/$service/new-releases?days=30" else "/api/$service/featured?type=" + enc(tab.id)
    fun searchPath(service: String, q: String, offset: Int) = "/api/$service/search?q=" + enc(q) + "&offset=$offset"
    fun artistPath(service: String, artistId: String, offset: Int) = "/api/$service/artist-albums?artist_id=" + enc(artistId) + "&offset=$offset"

    /** What the status line says of a page: a tab's, a search's for [q], an artist's. */
    fun tabStatus(tab: ServiceTab, p: ServicePage): String = if (tab.kind == "new-releases") {
        if (p.albums.isNotEmpty()) "${p.albums.size} releases in the last ${p.days} days" else "No new releases found in the last ${p.days} days."
    } else if (p.albums.isNotEmpty()) "${p.albums.size} albums" else "No albums found."

    fun searchStatus(q: String, p: ServicePage): String = when {
        p.albums.isNotEmpty() -> "${if (p.total > 0) p.total else p.albums.size} albums for “$q”"
        p.artists.isNotEmpty() -> "No album matches for “$q” — artists below"
        else -> "No results for “$q”"
    }

    fun artistStatus(p: ServicePage): String = if (p.albums.isNotEmpty()) "${if (p.total > 0) p.total else p.albums.size} albums" else "No albums found."

    /** A failure as the status line says it: not signed in, the service's own words. */
    fun failure(service: String, message: String?): String = if (message?.contains("not connected", ignoreCase = true) == true)
        (if (service == "tidal") "Sign in to Tidal in Settings → Services to browse Tidal." else "Connect your Qobuz account in Settings to browse Qobuz.")
        else "Couldn't load: " + (message ?: "no answer")

    /** What the status line says while a view is read. */
    fun loading(tab: ServiceTab?): String = if (tab?.kind == "new-releases") "Loading new releases…" else "Loading…"
    const val SEARCHING = "Searching…"
    const val TOO_SHORT = "Type at least 2 characters to search."

    /** A tap on a tile's favourite: what the toast says once the service has it. */
    fun favourited(service: String, on: Boolean) = if (on) "Added to ${name(service)} favourites" else "Removed from ${name(service)} favourites"

    internal fun albums(service: String, a: JSONArray?): List<ServiceAlbum> = objs(a).map {
        ServiceAlbum(service, it.optString("id"), it.optString("title"), it.optString("version"), it.optString("artist"), it.optString("image").takeIf { s -> s.isNotEmpty() && s != "null" }, it.optBoolean("favourited", false))
    }

    internal fun artists(service: String, a: JSONArray?): List<ServiceArtist> = objs(a).map {
        ServiceArtist(service, it.optString("id"), it.optString("name"), it.optString("image").takeIf { s -> s.isNotEmpty() && s != "null" })
    }

    private fun objs(a: JSONArray?): List<JSONObject> = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }
    private fun enc(s: String) = java.net.URLEncoder.encode(s, "UTF-8").replace("+", "%20")
}
