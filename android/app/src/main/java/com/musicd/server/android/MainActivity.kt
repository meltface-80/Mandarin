package com.musicd.server.android

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The app: MusicD Server's own page, full screen.
 *
 * The interface is the server's — the same page a browser or the iOS home
 * screen shortcut shows — so a new server version is a new interface with no
 * app update. What the app adds is what a page cannot do: the lock screen and
 * notification controls, the widget, the Quick Settings tile, and a share sheet
 * for the share card.
 *
 * Away from home the page comes from the server's Tailscale address instead
 * (see [Away]), and it is reloaded from the right one whenever that changes.
 *
 * With no server at all, it's still MusicD's own interface: the app answers
 * the page itself — the copy of it kept in [OfflineSite], and [OfflineApi]
 * for the albums on the phone and the phone's player — until the server is
 * back, when the page reloads from it.
 */
class MainActivity : Activity() {

    companion object {
        private const val TAG = "MainActivity"
        const val ACTION_CHANGE_SERVER = "com.musicd.server.android.action.CHANGE_SERVER"
        private const val BACKGROUND = 0xFF0E1012.toInt()

        /**
         * Offline only, added to the page the app serves: tells the page it's
         * offline, and sends each request's body in a header the app can read.
         */
        private const val OFFLINE_SHIM = "<script>window.__musicdOffline=true;(function(){var f=window.fetch;" +
            "window.fetch=function(u,o){try{if(o&&o.body&&typeof o.body==='string'){o=Object.assign({},o);" +
            "var h=new Headers(o.headers||{});h.set('X-Offline-Body',encodeURIComponent(o.body));o.headers=h;}}catch(e){}" +
            "return f.call(this,u,o);};})();</script>"
    }

    private lateinit var root: FrameLayout
    private lateinit var web: WebView
    private lateinit var errorPanel: LinearLayout
    private lateinit var errorText: TextView
    private var loadedBase: String? = null
    private val onAway: (Boolean) -> Unit = { reloadIfMoved() }
    /** The last load failed (set by the WebView client, cleared by each load). */
    private var loadFailed = false
    /** The offline screen has been opened for this outage — once, so Back returns here. */
    private var offlineShown = false
    /** The app is answering the page itself (the server can't be reached). */
    @Volatile private var offline = false
    private val checks = java.util.concurrent.Executors.newSingleThreadExecutor()
    /** Offline: look for the server now and then, and go back to it when it answers. */
    private val serverWatch = object : Runnable {
        override fun run() {
            if (!offline || isFinishing) return
            val base = Store.active(this@MainActivity)?.baseUrl
            checks.execute {
                val back = base != null && runCatching {
                    val c = java.net.URL("$base/api/health").openConnection() as java.net.HttpURLConnection
                    c.connectTimeout = 2500; c.readTimeout = 2500
                    try { c.responseCode == 200 } finally { c.disconnect() }
                }.getOrDefault(false)
                runOnUiThread {
                    if (!offline || isFinishing) return@runOnUiThread
                    if (back) { offline = false; load() } else web.postDelayed(this, 10_000)
                }
            }
        }
    }
    /** Downloads changed: tell the page (gathered, so a burst of progress is one call). */
    private var downloadsPending = false
    private val onDownloads: () -> Unit = {
        runOnUiThread {
            if (!downloadsPending) {
                downloadsPending = true
                web.postDelayed({ downloadsPending = false; tellPageDownloadsChanged() }, 400)
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (intent?.action == ACTION_CHANGE_SERVER || Store.server(this) == null) {
            openConnect()
            finish()
            return
        }
        if (Store.token(this) == null) {
            openSignIn()
            finish()
            return
        }

        root = FrameLayout(this).apply { setBackgroundColor(BACKGROUND) }
        web = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(BACKGROUND)
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                mediaPlaybackRequiresUserGesture = false
                cacheMode = WebSettings.LOAD_DEFAULT
                builtInZoomControls = false
                displayZoomControls = false
                // Tells the page it's inside this app (see index.html: the app
                // keeps it clear of the system bars, so the page mustn't too).
                userAgentString = "$userAgentString MusicDAndroid/${BuildConfig.VERSION_NAME}"
            }
            webViewClient = Client()
            addJavascriptInterface(ShareBridge(this@MainActivity), ShareBridge.NAME)
            addJavascriptInterface(DownloadsBridge(this@MainActivity), DownloadsBridge.NAME)
            addJavascriptInterface(AppBridge(this@MainActivity), AppBridge.NAME)
        }
        root.addView(web)
        root.addView(buildErrorPanel())
        Insets.pad(root)
        setContentView(root)

        registerBack()
        CrashLog.offer(this)
        askForNotificationPermission()
        AutoDownloads.schedule(this)
        DownloadStore.listen(onDownloads)
        Away.listen(onAway)
        Away.watch(this)
        load()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action == ACTION_CHANGE_SERVER) openConnect()
    }

    override fun onResume() {
        super.onResume()
        if (!::web.isInitialized) return
        // The server may have been changed from the connect screen — or it
        // couldn't be reached last time (back from the offline screen): try again.
        if (errorPanel.visibility == View.VISIBLE) load() else reloadIfMoved()
        Away.recheck(this)
        AppUpdate.check(this)
        web.removeCallbacks(liveWatch)
        web.postDelayed(liveWatch, 15_000)
        // Back from the Downloads screen (or anywhere): the page catches up.
        tellPageDownloadsChanged()
        NowPlayingService.start(this)
        PhonePlayerService.start(this)
    }

    private fun hasNetwork(): Boolean = runCatching {
        getSystemService(android.net.ConnectivityManager::class.java).activeNetwork != null
    }.getOrDefault(true)

    /** The server can't be reached: the app answers the page from what's on the phone. */
    private fun goOffline() {
        offline = true
        loadFailed = false
        errorPanel.visibility = View.GONE
        web.visibility = View.VISIBLE
        web.loadUrl("${loadedBase ?: return}/")
        web.removeCallbacks(serverWatch)
        web.postDelayed(serverWatch, 10_000)
    }

    private fun reloadIfMoved() {
        if (!::web.isInitialized) return
        val base = Store.active(this)?.baseUrl
        // A new address, or the way back to the server while the page is offline.
        if (base != null && (base != loadedBase || offline)) load()
    }

    override fun onPause() {
        // Only while it's on screen.
        if (::web.isInitialized) web.removeCallbacks(liveWatch)
        super.onPause()
    }

    private fun load() {
        if (Store.server(this) == null) return openConnect()
        val base = Store.active(this)?.baseUrl ?: return openConnect()
        val token = Store.token(this) ?: return signedOut()
        loadedBase = base
        loadFailed = false
        // No network at all: straight to the app's own copy, rather than an error first.
        offline = !hasNetwork() && OfflineSite.has(this)
        if (offline) web.postDelayed(serverWatch, 10_000)
        // The page signs in with the same token the rest of the app uses.
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setCookie(base, "musicd_session=$token; Path=/")
            flush()
        }
        errorPanel.visibility = View.GONE
        web.visibility = View.VISIBLE
        pageLoaded = false
        web.loadUrl("$base/")
        if (!offline) checkReachable(base)
    }

    /**
     * While the page is open from the server: is it still there? The page
     * alone can't tell a lost server from a slow one — covers go blank and
     * then it fails — so every 15 s the app asks, and if two checks in a row
     * get no answer, the app's own copy of MusicD takes over.
     */
    private var liveFailures = 0
    private val liveWatch = object : Runnable {
        override fun run() {
            if (isFinishing) return
            val base = loadedBase
            if (offline || !pageLoaded || base == null) { web.postDelayed(this, 15_000); return }
            checks.execute {
                val ok = runCatching {
                    val c = java.net.URL("$base/api/health").openConnection() as java.net.HttpURLConnection
                    c.connectTimeout = 4000; c.readTimeout = 4000; c.useCaches = false
                    c.setRequestProperty("Connection", "close")
                    try { c.responseCode == 200 } finally { c.disconnect() }
                }.getOrDefault(false)
                runOnUiThread {
                    if (isFinishing) return@runOnUiThread
                    liveFailures = if (ok) 0 else liveFailures + 1
                    if (liveFailures >= 2 && !offline && loadedBase == base) {
                        liveFailures = 0
                        Away.recheck(this@MainActivity)
                        goOffline()
                    }
                    web.postDelayed(this, 15_000)
                }
            }
        }
    }

    /** Which load a reachability check belongs to (a newer load makes older checks moot). */
    private var loadSeq = 0
    /** The current load finished from the server: a slow check mustn't undo it. */
    private var pageLoaded = false

    /**
     * Alongside the page load: does the server answer at all? An address that
     * can't be reached (away, with no route to the server) can leave the
     * WebView waiting a long time on a black screen before it gives up. If the
     * server hasn't answered within 3 seconds, the app's own copy of MusicD
     * takes over now — the server watch brings the page back when it answers.
     */
    private fun checkReachable(base: String) {
        val seq = ++loadSeq
        checks.execute {
            val ok = runCatching {
                val c = java.net.URL("$base/api/health").openConnection() as java.net.HttpURLConnection
                c.connectTimeout = 3000; c.readTimeout = 3000; c.useCaches = false
                c.setRequestProperty("Connection", "close")
                try { c.responseCode == 200 } finally { c.disconnect() }
            }.getOrDefault(false)
            if (ok) return@execute
            runOnUiThread {
                if (seq != loadSeq || offline || pageLoaded || isFinishing || loadedBase != base) return@runOnUiThread
                Away.recheck(this)
                if (OfflineSite.has(this)) goOffline()
            }
        }
    }

    /** This phone was signed out (from Settings, or the account was reset): sign in again. */
    private fun signedOut() {
        Store.setToken(this, null)
        openSignIn()
        finish()
    }

    private fun openSignIn() {
        startActivity(Intent(this, SignInActivity::class.java))
    }

    private fun openConnect() {
        startActivity(Intent(this, ConnectActivity::class.java))
    }

    private fun buildErrorPanel(): LinearLayout {
        val dp = resources.displayMetrics.density
        errorText = TextView(this).apply {
            setTextColor(0xFFBFC7CE.toInt())
            textSize = 16f
            gravity = Gravity.CENTER
        }
        errorPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding((24 * dp).toInt(), 0, (24 * dp).toInt(), 0)
            setBackgroundColor(BACKGROUND)
            visibility = View.GONE
            addView(errorText)
            addView(Button(this@MainActivity).apply {
                text = "Try again"
                setOnClickListener { load() }
            })
            addView(Button(this@MainActivity).apply {
                text = "On this phone"
                setOnClickListener { startActivity(Intent(this@MainActivity, DownloadsActivity::class.java)) }
            })
            addView(Button(this@MainActivity).apply {
                text = "Change server"
                setOnClickListener { openConnect() }
            })
        }
        return errorPanel
    }

    private fun showError(message: String) {
        errorText.text = message
        errorPanel.visibility = View.VISIBLE
        web.visibility = View.GONE
    }

    private fun askForNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
    }

    /**
     * Back walks the page's own history (album → Home) before it leaves the
     * app. From Android 16 the system no longer calls onBackPressed for apps
     * that target it, so the callback is registered with the dispatcher there;
     * the override covers the versions before.
     */
    private fun back() {
        if (!::web.isInitialized || web.visibility != View.VISIBLE) { moveTaskToBack(true); return }
        // The page first: full-screen Settings closes (or steps back a pane).
        web.evaluateJavascript("(window.__musicdBack && window.__musicdBack()) ? 1 : 0") { handled ->
            if (handled == "1") return@evaluateJavascript
            if (web.canGoBack()) web.goBack() else moveTaskToBack(true)
        }
    }

    private fun registerBack() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT
            ) { back() }
        }
    }

    @Deprecated("Deprecated in Java")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        back()
    }

    private fun tellPageDownloadsChanged() {
        if (!::web.isInitialized || web.visibility != View.VISIBLE) return
        web.evaluateJavascript("window.__musicdDownloadsChanged && window.__musicdDownloadsChanged()", null)
    }

    override fun onDestroy() {
        checks.shutdownNow()
        DownloadStore.unlisten(onDownloads)
        Away.unlisten(onAway)
        if (::web.isInitialized) {
            root.removeView(web)
            web.destroy()
        }
        super.onDestroy()
    }

    private inner class Client : WebViewClient() {
        override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
            // The server sends a signed-out page to /login; the app signs in natively instead.
            val base = loadedBase
            if (base != null && url.startsWith("$base/login")) {
                view.stopLoading()
                signedOut()
            }
        }

        override fun onPageFinished(view: WebView, url: String) {
            if (!loadFailed) offlineShown = false
            if (!loadFailed && !offline) pageLoaded = true
            // From the server: keep the app's copy of the page up to date.
            if (!loadFailed && !offline) OfflineSite.sync(this@MainActivity)
            ShareBridge.install(view)
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            // Perhaps the phone has just left home (or come back): look again.
            Away.recheck(this@MainActivity)
            // MusicD itself, from the app, rather than an error.
            if (!offline && OfflineSite.has(this@MainActivity)) { goOffline(); return }
            val where = Store.active(this@MainActivity)?.toString() ?: "the server"
            loadFailed = true
            showError("Can't reach MusicD Server at $where.\n\n${error.description}\n")
            // The app's own screen instead of an error: what's on the phone, and its player.
            if (!offlineShown && DownloadStore.albums(this@MainActivity).any { it.first.state == "done" }) {
                offlineShown = true
                startActivity(Intent(this@MainActivity, DownloadsActivity::class.java)
                    .putExtra(DownloadsActivity.EXTRA_OFFLINE, true))
            }
        }

        /** Offline, every request to the server is answered by the app. */
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            if (!offline) return null
            val base = loadedBase ?: return null
            val url = request.url
            if (!url.toString().startsWith(base)) return null
            val c = this@MainActivity
            val path = url.path ?: "/"
            if (path.startsWith("/api/")) {
                val q = url.queryParameterNames.associateWith { url.getQueryParameter(it) ?: "" }
                // The page passes a request's body in a header when offline (the WebView doesn't hand it over).
                val body = request.requestHeaders.entries.firstOrNull { it.key.equals("X-Offline-Body", true) }
                    ?.value?.let { java.net.URLDecoder.decode(it, "UTF-8") }
                val r = OfflineApi.handle(c, request.method, path, q, body)
                return respond(r.status, r.mime, r.body)
            }
            val f = OfflineSite.file(c, path)
                ?: if (!path.substringAfterLast('/').contains('.')) OfflineSite.file(c, "/") else null
            if (f == null) return respond(404, "text/plain", ByteArray(0))
            var bytes = f.first
            if (f.second == "text/html") bytes = String(bytes).replaceFirst("<head>", "<head>$OFFLINE_SHIM").toByteArray()
            return respond(200, f.second, bytes)
        }

        private fun respond(status: Int, mime: String, body: ByteArray) = WebResourceResponse(
            mime, "utf-8", status, if (status == 200) "OK" else "Error",
            mapOf("Cache-Control" to "no-store", "Access-Control-Allow-Origin" to "*"),
            java.io.ByteArrayInputStream(body)
        )

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url ?: return false
            val base = loadedBase
            if (base != null && url.toString().startsWith(base)) return false
            return openExternally(url)
        }

        private fun openExternally(url: Uri): Boolean {
            // A Qobuz album link opens the Qobuz app when it is installed.
            val s = url.toString()
            if (s.startsWith("https://open.qobuz.com/album/")) {
                val id = s.removePrefix("https://open.qobuz.com/album/").substringBefore('?').substringBefore('/')
                if (id.isNotEmpty() && id.all { it.isLetterOrDigit() } && start(Uri.parse("qobuzapp://album/$id"))) return true
            }
            if (!start(url)) Log.w(TAG, "nothing could open $url")
            return true
        }

        private fun start(url: Uri): Boolean = try {
            startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        } catch (e: Exception) {
            false
        }
    }
}
