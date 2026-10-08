// Mp4.cs — MP4 / M4A (AAC, ALAC) and its iTunes tags (v0.8.13), from
// music-metadata's mp4/MP4Parser.js, Atom.js and AtomToken.js.
//
// The atoms are walked as there, and given up on as there: an atom that says
// it runs past the file's end, a track without its header, a table whose
// count doesn't match its size each stop the file being read.
namespace Mandarin.Server.Tags;

internal sealed class Mp4Atom(string name, long length, bool extended, Mp4Atom? parent, long payloadLength)
{
    public readonly string Name = name;
    public readonly long Length = length; // 0: to the end
    public readonly bool Extended = extended;
    public readonly Mp4Atom? Parent = parent;
    public readonly long PayloadLength = payloadLength;
}

internal sealed class Mp4Parser(Collector md, Tokenizer tok)
{
    private sealed class Ssd
    {
        public string DataFormat = "";
        public bool HasDescription;
        public int NumAudioChannels, SampleSize;
        public double SampleRate;
    }

    private sealed class Track
    {
        public JsObjHeader? Header;
        public string? HandlerType;
        public (double TimeScale, double Duration)? MediaHeader;
        public List<Ssd>? Ssds;
        public List<(int Count, int Duration)>? TimeToSample;
        public List<int>? SampleSizeTable;
        public List<(List<(double? Duration, double? Size)> Samples, double? DefaultDuration, double? DefaultSize)> Fragments = [];
        public double Samples, Duration;
    }

    private sealed class JsObjHeader { public double TrackId; }

    private static readonly Dictionary<string, (bool Lossy, string Format)> EncoderDict = new(StringComparer.Ordinal)
    {
        ["raw"] = (false, "raw"), ["MAC3"] = (true, "MACE 3:1"), ["MAC6"] = (true, "MACE 6:1"), ["ima4"] = (true, "IMA 4:1"),
        ["ulaw"] = (true, "uLaw 2:1"), ["alaw"] = (true, "uLaw 2:1"), ["Qclp"] = (true, "QUALCOMM PureVoice"),
        [".mp3"] = (true, "MPEG-1 layer 3"), ["alac"] = (false, "ALAC"), ["ac-3"] = (true, "AC-3"), ["mp4a"] = (true, "MPEG-4/AAC"),
        ["mp4s"] = (true, "MP4S"), ["c608"] = (true, "CEA-608"), ["c708"] = (true, "CEA-708")
    };

    private readonly List<(double Id, Track T)> tracks = [];

    private static void Validate(long length)
    {
        if (length < 0 || length > 64 * 1024 * 1024) throw new JsError($"Atom payload exceeds the 64 MiB buffering limit: {length}");
    }

    private U8 Read(long len)
    {
        Validate(len);
        return tok.ReadToken((int)len);
    }

    /* Atom.readAtom */
    private Mp4Atom ReadAtom(Func<Mp4Atom, long, bool> handler, Mp4Atom? parent, long remaining)
    {
        var offset = tok.Position;
        remaining = Math.Min(remaining, (tok.Size ?? long.MaxValue) - offset);
        if (remaining < 8) throw new JsError("Truncated atom header");
        var h = tok.ReadToken(8);
        long length = h.U32BE(0);
        var name = Text.Decode(h.Sub(4, 8), "latin1");
        var extended = length == 1;
        if (extended)
        {
            if (remaining < 16) throw new JsError("Truncated extended atom header");
            var big = (ulong)tok.ReadToken(8).U64BE(0);
            if (big > 9007199254740991UL) throw new JsError("Atom size exceeds Number.MAX_SAFE_INTEGER");
            length = (long)big;
        }
        var headerLength = extended ? 16 : 8;
        if ((extended || length != 0) && length < headerLength) throw new JsError($"Invalid atom size: {length}");
        var len = length == 0 ? remaining : length;
        if (len > remaining) throw new JsError("Atom size exceeds remaining bytes");
        var atom = new Mp4Atom(name, length, extended, parent, len - headerLength);
        ReadData(atom, handler, atom.PayloadLength);
        return atom;
    }

    private void ReadAtoms(Mp4Atom parent, Func<Mp4Atom, long, bool> handler, long size)
    {
        while (size > 0)
        {
            var atom = ReadAtom(handler, parent, size);
            size = atom.Length == 0 ? 0 : size - atom.Length;
        }
    }

    private void ReadData(Mp4Atom atom, Func<Mp4Atom, long, bool> handler, long remaining)
    {
        switch (atom.Name)
        {
            case "moov":
            case "udta":
            case "mdia":
            case "minf":
            case "stbl":
            case "<id>":
            case "ilst":
            case "tref":
            case "moof":
                ReadAtoms(atom, handler, remaining);
                return;
            case "meta":
            {
                if (remaining < 8) throw new JsError("Truncated meta atom");
                var peek = tok.PeekToken(8);
                var padding = Text.Decode(peek.Sub(4, 8), "latin1") == "hdlr" ? 0 : 4;
                tok.Ignore(padding);
                ReadAtoms(atom, handler, remaining - padding);
                return;
            }
            default:
                handler(atom, remaining);
                return;
        }
    }

    public void Parse()
    {
        var remainingFileSize = tok.Size ?? long.MaxValue;
        while (remainingFileSize > 0)
        {
            try
            {
                var peek = tok.PeekToken(8);
                if (Text.Decode(peek.Sub(4, 8), "latin1") == "\0\0\0\0") break;
            }
            catch (JsError) { break; }
            var root = ReadAtom(HandleAtom, null, remainingFileSize);
            remainingFileSize = root.Length == 0 ? 0 : remainingFileSize - root.Length;
        }
        PostProcess();
    }

    private void PostProcess()
    {
        var formatList = new List<string>();
        foreach (var (_, t) in tracks)
        {
            var trackFormats = new List<string>();
            if (t.Ssds is null) throw new JsError("Cannot read properties of undefined (reading 'forEach')");
            foreach (var ssd in t.Ssds)
                if (EncoderDict.TryGetValue(ssd.DataFormat, out var enc)) trackFormats.Add(enc.Format);
            if (trackFormats.Count >= 1) formatList.Add(string.Join("/", trackFormats));
        }
        if (formatList.Count > 0) md.SetFormat("codec", string.Join("+", formatList.Distinct()));

        var audioTracks = tracks.Select(x => x.T).Where(IsAudioTrack).ToList();
        foreach (var t in audioTracks)
        {
            if (t.MediaHeader is { } mh && mh.TimeScale > 0)
            {
                var sampleRate = mh.TimeScale;
                if (mh.Duration > 0) { t.Samples = mh.Duration; t.Duration = t.Samples / sampleRate; }
                if (t.Fragments.Count > 0)
                {
                    double total = 0;
                    foreach (var (samples, dd, ds) in t.Fragments)
                        foreach (var (sd, ss) in samples)
                        {
                            var dur = sd ?? dd ?? 0;
                            var size = ss ?? ds ?? 0;
                            if (dur == 0) throw new JsError("Missing sampleDuration and no defaultSampleDuration in track fragment header");
                            if (size == 0) throw new JsError("Missing sampleSize and no defaultSampleSize in track fragment header");
                            total += dur;
                        }
                    if (t.Samples == 0) t.Samples = total;
                    if (t.Duration == 0 || double.IsNaN(t.Duration)) t.Duration = total / sampleRate;
                }
                else if (t.SampleSizeTable is null) throw new JsError("Cannot read properties of undefined (reading 'length')");
            }
            var first = t.Ssds![0];
            if (first.HasDescription && t.MediaHeader is { } h2)
            {
                md.SetFormat("sampleRate", first.SampleRate);
                md.SetFormat("bitsPerSample", (double)first.SampleSize);
                md.SetFormat("numberOfChannels", (double)first.NumAudioChannels);
                if (h2.TimeScale == 0)
                {
                    if (t.TimeToSample is null) throw new JsError("Cannot read properties of undefined (reading 'length')");
                    if (t.TimeToSample.Count > 0)
                    {
                        double total = 0;
                        foreach (var (count, duration) in t.TimeToSample) total += (double)count * duration;
                        t.Duration = total / first.SampleRate;
                    }
                }
            }
            if (EncoderDict.TryGetValue(first.DataFormat, out var enc)) md.SetFormat("lossless", !enc.Lossy);
        }
        if (audioTracks.Count >= 1 && Js.Truthy(audioTracks[0].Duration))
            md.SetFormat("duration", audioTracks[0].Duration);
    }

    private static bool IsAudioTrack(Track t)
    {
        if (t.Ssds is null || t.Ssds.Count == 0) return false;
        if (t.HandlerType is not null) return t.HandlerType is "audi" or "soun";
        return t.Ssds[0].HasDescription && t.Ssds[0].NumAudioChannels > 0;
    }

    private bool HandleAtom(Mp4Atom atom, long remaining)
    {
        if (atom.Parent is { } p)
        {
            switch (p.Name)
            {
                case "ilst":
                case "<id>":
                    ParseMetadataItem(atom);
                    return true;
                case "moov":
                    if (atom.Name is "trak" or "udta") { ParseTrackBox(atom); return true; }
                    break;
                case "moof":
                    if (atom.Name == "traf") { ParseTrackFragment(atom); return true; }
                    break;
            }
        }
        switch (atom.Name)
        {
            case "mvhd":
            {
                Validate(remaining);
                if (remaining < 100) throw new JsError($"Atom mvhd expected to be 100, but specifies {remaining} bytes long.");
                var b = Read(remaining);
                var version = b.U8At(0);
                b.U24BE(1);
                if (version == 1) { b.U64BE(4); b.U64BE(12); b.U32BE(20); b.U64BE(24); b.U32BE(32); b.U16BE(36); for (var o = 84; o <= 108; o += 4) b.U32BE(o); }
                else { b.U32BE(4); b.U32BE(8); b.U32BE(12); b.U32BE(16); b.U32BE(20); b.U16BE(24); for (var o = 72; o <= 96; o += 4) b.U32BE(o); }
                return true;
            }
            case "chap":
            {
                Validate(remaining);
                if (tracks.Count == 0) throw new JsError("Cannot set properties of undefined (setting 'chapterList')");
                var len = remaining;
                while (len >= 4) { tok.ReadNumber(4); len -= 4; }
                return true;
            }
            case "mdat":
                tok.Ignore(remaining);
                return true;
            case "ftyp":
            {
                Validate(remaining);
                if (remaining < 8 || remaining % 4 != 0) throw new JsError($"Invalid ftyp payload length: {remaining}");
                var types = new List<string>();
                var len = remaining;
                while (len > 0)
                {
                    var t = Text.Decode(Read(4), "ascii");
                    len -= 4;
                    var v = new string(t.Where(c => c is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or '_').ToArray());
                    if (v.Length > 0) types.Add(v);
                }
                md.SetFormat("container", string.Join("/", types.Distinct()));
                return true;
            }
            case "stsd":
            {
                Validate(remaining);
                if (tracks.Count == 0) { Stsd(Read(remaining), remaining); throw new JsError("Cannot set properties of undefined (setting 'soundSampleDescription')"); }
                tracks[^1].T.Ssds = Stsd(Read(remaining), remaining);
                return true;
            }
            case "stsz":
            {
                Validate(remaining);
                var st = Stsz(Read(remaining), remaining);
                if (tracks.Count == 0) throw new JsError("Cannot set properties of undefined (setting 'sampleSize')");
                tracks[^1].T.SampleSizeTable = st;
                return true;
            }
            case "date":
            {
                Validate(remaining);
                var date = Text.Decode(Read(remaining), "utf-8");
                md.AddTag("iTunes", "date", date);
                return true;
            }
        }
        tok.Ignore(remaining);
        return true;
    }

    private void ParseMetadataItem(Mp4Atom item)
    {
        var tagKey = item.Name;
        ReadAtoms(item, (child, _) =>
        {
            var payload = child.PayloadLength;
            switch (child.Name)
            {
                case "data":
                    ParseValueAtom(tagKey, child);
                    break;
                case "name":
                case "mean":
                case "rate":
                {
                    var b = Read(payload);
                    b.U8At(0);
                    b.U24BE(1);
                    var nameLen = (int)Math.Max(payload - 4, 0);
                    tagKey += ":" + Text.Decode(b.Sub(4, 4 + nameLen), "utf-8");
                    break;
                }
                default:
                    Read(payload);
                    break;
            }
            return true;
        }, item.PayloadLength);
    }

    private void ParseValueAtom(string tagKey, Mp4Atom atom)
    {
        var len = atom.PayloadLength;
        var b = Read(len);
        var set = b.U8At(0);
        var type = b.U24BE(1);
        b.U24BE(4);
        var value = b.Sub(8, (int)Math.Max(len, 8));
        if (set != 0) throw new JsError($"Unsupported type-set != 0: {set}");
        switch (type)
        {
            case 0:
                switch (tagKey)
                {
                    case "trkn":
                    case "disk":
                        md.AddTag("iTunes", tagKey, $"{value.U8At(3)}/{value.U8At(5)}");
                        break;
                    case "gnre":
                    {
                        var g = value.U8At(1) - 1;
                        md.AddTag("iTunes", tagKey, g >= 0 && g < Id3v2Frames.Genres.Length ? Id3v2Frames.Genres[g] : Undef.V);
                        break;
                    }
                    case "rate":
                        md.AddTag("iTunes", tagKey, Text.Decode(value, "ascii"));
                        break;
                }
                break;
            case 1:
            case 18:
                md.AddTag("iTunes", tagKey, Text.Decode(value, "utf-8"));
                break;
            case 13:
            case 14:
                break; // a cover (skipCovers)
            case 21:
                md.AddTag("iTunes", tagKey, BeInteger(value, true));
                break;
            case 22:
                md.AddTag("iTunes", tagKey, BeInteger(value, false));
                break;
            case 65:
                md.AddTag("iTunes", tagKey, (double)value.U8At(0));
                break;
            case 66:
                md.AddTag("iTunes", tagKey, (double)value.U16BE(0));
                break;
            case 67:
                md.AddTag("iTunes", tagKey, (double)value.U32BE(0));
                break;
        }
    }

    /* MP4Parser.read_BE_Integer: by its length, through token-types (1, 2, 3, 4 or 8 bytes). */
    private static double BeInteger(U8 a, bool signed) => (a.Length, signed) switch
    {
        (1, false) => a.U8At(0),
        (1, true) => a.I8At(0),
        (2, false) => a.U16BE(0),
        (2, true) => a.I16BE(0),
        (3, false) => a.U24BE(0),
        (3, true) => a.I24BE(0),
        (4, false) => a.U32BE(0),
        (4, true) => a.I32BE(0),
        (8, false) => (double)(ulong)a.U64BE(0),
        (8, true) => (double)(long)a.I64BE(0),
        _ => throw new JsError($"Token for integer type not found: \"{(signed ? "INT" : "UINT")}{a.Length * 8}{(a.Length > 1 ? "_BE" : "")}\"")
    };

    private void ParseTrackBox(Mp4Atom trak)
    {
        var t = new Track();
        ReadAtoms(trak, (child, _) =>
        {
            var len = child.PayloadLength;
            switch (child.Name)
            {
                case "chap":
                {
                    var b = Read(len);
                    for (var o = 0; o < len; o += 4) b.U32BE(o);
                    break;
                }
                case "tkhd":
                {
                    var b = Read(len);
                    var available = Math.Min(len, b.Length);
                    if (available < 4) throw new JsError("Truncated tkhd header");
                    var version = b.U8At(0);
                    if ((version == 0 && available < 38) || (version == 1 && available < 50)) throw new JsError("Truncated tkhd header");
                    b.U24BE(1);
                    t.Header = version switch
                    {
                        0 => new JsObjHeader { TrackId = b.U32BE(12) },
                        1 => new JsObjHeader { TrackId = b.U32BE(20) },
                        _ => throw new JsError("Invalid tkhd version header")
                    };
                    break;
                }
                case "hdlr":
                {
                    var b = Read(len);
                    b.I8At(0);
                    b.U24BE(1);
                    t.HandlerType = Text.Decode(b.Sub(8, 12), "utf-8");
                    break;
                }
                case "mdhd":
                {
                    if (len < 24) throw new JsError($"Atom mdhd expected to be 24, but specifies {len} bytes long.");
                    var b = Read(len);
                    var version = b.U8At(0);
                    b.U24BE(1);
                    t.MediaHeader = version switch
                    {
                        0 => Mdhd0(b),
                        1 => Mdhd1(b),
                        _ => throw new JsError("Invalid mdhd version header")
                    };
                    break;
                }
                case "stco":
                    SimpleTable(Read(len), len, 4);
                    break;
                case "stsc":
                    SimpleTable(Read(len), len, 12);
                    break;
                case "stsd":
                    t.Ssds = Stsd(Read(len), len);
                    break;
                case "stts":
                {
                    var b = Read(len);
                    var n = SimpleTable(b, len, 8);
                    var list = new List<(int, int)>();
                    for (var i = 0; i < n; i++) list.Add((b.I32BE(8 + i * 8), b.I32BE(12 + i * 8)));
                    t.TimeToSample = list;
                    break;
                }
                case "stsz":
                    t.SampleSizeTable = Stsz(Read(len), len);
                    break;
                default:
                    tok.Ignore(len);
                    break;
            }
            return true;
        }, trak.PayloadLength);
        if (t.Header is null) throw new JsError("Cannot read properties of undefined (reading 'trackId')");
        var at = tracks.FindIndex(x => x.Id == t.Header.TrackId);
        if (at >= 0) tracks[at] = (t.Header.TrackId, t);
        else tracks.Add((t.Header.TrackId, t));
    }

    private static (double, double) Mdhd0(U8 b)
    {
        b.U32BE(4); b.U32BE(8);
        var ts = b.U32BE(12);
        var dur = b.U32BE(16);
        b.U16BE(20); b.U16BE(22);
        return (ts, dur);
    }

    private static (double, double) Mdhd1(U8 b)
    {
        b.U64BE(4); b.U64BE(12);
        var ts = b.U32BE(20);
        var dur = (double)(ulong)b.U64BE(24);
        b.U16BE(32); b.U16BE(34);
        return (ts, dur);
    }

    /* SimpleTableAtom's readTokenTable: the entries counted as the header says. Returns how many. */
    private static int SimpleTable(U8 b, long len, int entryLen, int countAt = 4, int tableAt = 8)
    {
        var n = b.I32BE(countAt);
        b.I8At(0);
        b.I24BE(1);
        var remainingLen = len - tableAt;
        if (remainingLen == 0) return 0;
        if (remainingLen != (long)n * entryLen) throw new JsError("mismatch number-of-entries with remaining atom-length");
        for (var i = 0; i < n; i++) for (var o = 0; o < entryLen; o += 4) b.I32BE(tableAt + i * entryLen + o);
        return n;
    }

    private static List<int> Stsz(U8 b, long len)
    {
        var n = b.I32BE(8);
        b.I8At(0);
        b.I24BE(1);
        b.I32BE(4);
        var list = new List<int>();
        var remainingLen = len - 12;
        if (remainingLen == 0) return list;
        if (remainingLen != (long)n * 4) throw new JsError("mismatch number-of-entries with remaining atom-length");
        for (var i = 0; i < n; i++) list.Add(b.I32BE(12 + i * 4));
        return list;
    }

    private static List<Ssd> Stsd(U8 b, long len)
    {
        var off = 0;
        var end = (int)Math.Min(len, b.Length);
        if (end - off < 8) throw new JsError("Truncated stsd header");
        b.U8At(0);
        b.U24BE(1);
        long n = b.U32BE(4);
        off += 8;
        var table = new List<Ssd>();
        for (long i = 0; i < n; i++)
        {
            if (end - off < 4) throw new JsError("Truncated stsd sample entry");
            long size = b.U32BE(off);
            if (size < 16 || size > end - off) throw new JsError($"Invalid stsd sample entry size: {size}");
            off += 4;
            var entryLen = (int)size - 4;
            var dataFormat = FourCc.Get(b, off);
            b.U16BE(off + 10);
            var descrLen = entryLen - 12;
            var ssd = new Ssd { DataFormat = dataFormat };
            if (descrLen > 0)
            {
                var d = b.Sub(off + 12, off + 12 + descrLen);
                if (d.Length >= 8)
                {
                    var version = d.I16BE(0);
                    d.I16BE(2);
                    d.I32BE(4);
                    if ((version == 0 || version == 1) && d.Length >= 8 + 12)
                    {
                        ssd.HasDescription = true;
                        ssd.NumAudioChannels = d.I16BE(8);
                        ssd.SampleSize = d.I16BE(10);
                        d.I16BE(12);
                        d.I16BE(14);
                        ssd.SampleRate = d.U16BE(16) + d.U16BE(18) / 10000.0;
                    }
                }
            }
            table.Add(ssd);
            off += entryLen;
        }
        return table;
    }

    private void ParseTrackFragment(Mp4Atom traf)
    {
        (double TrackId, double? DefaultDuration, double? DefaultSize)? tfhd = null;
        ReadAtoms(traf, (child, _) =>
        {
            var len = child.PayloadLength;
            switch (child.Name)
            {
                case "tfhd":
                {
                    var b = Read(len);
                    b.I8At(0);
                    var flags2 = b.Get(3) ?? 0;
                    var trackId = b.U32BE(4);
                    var o = 8;
                    double? dd = null, ds = null;
                    if ((flags2 & 1) != 0) { b.U64BE(o); o += 8; }
                    if ((flags2 & 2) != 0) { b.U32BE(o); o += 4; }
                    if ((flags2 & 8) != 0) { dd = b.U32BE(o); o += 4; }
                    if ((flags2 & 16) != 0) { ds = b.U32BE(o); o += 4; }
                    if ((flags2 & 32) != 0) b.U32BE(o);
                    tfhd = (trackId, dd, ds);
                    break;
                }
                case "trun":
                {
                    var b = Read(len);
                    b.I8At(0);
                    var f1 = b.Get(2) ?? 0;
                    var f2 = b.Get(3) ?? 0;
                    long count = b.U32BE(4);
                    long o = 8;
                    if ((f2 & 1) != 0) { b.U32BE((int)o); o += 4; }
                    if ((f2 & 4) != 0) { b.U32BE((int)o); o += 4; }
                    var samples = new List<(double?, double?)>();
                    for (long i = 0; i < count; i++)
                    {
                        if (o >= len) break;
                        double? sd = null, ss = null;
                        if ((f1 & 1) != 0) { sd = b.U32BE((int)o); o += 4; }
                        if ((f1 & 2) != 0) { ss = b.U32BE((int)o); o += 4; }
                        if ((f1 & 4) != 0) { b.U32BE((int)o); o += 4; }
                        if ((f1 & 8) != 0) { b.U32BE((int)o); o += 4; }
                        samples.Add((sd, ss));
                    }
                    if (tfhd is { } h)
                    {
                        var at = tracks.FindIndex(x => x.Id == h.TrackId);
                        if (at >= 0) tracks[at].T.Fragments.Add((samples, h.DefaultDuration, h.DefaultSize));
                    }
                    break;
                }
                default:
                    tok.Ignore(len);
                    break;
            }
            return true;
        }, traf.PayloadLength);
    }
}
