package com.musicd.server.android

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView

/**
 * The page's WebView as the screen holds it ([MainActivity]): the whole of
 * it, in the page's own colour, and no stretch or glow when Home or a list is
 * pulled past its end (v1.0.7). The page's own scrolling already stops dead
 * there (style.css: overscroll-behavior), but Android draws its own effect
 * round the WebView, the stretch from Android 12 on, whatever the page says.
 */
object PageFrame {
    fun frame(web: WebView, background: Int) {
        web.layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        web.setBackgroundColor(background)
        web.overScrollMode = View.OVER_SCROLL_NEVER
    }
}
