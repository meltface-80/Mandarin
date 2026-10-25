package com.musicd.server.android

import android.app.Activity
import com.musicd.server.client.ServerClient
import com.musicd.server.client.UpdateBanner
import com.musicd.server.client.UpdateOffer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.lang.ref.WeakReference
import kotlin.coroutines.resume

/**
 * The update offer at the head of Home, looked for and installed by the app as the page's updater.js did (bug list item
 * 111; what it says is core's UpdateBanner): the server's update and this app's, looked for while Home is on screen and
 * every quarter of an hour; Update starts the server's, follows it to the end, then hands this app's to Android's
 * installer (AppUpdate), the server's outcome seen first; Later puts that offer away until the app starts again.
 * Settings → Updates hands what it found here ([apply]).
 */
internal object UpdateNow {
    private val scope = MainScope()
    @Volatile private var applying = false
    private var offer: UpdateBanner.Offer? = null
    /** The app's update held back while the server's runs: installing it first left the server's outcome unseen. */
    private var appAfterServer = false
    private var dismissed = ""
    /** The app last asked afresh (not its hour's cache) for this server version, or after a restart onto a new one. */
    private var forcedFor = ""
    private var restarted = false
    private var activity = WeakReference<Activity>(null)

    /** The activity the app's update installs from, and the server is asked through. */
    fun attach(a: Activity) { activity = WeakReference(a) }

    /**
     * That activity while it is still there (item 192): the reference outlived it (the phone turned, or the app closed while
     * an update ran), and a dialog shown on a destroyed activity brought the app down. Gone, nothing is shown on it.
     */
    private fun live(): Activity? = activity.get()?.takeIf { !it.isFinishing && !it.isDestroyed }

    private fun client(): ServerClient? = live()?.let { if (OfflineNow.on) null else Store.client(it) }
    private fun show(u: UpdateOffer?) { Notices.now.value = Notices.now.value.copy(update = u) }

    /** Looked for now and every quarter of an hour while Home is on screen (NoticeBanners). */
    suspend fun watch() {
        while (true) { look(); delay(UpdateBanner.LOOK_MS) }
    }

    private suspend fun look() {
        if (applying) return
        val c = client() ?: return
        val s = withContext(Dispatchers.IO) { runCatching { c.getJson("/api/update/status") }.getOrNull() }
        UpdateBanner.running(s)?.let { phase -> applying = true; show(UpdateBanner.busy(phase)); follow(s?.optString("latest")); return }
        val server = s != null && s.optBoolean("available") && !s.isNull("latest") && s.optString("latest").isNotEmpty()
        val want = if (server) "s" + s!!.optString("latest") else if (restarted) "r" + s?.optString("current").orEmpty() else ""
        restarted = false
        val force = want.isNotEmpty() && want != forcedFor
        if (force) forcedFor = want
        val a = appStatus(force)
        if (applying) return
        offer = UpdateBanner.offer(s, a, dismissed)
        show(offer?.banner)
    }

    /** This app's own update ({current, latest, available, installing}), once AppUpdate has looked (12 seconds at most). */
    private suspend fun appStatus(force: Boolean): JSONObject? {
        withTimeoutOrNull(12_000) { suspendCancellableCoroutine<Unit> { k -> AppUpdate.lookup(force) { if (k.isActive) k.resume(Unit) } } }
        return runCatching { JSONObject(AppUpdate.statusJson()) }.getOrNull()
    }

    /** The offer's Update ([now]), or Later: that offer put away. */
    fun tap(now: Boolean) {
        if (now) { update(); return }
        offer?.sig?.takeIf { it.isNotEmpty() }?.let { dismissed = it }
        show(null)
    }

    /** Settings → Updates found an update and its button was tapped again: the [server]'s and this [app]'s installed here, the banner showing how it goes. */
    fun apply(server: Boolean, app: Boolean) {
        dismissed = ""
        offer = UpdateBanner.Offer(server, app, "", offer?.banner ?: UpdateBanner.busy("checking"))
        update()
    }

    private fun update() {
        val o = offer ?: return
        if (applying) return
        val a = live()
        // The app alone goes at once; with the server's, once the server is back.
        if (o.app && !o.server) { a?.let { AppUpdate.installNow(it) }; show(null); return }
        appAfterServer = o.app
        if (!o.server) { show(null); return }
        val c = client() ?: return
        val word = o.banner.now ?: "Update"
        applying = true
        show(UpdateBanner.busy("checking"))
        scope.launch {
            val r = withContext(Dispatchers.IO) { runCatching { c.post("/api/update/apply", JSONObject()) } }
            val e = r.exceptionOrNull()
            if (e is ServerClient.ServerException) { applying = false; show(UpdateBanner.couldntStart(e.message ?: "HTTP ${e.status}", word)); return@launch }
            // Cut off by the restart, or started: followed either way.
            follow(r.getOrNull()?.optJSONObject("status")?.optString("latest"), word)
        }
    }

    /** The server's update followed to its end: back on [target] (or down and up again), failed, or taking too long. */
    private fun follow(target: String?, word: String = "Update") {
        val c = client() ?: return
        scope.launch {
            var wasDown = false
            val until = System.currentTimeMillis() + UpdateBanner.TIMEOUT_MS
            while (System.currentTimeMillis() < until) {
                delay(UpdateBanner.POLL_MS)
                val s = withContext(Dispatchers.IO) { runCatching { c.getJson("/api/update/status") }.getOrNull() }
                if (s == null) { wasDown = true; show(UpdateBanner.busy(UpdateBanner.RESTARTING)); continue }
                if (UpdateBanner.back(s, target, wasDown)) {
                    applying = false; restarted = true; show(null)
                    // The app's own then, from the activity on screen now; none there, it is offered again at the next look.
                    if (appAfterServer) live()?.let { appAfterServer = false; AppUpdate.installNow(it) }
                    HomeKept.reset()
                    look()
                    return@launch
                }
                val phase = s.optJSONObject("apply")?.optString("phase").orEmpty()
                if (phase == "error") {
                    applying = false
                    show(UpdateBanner.failed(s.optJSONObject("apply")?.optString("error"), appAfterServer, word))
                    return@launch
                }
                UpdateBanner.PHASES[phase]?.let { show(UpdateOffer(it, "", null, false, false)) }
            }
            show(UpdateBanner.slow)
        }
    }
}
