// QueueMoves.cs — picks from the queue moved to just after the track playing
// (the queue's Play now and Play next on a selection): lib/sonos/queue-moves.js
// (v0.8.37) rule for rule, held to it by test/sonos-csharp.test.js. Not used
// yet: the queue is still the Node server's until stage 6 of
// docs/specs/csharp-migration.md.
//
// One plan for every kind of player. Positions are 1-based, `current` the
// track playing (0 for none), `positions` the picks in the order they were
// chosen. Each move says which position to take (`from`), the position it is
// inserted before in the queue as it stands (`insertBefore`, Sonos's word) and
// where it lands (`at`). `order` is the queue afterwards as the old positions,
// and `first` where the first pick now sits, which is what Play now jumps to.
// The arguments are taken as JavaScript takes them (Number() of each, the
// length as Array.from reads it, splice's clamping), so odd ones give the same
// odd plan.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

using Js = Mandarin.Server.Tags.Js;

internal static class QueueMoves
{
    public sealed record Move(double From, double InsertBefore, double At);
    public sealed record Plan(List<Move> Moves, List<double> Order, double Current, double First, double Moved);

    /* ToIntegerOrInfinity */
    private static double Int(double x) => double.IsNaN(x) ? 0 : double.IsInfinity(x) ? x : Math.Truncate(x) + 0.0;

    public static Plan PlanMoves(object? length, object? current, object? positions)
    {
        if (positions is not List<object?> picks) throw new JsError("positions.map is not a function");
        var lengthNum = Js.ToNumber(length);
        // Array.from({ length }): ToLength.
        var n = Math.Min(Math.Max(Int(lengthNum), 0), 9007199254740991);
        if (n > int.MaxValue) throw new JsError("Invalid array length");
        var order = new List<double>((int)n);
        for (var i = 1; i <= n; i++) order.Add(i);
        var c = Js.ToNumber(current);
        var cur = Math.Max(0, Math.Min(lengthNum, double.IsNaN(c) || c == 0 ? 0 : c));
        var moves = new List<Move>();
        double k = 0;
        foreach (var id in picks.Select(Js.ToNumber))
        {
            var p = (double)(order.IndexOf(id) + 1);   // === : NaN is nowhere
            if (p == 0) continue;
            if (p == cur) continue;                    // the one playing stays where it is
            var t = cur + 1 + k;                       // before the item there now
            if (p == t) { k++; continue; }             // already next
            var at = p < t ? t - 1 : t;                // taking it out first shifts the rest up
            moves.Add(new Move(p, t, at));
            var item = order[(int)p - 1];
            order.RemoveAt((int)p - 1);
            // splice(at - 1, 0, item): relative to the end when negative, clamped to the list.
            var rel = Int(at - 1);
            var start = rel < 0 ? Math.Max(order.Count + rel, 0) : Math.Min(rel, order.Count);
            order.Insert((int)start, item);
            if (p < cur) cur--;
            k++;
        }
        return new Plan(moves, order, cur, Math.Min(lengthNum, cur + 1), k);
    }

    /* The plan as planMoves returns it. */
    public static JsObj Json(Plan p)
    {
        var o = new JsObj();
        o["moves"] = p.Moves.Select(m =>
        {
            var x = new JsObj();
            x["from"] = m.From;
            x["insertBefore"] = m.InsertBefore;
            x["at"] = m.At;
            return (object?)x;
        }).ToList();
        o["order"] = p.Order.Select(v => (object?)v).ToList();
        o["current"] = p.Current;
        o["first"] = p.First;
        o["moved"] = p.Moved;
        return o;
    }
}
