package com.musicd.server.android

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.usb.UsbManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.KeyEvent
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.musicd.server.client.UsbView
import kotlinx.coroutines.delay

/**
 * The app's two screens: Now Playing, which it opens on (item 430, NowPlayingScreen.kt), and Settings behind its cog
 * (StatusScreen.kt: what the Bridge and the DAC are doing, the USB settings Mandarin's driver has, what keeps the device
 * awake), Back returning to Now Playing. Read afresh every second, only while the app is in front.
 */
class MainActivity : ComponentActivity() {

    /** What the screen shows, read once a second. */
    class Snapshot(
        val service: DacService?,
        val usb: UsbView,
        val statusLine: String,
        val transport: String,
        val title: String?,
        val artist: String?,
        val album: String?,
        val address: String?,
        val server: String?,
        val lastHeard: Long,
        val awake: Boolean,
        val batteryExempt: Boolean,
        val usbNow: String?,
        val fixed: Boolean,
        val limit: Int,
        val volume: Int,
        val caps: DacService.Caps?,
        /** Now Playing's (item 430): the cover's address, what the DAC is fed, the DAC's name, played here yet, this Bridge's name. */
        val art: String?,
        val feed: NowPlaying.Feed?,
        val dacName: String?,
        val playedOnce: Boolean,
        val name: String
    ) {
        fun nowPlaying(): NowPlaying = NowPlaying.of(playedOnce, transport, title, artist, album, art, feed, dacName)
    }

    /** Whether the app is in front: the screen is read only then. */
    private val shown = mutableStateOf(false)

    private var askedUsb: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        UsbDac.start(this)
        askForNotificationPermission()
        val crash = CrashLog.take(this)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Brass, onPrimary = Graphite, background = Graphite, surface = Graphite), typography = bridgeTypography()) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) { App(crash) }
            }
        }
    }

    @Composable
    private fun App(crash: String?) {
        var tick by remember { mutableIntStateOf(0) }
        val again: () -> Unit = { tick++ }
        var snap by remember { mutableStateOf(snapshot()) }
        val inFront by shown
        // Read each second while in front, so a new track shows within one; nothing read with the app out of sight.
        LaunchedEffect(tick, inFront) { while (inFront) { snap = snapshot(); delay(1_000) } }
        // Now Playing first (item 430); Settings behind its cog, or first where the app stopped last time (its report is there).
        var settings by rememberSaveable { mutableStateOf(crash != null) }
        BackHandler(enabled = settings) { settings = false }
        if (settings) StatusScreen(this, snap, crash, again) { settings = false }
        else NowPlayingScreen(snap.nowPlaying(), snap.name) { settings = true }
    }

    fun snapshot(): Snapshot {
        val s = DacService.current?.takeIf { it.ready }
        val d = s?.transport?.current
        val pm = getSystemService(PowerManager::class.java)
        val usb = UsbView(UsbDac.json(this))
        return Snapshot(
            service = s,
            usb = usb,
            statusLine = s?.statusLine() ?: (DacService.current?.statusLine() ?: "The Bridge isn't running"),
            transport = s?.transport?.transportState() ?: "NO_MEDIA_PRESENT",
            title = d?.title?.takeIf { it.isNotBlank() },
            artist = d?.artist?.takeIf { it.isNotBlank() },
            album = d?.album?.takeIf { it.isNotBlank() },
            address = s?.baseUrl(),
            server = s?.slim?.server?.hostAddress,
            lastHeard = s?.slim?.lastHeard ?: 0L,
            awake = Awake.held(),
            batteryExempt = pm.isIgnoringBatteryOptimizations(packageName),
            usbNow = s?.usbNow(),
            fixed = UsbDriver.fixed(this),
            limit = Store.usbLimit(this),
            volume = UsbDriver.volume(),
            caps = s?.caps(),
            art = d?.art?.takeIf { it.isNotBlank() },
            feed = UsbDriver.current?.let { o -> NowPlaying.Feed(o.rate, o.bits, if (o.dsd) o.dsdMultiple else 0, o.kind == "dop") } ?: s?.ownFeed(),
            // No DAC on the port: this device's own, where it is played (item 432).
            dacName = UsbDac.device()?.let { u -> usb.name.ifBlank { u.productName ?: "USB DAC" } } ?: if (OwnDac.on(this)) OwnDac.name() else null,
            playedOnce = Store.playedOnce(this),
            name = Store.friendlyName(this)
        )
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action == UsbManager.ACTION_USB_DEVICE_ATTACHED) UsbDac.refresh(this)
    }

    override fun onResume() {
        super.onResume()
        shown.value = true
        keepScreen(Store.keepScreenOn(this))
        DacService.start(this)
        // A DAC on the port the app may not use yet: asked once per device, here where a dialog can be shown.
        val d = UsbDac.device()
        if (d != null && UsbDac.info() == null && askedUsb != d.deviceName) { askedUsb = d.deviceName; UsbDac.requestPermission(this) }
    }

    override fun onPause() {
        shown.value = false
        super.onPause()
    }

    /** The screen kept on while the app is in front (the device itself is kept awake by the Bridge regardless). */
    fun keepScreen(on: Boolean) {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    /** Android's battery optimisation left off for this app, asked of the system (a dialog). */
    fun askBatteryExemption() {
        runCatching { startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).setData(Uri.parse("package:$packageName"))) }
            .onFailure { runCatching { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) } }
    }

    private fun askForNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
    }

    /** The device's volume buttons drive the DAC's own USB volume control, where it has one and the volume isn't fixed. */
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if ((keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) && UsbDriver.controlsVolume) {
            UsbDriver.stepVolume(keyCode == KeyEvent.KEYCODE_VOLUME_UP)
            DacService.current?.let { s -> s.main.post { if (s.ready) s.slim.rehello() } }
            return true
        }
        return super.onKeyDown(keyCode, event)
    }
}
