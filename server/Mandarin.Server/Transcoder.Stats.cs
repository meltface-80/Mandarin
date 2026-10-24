// Transcoder.Stats.cs — the conversions' cache as /api/health says it: its
// files and their size counted in the background, at most every thirty
// seconds, never on the request's way. Listing and measuring every file of a
// full cache on each ask made the health check slow, and the Android app took
// a slow answer for being away from home. What is being made and what waits
// are said as they are.
namespace Mandarin.Server;

internal static partial class Transcoder
{
    private const long CountEveryMs = 30000;
    private sealed record Count(int Files, double Bytes);
    private static volatile Count counted = new(0, 0);
    private static long countedAt = -CountEveryMs;
    private static int counting;

    /* The cache as /api/health says it (lib/stream.js cacheStats): its FLAC files, their size, what is being made and what waits. */
    public static (int Files, double Bytes, int Running, int Queued) CacheStats()
    {
        if (Environment.TickCount64 - Interlocked.Read(ref countedAt) >= CountEveryMs) CountSoon();
        var c = counted;
        int queued;
        lock (Queue) queued = Queue.Count;
        return (c.Files, c.Bytes, Jobs.Count, queued);
    }

    /* Counted again in the background, one count at a time (from Init too, so the first ask has one). */
    private static void CountSoon()
    {
        if (Interlocked.Exchange(ref counting, 1) == 1) return;
        _ = Task.Run(() =>
        {
            try
            {
                var files = new DirectoryInfo(dir).GetFiles().Where(f => f.Name.EndsWith(".flac", StringComparison.Ordinal)).ToList();
                counted = new Count(files.Count, files.Sum(f => (double)f.Length));
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { counted = new Count(0, 0); }
            finally
            {
                Interlocked.Exchange(ref countedAt, Environment.TickCount64);
                Interlocked.Exchange(ref counting, 0);
            }
        });
    }
}
