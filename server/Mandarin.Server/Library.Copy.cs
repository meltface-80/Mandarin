// Library.Copy.cs — which copy of the library a request is answered from, and
// when a new one is read (out of Library.cs).
//
// Reading the whole library again takes a second or two at ten thousand albums
// and more, and the jobs ask for it often as they go: each step of a scan, each
// batch of release days, each artist found to share a name. Every library
// request used to wait for each of those readings, /api/health too, which the
// Android app's home-or-away test reads. A change a job tells as it goes
// (TellSoon, a scan's step) is now read in the background: requests are
// answered from the copy there is meanwhile, and the new one takes its place
// when it is done. Such changes told close together make one reading: it starts
// once they have been quiet a moment (QuietMs), or a couple of seconds on in a
// storm of them (LongestMs); and never sooner after the last reading than nine
// times its length (item 227: at 13,900 albums a reading took 2.4 s, and a
// scan's steps had it read 83 times in an hour), so reading takes a tenth of
// the time at most.
//
// Any other change (an edit, a merge, a verdict, a job's last word, a scan's
// end, the label rules or the music folders changed) is waited for by the next
// request, as before: whoever made it, or waited for the job that did, reads it
// next. So is the very first copy.
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal static partial class Library
{
    // MANDARIN_LIBRARY_QUIET_MS: the quiet moment set (the tests, on a busy machine); the longest wait seven of them.
    private static readonly int QuietMs = int.TryParse(Environment.GetEnvironmentVariable("MANDARIN_LIBRARY_QUIET_MS"), out var q) && q > 0 ? q : 300;
    private static readonly int LongestMs = Math.Max(2000, QuietMs * 7);

    private static string frontKey = "";
    /* The key this server's private addresses (/internal/…, the tests') are asked with. */
    public static string FrontKey => frontKey;
    private static volatile Snapshot? current;
    // One reading at a time; the background one, while a new copy is wanted.
    private static readonly SemaphoreSlim Building = new(1, 1);
    private static readonly object wantGate = new();
    private static Task? rebuilding;
    private static bool wanted;
    // When the copy first fell behind, and when a change was last told (Environment.TickCount64).
    private static long behindSince, lastTold;
    // When the last reading ended (Environment.TickCount64), and how long it took.
    private static long lastReadEnd, lastReadMs;
    // The version every copy answered from has at least: the last change told that isn't a job's step.
    private static long mustVersion;
    private static long reads;

    /* The copies read so far (the tests count them: /internal/library/changed). */
    public static long Reads => Interlocked.Read(ref reads);

    private static void Init(string key)
    {
        frontKey = key;
        // Looked at in the background too (every five seconds at most), so a
        // copy behind for any reason is read again with nobody asking.
        _ = Task.Run(async () =>
        {
            while (true)
            {
                await Task.Delay(TimeSpan.FromSeconds(5));
                try { await Current(); }
                catch (Exception e) { Server.Log($"[library] {e.GetType().Name}: {e.Message}"); }
            }
        });
    }

    private static Task<LibState?> State() => Task.FromResult<LibState?>(LocalState());

    /* The library's version now, for what is kept no longer than it stays (Services/). */
    public static async Task<long?> StateVersion() => (await State())?.Version;

    /* The current copy, for the covers (Images.cs); null when it can't be read. */
    public static async Task<Snapshot?> CurrentCopy() => (await Current()) is var (s, _) ? s : null;

    /* The current copy and the library's state with it (Identify/), or null when it can't be read. */
    public static Task<(Snapshot, LibState)?> CurrentState() => Current();

    /* A job's step told (a batch of release days, an artist's other name): read in the background, nobody waiting. */
    public static Task TellSoon(JsonObject what) => LocalTold(what, soon: true);

    /*
     * The copy to answer from: read now when there is none, or when it lacks a
     * change someone waits to see; one behind only by a job's steps answers
     * while the new one is read in the background.
     */
    private static async Task<(Snapshot, LibState)?> Current()
    {
        var st = await State();
        if (st == null) return null;
        var s = current;
        if (s == null || s.Version < Interlocked.Read(ref mustVersion) || s.Rest != st.Rest) s = await Read();
        else if (s.Sig != st.Sig) Want(false);
        return Marked(s, st);
    }

    /* The copy with every change told so far, steps too, waited for (the tests' word). */
    private static async Task<(Snapshot, LibState)?> Fresh()
    {
        var st = await State();
        if (st == null) return null;
        var s = current;
        if (s == null || s.Sig != st.Sig) s = await Read();
        return Marked(s, st);
    }

    /* A change told: the version moved, the copy read soon; one waited for by the next request unless it is a step. */
    private static void Moved(bool soon)
    {
        var v = Interlocked.Increment(ref version);
        if (!soon)
        {
            long m;
            while ((m = Interlocked.Read(ref mustVersion)) < v && Interlocked.CompareExchange(ref mustVersion, v, m) != m) { }
        }
        Want(true);
    }

    /* The hearts and Listen later as they are now: their own two tables, read again when they moved. */
    private static (Snapshot, LibState) Marked(Snapshot s, LibState st)
    {
        if (s.Marks.N != st.Marks)
        {
            using var c = Db.Open();
            s.Marks = ReadMarks(c, st.Marks);
        }
        return (s, st);
    }

    /* The copy brought up to the library's state now: read, or the one there already is. One reading at a time. */
    private static async Task<Snapshot> Read()
    {
        await Building.WaitAsync();
        try
        {
            var st = LocalState();
            var s = current;
            if (s != null && s.Sig == st.Sig) return s;
            var t0 = Environment.TickCount64;
            s = await Task.Run(() => Build(st));
            current = s; builtAt = NowMs();
            Interlocked.Increment(ref reads);
            var ms = Environment.TickCount64 - t0;
            lastReadEnd = Environment.TickCount64; lastReadMs = ms;
            if (ms > 500) Server.Log($"[library] {s.Albums.Count} albums read in {ms} ms");
            return s;
        }
        finally { Building.Release(); }
    }

    /* A new copy wanted, read in the background ([told]: a change told, which starts the quiet moment again). */
    private static void Want(bool told)
    {
        lock (wantGate)
        {
            var now = Environment.TickCount64;
            if (!wanted) { wanted = true; behindSince = now; }
            if (told) lastTold = now;
            rebuilding ??= Task.Run(Rebuilding);
        }
    }

    /* The background reading: once the changes told have been quiet a moment, or gone on too long, a copy read; until none is wanted. */
    private static async Task Rebuilding()
    {
        while (true)
        {
            await Task.Delay(QuietMs);
            lock (wantGate)
            {
                if (!wanted) { rebuilding = null; return; }
                var now = Environment.TickCount64;
                if (!ReadDue(now, lastTold, behindSince, lastReadEnd, lastReadMs, QuietMs, LongestMs)) continue;
                wanted = false;
            }
            try { await Read(); }
            catch (Exception e) { Server.Log($"[library] {e.GetType().Name}: {e.Message}"); }
        }
    }

    /*
     * May the background reading start [now] (item 227)? The changes told quiet [quietMs] since [lastTold], or behind
     * [longestMs] since [behindSince]; and nine times the last reading's length ([lastMs]) gone since it ended
     * ([lastEnd]), so reading takes a tenth of the time at most however long the jobs go on telling.
     */
    public static bool ReadDue(long now, long lastTold, long behindSince, long lastEnd, long lastMs, int quietMs, int longestMs) =>
        (now - lastTold >= quietMs || now - behindSince >= longestMs) && now - lastEnd >= 9 * lastMs;
}
