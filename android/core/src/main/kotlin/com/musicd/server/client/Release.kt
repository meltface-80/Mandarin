package com.musicd.server.client

import org.json.JSONObject

/**
 * The newest Android app, as GitHub Actions publishes it: dist/latest.json
 * beside the APK on the main branch.
 */
class Release(val version: String, val url: String, val sha256: String) {

    companion object {
        const val LATEST = "https://raw.githubusercontent.com/meltface-80/MusicD-Server/main/dist/latest.json"

        /**
         * The same file through GitHub's API, asked first. The address above is
         * served from a copy GitHub keeps for up to five minutes — and the app is
         * most often asked about just after the server's update, when that copy
         * still names the version before. The API answers from the repository
         * (sent as the file itself with [API_ACCEPT]); the address above is the
         * fall-back if it's refused (its limit is 60 asks an hour from one place).
         */
        const val LATEST_API = "https://api.github.com/repos/meltface-80/MusicD-Server/contents/dist/latest.json?ref=main"
        const val API_ACCEPT = "application/vnd.github.raw+json"

        fun parse(j: JSONObject): Release? {
            val v = j.optString("version").trim()
            val u = j.optString("url").trim()
            if (v.isEmpty() || !u.startsWith("https://")) return null
            return Release(v, u, j.optString("sha256").trim().lowercase())
        }

        /** Numbers compared part by part: 0.3.10 is newer than 0.3.9. */
        fun compare(a: String, b: String): Int {
            val x = a.trim().removePrefix("v").split('.', '-').map { it.toIntOrNull() ?: 0 }
            val y = b.trim().removePrefix("v").split('.', '-').map { it.toIntOrNull() ?: 0 }
            for (i in 0 until maxOf(x.size, y.size)) {
                val d = (x.getOrElse(i) { 0 }).compareTo(y.getOrElse(i) { 0 })
                if (d != 0) return d
            }
            return 0
        }
    }

    fun newerThan(installed: String) = compare(version, installed) > 0
}
