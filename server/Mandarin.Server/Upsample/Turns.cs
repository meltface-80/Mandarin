// Turns.cs — the one making that runs, shared between rooms (audit H2).
//
// One making runs at a time, on all of playback's cores but two (Cpu.Making.cs, items 260, 267). It kept its turn
// until it ended, held ahead of its device by Pace or not: a room paused mid-track, or a next track armed and nobody
// reading it yet, kept every other room's making waiting for good, and that room's device was sent nothing. Now a
// making Pace holds yields its turn, and the one to run is chosen (Choose): of those that want it, the one whose device
// has least made ahead of it. A track nothing reads yet (a room's next) waits, as before, for the track before it in
// its room (Follows: Players.Commands.Ready says which), or else for every making begun before it; and a track another
// making goes on into (Warm.cs, item 262) waits for that one to end. When a making Pace held must go on (its device has
// caught up) while another runs, the one further ahead of its device is held instead, by Pace's own stop and continue.
// Where nothing can be held (Windows; a making whose length isn't known before it is made), a making keeps its turn
// until it ends, as before. Every Pace.Holder ticks under the turns' lock (Gate), so that a hold is decided and done
// at once.
using Mandarin.Server.Tags;
using TJs = Mandarin.Server.Tags.Js;

namespace Mandarin.Server.Upsample;

internal static class Turns
{
    /* The lock the turns and every Pace.Holder share. */
    public static readonly object Gate = new();

    /*
     * A making as Choose sees it: [Key]; its place in line ([Order], the first asked for first); [Begun] (given its
     * turn once) or waiting for its first; [Running] (it has the turn); [Wants] the turn (waiting, held by the turns, or
     * held by Pace and its device caught up); [Holdable] by Pace; the seconds of music made [Ahead] of its device
     * (infinity: nothing reads it yet); the track it goes on into ([Continues]); the track before it in its room
     * ([Follows]: "" none made as it plays, null not known).
     */
    public readonly record struct Candidate(string Key, long Order, bool Begun, bool Running, bool Wants, bool Holdable, double Ahead, string? Continues, string? Follows);

    /*
     * Which of [all] runs: the key, or null for none. The one running goes on where it can't be held; else, of the rest
     * that want the turn and may have it, the one least ahead of its device (the first in line where even), in its place
     * where it is [margin] seconds closer to running dry than the one running.
     */
    public static string? Choose(IReadOnlyList<Candidate> all, double margin)
    {
        Candidate? running = null, best = null;
        foreach (var c in all) if (c.Running) running = c;
        if (running is { Holdable: false } r) return r.Key;
        foreach (var c in all)
        {
            if (c.Running || !c.Wants || Waits(c, all)) continue;
            if (best is not { } b || c.Ahead < b.Ahead || c.Ahead == b.Ahead && c.Order < b.Order) best = c;
        }
        if (running is not { } now) return best?.Key;
        return best is { } next && next.Ahead + margin < now.Ahead ? next.Key : now.Key;
    }

    // Whether [c] waits, whatever else: a track another goes on into, until that one ends; a track nothing reads yet,
    // until the track before it in its room ends (or, not known, every making asked for before it).
    private static bool Waits(Candidate c, IReadOnlyList<Candidate> all)
    {
        if (all.Any(o => o.Key != c.Key && o.Continues == c.Key)) return true;
        if (c.Begun || !double.IsPositiveInfinity(c.Ahead)) return false;
        return c.Follows != null ? c.Follows.Length > 0 && all.Any(o => o.Key == c.Follows && o.Key != c.Key) : all.Any(o => o.Order < c.Order);
    }

    private sealed class Seat
    {
        public required ConvJob Job;
        public required long Order;
        public required string? Follows;
        public readonly TaskCompletionSource Given = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Pace.Holder? Holder;
        public bool Running, Wants = true, Said;
        public string? Continues;
    }

    private static readonly List<Seat> Seats = [];
    private static readonly Dictionary<string, string> Followed = [];
    private static long order;
    private static Timer? timer;

    // How much closer to running dry a making must be to take the turn from the one running: a second of music, or a
    // quarter of Pace's lead where that is less.
    private static double Margin => Math.Min(1, Pace.LeadSeconds / 4);

    /* Track [key], when it is made as it plays, follows track [after] in its room ("" for one not made as it plays). */
    public static void Follows(string key, string after)
    {
        lock (Gate)
        {
            if (Followed.Count > 64) Followed.Clear();
            Followed[key] = after;
        }
    }

    /* [job]'s making in line: done when it has its turn. */
    public static Task Wait(ConvJob job)
    {
        lock (Gate)
        {
            var s = new Seat { Job = job, Order = ++order, Follows = Followed.Remove(job.Key, out var f) ? f : null };
            Seats.Add(s);
            timer ??= new Timer(_ => { lock (Gate) Decide(); }, null, 100, 100);
            Decide();
            return s.Given.Task;
        }
    }

    /* [job]'s making goes on into the start of track [next], whose own making waits for it. */
    public static void Continues(ConvJob job, string next)
    {
        lock (Gate) if (Of(job) is { } s) s.Continues = next;
    }

    /* [job]'s making held by Pace, far enough ahead of its device: its turn given up. */
    public static void Yield(ConvJob job)
    {
        lock (Gate)
        {
            if (Of(job) is not { } s) return;
            s.Running = s.Wants = false;
            Decide();
        }
    }

    /* [job]'s making held by Pace, its device caught up: it goes on now, or when its turn comes. */
    public static void Back(ConvJob job)
    {
        lock (Gate)
        {
            if (Of(job) is not { } s) return;
            s.Wants = true;
            Decide();
        }
    }

    /* [job]'s making ended: its turn given up, and its place. */
    public static void Release(ConvJob job)
    {
        lock (Gate)
        {
            if (Of(job) is { } s) Seats.Remove(s);
            if (Seats.Count == 0) { timer?.Dispose(); timer = null; }
            else Decide();
        }
    }

    /* [holder] holding [job]'s making (a new one, begun again: Resume.cs): held at once where it hasn't the turn. */
    public static void Attach(ConvJob job, Pace.Holder holder)
    {
        lock (Gate)
        {
            if (Of(job) is not { } s) return;
            s.Holder = holder;
            if (!s.Running && s.Given.Task.IsCompleted && holder.Hold()) s.Wants = true;
            Decide();
        }
    }

    /* [holder] no longer holds [job]'s making. */
    public static void Detach(ConvJob job, Pace.Holder holder)
    {
        lock (Gate) if (Of(job) is { } s && s.Holder == holder) s.Holder = null;
    }

    private static Seat? Of(ConvJob job) => Seats.Find(s => s.Job == job);

    // The turn given as Choose says, under Gate: the one running held where another is to run.
    private static void Decide()
    {
        if (Seats.Count == 0) return;
        var seen = Seats.Select(s => (Seat: s, View: View(s))).ToList();
        var key = Choose([.. seen.Select(x => x.View)], Margin);
        var running = Seats.Find(s => s.Running);
        var chosen = key == null ? null : Seats.Find(s => s.Job.Key == key);
        if (chosen != null && chosen != running)
        {
            if (running != null)
            {
                if (running.Holder?.Hold() != true) return;
                running.Running = false;
                running.Wants = true;
            }
            chosen.Running = true;
            chosen.Holder?.Go();
            chosen.Given.TrySetResult();
        }
        Said(seen, chosen);
    }

    // A making held by the turns while its device has caught up, and the one running behind its own: said once.
    private static void Said(List<(Seat Seat, Candidate View)> seen, Seat? chosen)
    {
        var half = Pace.LeadSeconds / 2;
        if (chosen == null || seen.Find(x => x.Seat == chosen).View.Ahead >= half) return;
        foreach (var (s, v) in seen)
        {
            if (s == chosen || s.Said || !v.Begun || !v.Wants || v.Ahead >= half) continue;
            s.Said = true;
            Server.Log("[upsample] a making held while its device has caught up, another running: two rooms need more than this server can make");
        }
    }

    private static Candidate View(Seat s)
    {
        var begun = s.Given.Task.IsCompleted;
        var ahead = s.Holder?.Ahead ?? (!begun && Volatile.Read(ref s.Job.Readers) > 0 ? 0 : double.PositiveInfinity);
        return new Candidate(s.Job.Key, s.Order, begun, s.Running, s.Wants, s.Holder?.Holdable == true, ahead, s.Continues, s.Follows);
    }

    /* The tests' own (RulesCommand's "upsample", turns: [{ seats, margin }]): { chosen: [key or null for each] }. */
    public static JsObj Rules(List<object?> cases) => new()
    {
        ["chosen"] = cases.Select(c => c as JsObj ?? new JsObj()).Select(c => (object?)Choose([.. (c["seats"] as List<object?> ?? []).Select(x => x as JsObj ?? new JsObj()).Select(x =>
            new Candidate(TJs.Str(x["key"]), (long)TJs.ToNumber(x["order"]), x["begun"] is true, x["running"] is true, x["wants"] is true, x["holdable"] is true,
                x["ahead"] is double a ? a : double.PositiveInfinity, x["continues"] as string, x["follows"] as string))], TJs.ToNumber(c["margin"]))).ToList(),
    };
}
