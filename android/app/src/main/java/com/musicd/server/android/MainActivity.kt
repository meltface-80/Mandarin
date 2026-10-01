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
import androidx.webkit.ProxyConfig
import androidx.webkit.ProxyController
import androidx.webkit.WebViewFeature

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
        private const val REQ_LOCAL_FOLDER = 7301
        private const val REQ_DOWNLOAD_FOLDER = 7302
        private const val REQ_STORAGE = 7302
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
    /** The page's traffic goes through [PageRelay], for this home address (so the page never moves). */
    private var relayedFor: String? = null
    private var relayTriedFor: String? = null
    /** The last load failed (set by the WebView client, cleared by each load). */
    private var loadFailed = false
    /** The offline screen has been opened for this outage — once, so Back returns here. */
    private var offlineShown = false
    /** The app is answering the page itself (the server can't be reached). */
    @Volatile private var offline = false
    private val checks = java.util.concurrent.Executors.newSingleThreadExecutor()
    /**
     * Offline: look for the server now and then, and go back to it when it
     * answers. Each look first has the way to the server checked and, if need
     * be, repaired ([Away.check]: the Tailscale engine's tunnel can go stale
     * while the phone sleeps, and only a check brings it back — before, only a
     * change of network did, which is why airplane mode on and off "fixed" it).
     */
    private val serverWatch = object : Runnable {
        override fun run() {
            if (!offline || isFinishing) return
            checks.execute {
                runCatching { Away.check(this@MainActivity) }
                val base = Store.active(this@MainActivity)?.baseUrl
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

    /** The phone's own music changed (a scan, a folder chosen or forgotten): the page catches up. */
    private val onLocal: () -> Unit = {
        runOnUiThread { if (::web.isInitialized) web.evaluateJavascript("window.__musicdLocalChanged && window.__musicdLocalChanged()", null) }
    }

    /** Settings → Music Folders → On this phone: Android's folder picker. */
    fun pickLocalFolder() {
        val i = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        runCatching { startActivityForResult(i, REQ_LOCAL_FOLDER) }
            .onFailure { Log.w(TAG, "no folder picker: ${it.message}") }
    }

    /** Settings → Downloads → Download folder: the picker, for the place downloads are saved (v0.5.41). */
    fun pickDownloadFolder() {
        val i = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        runCatching { startActivityForResult(i, REQ_DOWNLOAD_FOLDER) }
            .onFailure { Log.w(TAG, "no folder picker: ${it.message}") }
    }

    /** Android's "all files" access for the app (downloads into the music folder), or the storage permission before Android 11. */
    fun openAllFilesAccess() {
        if (Build.VERSION.SDK_INT >= 30) {
            val i = Intent(android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:$packageName"))
            runCatching { startActivity(i) }.onFailure { runCatching { startActivity(Intent(android.provider.Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)) } }
        } else {
            requestPermissions(arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), REQ_STORAGE)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (resultCode != Activity.RESULT_OK) return
        val uri = data?.data ?: return
        when (requestCode) {
            REQ_LOCAL_FOLDER -> {
                runCatching { contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
                LocalMusic.setFolder(this, uri)
            }
            REQ_DOWNLOAD_FOLDER -> {
                runCatching { contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) }
                DownloadStore.setDownloadFolder(this, uri)
                tellPageDownloadsChanged()
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
                // Draws a little beyond what's on screen, so moving around
                // (carousels, walls, the album sheet) has its tiles ready.
                offscreenPreRaster = true
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
            addJavascriptInterface(UsbBridge(this@MainActivity), UsbBridge.NAME)
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
        LocalMusic.load(this)
        LocalMusic.listen(onLocal)
        LocalMusic.watch(this)
        Away.listen(onAway)
        Away.watch(this)
        UsbDac.listen(onUsb)
        UsbDac.start(this)
        load()
    }

    /** The USB port changed (a DAC in or out, permission answered): the page's Audio Devices follow. */
    private val onUsb: () -> Unit = {
        runOnUiThread { PhonePlayerService.current?.usbChanged() }
        tellPage("window.__musicdUsbChanged && window.__musicdUsbChanged()")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action == ACTION_CHANGE_SERVER) openConnect()
        if (intent.action == android.hardware.usb.UsbManager.ACTION_USB_DEVICE_ATTACHED) UsbDac.refresh(this)
    }

    override fun onResume() {
        super.onResume()
        if (!::web.isInitialized) return
        // The server may have been changed from the connect screen — or it
        // couldn't be reached last time (back from the offline screen): try again.
        if (errorPanel.visibility == View.VISIBLE) load() else reloadIfMoved()
        Away.recheck(this)
        // A page that offers the app's updates with the server's does it; an older
        // one doesn't, and the app offers itself. (Given the page a moment to say.)
        web.postDelayed({ if (!AppBridge.pageOffersUpdates && !isFinishing) AppUpdate.check(this) }, 8000)
        web.removeCallbacks(liveWatch)
        web.postDelayed(liveWatch, 15_000)
        // Back from the Downloads screen (or anywhere): the page catches up.
        tellPageDownloadsChanged()
        // Files added to or taken from the phone's music folder meanwhile: read again (cheap when nothing changed).
        LocalMusic.checkSoon(this)
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
        if (relayedFor != null && relayedFor == Store.server(this)?.baseUrl) {
            // The page stays where it is; only the relay's way to the server changes.
            PageRelay.retarget(this)
            if (offline) load()
            return
        }
        val base = Store.active(this)?.baseUrl
        // A new address, or the way back to the server while the page is offline.
        if (base != null && (base != loadedBase || offline)) load()
    }

    /**
     * The WebView sends the home address's traffic (and nothing else) through
     * [PageRelay], so the page can stay on it at home and away. Then [then].
     * Where the WebView can't do that (an old one), or the server is on https,
     * the page moves between addresses as before.
     */
    private fun relayPage(then: () -> Unit) {
        val home = Store.server(this)
        if (home == null || home.secure || relayedFor == home.baseUrl || !PageRelay.start(this)) { then(); return }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE_REVERSE_BYPASS)) {
            val config = ProxyConfig.Builder()
                .addProxyRule("127.0.0.1:${PageRelay.PORT}", ProxyConfig.MATCH_HTTP)
                // Reversed: the only address that goes through the relay is the server's.
                .addBypassRule("${home.urlHost}:${home.port}")
                .setReverseBypassEnabled(true)
                .build()
            try {
                ProxyController.getInstance().setProxyOverride(config, { r -> runOnUiThread(r) }) {
                    relayedFor = home.baseUrl
                    then()
                }
            } catch (e: Exception) {
                Log.w(TAG, "the page can't go through the relay: ${e.message}")
                then()
            }
        } else {
            then()
        }
    }

    override fun onPause() {
        // Only while it's on screen.
        if (::web.isInitialized) web.removeCallbacks(liveWatch)
        super.onPause()
    }

    private fun load() {
        AppBridge.pageOffersUpdates = false    // the page being loaded says so again if it does
        val home = Store.server(this) ?: return openConnect()
        if (relayTriedFor != home.baseUrl) {
            // Once per home address (a changed server is set up again).
            relayTriedFor = home.baseUrl
            if (relayedFor != home.baseUrl) relayedFor = null
            return relayPage { load() }
        }
        // Through the relay the page stays on the home address, wherever the server is reached.
        val base = (if (relayedFor == home.baseUrl) home.baseUrl else Store.active(this)?.baseUrl) ?: return openConnect()
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
        if (!offline) checkReachable(Store.active(this)?.baseUrl ?: base)
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
            // Asked of the server where it's reached now (the page's address may be the relayed home one).
            val base = Store.active(this@MainActivity)?.baseUrl
            val page = loadedBase
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
                    if (liveFailures >= 2 && !offline && loadedBase == page) {
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
                if (seq != loadSeq || offline || pageLoaded || isFinishing) return@runOnUiThread
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
        // The page first: one step back its own way (Settings, a pop-up, the
        // album, a wall → Home). "2": the page is on Home with nothing open —
        // leave, never web.goBack(), which could land on an earlier page load
        // (the sign-in page) and reload everything. "0": an older page with no
        // Back of its own — as before.
        web.evaluateJavascript("(window.__musicdBack && window.__musicdBack()) ? 1 : (window.__pageBack ? 2 : 0)") { handled ->
            when (handled) {
                "1" -> return@evaluateJavascript
                "2" -> moveTaskToBack(true)
                else -> if (web.canGoBack()) web.goBack() else moveTaskToBack(true)
            }
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

    /** The volume buttons move the USB DAC's level when the app plays through it (Stage 9); Android's stream otherwise. */
    override fun onKeyDown(keyCode: Int, event: android.view.KeyEvent?): Boolean {
        if (keyCode == android.view.KeyEvent.KEYCODE_VOLUME_UP || keyCode == android.view.KeyEvent.KEYCODE_VOLUME_DOWN) {
            if (PhonePlayerService.current?.usbVolumeKey(keyCode == android.view.KeyEvent.KEYCODE_VOLUME_UP) == true) return true
        }
        return super.onKeyDown(keyCode, event)
    }

    /** Run [js] in the page (from any thread). */
    fun tellPage(js: String) {
        runOnUiThread {
            if (::web.isInitialized && web.visibility == View.VISIBLE) web.evaluateJavascript(js, null)
        }
    }

    private fun tellPageDownloadsChanged() {
        if (!::web.isInitialized || web.visibility != View.VISIBLE) return
        web.evaluateJavascript("window.__musicdDownloadsChanged && window.__musicdDownloadsChanged()", null)
    }

    override fun onDestroy() {
        UsbDac.unlisten(onUsb)
        LocalMusic.unwatch(this)
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
            showError("Can't reach Mandarin at $where.\n\n${error.description}\n")
            // The app's own screen instead of an error: what's on the phone, and its player.
            if (!offlineShown && DownloadStore.albums(this@MainActivity).any { it.first.state == "done" }) {
                offlineShown = true
                startActivity(Intent(this@MainActivity, DownloadsActivity::class.java)
                    .putExtra(DownloadsActivity.EXTRA_OFFLINE, true))
            }
        }

        /** Offline, every request to the server is answered by the app; the
         *  phone's own music (its albums, its covers) always is. */
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val base = loadedBase ?: return null
            val url = request.url
            if (!url.toString().startsWith(base)) return null
            val c = this@MainActivity
            val path = url.path ?: "/"
            if (!offline) {
                val mine = path.startsWith("/api/image/phone-") || path.startsWith("/api/phone-music/") ||
                    (path == "/api/album" && (url.getQueryParameter("offset") ?: "").startsWith("phone:"))
                if (!mine) return null
                val q = url.queryParameterNames.associateWith { url.getQueryParameter(it) ?: "" }
                val r = OfflineApi.handle(c, request.method, path, q, null)
                return respond(r.status, r.mime, r.body)
            }
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
