// SoloistPace.cs — Spotify's sound let out at the speed it plays (bug list item 146). Soloist's pipe sink waits for its
// reader, so whoever reads sets Soloist's clock: read faster than real time and Soloist plays faster than real time,
// running ahead of what the room or the phone is heard to play. A phone's player fetches minutes ahead as fast as the
// network allows, so pause and next would be heard minutes late. So the reader keeps to real time, with a lead while
// a stream is open (for the player's buffer to start from), and starts counting afresh after a stall (Spotify
// buffering, paused) rather than racing to make up the time.
namespace Mandarin.Server.Spotify;

internal sealed class SoloistPace
{
    /* How far ahead of real time an open stream may be: enough for a player to start, not enough to be heard late. */
    public const int LeadMs = 3000;
    private const int SlackMs = 250;

    private long startMs = -1, frames;

    /*
     * [chunkFrames] read at [nowMs] (a steady clock, in ms), with [leadMs] allowed ahead: how long to wait before the
     * next read. Behind by more than the lead (a stall): counted from now.
     */
    public int Next(long chunkFrames, long nowMs, int leadMs)
    {
        if (startMs < 0 || frames * 1000 / Soloist.Rate < nowMs - startMs - leadMs - SlackMs) { startMs = nowMs; frames = 0; }
        frames += chunkFrames;
        var ahead = frames * 1000 / Soloist.Rate - (nowMs - startMs) - leadMs;
        return ahead > 0 ? (int)ahead : 0;
    }

    /* Counted afresh (a stream opened or closed: another lead). */
    public void Reset() => startMs = -1;
}
