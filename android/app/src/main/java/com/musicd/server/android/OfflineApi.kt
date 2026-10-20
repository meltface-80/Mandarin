package com.musicd.server.android

import android.content.Context
import android.content.Intent
import com.musicd.server.client.Answer
import com.musicd.server.client.Deck
import com.musicd.server.client.DeckItem
import com.musicd.server.client.DeckState
import com.musicd.server.client.Phone
import com.musicd.server.client.PhoneAnswers
import com.musicd.server.client.PhoneInfo
import com.musicd.server.client.PhoneRoom
import org.json.JSONObject
import java.io.File

/**
 * The server's /api, answered by the app when the server can't be reached — so MusicD's own interface works offline, on
 * what's on the phone. The answers are core's ([PhoneAnswers], item 107); this gives them the phone: its downloads and
 * its own music ([PhoneData]), its player ([PhoneDeck]), its audio device ([PhoneDevices]), its covers, and the settings
 * as the server last gave them (OfflineSite).
 */
object OfflineApi {

    class Response(val status: Int, val mime: String, val body: ByteArray)

    fun handle(c: Context, method: String, path: String, query: Map<String, String>, body: String?): Response {
        val b = runCatching { if (body.isNullOrBlank()) JSONObject() else JSONObject(body) }.getOrDefault(JSONObject())
        val a = answers(c).answer(method, path, query, b)
        return Response(a.status, a.mime, a.bytes ?: (a.json ?: JSONObject()).toString().toByteArray())
    }

    /** The phone's answers to the server's requests. */
    fun answers(c: Context): PhoneAnswers = PhoneAnswers(
        info = { PhoneInfo(BuildConfig.VERSION_NAME, Store.username(c) ?: "", Store.offlineMode(c)) },
        shelf = { PhoneData.shelf(c) },
        room = PhoneRoom(Store.phoneZone(c), PhoneDeck(c)) { PhoneData.shelf(c) },
        everyDownload = { PhoneData.everyDownload(c) },
        devices = { m, p, b -> PhoneDevices.answer(c, m, p, b) },
        image = { cover(c, it) },
        cached = { p -> OfflineSite.api(c, p)?.let { runCatching { JSONObject(it) }.getOrNull() } },
    )

    /** A cover, by the key asked for: the phone's own album's art, or the downloaded album's cover.jpg. */
    private fun cover(c: Context, key: String): Answer {
        val none = Answer(404, bytes = ByteArray(0), mime = "text/plain")
        if (key.startsWith("phone-")) {
            LocalMusic.load(c)
            val f = LocalMusic.art(c, key.removePrefix("phone-")) ?: return none
            return Answer(200, bytes = f.readBytes(), mime = if (f.name.endsWith(".png")) "image/png" else "image/jpeg")
        }
        val all = DownloadStore.albums(c)
        val hit = all.firstOrNull { it.first.imageKey == key }
            ?: Regex("^al-(\\d+)").find(key)?.groupValues?.get(1)?.toIntOrNull()?.let { id -> all.firstOrNull { it.first.id == id } }
        val f = hit?.let { File(it.second, "cover.jpg") }
        return if (f != null && f.exists()) Answer(200, bytes = f.readBytes(), mime = "image/jpeg") else none
    }
}

/** The phone's player as core's answers drive it, started when first needed. */
internal class PhoneDeck(private val c: Context) : Deck {
    private fun player(): PhonePlayerService? {
        PhonePlayerService.current?.let { return it }
        runCatching { c.startService(Intent(c, PhonePlayerService::class.java)) }
        val until = System.currentTimeMillis() + 3000
        while (System.currentTimeMillis() < until) {
            PhonePlayerService.current?.let { return it }
            Thread.sleep(50)
        }
        return null
    }

    override fun ready(): Boolean = player() != null
    override fun revision(): Long = PhonePlayerService.current?.revision ?: 1
    override fun waitForChange(since: Long, ms: Long) { PhonePlayerService.current?.waitForChange(since, ms) }
    override fun play(albumIds: List<Int>, start: Int, kind: String, only: Int?): Boolean = PhonePlayerService.current?.offlinePlay(albumIds, start, kind, only) ?: false
    override fun command(c: Phone.Command) { PhonePlayerService.current?.offlineCommand(c) }
    override fun state(): DeckState? = PhonePlayerService.current?.offlineState()?.let { s ->
        DeckState(s.state, s.index, s.position, s.duration, s.shuffle, s.loop, s.volume, s.muted,
            s.items.map { DeckItem(it.trackId, it.albumId, it.title, it.artist, it.album, it.imageKey, it.duration, it.albumKey) },
            s.revision, s.format, s.dsp, s.usb)
    }
}
