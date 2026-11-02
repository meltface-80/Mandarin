// WatchMisses.cs — the favourites a service's watch couldn't read, rested (bug list item 234).
//
// The watch (Import.cs) brings in each favourite not yet in the library, every couple of minutes. An album the
// service won't give (gone from its catalogue, or refused) failed on every watch and was asked for again on the
// next: on 2 November 125 Qobuz favourites failed every two minutes all day, a line each in the log, 30,767 lines.
// One that fails now rests before it is asked again, 30 minutes the first time and twice as long each time after,
// a day at most; one read is forgotten. Its first failure is said in the log, in words its redaction keeps (the
// error's name, the service's status); its later ones are not.

namespace Mandarin.Server.Services;

internal sealed class WatchMisses
{
    /* How long an album rests after its first failure, and the most it ever rests. */
    public const double FirstRestMs = 30 * 60_000, LongestRestMs = 24 * 3_600_000.0;

    private static readonly Dictionary<string, WatchMisses> Services = new(StringComparer.Ordinal);
    private readonly Dictionary<string, (int Times, double Until)> missed = new(StringComparer.Ordinal);

    /* The watch's misses of [service] ("qobuz", "tidal"). */
    public static WatchMisses Of(string service)
    {
        lock (Services) return Services.TryGetValue(service, out var w) ? w : Services[service] = new WatchMisses();
    }

    /* How long an album rests after its [times]th failure in a row. */
    public static double RestMs(int times) => Math.Min(LongestRestMs, FirstRestMs * Math.Pow(2, Math.Max(0, times - 1)));

    /* Whether album [id] is resting at [now] (ms): not asked for until its rest is over. */
    public bool Resting(string id, double now)
    {
        lock (missed) return missed.TryGetValue(id, out var m) && now < m.Until;
    }

    /* Album [id] read: forgotten. */
    public void Read(string id)
    {
        lock (missed) missed.Remove(id);
    }

    /* Album [id] failed at [now]: rested; true the first time in a row, when it is said in the log. */
    public bool Failed(string id, double now)
    {
        lock (missed)
        {
            var times = (missed.TryGetValue(id, out var m) ? m.Times : 0) + 1;
            missed[id] = (times, now + RestMs(times));
            return times == 1;
        }
    }

    /* Album [id] of [service] failed with [e] at [now]: rested, and said in the log the first time. */
    public static void Failed(string service, string id, Exception e, double now)
    {
        if (!Of(service).Failed(id, now)) return;
        var minutes = Math.Round(RestMs(1) / 60_000);
        if (e is ServiceError se) Server.Log($"[{service}] watch: a favourite couldn't be read ({e.GetType().Name}, status {se.Status}); asked again in {minutes} min, then less often");
        else Server.Log($"[{service}] watch: a favourite couldn't be read ({e.GetType().Name}); asked again in {minutes} min, then less often");
    }

    /* For the tests: steps of [op, id, now] ("failed", "read", "resting"), on a watch of their own; what each said. */
    public static List<object?> Steps(List<object?> steps)
    {
        var w = new WatchMisses();
        var out_ = new List<object?>();
        foreach (var s in steps)
        {
            var step = s as List<object?> ?? [];
            var op = Tags.Js.Str(step.ElementAtOrDefault(0)); var id = Tags.Js.Str(step.ElementAtOrDefault(1)); var now = Tags.Js.ToNumber(step.ElementAtOrDefault(2));
            out_.Add(op switch { "failed" => w.Failed(id, now), "resting" => w.Resting(id, now), _ => Done(() => w.Read(id)) });
        }
        return out_;
    }

    private static object? Done(Action a) { a(); return null; }
}
