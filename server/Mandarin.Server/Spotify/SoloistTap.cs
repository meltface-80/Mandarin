// SoloistTap.cs — Spotify's samples handed to the room's live stream (bug list item 142): S32 LE stereo at 44.1 kHz,
// as Soloist's sound server writes them (Soloist.Sound.cs). The queue is short: the producer waits while the room is
// behind, so the room's clock sets the pace; as Mandarin DAC Bridge's LiveSource.cs.
using System.Collections.Concurrent;

namespace Mandarin.Server.Spotify;

internal sealed class SoloistTap(int capacity = 24) : IDisposable
{
    private readonly BlockingCollection<byte[]> queue = new(boundedCapacity: capacity);
    private readonly CancellationTokenSource closed = new();
    private byte[] cur = [];
    private int at;

    public bool Closed => closed.IsCancellationRequested;

    public void Preload(byte[] chunk) => queue.TryAdd(chunk);

    /* Blocks while the room is behind; false once the stream has let go. */
    public bool Push(byte[] chunk, CancellationToken ct)
    {
        if (closed.IsCancellationRequested) return false;
        using var both = CancellationTokenSource.CreateLinkedTokenSource(ct, closed.Token);
        try { queue.Add(chunk, both.Token); return true; }
        catch (Exception e) when (e is OperationCanceledException or InvalidOperationException or ObjectDisposedException) { return false; }
    }

    /* Up to [buffer]'s length of samples, waiting for them; 0 once closed. */
    public int Read(Span<byte> buffer, CancellationToken ct)
    {
        while (at >= cur.Length)
        {
            using var both = CancellationTokenSource.CreateLinkedTokenSource(ct, closed.Token);
            try { cur = queue.Take(both.Token); at = 0; }
            catch (Exception e) when (e is OperationCanceledException or InvalidOperationException or ObjectDisposedException) { return 0; }
        }
        int n = Math.Min(buffer.Length, cur.Length - at);
        cur.AsSpan(at, n).CopyTo(buffer);
        at += n;
        return n;
    }

    public void Dispose()
    {
        if (closed.IsCancellationRequested) return;
        closed.Cancel();
        queue.CompleteAdding();
    }
}
