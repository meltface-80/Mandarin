// ShareBlob.cs — a playlist as text you can paste to someone (v0.8.21), from
// lib/server/share.js rule for rule: MusicD Remote's own "MDRP1:" format
// (JSPF, gzipped, base64url), so a playlist shared from either app imports
// into the other.
//
// Written from a fresh object of known fields every time, never passed
// through. Read back forgivingly, as the Node server reads it: the marker found
// wherever it sits and in any case, only base64url kept after it, and the
// sender's own words after the blob shaved off a character at a time (40 at
// most) until gzip's checksum passes. gzip is read as Node's zlib reads it, so
// the same pastes pass and fail: each member checked to its trailer; after
// one, the end or a zero byte ends it, and anything else must be another
// member. The compressed bytes this side writes are .NET's, not zlib's: the
// same playlist, a few bytes more or less.
using System.Buffers.Text;
using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Extras;

using Js = Mandarin.Server.Tags.Js;

internal static class ShareBlob
{
    public const string Magic = "MDRP1";
    public const int TrackMax = 2000, InputMax = 5000, TextMax = 500, NameMax = 200, UriMax = 4;
    private const string NsTrack = "https://musicbrainz.org/doc/jspf#track";
    private const string NsPlaylist = "https://musicbrainz.org/doc/jspf#playlist";
    // What a blob may unpack to here. No playlist comes near it (2,000 tracks
    // of every field at its longest is about 11 MB); a blob that unpacks past
    // it is read as damaged rather than held in memory.
    private const int MaxOut = 64 * 1024 * 1024;

    /* A paste refused, with the words the page shows. */
    public sealed class Refused(string message) : Exception(message);

    // ------------------------------------------------------------ the fields

    /* shareText: a string, its runs of white space one space, trimmed, cut to [max], trimmed again; "" for anything else. */
    public static string Text(object? v, int max = TextMax)
    {
        if (v is not string s) return "";
        s = Js.Trim(OneSpace(s));
        if (s.Length > max) s = s[..max];
        return Js.Trim(s);
    }

    private static string OneSpace(string s)
    {
        var sb = new StringBuilder(s.Length);
        for (var i = 0; i < s.Length; i++)
        {
            if (!Js.IsWs(s[i])) { sb.Append(s[i]); continue; }
            sb.Append(' ');
            while (i + 1 < s.Length && Js.IsWs(s[i + 1])) i++;
        }
        return sb.ToString();
    }

    /* shareInt: parseInt(v, 10) within [min, max], or null. */
    public static double? Int(object? v, double min, double max)
    {
        var n = Js.ParseInt(v);
        return double.IsFinite(n) && n >= min && n <= max ? n : null;
    }

    // A scheme is what makes it a URI rather than free text (ASCII letters only, as /i reads them there).
    private static readonly Regex Scheme = new("^[A-Za-z][A-Za-z0-9+.-]*:", RegexOptions.CultureInvariant);

    /* shareUriList: up to four distinct URIs, each with a scheme and no longer than 500. */
    public static List<object?> UriList(object? v)
    {
        var list = new List<object?>();
        if (v is not List<object?> items) return list;
        foreach (var item in items)
        {
            if (item is not string raw) continue;
            var s = Js.Trim(raw);
            if (!Scheme.IsMatch(s) || s.Length > TextMax) continue;
            if (!list.Contains(s)) list.Add(s);
            if (list.Count >= UriMax) break;
        }
        return list;
    }

    /* sharePrune: the fields with something in them (not null, "", [] or {}), in their order. */
    private static JsObj Prune(JsObj o)
    {
        var r = new JsObj();
        foreach (var k in o.Keys)
        {
            var v = o[k];
            if (v is null or Undef or "" || v is List<object?> { Count: 0 } || v is JsObj { Count: 0 }) continue;
            r[k] = v;
        }
        return r;
    }

    /* shareTrackEntry: one track as JSPF has it, or null for one without a title. */
    public static JsObj? TrackEntry(object? entry)
    {
        if (entry is not JsObj t) return null;
        var title = Text(t["title"]);
        if (title.Length == 0) return null;
        // Identifiers a future exporter fills in; absent until then.
        var extra = new JsObj();
        extra["isrc"] = Text(t["isrc"], 32);
        extra["upc"] = Text(t["upc"], 32);
        extra["qobuz_album_id"] = Text(t["qobuz_album_id"], 64);
        extra["tidal_album_id"] = Text(t["tidal_album_id"], 64);
        extra["year"] = Int(t["year"], 1000, 2999);
        extra["disc"] = Int(t["disc"], 1, 99);
        extra = Prune(extra);
        JsObj? ext = null;
        if (extra.Count > 0)
        {
            var md = new JsObj();
            md["additional_metadata"] = extra;
            ext = new JsObj();
            ext[NsTrack] = md;
        }
        var e = new JsObj();
        e["title"] = title;
        e["creator"] = Text(t["artist"]);
        e["album"] = Text(t["album"]);
        e["trackNum"] = Int(t["track_no"], 1, 999);
        e["duration"] = Int(t["duration_ms"], 1, 24 * 60 * 60 * 1000);
        e["identifier"] = UriList(t["identifier"]);
        e["location"] = UriList(t["location"]);
        e["extension"] = ext;
        return Prune(e);
    }

    /* buildShareDoc: the playlist's document; truncated only when the 2,000 cap stopped it. */
    public static (JsObj Doc, int TrackCount, int Skipped, bool Truncated) BuildDoc(object? name, object? annotation, object? entries, string date, string version)
    {
        var track = new List<object?>();
        int skipped = 0;
        var truncated = false;
        foreach (var e in entries as List<object?> ?? [])
        {
            if (track.Count >= TrackMax) { truncated = true; break; }
            if (TrackEntry(e) is { } one) track.Add(one);
            else skipped++;
        }
        var stamp = new JsObj();
        stamp["generator"] = "Mandarin";
        stamp["generator_version"] = version;
        var md = new JsObj();
        md["additional_metadata"] = stamp;
        var ext = new JsObj();
        ext[NsPlaylist] = md;
        var p = new JsObj();
        var title = Text(name, NameMax);
        p["title"] = title.Length > 0 ? title : "Shared playlist";
        p["annotation"] = Text(annotation, TextMax);
        p["date"] = date;
        p["extension"] = ext;
        var playlist = Prune(p);
        // Always there, even empty: none means malformed, empty means no tracks.
        playlist["track"] = track;
        var doc = new JsObj();
        doc["playlist"] = playlist;
        return (doc, track.Count, skipped, truncated);
    }

    /* new Date().toISOString() */
    public static string IsoNow() => DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    // ------------------------------------------------------------ the blob

    /* encodeSharePayload: "MDRP1:" and the document's JSON, gzipped (the most it packs) and in base64url. */
    public static string Encode(JsObj doc)
    {
        var json = Encoding.UTF8.GetBytes(Js.Json(doc) ?? "null");
        using var ms = new MemoryStream();
        using (var gz = new GZipStream(ms, new ZLibCompressionOptions { CompressionLevel = 9 }, leaveOpen: true)) gz.Write(json);
        return Magic + ":" + Base64Url.EncodeToString(ms.ToArray());
    }

    /* decodeSharePayload: the document in a paste, or Refused with the reason. */
    public static JsObj Decode(string blob)
    {
        var compact = NoSpace(blob);
        // Found in any case (a phone lower-cases it); where it sits is read off the
        // upper-cased text, as the Node server reads it.
        var at = Js.Upper(compact).IndexOf(Magic + ":", StringComparison.Ordinal);
        if (at < 0) throw new Refused($"That doesn't look like a MusicD Remote playlist — it should contain \"{Magic}:\"");
        var from = at + Magic.Length + 1;
        var payload = OnlyBase64Url(from < compact.Length ? compact[from..] : "");
        if (payload.Length == 0) throw new Refused("That playlist is empty — nothing followed the marker");
        // The sender's words after it can't be told from the payload by looking;
        // gzip's checksum can: only the right length passes.
        string? json = null;
        for (var cut = 0; cut <= 40 && cut < payload.Length; cut++)
        {
            try
            {
                json = Encoding.UTF8.GetString(Gunzip(Base64UrlLoose(payload[..(payload.Length - cut)])));
                break;
            }
            catch (InvalidDataException) { /* not this length: one shorter */ }
        }
        if (json == null) throw new Refused("That playlist is damaged — it may have been cut short in transit");
        object? doc;
        try { doc = JsJson.Parse(json); }
        catch (JsError) { throw new Refused("That playlist is damaged — the contents didn't parse"); }
        if (doc is not JsObj d || d["playlist"] is not JsObj pl || pl["track"] is not List<object?>)
            throw new Refused("That playlist has no tracks in it");
        return d;
    }

    private static string NoSpace(string s)
    {
        var sb = new StringBuilder(s.Length);
        foreach (var c in s) if (!Js.IsWs(c)) sb.Append(c);
        return sb.ToString();
    }

    private static string OnlyBase64Url(string s)
    {
        var sb = new StringBuilder(s.Length);
        foreach (var c in s) if (char.IsAsciiLetterOrDigit(c) || c == '_' || c == '-') sb.Append(c);
        return sb.ToString();
    }

    /* Buffer.from(s, "base64url") for s of base64url's characters only: a last lone character makes nothing. */
    private static byte[] Base64UrlLoose(string s)
    {
        static int V(char c) => c >= 'A' && c <= 'Z' ? c - 'A' : c >= 'a' && c <= 'z' ? c - 'a' + 26 : c >= '0' && c <= '9' ? c - '0' + 52 : c == '-' ? 62 : 63;
        int full = s.Length / 4, rem = s.Length % 4;
        var b = new byte[full * 3 + (rem == 2 ? 1 : rem == 3 ? 2 : 0)];
        int o = 0, i = 0;
        for (var g = 0; g < full; g++, i += 4)
        {
            var n = V(s[i]) << 18 | V(s[i + 1]) << 12 | V(s[i + 2]) << 6 | V(s[i + 3]);
            b[o++] = (byte)(n >> 16);
            b[o++] = (byte)(n >> 8);
            b[o++] = (byte)n;
        }
        if (rem >= 2)
        {
            var n = V(s[i]) << 18 | V(s[i + 1]) << 12 | (rem == 3 ? V(s[i + 2]) << 6 : 0);
            b[o++] = (byte)(n >> 16);
            if (rem == 3) b[o] = (byte)(n >> 8);
        }
        return b;
    }

    // ------------------------------------------------------------ gzip as zlib reads it

    /* zlib.gunzipSync: one member, then more while what follows isn't the end or a zero byte. */
    public static byte[] Gunzip(byte[] d)
    {
        using var all = new MemoryStream();
        var p = 0;
        do p = Member(d, p, all);
        while (p < d.Length && d[p] != 0);
        return all.ToArray();
    }

    private static InvalidDataException Bad(string why) => new(why);

    /* One member: its header, its deflated data and its trailer (CRC-32, length); where the next begins. */
    private static int Member(byte[] d, int p, MemoryStream all)
    {
        int At(int i) => i < d.Length ? d[i] : throw Bad("unexpected end of file");
        var start = p;
        if (At(p) != 0x1f || At(p + 1) != 0x8b) throw Bad("incorrect header check");
        if (At(p + 2) != 8) throw Bad("unknown compression method");
        var flags = At(p + 3);
        if ((flags & 0xe0) != 0) throw Bad("unknown header flags set");
        At(p + 9);                                       // the time, the extra flags, the system
        p += 10;
        if ((flags & 4) != 0)
        {
            var xlen = At(p) | At(p + 1) << 8;
            p += 2;
            if (xlen > 0) At(p + xlen - 1);
            p += xlen;
        }
        if ((flags & 8) != 0) while (At(p++) != 0) { }   // a file name
        if ((flags & 16) != 0) while (At(p++) != 0) { }  // a comment
        if ((flags & 2) != 0)
        {
            var hcrc = At(p) | At(p + 1) << 8;
            if (hcrc != (Crc32(d, start, p - start) & 0xffff)) throw Bad("header crc mismatch");
            p += 2;
        }
        var inf = new Inflater(d, p, MaxOut - (int)all.Length);
        inf.Run();
        p = inf.Pos;
        At(p + 7);
        var crc = (uint)(d[p] | d[p + 1] << 8 | d[p + 2] << 16 | d[p + 3] << 24);
        var size = (uint)(d[p + 4] | d[p + 5] << 8 | d[p + 6] << 16 | d[p + 7] << 24);
        if (crc != Crc32(inf.Out, 0, inf.Length)) throw Bad("incorrect data check");
        if (size != (uint)inf.Length) throw Bad("incorrect length check");
        all.Write(inf.Out, 0, inf.Length);
        return p + 8;
    }

    private static readonly uint[] CrcTable = MakeCrcTable();
    private static uint[] MakeCrcTable()
    {
        var t = new uint[256];
        for (uint n = 0; n < 256; n++)
        {
            var c = n;
            for (var k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
            t[n] = c;
        }
        return t;
    }
    private static uint Crc32(byte[] b, int off, int len)
    {
        var c = 0xffffffffu;
        for (var i = off; i < off + len; i++) c = CrcTable[(c ^ b[i]) & 0xff] ^ (c >> 8);
        return c ^ 0xffffffffu;
    }

    /*
     * Raw deflate (RFC 1951), a code at a time, refusing what zlib refuses: a
     * fourth block type, stored lengths that disagree, codes over-subscribed or
     * incomplete (but for a lone one-bit code), a repeat with nothing before it
     * or past the end, no end-of-block code, the two unused length and distance
     * codes, a distance further back than the member's output, and running out.
     */
    private sealed class Inflater(byte[] src, int pos, int max)
    {
        public int Pos = pos;
        public byte[] Out = new byte[Math.Clamp(src.Length * 4, 256, Math.Max(256, max))];
        public int Length;
        private int bitBuf, bitCnt;

        private int Bits(int need)
        {
            var v = bitBuf;
            while (bitCnt < need)
            {
                if (Pos >= src.Length) throw Bad("unexpected end of file");
                v |= src[Pos++] << bitCnt;
                bitCnt += 8;
            }
            bitBuf = v >> need;
            bitCnt -= need;
            return v & ((1 << need) - 1);
        }

        private void Room(int more)
        {
            if ((long)Length + more <= Out.Length) return;
            if ((long)Length + more > max) throw Bad("too large");
            var n = Math.Max((long)Length + more, Math.Min(max, (long)Out.Length * 2));
            Array.Resize(ref Out, (int)n);
        }

        private sealed class Huffman(int n)
        {
            public readonly short[] Count = new short[16];
            public readonly short[] Symbol = new short[n];
        }

        private int Decode(Huffman h)
        {
            int code = 0, first = 0, index = 0;
            for (var len = 1; len <= 15; len++)
            {
                code |= Bits(1);
                int count = h.Count[len];
                if (code - count < first) return h.Symbol[index + (code - first)];
                index += count;
                first += count;
                first <<= 1;
                code <<= 1;
            }
            throw Bad("invalid code");
        }

        /* The canonical code for [n] lengths from [off]: 0 complete, above 0 incomplete, below 0 over-subscribed. */
        private static int Construct(Huffman h, int[] length, int off, int n)
        {
            Array.Clear(h.Count);
            for (var s = 0; s < n; s++) h.Count[length[off + s]]++;
            if (h.Count[0] == n) return 0;
            var left = 1;
            for (var len = 1; len <= 15; len++)
            {
                left <<= 1;
                left -= h.Count[len];
                if (left < 0) return left;
            }
            var offs = new int[16];
            for (var len = 1; len < 15; len++) offs[len + 1] = offs[len] + h.Count[len];
            for (var s = 0; s < n; s++) if (length[off + s] != 0) h.Symbol[offs[length[off + s]]++] = (short)s;
            return left;
        }

        private static readonly short[] LBase = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
        private static readonly short[] LExt = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
        private static readonly short[] DBase = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
        private static readonly short[] DExt = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
        private static readonly byte[] Order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

        private static readonly Huffman FixedLen = new(288), FixedDist = new(30);
        static Inflater()
        {
            var l = new int[288];
            for (var s = 0; s < 288; s++) l[s] = s < 144 ? 8 : s < 256 ? 9 : s < 280 ? 7 : 8;
            Construct(FixedLen, l, 0, 288);
            // Thirty five-bit codes: the two left over (30, 31) decode to nothing.
            var dl = new int[30];
            Array.Fill(dl, 5);
            Construct(FixedDist, dl, 0, 30);
        }

        public void Run()
        {
            int last;
            do
            {
                last = Bits(1);
                switch (Bits(2))
                {
                    case 0: Stored(); break;
                    case 1: Codes(FixedLen, FixedDist); break;
                    case 2: Dynamic(); break;
                    default: throw Bad("invalid block type");
                }
            } while (last == 0);
            // The trailer begins at the next whole byte.
            bitBuf = 0;
            bitCnt = 0;
        }

        private void Stored()
        {
            bitBuf = 0;
            bitCnt = 0;
            if (Pos + 4 > src.Length) throw Bad("unexpected end of file");
            var len = src[Pos] | src[Pos + 1] << 8;
            var nlen = src[Pos + 2] | src[Pos + 3] << 8;
            Pos += 4;
            if (len != (~nlen & 0xffff)) throw Bad("invalid stored block lengths");
            if (Pos + len > src.Length) throw Bad("unexpected end of file");
            Room(len);
            Buffer.BlockCopy(src, Pos, Out, Length, len);
            Length += len;
            Pos += len;
        }

        private void Codes(Huffman lencode, Huffman distcode)
        {
            while (true)
            {
                var symbol = Decode(lencode);
                if (symbol < 256)
                {
                    Room(1);
                    Out[Length++] = (byte)symbol;
                    continue;
                }
                if (symbol == 256) return;
                symbol -= 257;
                if (symbol >= 29) throw Bad("invalid literal/length code");
                var len = LBase[symbol] + Bits(LExt[symbol]);
                var ds = Decode(distcode);
                if (ds >= 30) throw Bad("invalid distance code");
                var dist = DBase[ds] + Bits(DExt[ds]);
                if (dist > Length) throw Bad("invalid distance too far back");
                Room(len);
                for (var i = 0; i < len; i++, Length++) Out[Length] = Out[Length - dist];
            }
        }

        private void Dynamic()
        {
            int nlen = Bits(5) + 257, ndist = Bits(5) + 1, ncode = Bits(4) + 4;
            if (nlen > 286 || ndist > 30) throw Bad("too many length or distance symbols");
            var lengths = new int[286 + 30];
            for (var i = 0; i < ncode; i++) lengths[Order[i]] = Bits(3);
            Huffman lencode = new(288), distcode = new(30);
            if (Construct(lencode, lengths, 0, 19) != 0) throw Bad("invalid code lengths set");
            var index = 0;
            while (index < nlen + ndist)
            {
                var symbol = Decode(lencode);
                if (symbol < 16) { lengths[index++] = symbol; continue; }
                int len = 0, rep;
                if (symbol == 16)
                {
                    if (index == 0) throw Bad("invalid bit length repeat");
                    len = lengths[index - 1];
                    rep = 3 + Bits(2);
                }
                else if (symbol == 17) rep = 3 + Bits(3);
                else rep = 11 + Bits(7);
                if (index + rep > nlen + ndist) throw Bad("invalid bit length repeat");
                while (rep-- > 0) lengths[index++] = len;
            }
            if (lengths[256] == 0) throw Bad("invalid code -- missing end-of-block");
            var err = Construct(lencode, lengths, 0, nlen);
            if (err < 0 || (err > 0 && nlen != lencode.Count[0] + lencode.Count[1])) throw Bad("invalid literal/lengths set");
            err = Construct(distcode, lengths, nlen, ndist);
            if (err < 0 || (err > 0 && ndist != distcode.Count[0] + distcode.Count[1])) throw Bad("invalid distances set");
            Codes(lencode, distcode);
        }
    }
}
