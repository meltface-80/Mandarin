// Identifier.Loop.cs — when the scan runs and what the page reads of it
// (v0.8.19; out of Identifier.cs in v0.9.2): started and stopped, a tick in the
// hours allowed, one album at a time in the background, and how far it has got.
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Identify;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class Identifier
{
    // ------------------------------------------------------------ the loop

    /* Started, and not stopped: albums are being looked at whenever the hours allow. */
    public bool Running => timer != null && !stopped;

    public void Start()
    {
        if (timer != null) return;
        stopped = false;
        timer = new Timer(_ => { _ = Tick(); }, null, tickMs, tickMs);
    }

    public void Stop()
    {
        stopped = true;
        timer?.Dispose();
        timer = null;
    }

    /* While the C# server doesn't hold the work (the Node server restarting): nothing is started. */
    public Func<bool> Ready = () => true;

    /*
     * Proposals already waiting that the rule now applies (85 % alike, v0.8.41): applied
     * once the library is there, as if accepted. → how many were applied.
     */
    private async Task<int> ApplyWaiting(Snapshot lib)
    {
        List<MatchRow> rows;
        using (var c = Db.Open()) rows = Rows(c, $"SELECT {RowColumns} FROM album_matches WHERE status = 'proposed' AND candidate IS NOT NULL").Select(RowOf).ToList();
        var n = 0;
        foreach (var r in rows)
        {
            JsObj? cand;
            try { cand = JsJson.Parse(Js.Str(r.Candidate)) as JsObj; } catch (Exception) { continue; }
            if (!Score.AppliesUnasked(r.Distance is double d ? d : null)) continue;
            var al = lib.Albums.FirstOrDefault(a => a.Key == r.Key);
            if (al == null || await Accept(al) == null) continue;
            n++;
            log($"[identify] {al.Artist} — {al.Title} → {Js.Str(cand?["artist"])} — {Js.Str(cand?["title"])} ({Js.Num(Score.Similarity(Js.ToNumber(r.Distance)))} %, waiting, now applied)");
        }
        return n;
    }

    public async Task Tick()
    {
        if (Interlocked.Exchange(ref ticking, 1) == 1) return;
        try
        {
            if (busy != null || stopped || !Ready()) return;
            var cur = await Library.CurrentState();
            if (cur is not var (lib, st) || lib.Count == 0) return;
            if (!waitingApplied) { waitingApplied = true; await ApplyWaiting(lib); }
            var stNow = State(lib, st);
            // musicbrainz.org is back: what the pack alone couldn't place is asked again.
            lock (state) if (Now >= pausedUntil && packTried.Count > 0) packTried.Clear();
            if (Js.StrictEq(stNow["reason"], "pack"))
            {
                var al = Next(lib, packOnly: true);
                if (al == null) return;
                Run(al, async () =>
                {
                    try { await IdentifyFromPack(al); }
                    catch (Exception e) { log($"[identify] pack: {e.Message}"); }
                });
                return;
            }
            if (!Js.Truthy(stNow["active"])) return;
            var next = Next(lib);
            if (next == null) return;
            Run(next, async () =>
            {
                try { await Identify(next); failures = 0; }
                catch (Exception e)
                {
                    // MusicBrainz down or unreachable: leave it ten minutes rather than knock every few seconds.
                    if (++failures >= 3)
                    {
                        pausedUntil = Now + 10 * 60 * 1000;
                        failures = 0;
                        log($"[identify] MusicBrainz isn't answering ({e.Message}); trying again in ten minutes");
                    }
                }
            });
        }
        catch (Exception e) { log($"[identify] {e.GetType().Name}: {e.Message}"); }
        finally { Interlocked.Exchange(ref ticking, 0); }
    }

    /* One album looked at, in the background: busy (and current) until it's done. */
    private void Run(Album al, Func<Task> work)
    {
        var done = new TaskCompletionSource();
        busy = done.Task;
        SetCurrent(al);
        _ = Task.Run(async () =>
        {
            try { await work(); }
            finally { SetCurrent(null); busy = null; done.SetResult(); }
        });
    }

    private void SetCurrent(Album? al)
    {
        JsObj? o = null;
        if (al != null)
        {
            o = new JsObj();
            o["id"] = (double)al.Id;
            o["title"] = al.Title;
            o["artist"] = al.Artist;
        }
        lock (state) current = o;
    }

    // ------------------------------------------------------------ the page

    public static JsObj Progress(Snapshot lib, Dictionary<string, MatchRow> rows)
    {
        var counts = new Dictionary<string, double> { ["applied"] = 0, ["proposed"] = 0, ["unidentified"] = 0, ["rejected"] = 0 };
        var keys = new HashSet<string>(Eligible(lib).Select(al => al.Key));
        double checkedN = 0;
        foreach (var (key, r) in rows)
        {
            if (!keys.Contains(key)) continue;
            checkedN++;
            if (counts.ContainsKey(r.Status)) counts[r.Status]++;
        }
        var o = new JsObj();
        o["eligible"] = (double)keys.Count;
        o["checked"] = checkedN;
        foreach (var k in new[] { "applied", "proposed", "unidentified", "rejected" }) o[k] = counts[k];
        return o;
    }
}
