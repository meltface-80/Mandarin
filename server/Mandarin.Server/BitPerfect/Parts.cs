// Parts.cs — a recording made in parts made one again (item 286): Mandarin Bridge records a long track in parts, each
// begun on the frame after the last's (its sidecar says which: "first_frame"). Where every part follows on exactly,
// in the same format, they are joined into the one recording of the track they are, so that it is found in what was
// sent once, from its start, and compared whole (a part begun mid-track could be found at another place in music
// that repeats). Parts that don't follow on are left as they are, each compared alone.
using System.Buffers.Binary;
using System.Text.Json.Nodes;

namespace Mandarin.Server.BitPerfect;

internal static class Parts
{
    private static long Whole(JsonNode? n) =>
        n is JsonValue v ? (v.TryGetValue<long>(out var l) ? l : v.TryGetValue<double>(out var d) ? (long)d : -1) : -1;

    /* [parts] joined into [into] where they follow on; else null. */
    public static (string Wav, JsonObject? Said)? Join(List<(string Wav, JsonObject? Said)> parts, string into)
    {
        if (parts.Count < 2 || parts.Any(p => p.Said == null)) return null;
        var heads = parts.Select(p => Recording.Header(p.Wav)).ToList();
        if (heads.Any(h => h == null)) return null;
        var first = heads[0]!;
        long frames = 0;
        var interruptions = new JsonArray();
        for (var i = 0; i < parts.Count; i++)
        {
            var (_, said) = parts[i];
            var h = heads[i]!;
            if (h.Rate != first.Rate || h.Channels != first.Channels || h.ContainerBits != first.ContainerBits) return null;
            if ((string?)said!["kind"] != (string?)parts[0].Said!["kind"] || Whole(said["first_frame"]) != frames) return null;
            foreach (var x in said["interruptions"] as JsonArray ?? [])
                if (x is JsonObject o) { var c = (JsonObject)o.DeepClone(); c["frame"] = Whole(o["frame"]) + frames; interruptions.Add(c); }
            frames += h.DataBytes / (h.Channels * (h.ContainerBits / 8));
        }
        var bytes = heads.Sum(h => h!.DataBytes);
        var head = new byte[first.Data];
        using (var f = File.OpenRead(parts[0].Wav)) f.ReadExactly(head);
        BinaryPrimitives.WriteUInt32LittleEndian(head.AsSpan(4), (uint)Math.Min(uint.MaxValue, head.Length - 8 + bytes));
        BinaryPrimitives.WriteUInt32LittleEndian(head.AsSpan(head.Length - 4), (uint)Math.Min(uint.MaxValue, bytes));
        using (var o = File.Create(into))
        {
            o.Write(head);
            for (var i = 0; i < parts.Count; i++)
            {
                using var f = File.OpenRead(parts[i].Wav);
                f.Position = heads[i]!.Data;
                CopyBytes(f, o, heads[i]!.DataBytes);
            }
        }
        var joined = (JsonObject)parts[0].Said!.DeepClone();
        joined["frames"] = frames;
        joined["seconds"] = Math.Round(frames / (double)first.Rate, 3);
        joined["interruptions"] = interruptions;
        joined["parts"] = parts.Count;
        // The USB driver's underruns and errors while each part ran, together.
        if (joined["usb"] is JsonObject usb)
            foreach (var k in new[] { "underruns", "errors" })
                usb[k] = parts.Sum(p => Math.Max(0, Whole((p.Said!["usb"] as JsonObject)?[k])));
        return (into, joined);
    }

    private static void CopyBytes(Stream from, Stream to, long n)
    {
        var b = new byte[1 << 20];
        while (n > 0)
        {
            var r = from.Read(b, 0, (int)Math.Min(b.Length, n));
            if (r <= 0) return;
            to.Write(b, 0, r);
            n -= r;
        }
    }
}
