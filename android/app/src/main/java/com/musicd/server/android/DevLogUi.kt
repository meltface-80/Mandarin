package com.musicd.server.android

import android.os.SystemClock
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavController
import androidx.navigation.NavGraph
import androidx.navigation.NavHostController
import androidx.navigation.compose.currentBackStackEntryAsState

/*
 * The log build's watch on the shell (bug list item 116; the branch 116-android-log-build alone): each move with the
 * back stack after it and how long after the last tap it came, what is shown each time it changes (the screen on top,
 * the side menu or a sheet over it), and each tap with where it fell. UiTrace (core) finds in them what a smooth app
 * never does. It draws nothing of its own.
 */

/** A screen's name in the log: its route's head, Settings with its page, an album with its number. */
internal fun logName(e: NavBackStackEntry?): String {
    val route = e?.destination?.route ?: return "none"
    val head = route.substringBefore('/').substringBefore('?')
    val a = e.arguments ?: return head
    return when (head) {
        "settings" -> "settings/" + (a.getString("pane") ?: "home")
        "album" -> "album/" + a.getLong("offset")
        else -> head
    }
}

/** The moves, and what is shown, logged and watched. */
@Composable
internal fun DevTrace(nav: NavHostController) {
    DisposableEffect(nav) {
        val moved = NavController.OnDestinationChangedListener { c, _, _ ->
            val now = SystemClock.uptimeMillis()
            val stack = c.currentBackStack.value.filter { it.destination !is NavGraph }
            val after = DevLog.lastTap.takeIf { it > 0 && now - it < 5_000 }?.let { " (${now - it} ms after the last tap)" } ?: ""
            DevLog.line("NAV", "to ${logName(c.currentBackStackEntry)}$after; stack: " + stack.joinToString(" > ") { logName(it) })
            DevLog.found(DevLog.trace.stack(stack.mapNotNull { it.destination.route }, now))
        }
        nav.addOnDestinationChangedListener(moved)
        onDispose { nav.removeOnDestinationChangedListener(moved) }
    }
    val entry by nav.currentBackStackEntryAsState()
    val menu by NativeShell.menuOpen
    val power by PowerKept.asking
    val ask by RoomAsk.asked
    val add by PlaylistAddAsk.asked
    val shown = logName(entry) + (if (menu) "+menu" else "") + (if (power != null) "+power" else "") + (if (ask != null) "+move-question" else "") + (if (add != null) "+add-to-playlist" else "")
    SideEffect {
        val now = SystemClock.uptimeMillis()
        val found = DevLog.trace.shown(shown, now)
        if (found.isNotEmpty() || DevLog.shownLast != shown) DevLog.line("SHOWN", shown)
        DevLog.shownLast = shown
        DevLog.found(found)
    }
}

/** Each tap on the shell logged with where it fell and on what (it takes nothing from the screens: it only looks). */
internal fun Modifier.devTaps(): Modifier = pointerInput(Unit) {
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        val t0 = SystemClock.uptimeMillis()
        DevLog.lastTap = t0
        DevLog.line("TAP", "at ${down.position.x.toInt()},${down.position.y.toInt()} px on ${DevLog.shownLast}")
    }
}
