package com.musicd.server.client

/**
 * The phone player's long poll of the server's commands, one loop at a time and each command applied once (audit A-M1,
 * A-M2).
 *
 * The poll is held open by the server for up to 25 s, and nothing can end it from outside: an interrupt doesn't end a
 * read. Gone dormant and woken again within that time, the old way had the old loop come back with its batch, apply it
 * (the new loop was handed the same commands: both asked with the same `after`) and go on, as `running` was true again:
 * two loops, sharing one cursor, each command played twice. And a 401 ended the loop with `running` left true, so
 * signing in again woke nothing.
 *
 * Here each start is a turn of its own ([begin]); a loop goes on only while its turn is [current]. A batch is applied
 * only through [accept], which drops a batch from a turn that is over and any command at or below the last applied.
 * [after] is what the next poll asks with. Commands the phone makes itself carry seq 0 and never come through here;
 * should an unnumbered one come in a batch, it is let through (it can't be told for a repeat). Thread-safe: the loop
 * runs on its own thread, the commands are applied on the main one.
 */
class PollTurns {
    /** What a loop does after the server's error: [Stop] signed out (its turn is over), [Stale] its turn was over already. */
    enum class Next { Retry, Rehello, Stop, Stale }

    private var turn = 0
    private var on = false
    private var applied = 0L

    /** A loop's turn is on (the service running, not dormant, not signed out). */
    val live: Boolean @Synchronized get() = on

    /** The poll's `after`: the server's seq at the last batch applied, or at the hello. */
    val after: Long @Synchronized get() = applied

    /** A new turn, for the loop started now; a loop of an earlier turn is no longer [current]. */
    @Synchronized fun begin(): Int { turn++; on = true; return turn }

    /** No turn on (dormant, destroyed): the loop out stops at its next look. */
    @Synchronized fun end() { on = false }

    @Synchronized fun current(gen: Int): Boolean = on && gen == turn

    /** The server's hello answered at [seq]: commands are counted from there (a restarted server counts from nought). False for a turn that is over. */
    @Synchronized fun onHello(gen: Int, seq: Long): Boolean {
        if (!current(gen)) return false
        applied = seq
        return true
    }

    /** The commands of [batch] to apply now: none for a turn that is over, and only those after the last applied. */
    @Synchronized fun accept(gen: Int, batch: Phone.Batch): List<Phone.Command> {
        if (!current(gen)) return emptyList()
        // Only a server started again counts lower (it clamps an after above its own): from nought, then.
        if (batch.seq < applied) applied = 0
        val fresh = batch.commands.filter { it.seq <= 0 || it.seq > applied }
        applied = maxOf(applied, batch.seq, fresh.maxOfOrNull { it.seq } ?: 0)
        return fresh
    }

    /** The server answered the poll or the hello with [status]: a 401 ends the turn, so the next wake starts one. */
    @Synchronized fun onError(gen: Int, status: Int): Next {
        if (!current(gen)) return Next.Stale
        return when (status) {
            401 -> { on = false; Next.Stop }
            409 -> Next.Rehello
            else -> Next.Retry
        }
    }
}
