package com.musicd.server.client

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

/*
 * How a ServerClient's requests are answered (bug list item 106, O1 in old/plan-android-native.md): over HTTP by
 * the server ([HttpTransport]), or, offline, by the app itself ([LocalTransport]) from what is on the phone, so every
 * native screen asks the same way whether the server is there or not.
 */

/** Answers a [ServerClient]'s requests. */
interface Transport {
    /** [method] (GET, POST, PATCH, DELETE) on the server's [path], with [body] for those that carry one: the JSON answer, or a [ServerClient.ServerException]. */
    fun json(method: String, path: String, body: JSONObject?, timeout: Int): JSONObject

    /** The bytes at the server's [path] (a cover, the labels' scan log), or at a whole address elsewhere (a service's cover). */
    fun bytes(path: String, timeout: Int): ByteArray
}

/** The server, over HTTP at [baseUrl], signed in with [token]. Plain HttpURLConnection, no library. */
class HttpTransport(private val baseUrl: String, private val token: String?) : Transport {
    override fun json(method: String, path: String, body: JSONObject?, timeout: Int): JSONObject {
        val c = open(baseUrl + path, timeout)
        try {
            if (method != "GET") method(c, method)
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            return readJson(c)
        } finally {
            c.disconnect()
        }
    }

    override fun bytes(path: String, timeout: Int): ByteArray {
        val c = open(if (path.startsWith("http://") || path.startsWith("https://")) path else baseUrl + path, timeout)
        try {
            if (c.responseCode != 200) throw ServerClient.ServerException(c.responseCode, "HTTP ${c.responseCode}")
            return c.inputStream.use { it.readBytes() }
        } finally {
            c.disconnect()
        }
    }

    private fun open(url: String, timeout: Int): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = minOf(timeout, 5000)
            readTimeout = timeout
            useCaches = false
            setRequestProperty("Accept", "application/json")
            if (token != null) setRequestProperty("Authorization", "Bearer $token")
        }

    /** Android's connection takes PATCH (Settings → Audio Devices, item 89); one that refuses it has it set underneath. */
    private fun method(c: HttpURLConnection, method: String) {
        try { c.requestMethod = method } catch (e: java.net.ProtocolException) {
            HttpURLConnection::class.java.getDeclaredField("method").apply { isAccessible = true }.set(c, method)
        }
    }

    private fun readJson(c: HttpURLConnection): JSONObject {
        val code = c.responseCode
        val stream = if (code >= 400) c.errorStream else c.inputStream
        val text = stream?.use { s ->
            val out = ByteArrayOutputStream()
            s.copyTo(out)
            out.toString("UTF-8")
        } ?: ""
        val j = try { JSONObject(text) } catch (e: Exception) { null }
        if (code >= 400) {
            throw ServerClient.ServerException(code, j?.optString("error")?.takeIf { it.isNotEmpty() } ?: "HTTP $code")
        }
        return j ?: throw ServerClient.ServerException(code, "The server answered with something that isn't JSON")
    }
}

/** An answer made in the app: its [status] and its JSON (an error's words under "error"), or its [bytes] of type [mime]. */
class Answer(val status: Int, val json: JSONObject? = null, val bytes: ByteArray? = null, val mime: String = "application/json") {
    companion object {
        fun ok(j: JSONObject) = Answer(200, j)
        fun error(status: Int, message: String) = Answer(status, JSONObject().put("error", message))
    }
}

/** Requests answered in the app by [answer] ([method], the path, the query's fields, the body): offline, the phone's own. */
class LocalTransport(private val answer: (method: String, path: String, query: Map<String, String>, body: JSONObject?) -> Answer) : Transport {
    override fun json(method: String, path: String, body: JSONObject?, timeout: Int): JSONObject {
        val a = ask(method, path, body)
        if (a.status >= 400) throw ServerClient.ServerException(a.status, a.json?.optString("error")?.takeIf { it.isNotEmpty() } ?: "HTTP ${a.status}")
        return a.json ?: throw ServerClient.ServerException(a.status, "The server answered with something that isn't JSON")
    }

    override fun bytes(path: String, timeout: Int): ByteArray {
        val a = ask("GET", path, null)
        return a.bytes?.takeIf { a.status == 200 } ?: throw ServerClient.ServerException(if (a.status == 200) 404 else a.status, "HTTP ${a.status}")
    }

    private fun ask(method: String, path: String, body: JSONObject?): Answer {
        val at = path.indexOf('?')
        val bare = if (at < 0) path else path.substring(0, at)
        return answer(method, bare, if (at < 0) emptyMap() else query(path.substring(at + 1)), body)
    }

    companion object {
        /** A query's fields, decoded (a "+" a space, as a form's). */
        fun query(q: String): Map<String, String> = q.split('&').filter { it.isNotEmpty() }.associate { kv ->
            val i = kv.indexOf('=')
            val k = if (i < 0) kv else kv.substring(0, i)
            val v = if (i < 0) "" else kv.substring(i + 1)
            java.net.URLDecoder.decode(k, "UTF-8") to java.net.URLDecoder.decode(v, "UTF-8")
        }
    }
}

/**
 * [inner]'s answers, its gate shutting on this phone ([ServerClient.ServerException.gateShut]) told to [shut] as well
 * as thrown: the app signs in again, as the page's /login once had it (bug list item 111).
 */
class GateWatch(private val inner: Transport, private val shut: () -> Unit) : Transport {
    override fun json(method: String, path: String, body: JSONObject?, timeout: Int): JSONObject = watched { inner.json(method, path, body, timeout) }
    override fun bytes(path: String, timeout: Int): ByteArray = watched { inner.bytes(path, timeout) }

    private fun <T> watched(ask: () -> T): T = try { ask() } catch (e: ServerClient.ServerException) { if (e.gateShut) shut(); throw e }
}
