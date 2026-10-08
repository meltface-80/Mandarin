// Id3.cs — ID3v2 (2.2, 2.3, 2.4), ID3v1, Lyrics3 and APEv2 tags (v0.8.13), from
// music-metadata's id3v2/, id3v1/, lyrics3/ and apev2/APEv2Parser.js.
//
// The frame rules are the Node reader's, quirks and all: 2.3's TPE1, TCOM,
// TEXT, TOLY, TOPE, TSRC and every TXXX split at "/", 2.4's frames at NUL;
// TCON's "(17)" codes for genres; TIT2 and TRCK left as written; a frame it
// doesn't know left out. A tag running past the file's end stops the file
// being read, as there.
namespace Mandarin.Server.Tags;

internal readonly record struct TextEnc(string Encoding, bool Bom);

internal sealed class Id3v2Frames(int major, bool includeCovers)
{
    public static readonly string[] Genres =
    [
        "Blues", "Classic Rock", "Country", "Dance", "Disco", "Funk", "Grunge", "Hip-Hop", "Jazz", "Metal", "New Age", "Oldies",
        "Other", "Pop", "R&B", "Rap", "Reggae", "Rock", "Techno", "Industrial", "Alternative", "Ska", "Death Metal", "Pranks",
        "Soundtrack", "Euro-Techno", "Ambient", "Trip-Hop", "Vocal", "Jazz+Funk", "Fusion", "Trance", "Classical", "Instrumental",
        "Acid", "House", "Game", "Sound Clip", "Gospel", "Noise", "Alt. Rock", "Bass", "Soul", "Punk", "Space", "Meditative",
        "Instrumental Pop", "Instrumental Rock", "Ethnic", "Gothic", "Darkwave", "Techno-Industrial", "Electronic", "Pop-Folk",
        "Eurodance", "Dream", "Southern Rock", "Comedy", "Cult", "Gangsta Rap", "Top 40", "Christian Rap", "Pop/Funk", "Jungle",
        "Native American", "Cabaret", "New Wave", "Psychedelic", "Rave", "Showtunes", "Trailer", "Lo-Fi", "Tribal", "Acid Punk",
        "Acid Jazz", "Polka", "Retro", "Musical", "Rock & Roll", "Hard Rock", "Folk", "Folk/Rock", "National Folk", "Swing",
        "Fast-Fusion", "Bebob", "Latin", "Revival", "Celtic", "Bluegrass", "Avantgarde", "Gothic Rock", "Progressive Rock",
        "Psychedelic Rock", "Symphonic Rock", "Slow Rock", "Big Band", "Chorus", "Easy Listening", "Acoustic", "Humour", "Speech",
        "Chanson", "Opera", "Chamber Music", "Sonata", "Symphony", "Booty Bass", "Primus", "Porn Groove", "Satire", "Slow Jam",
        "Club", "Tango", "Samba", "Folklore", "Ballad", "Power Ballad", "Rhythmic Soul", "Freestyle", "Duet", "Punk Rock",
        "Drum Solo", "A Cappella", "Euro-House", "Dance Hall", "Goa", "Drum & Bass", "Club-House", "Hardcore", "Terror", "Indie",
        "BritPop", "Negerpunk", "Polsk Punk", "Beat", "Christian Gangsta Rap", "Heavy Metal", "Black Metal", "Crossover",
        "Contemporary Christian", "Christian Rock", "Merengue", "Salsa", "Thrash Metal", "Anime", "JPop", "Synthpop", "Abstract",
        "Art Rock", "Baroque", "Bhangra", "Big Beat", "Breakbeat", "Chillout", "Downtempo", "Dub", "EBM", "Eclectic", "Electro",
        "Electroclash", "Emo", "Experimental", "Garage", "Global", "IDM", "Illbient", "Industro-Goth", "Jam Band", "Krautrock",
        "Leftfield", "Lounge", "Math Rock", "New Romantic", "Nu-Breakz", "Post-Punk", "Post-Rock", "Psytrance", "Shoegaze",
        "Space Rock", "Trop Rock", "World Music", "Neoclassical", "Audiobook", "Audio Theatre", "Neue Deutsche Welle", "Podcast",
        "Indie Rock", "G-Funk", "Dubstep", "Garage Rock", "Psybient"
    ];

    private static readonly HashSet<string> SlashSplit =
        ["TPE1", "TPE2", "TPE3", "TPE4", "TCOM", "TEXT", "TOLY", "TOPE", "TP1", "TCM", "TXT", "TOA", "TOL", "TXXX", "TSRC", "IPLS"];

    public static TextEnc Encoding(U8 a, int off) => a.Get(off) switch
    {
        0x00 => new("latin1", false),
        0x01 => new("utf-16le", true),
        0x02 => new("utf-16be", false),
        _ => new("utf8", false)
    };

    private static int NullLen(string enc) => enc.StartsWith("utf-16", StringComparison.Ordinal) ? 2 : 1;

    public static (string Text, int Len) ReadNullTerminated(U8 a, string encoding)
    {
        var zero = Text.FindZero(a, encoding);
        if (zero >= a.Length) return (Text.DecodeString(a, encoding), a.Length);
        return (Text.DecodeString(a.Sub(0, zero), encoding), zero + NullLen(encoding));
    }

    private static (string Id, U8 Data) IdAndData(U8 a, string encoding)
    {
        var (text, len) = ReadNullTerminated(a, encoding);
        return (text, a.Sub(len));
    }

    public static string TrimNullPadding(string v)
    {
        var end = v.Length;
        while (end > 0 && v[end - 1] == '\0') end--;
        return end == v.Length ? v : v[..end];
    }

    private List<object?> SplitValue(string tag, string text)
    {
        string[] values = text.Split('\0');
        if (major < 4 && values.Length <= 1 && SlashSplit.Contains(tag)) values = text.Split('/');
        return values.Select(v => (object?)Js.Trim(TrimNullPadding(v))).ToList();
    }

    public static List<object?> ParseGenre(string orig)
    {
        var genres = new List<object?>();
        string? code = null;
        var word = "";
        foreach (var c in orig)
        {
            if (code is not null)
            {
                if (c == '(' && code == "") { word += "("; code = null; }
                else if (c == ')')
                {
                    if (word != "") { genres.Add(word); word = ""; }
                    var g = GenreCode(code);
                    if (g is not null) genres.Add(g);
                    code = null;
                }
                else code += c;
            }
            else if (c == '(') code = "";
            else word += c;
        }
        if (word.Length > 0)
        {
            string? w = word;
            if (genres.Count == 0 && w.All(ch => ch >= '0' && ch <= '9')) w = GenreCode(w);
            if (!string.IsNullOrEmpty(w)) genres.Add(w);
        }
        return genres;
    }

    private static string? GenreCode(string code)
    {
        if (code == "RX") return "Remix";
        if (code == "CR") return "Cover";
        if (code.All(ch => ch >= '0' && ch <= '9'))
        {
            var n = Js.ParseInt(code);
            if (double.IsNaN(n) || n < 0 || n >= Genres.Length) return null;
            return Genres[(int)n];
        }
        return null;
    }

    /* Util.decodeUintBE: 1 to 6 bytes; undefined for 7 or 8. */
    private static object? UintBE(U8 a)
    {
        if (a.Length == 0) throw new JsError("decodeUintBE: empty Uint8Array");
        var s = a.Span;
        switch (s.Length)
        {
            case 6: return (double)(((long)s[0] << 8 | s[1]) * 4294967296L + ((long)s[2] << 24 | (long)s[3] << 16 | (long)s[4] << 8 | s[5]));
            case 5: return (double)(s[0] * 4294967296L + ((long)s[1] << 24 | (long)s[2] << 16 | (long)s[3] << 8 | s[4]));
            case 4: return (double)((long)s[0] << 24 | (long)s[1] << 16 | (long)s[2] << 8 | s[3]);
            case 3: return (double)(s[0] * 65536 + (s[1] << 8 | s[2]));
            case 2: return (double)(s[0] << 8 | s[1]);
            case 1: return (double)s[0];
            default: return Undef.V;
        }
    }

    /* FrameParser.readData */
    public object? ReadData(U8 a, string type, Collector warnings)
    {
        if (a.Length == 0) return Undef.V;
        var enc = Encoding(a, 0);
        var encoding = enc.Encoding;
        var length = a.Length;
        object? output = new List<object?>();
        var kind = type != "TXXX" && type.Length > 0 && type[0] == 'T' ? "T*" : type;
        switch (kind)
        {
            case "T*":
            case "GRP1":
            case "GP1":
            case "IPLS":
            case "MVIN":
            case "MVNM":
            case "PCS":
            case "PCST":
            {
                string text;
                try { text = TrimNullPadding(Text.DecodeString(a.Sub(1), encoding)); }
                catch (JsError) { break; }
                switch (type)
                {
                    case "TMCL":
                    case "TIPL":
                    case "IPLS":
                        output = FunctionList(SplitValue(type, text));
                        break;
                    case "TRK":
                    case "TRCK":
                    case "TPOS":
                    case "TIT1":
                    case "TIT2":
                    case "TIT3":
                        output = text;
                        break;
                    case "TCOM":
                    case "TEXT":
                    case "TOLY":
                    case "TOPE":
                    case "TPE1":
                    case "TSRC":
                        output = SplitValue(type, text);
                        break;
                    case "TCO":
                    case "TCON":
                        output = SplitValue(type, text).SelectMany(v => ParseGenre((string)v!)).ToList();
                        break;
                    case "PCS":
                    case "PCST":
                    {
                        var l = major >= 4 ? SplitValue(type, text) : [text];
                        output = l.Count > 0 && l[0] is "" ? 1.0 : 0.0;
                        break;
                    }
                    default:
                        output = major >= 4 ? SplitValue(type, text) : new List<object?> { text };
                        break;
                }
                break;
            }
            case "TXXX":
            {
                var (id, data) = IdAndData(a.Sub(1), encoding);
                var value = Text.DecodeString(data, encoding);
                var end = value.Length;
                while (end > 0 && value[end - 1] == '\0') end--;
                var o = new JsObj();
                o["description"] = id;
                o["text"] = SplitValue(type, value[..end]);
                output = o;
                break;
            }
            case "PIC":
            case "APIC":
                if (includeCovers) throw new JsError("covers are not read here");
                break;
            case "CNT":
            case "PCNT":
                output = UintBE(a);
                break;
            case "SYLT":
            {
                var sEnc = Encoding(a, 0);
                var language = Text.Decode(a.Sub(1, 4), "latin1");
                var timeStampFormat = a.U8At(4);
                var contentType = a.U8At(5);
                a = a.Sub(6);
                var result = new JsObj();
                result["descriptor"] = "";
                result["language"] = language;
                result["contentType"] = (double)contentType;
                result["timeStampFormat"] = (double)timeStampFormat;
                var sync = new List<object?>();
                result["syncText"] = sync;
                var syllables = false;
                while (a.Length > 0)
                {
                    var (t, len) = ReadNullTerminated(a, sEnc.Encoding);
                    a = a.Sub(len);
                    if (syllables)
                    {
                        var ts = a.U32BE(0);
                        a = a.Sub(4);
                        var entry = new JsObj();
                        entry["text"] = t;
                        entry["timestamp"] = (double)ts;
                        sync.Add(entry);
                    }
                    else { result["descriptor"] = t; syllables = true; }
                }
                output = result;
                break;
            }
            case "ULT":
            case "USLT":
            case "COM":
            case "COMM":
            {
                var tEnc = Encoding(a, 0);
                var language = Text.Decode(a.Sub(1, 4), "latin1");
                var offset = 4;
                var (descriptor, dlen) = ReadNullTerminated(a.Sub(offset), tEnc.Encoding);
                offset += dlen;
                var (t, _) = ReadNullTerminated(a.Sub(offset), tEnc.Encoding);
                var o = new JsObj();
                o["language"] = language;
                o["descriptor"] = descriptor;
                o["text"] = t;
                output = o;
                break;
            }
            case "UFID":
            {
                var (id, data) = IdAndData(a, "latin1");
                var o = new JsObj();
                o["owner_identifier"] = id;
                o["identifier"] = data;
                output = o;
                break;
            }
            case "PRIV":
            {
                var (id, data) = IdAndData(a, "latin1");
                var o = new JsObj();
                o["owner_identifier"] = id;
                o["data"] = data;
                output = o;
                break;
            }
            case "POPM":
            {
                var (email, len) = ReadNullTerminated(a, "latin1");
                a = a.Sub(len);
                var o = new JsObj();
                o["email"] = email;
                if (a.Length == 0) { o["rating"] = 0.0; o["counter"] = Undef.V; output = o; break; }
                o["rating"] = (double)a.U8At(0);
                var counter = a.Sub(1);
                o["counter"] = counter.Length > 0 ? UintBE(counter) : Undef.V;
                output = o;
                break;
            }
            case "GEOB":
            {
                var gEnc = Encoding(a, 0);
                a = a.Sub(1);
                var (mime, l1) = ReadNullTerminated(a, "latin1");
                a = a.Sub(l1);
                var (filename, l2) = ReadNullTerminated(a, gEnc.Encoding);
                a = a.Sub(l2);
                var (description, l3) = ReadNullTerminated(a, gEnc.Encoding);
                a = a.Sub(l3);
                var o = new JsObj();
                o["type"] = mime;
                o["filename"] = filename;
                o["description"] = description;
                o["data"] = a;
                output = o;
                break;
            }
            case "WCOM":
            case "WCOP":
            case "WOAF":
            case "WOAR":
            case "WOAS":
            case "WORS":
            case "WPAY":
            case "WPUB":
                output = ReadNullTerminated(a, "latin1").Text;
                break;
            case "WXXX":
            {
                var wEnc = Encoding(a, 0);
                a = a.Sub(1);
                var (description, len) = ReadNullTerminated(a, wEnc.Encoding);
                a = a.Sub(len);
                var o = new JsObj();
                o["description"] = description;
                o["url"] = TrimNullPadding(Text.DecodeString(a, "latin1"));
                output = o;
                break;
            }
            case "WFD":
            case "WFED":
            {
                var wEnc = Encoding(a, 0);
                output = ReadNullTerminated(a.Sub(1), wEnc.Encoding).Text;
                break;
            }
            case "MCDI":
                output = a.Sub(0, length);
                break;
            case "CHAP":
            {
                var fzero = Text.FindZero(a, "latin1");
                var chapter = new JsObj();
                chapter["label"] = Text.DecodeString(a.Sub(0, fzero), "latin1");
                var startOffset = a.U32BE(fzero + 1 + 8);
                var endOffset = a.U32BE(fzero + 1 + 12);
                var info = new JsObj();
                info["startTime"] = (double)a.U32BE(fzero + 1);
                info["endTime"] = (double)a.U32BE(fzero + 1 + 4);
                info["startOffset"] = startOffset == 0xffffffff ? Undef.V : (double)startOffset;
                info["endOffset"] = endOffset == 0xffffffff ? Undef.V : (double)endOffset;
                chapter["info"] = info;
                chapter["frames"] = SubFrames(a, fzero + 1 + 16, length, warnings);
                output = chapter;
                break;
            }
            case "CTOC":
            {
                var idEnd = Text.FindZero(a, "latin1");
                var toc = new JsObj();
                toc["label"] = Text.DecodeString(a.Sub(0, idEnd), "latin1");
                var offset = idEnd + 1;
                var flags = a.Get(offset++) ?? 0;
                var tl = new JsObj();
                tl["topLevel"] = (flags & 0x02) != 0;
                tl["ordered"] = (flags & 0x01) != 0;
                var count = a.Get(offset++);
                var children = new List<object?>();
                for (var i = 0; count is int n && i < n && offset < length; i++)
                {
                    var end = Text.FindZero(a.Sub(offset), "latin1");
                    children.Add(Text.DecodeString(a.Sub(offset, offset + end), "latin1"));
                    offset += end + 1;
                }
                toc["flags"] = tl;
                toc["childElementIds"] = children;
                toc["frames"] = SubFrames(a, offset, length, warnings);
                output = toc;
                break;
            }
        }
        return output;
    }

    private JsMap SubFrames(U8 a, int offset, int length, Collector warnings)
    {
        var frames = new JsMap();
        while (offset < length)
        {
            var sub = Id3v2.ReadFrameHeader(a.Sub(offset), major);
            offset += Id3v2.FrameHeaderLength(major);
            var data = a.Sub(offset, (int)Math.Min(int.MaxValue, (long)offset + sub.Length));
            frames.Set(sub.Id, ReadData(data, sub.Id, warnings));
            offset = (int)Math.Min(int.MaxValue, (long)offset + sub.Length);
        }
        return frames;
    }

    private static JsObj FunctionList(List<object?> entries)
    {
        var res = new JsObj();
        for (var i = 0; i + 1 < entries.Count; i += 2)
        {
            var role = (string)entries[i]!;
            var names = ((string)entries[i + 1]!).Split(',').Select(x => (object?)x).ToList();
            res[role] = res[role] is List<object?> had ? had.Concat(names).ToList() : names;
        }
        return res;
    }
}

internal readonly record struct FrameHeader(string Id, long Length, bool Unsync, bool DataLengthIndicator);

internal static class Id3v2
{
    public static int FrameHeaderLength(int major) => major switch
    {
        2 => 6,
        3 or 4 => 10,
        _ => throw new JsError($"Unexpected majorVer: {major}")
    };

    /* UINT32SYNCSAFE: plain indexing, a missing byte counting as 0. */
    public static long SyncSafe(U8 b, int off) =>
        ((b.Get(off + 3) ?? 0) & 0x7f) | ((b.Get(off + 2) ?? 0) << 7) | ((b.Get(off + 1) ?? 0) << 14) | ((b.Get(off) ?? 0) << 21);

    private static bool Bit(U8 b, int off, int bit) => ((b.Get(off) ?? 0) & (1 << bit)) != 0;

    public static FrameHeader ReadFrameHeader(U8 a, int major)
    {
        switch (major)
        {
            case 2:
                return new(Text.Decode(a.Sub(0, 3), "ascii"), a.U24BE(3), false, false);
            case 3:
            case 4:
            {
                var id = Text.Decode(a.Sub(0, 4), "ascii");
                long length = major == 4 ? SyncSafe(a, 4) : a.U32BE(4);
                var flags = a.Sub(8, 10);
                return major == 3
                    ? new(id, length, false, false)
                    : new(id, length, Bit(flags, 1, 1), Bit(flags, 1, 0));
            }
            default:
                throw new JsError($"Unexpected majorVer: {major}");
        }
    }

    private static U8 RemoveUnsync(U8 buffer)
    {
        int read = 0, write = 0;
        while (read < buffer.Length - 1)
        {
            if (read != write) buffer.Put(write, buffer.At(read));
            read += buffer.At(read) == 0xff && buffer.At(read + 1) == 0 ? 2 : 1;
            write++;
        }
        if (read < buffer.Length) buffer.Put(write++, buffer.At(read));
        return buffer.Sub(0, write);
    }

    public static bool StartsWithId3(Tokenizer tok)
    {
        var h = tok.PeekToken(10);
        return Text.Decode(h.Sub(0, 3), "ascii") == "ID3";
    }

    /* ID3v2Parser.parse: one tag at the tokenizer's position. */
    public static void Parse(Collector md, Tokenizer tok, bool skipCovers)
    {
        var h = tok.ReadToken(10);
        if (Text.Decode(h.Sub(0, 3), "ascii") != "ID3") throw new JsError("expected ID3-header file-identifier 'ID3' was not found");
        var major = h.I8At(3);
        var extended = Bit(h, 5, 6);
        var size = SyncSafe(h, 6);
        if (tok.Size is long fileSize && size > fileSize - tok.Position)
            throw new JsError($"ID3v2 tag size {size} exceeds remaining file size");
        var headerType = $"ID3v2.{major}";
        long dataLen;
        if (extended)
        {
            var ext = tok.ReadToken(10);
            long extSize = ext.U32BE(0);
            var remaining = extSize - 10;
            if (remaining > 0) tok.Ignore(remaining);
            dataLen = size - extSize;
        }
        else dataLen = size;
        if (dataLen < 0 || dataLen > int.MaxValue) throw new JsError("Invalid typed array length");
        var data = tok.ReadToken((int)dataLen);
        var frames = new Id3v2Frames(major, !skipCovers);
        foreach (var (id, value) in ParseMetadata(md, data, major, frames))
        {
            if (id == "TXXX")
            {
                if (!Js.Truthy(value)) continue;
                var o = (JsObj)value!;
                var desc = o["description"];
                var key = "TXXX" + (Js.Truthy(desc) ? ":" + Js.Str(desc) : "");
                foreach (var v in (List<object?>)o["text"]!) md.AddTag(headerType, key, v);
            }
            else if (value is List<object?> list)
            {
                foreach (var v in list) md.AddTag(headerType, id, v);
            }
            else md.AddTag(headerType, id, value);
        }
    }

    private static List<(string Id, object? Value)> ParseMetadata(Collector md, U8 data, int major, Id3v2Frames frames)
    {
        var offset = 0L;
        var tags = new List<(string, object?)>();
        while (true)
        {
            if (offset == data.Length) break;
            var hl = FrameHeaderLength(major);
            if (offset + hl > data.Length) break;
            var hb = data.Sub((int)offset, (int)offset + hl);
            offset += hl;
            var fh = ReadFrameHeader(hb, major);
            var fd = data.Sub((int)offset, (int)Math.Min(data.Length, offset + fh.Length));
            offset += fh.Length;
            if (major is 3 or 4)
            {
                if (fh.Unsync) fd = RemoveUnsync(fd);
                if (fh.DataLengthIndicator) fd = fd.Sub(4, fd.Length);
            }
            var values = frames.ReadData(fd, fh.Id, md);
            if (Js.Truthy(values)) tags.Add((fh.Id, values));
            if (offset > data.Length) offset = data.Length + 1; // (a frame past the end: the next pass stops)
        }
        return tags;
    }
}

internal static class Id3v1
{
    public static bool HasHeader(Tokenizer tok)
    {
        if (tok.Size is not long size || size < 128) return false;
        var tag = new U8(3);
        var pos = tok.Position;
        tok.ReadBuffer(tag, size - 128);
        tok.SetPosition(pos);
        return Text.Decode(tag, "latin1") == "TAG";
    }

    public static double LyricsHeaderLength(Tokenizer tok)
    {
        if (tok.Size is not long size || size < 143) return 0;
        var buf = new U8(15);
        var pos = tok.Position;
        tok.ReadBuffer(buf, size - 143);
        tok.SetPosition(pos);
        var txt = Text.Decode(buf, "latin1");
        if (txt[6..] == "LYRICS200") return Js.ParseInt(txt[..6]) + 15;
        return 0;
    }

    private static string? Str(U8 b, int off, int len)
    {
        var v = Js.Trim(Text.TrimRightNull(Text.Decode(b.Sub(off, off + len), "latin1")));
        return v.Length > 0 ? v : null;
    }

    /* ID3v1Parser.parse: the APE tag found at the end, then the ID3v1 tag. */
    public static void Parse(Collector md, Tokenizer tok, ApeFooterAt? ape)
    {
        if (tok.Size is not long size || size == 0) return;
        if (ape is { } a)
        {
            tok.SetPosition(a.Offset);
            Ape.ParseTags(md, tok, a.Footer);
        }
        var offset = size - 128;
        if (tok.Position > offset) return;
        var h = tok.ReadToken(128, offset);
        if (Str(h, 0, 3) != "TAG") return;
        var zero = h.U8At(125);
        var track = h.U8At(126);
        var hasTrack = zero == 0 && track != 0;
        var props = new (string Id, object? Value)[]
        {
            ("title", Str(h, 3, 30)), ("artist", Str(h, 33, 30)), ("album", Str(h, 63, 30)),
            ("comment", Str(h, 97, hasTrack ? 28 : 30)), ("track", hasTrack ? (double)track : null), ("year", Str(h, 93, 4))
        };
        foreach (var (id, value) in props) if (value is not null && value is not "") md.AddTag("ID3v1", id, value);
        var genre = h.U8At(127);
        if (genre < Id3v2Frames.Genres.Length) md.AddTag("ID3v1", "genre", Id3v2Frames.Genres[genre]);
    }
}

internal readonly record struct ApeFooter(string Id, long Size, long Fields, bool IsHeader, uint Flags);
internal readonly record struct ApeFooterAt(ApeFooter Footer, long Offset);

internal static class Ape
{
    public static ApeFooter Footer(U8 b, int off)
    {
        var flags = b.U32LE(off + 20);
        return new(Text.Decode(b.Sub(off, off + 8), "ascii"), b.U32LE(off + 12), b.U32LE(off + 16), (flags & (1u << 29)) != 0, flags);
    }

    /* APEv2Parser.findApeFooterOffset */
    public static ApeFooterAt? FindFooter(Tokenizer tok, double offset)
    {
        if (!(offset > 32)) return null;
        var buf = new U8(32);
        var pos = tok.Position;
        tok.ReadBuffer(buf, (long)offset - 32);
        tok.SetPosition(pos);
        var f = Footer(buf, 0);
        if (f.Id != "APETAGEX") return null;
        var o = (long)offset;
        if (!f.IsHeader) o -= f.Size;
        return new(f, o);
    }

    /* core.scanAppendingHeaders: where an APE tag at the end starts. */
    public static ApeFooterAt? ScanAppending(Tokenizer tok)
    {
        double apeOffset = tok.Size ?? 0;
        if (Id3v1.HasHeader(tok))
        {
            apeOffset -= 128;
            apeOffset -= Id3v1.LyricsHeaderLength(tok);
        }
        return FindFooter(tok, apeOffset);
    }

    /* APEv2Parser.parseTags */
    public static void ParseTags(Collector md, Tokenizer tok, ApeFooter footer)
    {
        var keyBuffer = new U8(256);
        var remaining = footer.Size - 32;
        for (long i = 0; i < footer.Fields; i++)
        {
            if (remaining < 8) break;
            var item = tok.ReadToken(8);
            long size = item.U32LE(0);
            var flags = item.U32LE(4);
            remaining -= 8;
            if (size >= remaining) throw new JsError($"Invalid tag item size: {size}");
            var keyBytes = tok.PeekBuffer(keyBuffer, null, (int)Math.Min(256, remaining - size), true);
            var zero = keyBuffer.Sub(0, keyBytes).IndexOf(0);
            if (zero == -1) throw new JsError("Unterminated tag item key");
            var key = Text.Decode(tok.ReadToken(zero), "ascii");
            tok.Ignore(1);
            remaining -= key.Length + 1;
            if (tok.Size is long fs && size > fs - tok.Position) throw new JsError($"Invalid tag item size: {size}");
            remaining -= size;
            switch ((flags & 6) >> 1)
            {
                case 0:
                {
                    var value = Text.Decode(tok.ReadToken((int)size), "utf-8");
                    foreach (var v in value.Split('\0')) md.AddTag("APEv2", key, v);
                    break;
                }
                default:
                    // Binary (a cover: not read here), external, reserved: passed over.
                    tok.Ignore(size);
                    break;
            }
        }
    }

    /* APEv2Parser.tryParseApeHeader: a tag here (by its header) or one that ends the file. */
    public static void TryParseHeader(Collector md, Tokenizer tok)
    {
        if (tok.Size is long s && s != 0 && s - tok.Position < 32) return;
        var peek = tok.PeekToken(32);
        var footer = Footer(peek, 0);
        if (footer.Id == "APETAGEX")
        {
            tok.Ignore(32);
            ParseTags(md, tok, footer);
            return;
        }
        if (tok.Size is long size && size != 0)
        {
            var remaining = size - tok.Position;
            var buffer = new U8((int)remaining);
            tok.ReadBuffer(buffer);
            var f = Footer(buffer, buffer.Length - 32);
            if (f.Id != "APETAGEX") throw new JsError("Unexpected APEv2 Footer ID preamble value");
            ParseTags(md, new BufferTok(buffer), f);
        }
    }
}

/* id3v2/AbstractID3Parser: ID3v2 tags first, the format's own parse, then the end's APE and ID3v1. */
internal abstract class Id3Parser(Collector md, Tokenizer tok, ApeFooterAt? ape)
{
    protected readonly Collector Md = md;
    protected readonly Tokenizer Tok = tok;

    protected abstract void PostId3v2Parse();
    protected virtual void Finish() { }

    public void Parse()
    {
        try
        {
            while (Id3v2.StartsWithId3(Tok)) Id3v2.Parse(Md, Tok, true);
            PostId3v2Parse();
            Id3v1.Parse(Md, Tok, ape);
            Finish();
        }
        catch (EndOfStream) { }
    }
}

