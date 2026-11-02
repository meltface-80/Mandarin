// LibraryMark.cs — which albums there are, asked for and waited on (bug list item 232; the mark is v0.8.43's,
// Library.AlbumSet).
//
// GET /api/library/mark answers the mark, as the X-Mandarin-Library header carries it on every answer (Program.cs).
// With ?wait_for=<mark> (the one a screen has) it is held until a new copy of the library holds other albums, or
// ?timeout= ms pass (20 s, at most 25), as /api/zone-state's wait: answered at once when the mark has moved
// already. The Android app holds it while it is on screen, and the page while nothing else is asked, so an album a
// scan adds is on the wall sorted by Recently added within a moment of the scan, with nothing touched. Before, the
// app never asked, and the page asked every ten seconds once it had heard nothing for twenty.
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal static partial class Library
{
    private static readonly object MarkGate = new();
    private static readonly List<TaskCompletionSource> MarkWaiters = [];

    /* GET /api/library/mark: the mark; with wait_for, once it is other than that, or the timeout has passed. */
    private static async Task<bool> Mark(HttpContext ctx, Snapshot s, LibState st)
    {
        if (Q(ctx, "wait_for") is { } had)
        {
            var timeout = (int)Math.Max(0, Math.Min(25000, PInt(Q(ctx, "timeout")) is { } t and > 0 ? t : 20000));
            await MarkMoved(had, timeout, ctx.RequestAborted);
            if (ctx.RequestAborted.IsCancellationRequested) return true;
        }
        return await Send(ctx, new JsonObject { ["albums"] = AlbumSetNow ?? s.AlbumSet });
    }

    /* Until the copy's mark is other than [had], [timeoutMs] pass, or [stop] (the asker gone). */
    private static async Task MarkMoved(string had, int timeoutMs, CancellationToken stop)
    {
        var moved = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (MarkGate)
        {
            if ((AlbumSetNow ?? "") != had) return;
            MarkWaiters.Add(moved);
        }
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(stop);
        cts.CancelAfter(timeoutMs);
        using (cts.Token.Register(() => moved.TrySetResult())) await moved.Task;
        lock (MarkGate) MarkWaiters.Remove(moved);
    }

    /* A new copy taken up (Library.Copy.cs Read): whoever waits on the mark told, when its albums are other than [before]'s. */
    private static void MarkRead(string? before, string after)
    {
        if (before == after) return;
        List<TaskCompletionSource> woken;
        lock (MarkGate) { woken = [.. MarkWaiters]; MarkWaiters.Clear(); }
        foreach (var w in woken) w.TrySetResult();
    }
}
