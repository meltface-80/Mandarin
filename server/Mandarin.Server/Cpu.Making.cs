// Cpu.Making.cs — the processor while a track is made as it plays (bug list items 259, 260).
//
// A DSF made from PCM, or PCM upsampled in a shape, is made as the device plays it (Upsample/MadeAsPlayed.cs): it is
// playback, and the most of it there is (DSD256 wants some four cores' worth on a small server). Until item 260 it ran
// where this server runs, on the cores playback doesn't keep, beside the scans and the library's reading, the playback
// core left idle. Now, while one is made and for [MakingHoldMs] after (the next track is made in its turn), playback
// keeps all the cores but two (but one on a machine of two or three), or as many as the owner set (Settings → Library
// Scanner → Processor: Auto, 1, 2 or 3), and the making is put on them like any conversion a device waits for, moved
// with them when the split moves. Two, not one, are left (item 267): this server's own threads, which answer the app
// and stream to the device, are on the cores playback doesn't keep, and on one, beside the library's re-reading, a
// device waiting for its track and the app's every request timed out.
using System.Globalization;

namespace Mandarin.Server;

internal static partial class Cpu
{
    // The cores kept a while after the last making, so that the next track's, begun in its turn, finds them kept.
    private static readonly int MakingHoldMs = int.TryParse(Environment.GetEnvironmentVariable("MANDARIN_CPU_MAKING_HOLD_MS"), out var mh) && mh >= 0 ? mh : 30 * 1000;
    // A making that has made nothing more and had nothing more read for this long isn't music playing (item 417).
    private static readonly int QuietMs = int.TryParse(Environment.GetEnvironmentVariable("MANDARIN_MAKING_QUIET_MS"), out var mq) && mq > 0 ? mq : 30 * 1000;
    private static int makingRunning;      // makings under way
    private static long makingUntil;       // and their cores kept until then (Environment.TickCount64)
    private static long makingFlowed;      // when one last made more, or had more read (Environment.TickCount64)
    private static Timer? makingTimer;
    private static (long TrackId, string Name)? makingWhat;   // the last making begun: its track (item 417b)
    private static int makingCores = -1;   // the owner's setting, read once: 0 for Auto

    /* The cores the owner gave a making (the setting "making_cores"): 0 for Auto (all but two, or one: Cpu.Decide), else 1, 2 or 3. */
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

    /*
     * A track being made as it plays, and going on (more made, or more of it read: MakingFlowed) within [QuietMs], or
     * one ended within [MakingHoldMs]: the background's lookups wait (items 409, 417). A making held ahead of a paused
     * device stays under way for as long as the pause; until item 417 the Album Scanner said "Paused while music plays"
     * all that while. The cores stay kept for it (MakingActive): the device may go on at any moment.
     */
    public static bool MakingNow
    {
        get
        {
            var now = Environment.TickCount64;
            return Volatile.Read(ref makingRunning) > 0 && now - Volatile.Read(ref makingFlowed) < QuietMs || now < Volatile.Read(ref makingUntil);
        }
    }

    /* A making made more of its file, or its device read more of it (Upsample/Pace.cs). */
    public static void MakingFlowed() => Volatile.Write(ref makingFlowed, Environment.TickCount64);

    /* The track of the last making begun, its library id and its file's name, and how long ago it last went on (ms): what
       holds the Album Scanner, said (item 417b). Null where none has been made. */
    public static (long TrackId, string Name, long QuietMs)? MakingWhat
    {
        get { lock (Deciding_) return makingWhat is { } w ? (w.TrackId, w.Name, Environment.TickCount64 - Volatile.Read(ref makingFlowed)) : null; }
    }

    /* A making of track [trackId] (its file [name]) started: as Making(true), and named. */
    public static void Making(long trackId, string name)
    {
        lock (Deciding_) makingWhat = (trackId, name);
        Making(true);
    }

    /* A making started (true) or ended (false): while any runs, and for a while after, playback keeps its cores. */
    public static void Making(bool on)
    {
        lock (Deciding_)
        {
            if (on) { makingRunning++; MakingFlowed(); }
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
