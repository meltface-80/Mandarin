// Covers.Sources.cs — the picture an album's cover is drawn from, kept a little while (out of Covers.cs, item 486).
//
// A wall asks for many covers at once, and each of an album's sizes is drawn from the same picture, so the last few
// pictures read are kept: twenty seconds, eight at most, the oldest let go. The oldest were found by sorting the
// dictionary itself, and LINQ sorts a copy it makes by asking how many there are and then for all of them: another
// cover's drawing taking one out between the two left the copy an entry short, an empty one with no key at its end,
// which sorted first (its time zero) and was "removed": ArgumentNullException, Parameter 'key', and the cover not
// drawn. On the owner's server, once, an album's cover was answered 404 for it and drawn at the next ask. The copy
// sorted now is the dictionary's own (ToArray, made whole under its locks).
using System.Collections.Concurrent;

namespace Mandarin.Server;

internal static partial class Covers
{
    private static readonly ConcurrentDictionary<string, (long At, Lazy<Task<byte[]?>> Bytes)> Sources = new();
    private const long SourceMs = 20000;
    /* As many pictures kept as this: a cover is megabytes. */
    private const int SourcesMost = 8;

    /* artwork.source for an album, kept for its other sizes. */
    private static Task<byte[]?> Source(Album al)
    {
        var now = Environment.TickCount64;
        foreach (var (k, v) in Sources) if (now - v.At > SourceMs) Sources.TryRemove(k, out _);
        var key = al.ImageKey;
        var entry = Sources.GetOrAdd(key, k => (now, new Lazy<Task<byte[]?>>(() => Find(al).ContinueWith(t =>
        {
            // A very big one is shared only by the asks already waiting for it; one that couldn't be told (null: its drive away) isn't kept.
            if (t.IsCompletedSuccessfully && t.Result is null or { Length: > 8 << 20 }) Sources.TryRemove(k, out var _);
            return t;
        }, TaskScheduler.Default).Unwrap())));
        if (Sources.Count > SourcesMost)
        {
            var all = Sources.ToArray();
            foreach (var (k, _) in all.OrderBy(x => x.Value.At).Take(all.Length - SourcesMost)) if (k != key) Sources.TryRemove(k, out _);
        }
        return entry.Bytes.Value;
    }
}
