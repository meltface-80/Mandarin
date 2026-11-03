// Cpu.Making.cs — the processor while a track is made as it plays (bug list items 259, 260).
//
// A DSF made from PCM, or PCM upsampled in a shape, is made as the device plays it (Upsample/MadeAsPlayed.cs): it is
// playback, and the most of it there is (DSD256 wants some four cores' worth on a small server). Until item 260 it ran
// where this server runs, on the cores playback doesn't keep, beside the scans and the library's reading, the playback
// core left idle. Now, while one is made and for [MakingHoldMs] after (the next track is made in its turn), playback
// keeps all the cores but one, or as many as the owner set (Settings → Library Scanner → Processor: Auto, 1, 2 or 3),
// and the making is put on them like any conversion a device waits for, moved with them when the split moves.
using System.Globalization;

namespace Mandarin.Server;

internal static partial class Cpu
{
    // The cores kept a while after the last making, so that the next track's, begun in its turn, finds them kept.
    private static readonly int MakingHoldMs = int.TryParse(Environment.GetEnvironmentVariable("MANDARIN_CPU_MAKING_HOLD_MS"), out var mh) && mh >= 0 ? mh : 30 * 1000;
    private static int makingRunning;      // makings under way
    private static long makingUntil;       // and their cores kept until then (Environment.TickCount64)
    private static Timer? makingTimer;
    private static int makingCores = -1;   // the owner's setting, read once: 0 for Auto

    /* The cores the owner gave a making (the setting "making_cores"): 0 for Auto (all but one), else 1, 2 or 3. */
    public static int MakingCores
    {
        get
        {
            if (makingCores < 0)
            {
                try { using var c = Db.Open(); makingCores = Db.Setting(c, "making_cores") is { } v && v.GetValueKind() == System.Text.Json.JsonValueKind.Number ? (int)v : 0; }
                catch (Exception) { makingCores = 0; }
            }
            return makingCores;
        }
    }

    /* The owner's setting kept ([n]: 0 for Auto, else 1 to 3), and the split decided again with it. */
    public static void SetMakingCores(int n)
    {
        using (var c = Db.Open())
        using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "INSERT INTO settings(key, value) VALUES('making_cores', $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
            cmd.Parameters.AddWithValue("$v", n.ToString(CultureInfo.InvariantCulture));
            cmd.ExecuteNonQuery();
        }
        lock (Deciding_)
        {
            makingCores = n;
            if (deciding) Recompute();
        }
    }

    /* A making started (true) or ended (false): while any runs, and for a while after, playback keeps its cores. */
    public static void Making(bool on)
    {
        lock (Deciding_)
        {
            if (on) makingRunning++;
            else
            {
                makingRunning = Math.Max(0, makingRunning - 1);
                if (makingRunning == 0)
                {
                    Volatile.Write(ref makingUntil, Environment.TickCount64 + MakingHoldMs);
                    makingTimer?.Dispose();
                    makingTimer = new Timer(_ => { lock (Deciding_) { makingTimer = null; if (deciding) Recompute(); } }, null, MakingHoldMs + 50, Timeout.Infinite);
                }
            }
            if (deciding) Recompute();
        }
    }

    private static bool MakingActive() => Volatile.Read(ref makingRunning) > 0 || Environment.TickCount64 < Volatile.Read(ref makingUntil);
}
