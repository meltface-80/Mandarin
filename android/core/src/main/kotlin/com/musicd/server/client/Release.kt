package com.musicd.server.client

import org.json.JSONObject

/**
 * The newest Android app, as GitHub Actions publishes it: dist/latest.json
 * beside the APK on the main branch.
 */
class Release(val version: String, val url: String, val sha256: String) {

    companion object {
        const val LATEST = "https://raw.githubusercontent.com/meltface-80/Mandarin/main/dist/latest.json"

        /**
         * The same file through GitHub's API, asked first. The address above is
         * served from a copy GitHub keeps for up to five minutes — and the app is
         * most often asked about just after the server's update, when that copy
         * still names the version before. The API answers from the repository
         * (sent as the file itself with [API_ACCEPT]); the address above is the
         * fall-back if it's refused (its limit is 60 asks an hour from one place).
         */
        const val LATEST_API = "https://api.github.com/repos/meltface-80/Mandarin/contents/dist/latest.json?ref=main"
        const val API_ACCEPT = "application/vnd.github.raw+json"

        fun parse(j: JSONObject): Release? {
            val v = j.optString("version").trim()
            val u = j.optString("url").trim()
            if (v.isEmpty() || !u.startsWith("https://")) return null
            return Release(v, u, j.optString("sha256").trim().lowercase())
        }

        /**
         * Numbers compared part by part: 0.3.10 is newer than 0.3.9. A
         * pre-release comes before its release, and pre-releases count up by
         * their number: 0.6.0-RC1 < 0.6.0-RC2 < 0.6.0-RC10 < 0.6.0. (Before
         * 0.6.0-RC1 the "-RC1" was ignored, so 0.6.0 wouldn't have been offered
         * over it.)
         */
        fun compare(a: String, b: String): Int {
            val (ca, pa) = split(a)
            val (cb, pb) = split(b)
            for (i in 0 until maxOf(ca.size, cb.size)) {
                val d = ca.getOrElse(i) { 0 }.compareTo(cb.getOrElse(i) { 0 })
                if (d != 0) return d
            }
            return when {
                pa == null && pb == null -> 0
                pa == null -> 1
                pb == null -> -1
                else -> comparePre(pa, pb)
            }
        }

        private fun split(v: String): Pair<List<Int>, String?> {
            val s = v.trim().removePrefix("v").removePrefix("V")
            val core = s.substringBefore('-').substringBefore('+')
            val pre = if (s.length > core.length && s[core.length] == '-') s.substring(core.length + 1).substringBefore('+').takeIf { it.isNotEmpty() } else null
            return core.split('.').map { it.toIntOrNull() ?: 0 } to pre
        }

        /** "RC2" before "RC10": runs of digits as numbers, the rest as text (case aside). */
        private fun comparePre(a: String, b: String): Int {
            val re = Regex("\\d+|\\D+")
            val x = re.findAll(a.lowercase()).map { it.value }.toList()
            val y = re.findAll(b.lowercase()).map { it.value }.toList()
            for (i in 0 until maxOf(x.size, y.size)) {
                val p = x.getOrNull(i) ?: return -1
                val q = y.getOrNull(i) ?: return 1
                val pn = p.toLongOrNull(); val qn = q.toLongOrNull()
                val d = if (pn != null && qn != null) pn.compareTo(qn) else p.compareTo(q)
                if (d != 0) return d
            }
            return 0
        }
    }

    fun newerThan(installed: String) = compare(version, installed) > 0
}
