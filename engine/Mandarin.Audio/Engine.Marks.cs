// Engine.Marks.cs — where the buffer's tracks begin, how much of it is still to play, and a gapless next that fails.
// The next track is decoded while this one plays; one that can't be opened or read (a file gone, a stream refused) used
// to stop everything there and then, the track playing cut off with what was buffered of it. Now what was decoded plays
// out to its end, and only then is the next's failure said, as an error in place of "ended".
namespace Mandarin.Audio;

internal sealed partial class Engine
{
    // The next track's failure, said once what was decoded before it has played out (under the gate).
    private string? failedNext;

    // How long the device and the buffer hold, in seconds (under the gate).
    private double SecondsAhead()
    {
        var m = marks.Count > 0 ? marks[^1] : null;
        if (m == null) return 0;
        return (writeBytes - playedBytes) / (4.0 * m.Channels * m.Rate);
    }

    private Mark? MarkAt(long b)
    {
        Mark? m = null;
        foreach (var x in marks) if (x.Byte <= b) m = x;
        return m ?? (marks.Count > 0 ? marks[0] : null);
    }

    /* The next track of generation [gen] failed: what is decoded plays out, its end said as the failure. */
    private void NextFailed(int gen, string message)
    {
        lock (gate)
        {
            if (gen != generation) return;
            failedNext = message;
            endBytes = writeBytes;
            Monitor.PulseAll(gate);
        }
        log("the next track couldn't be played: " + message + "; the one playing plays out");
    }
}
