package com.musicd.server.client

/**
 * What a freeze in the screen's drawing was waiting on, for the app's freeze report (item 471). A freeze stuck in
 * HardwareRenderer.nSyncAndDrawFrame is the app's main thread waiting for Android's drawing thread (RenderThread),
 * which draws on the graphics chip: its own state, as the kernel has it in /proc/self/task/<id>/, says whether it was
 * drawing (busy), waiting on the graphics driver, or waiting on something else; and the screen the app showed, and how
 * long after it came back on screen, say what it was drawing and when.
 */
object RenderStall {
    /** The state letter of a /proc/<id>/stat line ("1234 (RenderThread) S 1 …"), or null for one that doesn't read. */
    fun state(stat: String?): Char? {
        val close = stat?.lastIndexOf(')') ?: return null
        return stat.getOrNull(close + 2)?.takeIf { close >= 0 && it.isLetter() }
    }

    /** The system call a /proc/<id>/syscall line names (its first number), named where it is one drawing waits in. */
    fun call(syscall: String?): String? {
        val n = syscall?.trim()?.substringBefore(' ')?.toIntOrNull() ?: return null
        if (n < 0) return null   // -1: running, in no call
        return NAMES[n] ?: "system call $n"
    }

    // arm64's numbers (Android phones'): those a drawing thread waits in.
    private val NAMES = mapOf(29 to "ioctl (a driver: the graphics chip's, as a drawing thread's are)", 98 to "futex (a lock)",
        22 to "epoll_pwait", 73 to "ppoll", 63 to "read", 64 to "write", 101 to "nanosleep")

    /**
     * The drawing thread said: what it was doing (from [stat], its kernel wait [wchan] where the kernel tells it, and its
     * [syscall]); "not found" when there was no such thread to read.
     */
    fun describe(stat: String?, wchan: String?, syscall: String?): String {
        val s = state(stat) ?: return "the drawing thread (RenderThread): not found"
        val doing = when (s) {
            'R' -> "running (drawing, busy)"
            'D' -> "waiting on a device, and can't be woken (the graphics driver, most likely)"
            'S' -> "waiting"
            else -> "in state $s"
        }
        val parts = mutableListOf("the drawing thread (RenderThread): $doing")
        wchan?.trim()?.takeIf { it.isNotEmpty() && it != "0" }?.let { parts += "in the kernel at $it" }
        call(syscall)?.let { parts += "in $it" }
        return parts.joinToString(", ")
    }

    /** Where the app was: the screen [shown], and how long since it came back on screen ([sinceMs] -1: not known). */
    fun where(shown: String, sinceMs: Long): String =
        "on $shown" + if (sinceMs >= 0) ", ${"%.1f".format(java.util.Locale.ROOT, sinceMs / 1000.0)} s after the app came back on screen" else ""
}
