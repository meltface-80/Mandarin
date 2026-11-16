// GitHubLimit.cs — GitHub's limit on what this box asks of its API without a token (item 437): sixty requests an hour
// from one address, every Settings → Updates check of the server and of each Bridge, and the Library Scanner's pack,
// counted against it. Used up, GitHub answers 403 (or 429) until the hour turns, and the checks said "Check failed"
// for the server and "Nothing published" for a Bridge, neither saying why. Every answer of api.github.com is noted
// here: where the limit is used up, until when (its X-RateLimit-Reset, else Retry-After, else an hour); and until
// then nothing asks it again, and every check says so in words, with how long is left. Said in the log once a time.
using System.Globalization;

namespace Mandarin.Server.Admin;

internal static class GitHubLimit
{
    private static readonly object gate = new();
    private static DateTimeOffset? until;

    /* What GitHub's answer [r] to a request of its API says of the limit: used up until a time, or not. */
    public static void Note(HttpResponseMessage r)
    {
        var code = (int)r.StatusCode;
        var left = Header(r, "X-RateLimit-Remaining");
        if (code is 403 or 429 && (left == 0 || r.Headers.RetryAfter != null))
            UsedUp(Header(r, "X-RateLimit-Reset") is { } s ? DateTimeOffset.FromUnixTimeSeconds(s)
                : DateTimeOffset.UtcNow + (r.Headers.RetryAfter?.Delta ?? TimeSpan.FromHours(1)));
        else if (code < 400) lock (gate) until = null;
    }

    /* The limit used up until [at]: kept, and said in the log once for that time. */
    internal static void UsedUp(DateTimeOffset at)
    {
        lock (gate)
        {
            if (until is { } u && u >= at) return;
            until = at;
        }
        Server.Log($"[update] GitHub's limit of checks from this box is used up until {at.ToUniversalTime().ToString("HH:mm", CultureInfo.InvariantCulture)} UTC: nothing asks it again until then");
    }

    /* Why GitHub isn't to be asked now, in words; null where it may be ([now]: the time, for the tests). */
    public static string? Blocked(DateTimeOffset? now = null)
    {
        lock (gate)
        {
            var n = now ?? DateTimeOffset.UtcNow;
            if (until is not { } u) return null;
            if (u <= n) { until = null; return null; }
            return Words(u - n);
        }
    }

    /* "GitHub's limit … used up: it can be asked again in 23 minutes." */
    internal static string Words(TimeSpan wait)
    {
        var m = Math.Max(1, (int)Math.Ceiling(wait.TotalMinutes));
        return $"GitHub's limit of 60 checks an hour from this box is used up: it can be asked again in {m} minute{(m == 1 ? "" : "s")}.";
    }

    /* Forgotten (the tests). */
    internal static void Reset() { lock (gate) until = null; }

    private static long? Header(HttpResponseMessage r, string name) =>
        r.Headers.TryGetValues(name, out var v) && long.TryParse(v.FirstOrDefault(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : null;
}
