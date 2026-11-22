// SpotifyApi.Throttle.cs — every request to Spotify in one queue, one at a time and spaced (bug list item 518), as Music
// Assistant asks Spotify (its ThrottlerManager(rate_limit=1, period=2) for an app's shared allowance). Mandarin had no
// such gate: an import asked as fast as Spotify answered, and the owner's thousand saved albums made 500 requests in 13
// minutes, after which Spotify shut Mandarin out for a day. Now each request waits its turn, IntervalMs after the last
// (two seconds), so nothing Mandarin does can burst. What the owner is waiting on goes first: a page's ask (not
// "patient") takes the next turn ahead of the import and the builders in the background. And the day's count is kept by
// kind (the saved list, albums, search…), said with the totals, so what spends the allowance is seen.
namespace Mandarin.Server.Services;

using static ServiceHttp;

internal sealed partial class SpotifyApi
{
    /// <summary>The least time between two requests to Spotify, ms (the tests' "spotify_interval_ms"): two seconds.</summary>
    public int IntervalMs { get; init; } = 2000;

    private readonly SemaphoreSlim turn = new(1, 1);
    private double nextAt;
    private int waitingAsks;   // a page's asks waiting for a turn: the background lets them go first

    /* A turn to ask Spotify: [patient] (the background) after any page's ask waiting; each IntervalMs after the last. */
    private async Task Turn(bool patient)
    {
        if (!patient) Interlocked.Increment(ref waitingAsks);
        try
        {
            if (patient) while (Volatile.Read(ref waitingAsks) > 0) await Task.Delay(50);
            await turn.WaitAsync();
        }
        finally { if (!patient) Interlocked.Decrement(ref waitingAsks); }
        try
        {
            var wait = nextAt - NowMs();
            if (wait > 0) await Task.Delay(TimeSpan.FromMilliseconds(wait));
            nextAt = NowMs() + IntervalMs;
        }
        finally { turn.Release(); }
    }

    // ------------------------------------------------------------ the day's requests, by kind

    private readonly Dictionary<string, Queue<double>> byKind = new(StringComparer.Ordinal);

    /* What [url] asks, its ids left out: "me/albums", "albums/{id}", "albums/{id}/tracks", "search", "artists/{id}/albums". */
    internal static string KindOf(string url)
    {
        var path = url.Split('?')[0];
        var at = path.IndexOf("/v1/", StringComparison.Ordinal);
        if (at >= 0) path = path[(at + 4)..];
        return string.Join('/', path.Trim('/').Split('/').Select((s, i) => i > 0 && s.Length >= 16 && s.All(char.IsLetterOrDigit) ? "{id}" : s));
    }

    /* [url]'s request counted under its kind; the day's counts, most first ("albums/{id} 200, me/albums 20"). */
    private string CountKind(string url)
    {
        var now = NowMs();
        lock (byKind)
        {
            var k = KindOf(url);
            if (!byKind.TryGetValue(k, out var q)) byKind[k] = q = new Queue<double>();
            q.Enqueue(now);
            foreach (var each in byKind.Values) while (each.Count > 0 && now - each.Peek() > 86400e3) each.Dequeue();
            return string.Join(", ", byKind.Where(x => x.Value.Count > 0).OrderByDescending(x => x.Value.Count).Select(x => x.Key + " " + x.Value.Count));
        }
    }
}
