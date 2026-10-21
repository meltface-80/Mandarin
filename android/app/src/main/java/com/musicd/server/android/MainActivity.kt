package com.musicd.server.android

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.os.SystemClock
import android.widget.FrameLayout
import java.lang.ref.WeakReference

/**
 * The app: Mandarin's own screens, the whole of it (NativeShell), drawn by the app since bug list item 111 (the server's
 * page in a WebView before). What it adds beside them: the lock screen and notification controls, the widget, the Quick
 * Settings tile, downloads and the phone's own music, the pickers Android asks with, and the volume keys on a USB DAC.
 *
 * Away from home the server is reached at its Tailscale address instead ([Away]); with no server at all the screens are
 * answered by the phone itself ([ServerReach], [OfflineNow]) until the server is back.
 */
class MainActivity : androidx.activity.ComponentActivity() {

    companion object {
        private const val REQ_LOCAL_FOLDER = 7301
        private const val REQ_DOWNLOAD_FOLDER = 7302
        private const val REQ_STORAGE = 7303
        private const val REQ_BACKUP_SAVE = 7304
        private const val REQ_BACKUP_OPEN = 7305
        private const val TAG = "MainActivity"
        const val ACTION_CHANGE_SERVER = "com.musicd.server.android.action.CHANGE_SERVER"
        private const val BACKGROUND = 0xFF0E1012.toInt()

        /** The activity on screen, for the server's gate shutting on this phone ([gateShut]). */
        @Volatile private var shown = WeakReference<MainActivity>(null)

        /** The server turned this phone away (core GateWatch, from any thread): signed in again, as its /login once had the page. */
        fun gateShut() { shown.get()?.let { a -> a.runOnUiThread { if (!a.isFinishing) a.signedOut() } } }
    }

    private lateinit var reach: ServerReach
    private val onAway: (Boolean) -> Unit = { NativeShell.wayChanged(); if (::reach.isInitialized) reach.moved() }

    /** The USB port changed (a DAC in or out, permission answered): the phone's player follows. */
    private val onUsb: () -> Unit = { runOnUiThread { PhonePlayerService.current?.usbChanged() } }

    /** Offline, the server looked for now (the Offline dialog's Try the server again, item 110), not at the next look. */
    fun lookForServer() { if (::reach.isInitialized) reach.lookNow() }

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

    // Backup & restore (v0.6.14): Android's own "save as" and "open" for the backup file.
    private var backupSave: ((Uri?) -> Unit)? = null
    private var backupOpen: ((Uri?) -> Unit)? = null

    fun chooseBackupFile(name: String, then: (Uri?) -> Unit) {
        runOnUiThread {
            backupSave = then
            val i = Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType("application/gzip").putExtra(Intent.EXTRA_TITLE, name)
            runCatching { startActivityForResult(i, REQ_BACKUP_SAVE) }.onFailure { backupSave = null; then(null) }
        }
    }

    fun openBackupFile(then: (Uri?) -> Unit) {
        runOnUiThread {
            backupOpen = then
            val i = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType("*/*").putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/gzip", "application/x-gzip", "application/x-tar", "application/octet-stream"))
            runCatching { startActivityForResult(i, REQ_BACKUP_OPEN) }.onFailure { backupOpen = null; then(null) }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        // The backup file's answer, chosen or not: Backup & restore is waiting for it either way.
        if (requestCode == REQ_BACKUP_SAVE || requestCode == REQ_BACKUP_OPEN) {
            val then = if (requestCode == REQ_BACKUP_SAVE) backupSave else backupOpen
            backupSave = null; backupOpen = null
            val uri = if (resultCode == Activity.RESULT_OK) data?.data else null
            // Kept readable after this: a saved backup is restored or deleted from the list (v0.6.18).
            if (uri != null) runCatching { contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) }
            then?.invoke(uri)
            return
        }
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
            }
        }
    }

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

        val root = FrameLayout(this).apply { setBackgroundColor(BACKGROUND) }
        root.addView(NativeShell.attach(this), FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        Insets.pad(root)
        setContentView(root)
        AppLog.line("APP", "the app's screen made")
        AppLog.trace.reset()
        // Every frame drawn, timed by Android (while logging is on, item 121): a stall is found, slow ones counted.
        window.addOnFrameMetricsAvailableListener({ _, m, _ ->
            if (m.getMetric(android.view.FrameMetrics.FIRST_DRAW_FRAME) == 0L)
                AppLog.trace.frame(m.getMetric(android.view.FrameMetrics.TOTAL_DURATION) / 1_000_000, SystemClock.uptimeMillis())?.let { AppLog.found(listOf(it)) }
        }, android.os.Handler(android.os.Looper.getMainLooper()))

        registerBack()
        CrashLog.offer(this)
        askForNotificationPermission()
        AutoDownloads.schedule(this)
        LocalMusic.load(this)
        LocalMusic.watch(this)
        Away.listen(onAway)
        Away.watch(this)
        UsbDac.listen(onUsb)
        UsbDac.start(this)
        reach = ServerReach(this)
        reach.start()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action == ACTION_CHANGE_SERVER) openConnect()
        if (intent.action == android.hardware.usb.UsbManager.ACTION_USB_DEVICE_ATTACHED) UsbDac.refresh(this)
    }

    override fun onResume() {
        super.onResume()
        NativeShell.onScreen.value = true
        if (!::reach.isInitialized) return
        shown = WeakReference(this)
        AppLog.line("APP", "on screen")
        AppLog.snapshots(this, true)
        UpdateNow.attach(this)
        reach.resumed()
        Away.recheck(this)
        // Files added to or taken from the phone's music folder meanwhile: the folder is read again (cheap when nothing
        // changed), and every half minute while on screen.
        LocalMusic.foreground(this, true)
        NowPlayingService.start(this)
        PhonePlayerService.start(this)
    }

    override fun onPause() {
        NativeShell.onScreen.value = false
        AppLog.line("APP", "off screen")
        AppLog.snapshots(this, false)
        if (::reach.isInitialized) reach.paused()
        LocalMusic.foreground(this, false)
        super.onPause()
    }

    /**
     * Offline mode switched (the menu, or Settings → Downloads): the screens go onto the phone's music, or back to the
     * server, or, if that can't be reached, stay on the phone's music. The services follow.
     */
    fun offlineModeChanged() {
        if (!::reach.isInitialized) return
        if (Store.offlineMode(this)) runCatching { stopService(Intent(this, NowPlayingService::class.java)) }
        else { NowPlayingService.start(this); Away.recheck(this) }
        reach.modeChanged()
    }

    /** This phone was signed out (from Settings, or the account was reset): sign in again. */
    internal fun signedOut() {
        Store.setToken(this, null)
        openSignIn()
        finish()
    }

    private fun openSignIn() {
        startActivity(Intent(this, SignInActivity::class.java))
    }

    internal fun openConnect() {
        startActivity(Intent(this, ConnectActivity::class.java))
    }

    private fun askForNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
    }

    /**
     * Back closes what is on top (the side menu, a screen); on Home the app goes to the back. From Android 16 the system
     * no longer calls onBackPressed for apps that target it, so the callback is registered with the dispatcher there; the
     * override covers the versions before.
     */
    private fun back() {
        val on = AppLog.shownLast
        val closed = NativeShell.back()
        AppLog.line("BACK", "on $on: " + if (closed) "closed what was on top" else "the app goes to the back")
        if (!closed) moveTaskToBack(true)
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        AppLog.line("APP", "Android asks for memory back (level $level)", anomaly = com.musicd.server.client.UiTrace.memoryLow(level))
    }

    private fun registerBack() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT
            ) { back() }
        }
    }

    @Deprecated("Deprecated in Java") @Suppress("DEPRECATION")
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

    override fun onDestroy() {
        AppLog.line("APP", "the app's screen gone" + if (isChangingConfigurations) " (made again: the phone turned, or its settings changed)" else "")
        if (shown.get() === this) shown = WeakReference(null)
        UsbDac.unlisten(onUsb)
        LocalMusic.unwatch(this)
        Away.unlisten(onAway)
        if (::reach.isInitialized) reach.stop()
        super.onDestroy()
    }
}
