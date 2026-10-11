package com.musicd.server.android

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.WebViewRenderProcess
import androidx.webkit.WebViewRenderProcessClient

/**
 * The WebView's side of watching the page (v0.8.42; what to do when is
 * [com.musicd.server.client.PageWatch], and [MainActivity] does it):
 * asking the page how it is, with a time limit; hearing from the WebView
 * when the page stops handling taps; and ending the page's renderer, so a
 * page whose script is stuck can be put up again.
 */
object PageGuard {
    /** How long the page has to answer. */
    const val ANSWER_MS = 5_000L
    /** How long the WebView may go on not handling taps before the page counts as stopped. */
    private const val UNRESPONSIVE_MS = 10_000L

    private val main = Handler(Looper.getMainLooper())

    /**
     * Run [js] in the page; [then] gets what it returned (as JSON), or null
     * if nothing came back within [ANSWER_MS] — once, on the main thread.
     */
    fun ask(web: WebView, js: String, then: (String?) -> Unit) {
        var done = false
        val late = Runnable { if (!done) { done = true; then(null) } }
        main.postDelayed(late, ANSWER_MS)
        try {
            web.evaluateJavascript(js) { answer ->
                if (!done) {
                    done = true
                    main.removeCallbacks(late)
                    then(answer ?: "null")
                }
            }
        } catch (e: Exception) {
            // A WebView that can't be asked (being replaced): no answer, and nothing held against the page.
            done = true
            main.removeCallbacks(late)
        }
    }

    /**
     * [stopped] is told when the WebView has gone [UNRESPONSIVE_MS] without
     * handling a tap (the page's script stuck), where the WebView can say so.
     */
    fun watchRenderer(web: WebView, stopped: () -> Unit) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_VIEW_RENDERER_CLIENT_BASIC_USAGE)) return
        runCatching {
            WebViewCompat.setWebViewRenderProcessClient(web, object : WebViewRenderProcessClient() {
                // Told again every few seconds while it lasts.
                private var since = 0L
                override fun onRenderProcessUnresponsive(view: WebView, renderer: WebViewRenderProcess?) {
                    val now = SystemClock.elapsedRealtime()
                    if (since == 0L) { since = now; return }
                    if (now - since < UNRESPONSIVE_MS) return
                    since = 0L
                    stopped()
                }
                override fun onRenderProcessResponsive(view: WebView, renderer: WebViewRenderProcess?) { since = 0L }
            })
        }
    }

    /**
     * End the page's renderer: true if it was (the WebView's
     * onRenderProcessGone follows); false where the WebView can't, and the
     * caller replaces the WebView itself.
     */
    fun endRenderer(web: WebView): Boolean = runCatching {
        WebViewFeature.isFeatureSupported(WebViewFeature.GET_WEB_VIEW_RENDERER) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.WEB_VIEW_RENDERER_TERMINATE) &&
            WebViewCompat.getWebViewRenderProcess(web)?.terminate() == true
    }.getOrDefault(false)
}
