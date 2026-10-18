package com.musicd.server.android

import android.app.Activity
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import android.view.ViewGroup
import android.widget.ImageView

/**
 * The screen held still while the page loads again under it (v1.0.7).
 *
 * The side menu's Offline switch puts the page up afresh, on the phone's music
 * or back on the server, and the menu went with it: it shut, the page loaded,
 * and the menu came back open. Now the page asks for the screen to be held
 * ([want], MusicdApp.holdScreen) once its switch has moved; the app shows a
 * picture of the screen as it is over the page while the page loads again,
 * and takes it away when the new page has its menu open again
 * ([down], MusicdApp.screenShown), or after [LONGEST_MS] whatever happens. All
 * that's seen to move is the switch. A page that doesn't ask (an older
 * server's) loads as it always did.
 */
object PageCurtain {
    private const val LONGEST_MS = 4_000L
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var wanted = false
    private var shown: ImageView? = null
    private val late = Runnable { down() }

    /** The page's ask: the next [up] holds the screen. */
    fun want() { wanted = true }

    /** On the main thread: the screen held if the page asked, then [then] (which loads the page again). */
    fun up(activity: Activity, then: () -> Unit) {
        val asked = wanted
        wanted = false
        val root = activity.window?.decorView as? ViewGroup
        if (!asked || root == null || root.width <= 0 || root.height <= 0) { then(); return }
        val shot = runCatching { Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888) }.getOrNull() ?: return then()
        runCatching {
            PixelCopy.request(activity.window, shot, { result ->
                if (result == PixelCopy.SUCCESS && !activity.isFinishing) hold(activity, root, shot)
                then()
            }, main)
        }.onFailure { then() }
    }

    private fun hold(activity: Activity, root: ViewGroup, shot: Bitmap) {
        down()
        // Taps on it go nowhere: the page under it isn't ready for them.
        val v = ImageView(activity).apply { setImageBitmap(shot); scaleType = ImageView.ScaleType.FIT_XY; isClickable = true }
        root.addView(v, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        shown = v
        main.postDelayed(late, LONGEST_MS)
    }

    /** On the main thread: the page itself again, the picture faded off it. */
    fun down() {
        main.removeCallbacks(late)
        val v = shown ?: return
        shown = null
        v.animate().alpha(0f).setDuration(120).withEndAction { (v.parent as? ViewGroup)?.removeView(v) }.start()
    }
}
