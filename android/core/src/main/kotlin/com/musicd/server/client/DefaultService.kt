package com.musicd.server.client

import org.json.JSONObject

/*
 * The default service (bug list item 522; the page's settings-default-service.js and artist-discography.js): Settings →
 * Services' choice of the service whose albums an artist's page shows after the library's, and those albums, typed.
 */

/** The default service ([service], "" for none) and its list's [choices]: None, then each the server offers, one not signed in saying so. */
data class DefaultService(val service: String, val choices: List<Choice>) {
    companion object {
        const val PATH = "/api/settings/default-service"

        /** The ⓘ's words, as the page's. */
        const val INFO = "The service whose albums an artist's page shows after the library's, on its Discography tab: every album of theirs that service has and your library doesn't (an album you already have in another edition is left out). Read from the service when you first open an artist's page, then kept for a day. A service you're not signed in to shows nothing."

        fun parse(j: JSONObject): DefaultService {
            val a = j.optJSONArray("choices")
            val offered = if (a == null) emptyList() else (0 until a.length()).mapNotNull { a.optJSONObject(it) }.filter { it.optString("id").isNotEmpty() }
                .map { Choice(it.optString("id"), it.optString("name").ifEmpty { it.optString("id") } + (if (it.optBoolean("connected")) "" else " (not signed in)")) }
            return DefaultService(j.optString("service"), listOf(Choice("", "None")) + offered)
        }
    }
}

/**
 * An artist's albums on the default service that the library hasn't (/api/artist-discography): the service ([service], ""
 * for none) and its [name], for the heading "More on {name}"; [albums] as the service's browser has them. None when there is
 * no default service, the service has none of theirs, or it didn't answer.
 */
data class ArtistDiscography(val service: String, val name: String, val albums: List<ServiceAlbum>) {
    /** The section's heading. */
    val heading get() = "More on $name"

    companion object {
        /** The address asked for [artist] (and act [act], where acts share the name). */
        fun path(artist: String, act: Long?): String =
            "/api/artist-discography?artist=" + java.net.URLEncoder.encode(artist, "UTF-8") + (if (act != null) "&artist_id=$act" else "")

        fun parse(j: JSONObject): ArtistDiscography {
            val service = j.optString("service")
            val ok = service.isNotEmpty() && j.optString("error").isEmpty()
            return ArtistDiscography(service, j.optString("name").ifEmpty { service }, if (ok) ServiceBrowse.albums(service, j.optJSONArray("albums")) else emptyList())
        }
    }
}
