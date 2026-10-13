// Backup.Tar.cs — a backup's file (v0.8.22; out of Backup.cs in v0.9.2): a
// tar.gz written as the Node server's tar package wrote it, and read back as
// zlib reads it, checked to its trailer.
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Admin;

using Js = Mandarin.Server.Tags.Js;

internal static partial class Backup
{
    // ------------------------------------------------------------ tar.gz

    private static byte[] TarHeader(string name, long size, long mtimeMs)
    {
        var h = new byte[512];
        void Put(string s, int at) { var b = Encoding.UTF8.GetBytes(s); Array.Copy(b, 0, h, at, Math.Min(b.Length, 512 - at)); }
        Put(name.Length > 99 ? name[..99] : name, 0);
        Put("0000644\0", 100); Put("0000000\0", 108); Put("0000000\0", 116);
        Put(Convert.ToString(size, 8).PadLeft(11, '0') + "\0", 124);
        Put(Convert.ToString(mtimeMs / 1000, 8).PadLeft(11, '0') + "\0", 136);
        Put("        ", 148);
        Put("0", 156);
        Put("ustar\0", 257); Put("00", 263);
        var sum = 0;
        foreach (var b in h) sum += b;
        Put(Convert.ToString(sum, 8).PadLeft(6, '0') + "\0 ", 148);
        return h;
    }
    private static byte[] Pad(long n) => new byte[(512 - (int)(n % 512)) % 512];

    /* An entry: JSON text (JSON.stringify(v, null, 1)), or a file read from disk (the database copy). */
    public sealed record Entry(string Name, byte[]? Data = null, string? File = null);
    public static Entry JsonEntry(string name, object? value) => new(name, Encoding.UTF8.GetBytes(Pretty(value)));

    /* writeBackup: the entries as a tar, gzipped. */
    public static async Task WriteBackup(Stream output, IEnumerable<Entry> entries)
    {
        await using var gz = new GZipStream(output, new ZLibCompressionOptions { CompressionLevel = 6 }, leaveOpen: true);
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        foreach (var e in entries)
        {
            if (e.File != null)
            {
                var size = new FileInfo(e.File).Length;
                await gz.WriteAsync(TarHeader(e.Name, size, now));
                await using (var f = File.OpenRead(e.File)) await f.CopyToAsync(gz);
                await gz.WriteAsync(Pad(size));
            }
            else
            {
                var data = e.Data ?? [];
                await gz.WriteAsync(TarHeader(e.Name, data.Length, now));
                await gz.WriteAsync(data);
                await gz.WriteAsync(Pad(data.Length));
            }
        }
        await gz.WriteAsync(new byte[1024]);
    }

    /* JSON.stringify(v, null, 1). */
    public static string Pretty(object? v)
    {
        var sb = new StringBuilder();
        if (!WritePretty(sb, v, "")) return "undefined";
        return sb.ToString();
    }
    private static bool WritePretty(StringBuilder sb, object? v, string indent)
    {
        switch (v)
        {
            case JsObj o:
            {
                var inner = indent + " ";
                var first = true;
                var mark = sb.Length;
                sb.Append('{');
                foreach (var k in o.Keys)
                {
                    var x = o[k];
                    if (x is Undef) continue;
                    var at = sb.Length;
                    sb.Append(first ? "\n" : ",\n").Append(inner);
                    Js.Quote(sb, k);
                    sb.Append(": ");
                    if (!WritePretty(sb, x, inner)) { sb.Length = at; continue; }
                    first = false;
                }
                if (first) { sb.Length = mark; sb.Append("{}"); return true; }
                sb.Append('\n').Append(indent).Append('}');
                return true;
            }
            case List<object?> l:
            {
                if (l.Count == 0) { sb.Append("[]"); return true; }
                var inner = indent + " ";
                sb.Append('[');
                for (var i = 0; i < l.Count; i++)
                {
                    sb.Append(i == 0 ? "\n" : ",\n").Append(inner);
                    if (!WritePretty(sb, l[i], inner)) sb.Append("null");
                }
                sb.Append('\n').Append(indent).Append(']');
                return true;
            }
            default:
            {
                var s = Js.Json(v);
                if (s == null) return false;
                sb.Append(s);
                return true;
            }
        }
    }

    public sealed record Read(JsObj Parts, bool HasDb);

    /* A stream of what's inflated, its CRC-32 and length kept for the trailer's check. */
    private sealed class Checked(Stream inner) : Stream
    {
        public uint Crc = 0xffffffffu;
        public long Length0;
        public override int Read(byte[] buffer, int offset, int count) => Read(buffer.AsSpan(offset, count));
        public override int Read(Span<byte> buffer)
        {
            var n = inner.Read(buffer);
            for (var i = 0; i < n; i++) Crc = CrcTable[(Crc ^ buffer[i]) & 0xff] ^ (Crc >> 8);
            Length0 += n;
            return n;
        }
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
    private static readonly uint[] CrcTable = Enumerable.Range(0, 256).Select(n =>
    {
        var c = (uint)n;
        for (var k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
        return c;
    }).ToArray();

    /* The gzip around a backup as zlib takes it: the header's own words, and a member read to its trailer (trailing zero bytes allowed). */
    private static void CheckHead(FileStream f)
    {
        var head = new byte[4];
        var n = f.Read(head, 0, 4);
        f.Position = 0;
        if (n < 2) throw new Refused("unexpected end of file");
        if (head[0] != 0x1f || head[1] != 0x8b) throw new Refused("incorrect header check");
        if (n < 4) throw new Refused("unexpected end of file");
        if (head[2] != 8) throw new Refused("unknown compression method");
        if ((head[3] & 0xe0) != 0) throw new Refused("unknown header flags set");
    }
    private static void CheckTrailer(FileStream f, uint crc, long length)
    {
        var want = new byte[8];
        BitConverter.TryWriteBytes(want.AsSpan(0, 4), crc);
        BitConverter.TryWriteBytes(want.AsSpan(4, 4), (uint)(length & 0xffffffff));
        if (!BitConverter.IsLittleEndian) { Array.Reverse(want, 0, 4); Array.Reverse(want, 4, 4); }
        var end = f.Length;
        var back = (int)Math.Min(end, 65536 + 8);
        var tail = new byte[back];
        f.Position = end - back;
        f.ReadExactly(tail);
        // Where the member ends: its trailer. After it, zlib takes the end or a
        // zero byte (padding) as the end; anything else must be another member.
        for (var at = back - 8; at >= 0; at--)
        {
            if (!tail.AsSpan(at, 8).SequenceEqual(want)) continue;
            var after = back - (at + 8);
            if (after == 0 || tail[at + 8] == 0) return;
            if (after >= 2 && (tail[at + 8] != 0x1f || tail[at + 9] != 0x8b)) throw new Refused("incorrect header check");
            throw new Refused("unexpected end of file");
        }
        throw new Refused("unexpected end of file");
    }

    /*
     * readBackup: the JSON parts into memory (each at most 64 MB), the
     * database copy to dbFile when there is one.
     */
    public static Read ReadBackup(string file, string? dbFile)
    {
        const long JsonMax = 64L * 1024 * 1024;
        var parts = new JsObj();
        var hasDb = false;
        using var f = File.OpenRead(file);
        CheckHead(f);
        Checked inflated;
        Exception? failed = null;
        using (var gz = new GZipStream(f, CompressionMode.Decompress, leaveOpen: true))
        {
            inflated = new Checked(gz);
            try
            {
                var h = new byte[512];
                while (true)
                {
                    if (!Fill(inflated, h)) break;
                    if (h.All(b => b == 0)) break;
                    var nul = Array.IndexOf(h, (byte)0, 0, 100);
                    var name = Encoding.UTF8.GetString(h, 0, nul < 0 ? 100 : nul);
                    var sizeText = Encoding.UTF8.GetString(h, 124, 12);
                    var cut = sizeText.IndexOf('\0');
                    var size = ParseOctal(Js.Trim(cut < 0 ? sizeText : sizeText[..cut]) is { Length: > 0 } st ? st : "0");
                    var isDb = name == "musicd.db";
                    var isJson = !isDb && JsonPart().IsMatch(name);
                    if (isDb && dbFile == null) throw new Refused("A database copy wasn't expected here");
                    if (isJson && size > JsonMax) throw new Refused("The backup's " + name + " is too large");
                    if (double.IsNaN(size) || size == 0)
                    {
                        // Nothing in it: as written, an empty part.
                        if (isDb) { File.WriteAllBytes(dbFile!, []); hasDb = true; }
                        else if (isJson) Part(parts, name, []);
                        continue;
                    }
                    var left = (long)size;
                    if (isDb)
                    {
                        using (var w = File.Create(dbFile!)) if (!Copy(inflated, w, left)) throw new CutShort();
                        hasDb = true;
                    }
                    else if (isJson)
                    {
                        var buf = new byte[left];
                        if (!Fill(inflated, buf)) throw new CutShort();
                        Part(parts, name, buf);
                    }
                    else if (!Copy(inflated, Stream.Null, left)) throw new CutShort();
                    if (!Copy(inflated, Stream.Null, (512 - left % 512) % 512)) break;
                }
                // The rest, inflated to the member's end (its checksum read there).
                inflated.CopyTo(Stream.Null);
            }
            catch (CutShort e) { failed = e; inflated.CopyTo(Stream.Null); }
            catch (InvalidDataException) { throw new Refused("incorrect data check"); }
        }
        CheckTrailer(f, ~inflated.Crc, inflated.Length0);
        if (failed != null) throw new Refused("The backup file is cut short");
        if (parts["manifest"] is not JsObj m || !Js.StrictEq(m["app"], "mandarin")) throw new Refused("That isn't a Mandarin backup");
        return new Read(parts, hasDb);
    }

    private sealed class CutShort : Exception;

    [GeneratedRegexAttribute("^[a-z]+\\.json\\z")] private static partial Regex JsonPartRx();
    private static Regex JsonPart() => JsonPartRx();

    private static void Part(JsObj parts, string name, byte[] bytes)
    {
        try { parts[name[..^5]] = JsJson.Parse(Encoding.UTF8.GetString(bytes)); }
        catch (JsError) { throw new Refused("The backup's " + name + " is unreadable"); }
    }

    /* parseInt(s, 8) */
    private static double ParseOctal(string s)
    {
        var i = 0;
        var neg = false;
        if (i < s.Length && (s[i] == '+' || s[i] == '-')) { neg = s[i] == '-'; i++; }
        var start = i;
        double v = 0;
        while (i < s.Length && s[i] >= '0' && s[i] <= '7') v = v * 8 + (s[i++] - '0');
        if (i == start) return double.NaN;
        return neg ? -v : v;
    }

    private static bool Fill(Stream s, byte[] buf)
    {
        var got = 0;
        while (got < buf.Length) { var n = s.Read(buf, got, buf.Length - got); if (n == 0) return false; got += n; }
        return true;
    }
    private static bool Copy(Stream s, Stream to, long count)
    {
        var buf = new byte[81920];
        while (count > 0)
        {
            var n = s.Read(buf, 0, (int)Math.Min(buf.Length, count));
            if (n == 0) return false;
            to.Write(buf, 0, n);
            count -= n;
        }
        return true;
    }
}
