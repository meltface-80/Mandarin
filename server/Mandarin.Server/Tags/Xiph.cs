// Xiph.cs — FLAC, Ogg (Vorbis, Opus, Speex, FLAC, Theora) and Vorbis comments
// (v0.8.13), from music-metadata's flac/ and ogg/.
//
// As read with duration: false, an Ogg stream is read for its first thirteen
// pages only, so a longer Ogg Vorbis or Opus file has no length here (nor had
// it in the Node reader); FLAC's comes from its STREAMINFO, even inside Ogg.
namespace Mandarin.Server.Tags;

internal static class FourCc
{
    /* FourCcToken: four latin1 characters, the first printable or ©, the rest printable, NUL or brackets. */
    public static string Get(U8 buf, int off)
    {
        var id = Text.Decode(buf.Sub(off, off + 4), "latin1");
        if (id.Length < 4 || !Valid(id)) throw new JsError($"FourCC contains invalid characters: \"{id}\"");
        return id;
    }

    private static bool Valid(string id)
    {
        var c0 = id[0];
        if (!((c0 >= '\x21' && c0 <= '\x7e') || c0 == '©')) return false;
        for (var i = 1; i < 4; i++)
        {
            var c = id[i];
            if (!((c >= '\x20' && c <= '\x7e') || c == '\0')) return false;
        }
        return true;
    }
}

/* VorbisDecoder: length-prefixed UTF-8 strings, read on whatever the lengths say. */
internal sealed class VorbisDecoder(U8 data, long offset)
{
    public long Offset = offset;

    public long ReadInt32()
    {
        if (Offset > int.MaxValue) throw new JsError("Offset is outside the bounds of the DataView");
        long v = data.U32LE((int)Offset);
        Offset += 4;
        return v;
    }

    public string ReadStringUtf8()
    {
        var len = ReadInt32();
        var start = (int)Math.Min(Offset, data.Length);
        var end = (int)Math.Min(Offset + len, data.Length);
        var value = Text.Decode(data.Sub(start, end), "utf-8");
        Offset += len;
        return value;
    }

    public (string Key, string Value, long Len) ParseUserComment()
    {
        var o0 = Offset;
        var v = ReadStringUtf8();
        var idx = v.IndexOf('=');
        var key = Js.Upper(idx <= 0 ? "" : v[..idx]);
        var value = idx < 0 ? v : v[(idx + 1)..];
        return (key, value, Offset - o0);
    }
}

internal static class Vorbis
{
    /* VorbisStream.addTag: a picture comment isn't read (covers are found on their own). */
    public static void AddTag(Collector md, string id, string value)
    {
        if (id == "METADATA_BLOCK_PICTURE") return;
        md.AddTag("vorbis", id, value);
    }
}

internal readonly record struct StreamInfo(int SampleRate, int Channels, int BitsPerSample, int TotalSamples);

internal sealed class FlacParser(Collector md, Tokenizer tok, ApeFooterAt? ape) : Id3Parser(md, tok, ape)
{
    public static StreamInfo ReadStreamInfo(U8 buf, int off) => new(
        buf.U24BE(off + 10) >> 4,
        Bits.Get(buf, off + 12, 4, 3) + 1,
        Bits.Get(buf, off + 12, 7, 5) + 1,
        Bits.Get(buf, off + 13, 4, 36));

    public static void ProcessStreamInfo(Collector md, StreamInfo s)
    {
        md.SetFormat("codec", "FLAC");
        md.SetFormat("hasAudio", true);
        md.SetFormat("lossless", true);
        md.SetFormat("numberOfChannels", (double)s.Channels);
        md.SetFormat("bitsPerSample", (double)s.BitsPerSample);
        md.SetFormat("sampleRate", (double)s.SampleRate);
        if (s.TotalSamples > 0) md.SetFormat("duration", (double)s.TotalSamples / s.SampleRate);
    }

    /* FlacParser.parseComment: every comment read first, then each added. */
    public static void ParseComment(Collector md, U8 data)
    {
        var d = new VorbisDecoder(data, 0);
        d.ReadStringUtf8();
        var n = d.ReadInt32();
        var tags = new List<(string, string)>();
        for (long i = 0; i < n; i++)
        {
            var (k, v, _) = d.ParseUserComment();
            tags.Add((k, v));
        }
        foreach (var (k, v) in tags) Vorbis.AddTag(md, k, v);
    }

    protected override void PostId3v2Parse()
    {
        var fourCc = FourCc.Get(Tok.ReadToken(4), 0);
        if (fourCc != "fLaC") throw new JsError("Invalid FLAC preamble");
        bool last;
        do
        {
            var h = Tok.ReadToken(4);
            last = (h.At(0) & 0x80) != 0;
            var type = Bits.Get(h, 0, 1, 7);
            var length = h.U24BE(1);
            switch (type)
            {
                case 0:
                    if (length != 34) throw new JsError("Unexpected block-stream-info length");
                    var si = Tok.ReadToken(34);
                    Md.SetFormat("container", "FLAC");
                    ProcessStreamInfo(Md, ReadStreamInfo(si, 0));
                    break;
                case 4:
                    ParseComment(Md, Tok.ReadToken(length));
                    break;
                default:
                    // Padding, application, seek table, cue sheet, picture (skipped), unknown.
                    Tok.Ignore(length);
                    break;
            }
        } while (!last);
    }
}

internal readonly record struct OggPage(bool Continued, bool FirstPage, bool LastPage, double Granule, uint Serial, uint Sequence, int Segments);

internal abstract class OggConsumer
{
    public virtual bool DurationOnLastPage => false;
    public abstract void ParsePage(OggPage header, U8 pageData);
    public virtual void Flush() { }
    public virtual void CalculateDuration(bool endOfStream) { }
}

/* VorbisStream (and the Opus and Speex streams built on it). */
internal class VorbisConsumer(Collector md) : OggConsumer
{
    protected readonly Collector Md = md;
    private List<U8> pageSegments = [];
    protected OggPage? LastPageHeader;

    public override bool DurationOnLastPage => true;

    public override void ParsePage(OggPage header, U8 pageData)
    {
        LastPageHeader = header;
        if (header.FirstPage) { ParseFirstPage(pageData); return; }
        if (header.Continued)
        {
            if (pageSegments.Count == 0) throw new JsError("Cannot continue on previous page");
            pageSegments.Add(pageData);
        }
        if (header.LastPage || !header.Continued)
        {
            if (pageSegments.Count > 0) ParseFullPage(Merge(pageSegments));
            pageSegments = header.LastPage ? [] : [pageData];
        }
    }

    private static U8 Merge(List<U8> arrays)
    {
        var merged = new U8(arrays.Sum(a => a.Length));
        var o = 0;
        foreach (var a in arrays) { a.Span.CopyTo(merged.Buf.AsSpan(o)); o += a.Length; }
        return merged;
    }

    public override void Flush() => ParseFullPage(Merge(pageSegments));

    protected virtual void ParseFirstPage(U8 pageData)
    {
        Md.SetFormat("codec", "Vorbis I");
        Md.SetFormat("hasAudio", true);
        var packetType = pageData.U8At(0);
        if (Text.Decode(pageData.Sub(1, 7), "ascii") != "vorbis") throw new JsError("Metadata does not look like Vorbis");
        if (packetType != 1) throw new JsError("First Ogg page should be type 1: the identification header");
        pageData.U32LE(7); pageData.U32LE(7 + 9); pageData.U32LE(7 + 17);
        Md.SetFormat("sampleRate", (double)pageData.U32LE(7 + 5));
        Md.SetFormat("bitrate", (double)pageData.U32LE(7 + 13));
        Md.SetFormat("numberOfChannels", (double)pageData.U8At(7 + 4));
    }

    protected virtual void ParseFullPage(U8 pageData)
    {
        if (pageData.U8At(0) == 3) ParseUserCommentList(pageData, 7);
    }

    protected void ParseUserCommentList(U8 pageData, long offset)
    {
        if (offset > int.MaxValue) throw new JsError("Offset is outside the bounds of the DataView");
        long strLen = pageData.U32LE((int)offset);
        offset += 4 + strLen;
        if (offset > int.MaxValue) throw new JsError("Offset is outside the bounds of the DataView");
        long count = pageData.U32LE((int)offset);
        offset += 4;
        while (count-- > 0)
        {
            var d = new VorbisDecoder(pageData, offset);
            var (k, v, len) = d.ParseUserComment();
            Vorbis.AddTag(Md, k, v);
            offset += len;
        }
    }

    public override void CalculateDuration(bool endOfStream)
    {
        if (LastPageHeader is { } h && (endOfStream || h.LastPage) && Js.Truthy(Md.Fmt("sampleRate")) && h.Granule >= 0)
        {
            Md.SetFormat("numberOfSamples", h.Granule);
            Md.SetFormat("duration", h.Granule / Js.ToNumber(Md.Fmt("sampleRate")));
        }
    }
}

internal sealed class OpusConsumer(Collector md) : VorbisConsumer(md)
{
    private int preSkip;

    protected override void ParseFirstPage(U8 pageData)
    {
        Md.SetFormat("codec", "Opus");
        if (pageData.Length < 19) throw new JsError("ID-header-page 0 should be at least 19 bytes long");
        var magic = Text.Decode(pageData.Sub(0, 8), "ascii");
        var channels = pageData.U8At(9);
        preSkip = pageData.U16LE(10);
        var rate = pageData.U32LE(12);
        pageData.U16LE(16);
        pageData.U8At(18);
        if (magic != "OpusHead") throw new JsError("Illegal ogg/Opus magic-signature");
        Md.SetFormat("sampleRate", (double)rate);
        Md.SetFormat("numberOfChannels", (double)channels);
        Md.SetAudioOnly();
    }

    protected override void ParseFullPage(U8 pageData)
    {
        if (Text.Decode(pageData.Sub(0, 8), "ascii") == "OpusTags") ParseUserCommentList(pageData, 8);
    }

    public override void CalculateDuration(bool endOfStream)
    {
        if (LastPageHeader is { } h && (endOfStream || h.LastPage) && Js.Truthy(Md.Fmt("sampleRate")) && h.Granule >= 0)
        {
            var pos = h.Granule - preSkip;
            Md.SetFormat("numberOfSamples", pos);
            Md.SetFormat("duration", pos / 48000);
        }
    }
}

internal sealed class SpeexConsumer(Collector md) : VorbisConsumer(md)
{
    private bool commentParsed;

    protected override void ParseFirstPage(U8 pageData)
    {
        var version = Text.TrimRightNull(Text.Decode(pageData.Sub(8, 28), "ascii"));
        for (var o = 28; o <= 76; o += 4) pageData.I32LE(o);
        var rate = pageData.I32LE(36);
        var channels = pageData.I32LE(48);
        var bitrate = pageData.I32LE(52);
        Md.SetFormat("codec", $"Speex {version}");
        Md.SetFormat("numberOfChannels", (double)channels);
        Md.SetFormat("sampleRate", (double)rate);
        if (bitrate != -1) Md.SetFormat("bitrate", (double)bitrate);
        Md.SetAudioOnly();
    }

    protected override void ParseFullPage(U8 pageData)
    {
        if (commentParsed) return;
        commentParsed = true;
        ParseUserCommentList(pageData, 0);
    }
}

internal sealed class TheoraConsumer(Collector md) : OggConsumer
{
    public override void ParsePage(OggPage header, U8 pageData)
    {
        if (!header.FirstPage) return;
        md.SetFormat("codec", "Theora");
        pageData.U8At(7); pageData.U8At(8); pageData.U8At(9); pageData.U16BE(10); pageData.U16BE(17);
        md.SetFormat("bitrate", (double)pageData.U24BE(37));
        pageData.U8At(40);
        md.SetFormat("hasVideo", true);
    }
}

internal sealed class OggFlacConsumer(Collector md, Tokenizer tok) : OggConsumer
{
    public override void ParsePage(OggPage header, U8 pageData)
    {
        if (!header.FirstPage) return;
        if (FourCc.Get(pageData, 9) != "fLaC") throw new JsError("Invalid FLAC preamble");
        var type = Bits.Get(pageData, 13, 1, 7);
        var length = pageData.U24BE(14);
        var block = pageData.Sub(17);
        switch (type)
        {
            case 0:
                FlacParser.ProcessStreamInfo(md, FlacParser.ReadStreamInfo(block, 0));
                return;
            case 4:
                FlacParser.ParseComment(md, block);
                return;
            default:
                tok.Ignore(length);
                return;
        }
    }
}

internal sealed class OggParser(Collector md, Tokenizer tok)
{
    private sealed class Stream(uint serial)
    {
        public readonly uint Serial = serial;
        public uint PageNumber;
        public bool Closed;
        public OggConsumer? Consumer;
    }

    private sealed class OggContentError(string m) : Exception(m);

    public void Parse()
    {
        var streams = new List<Stream>();
        var endOfStream = false;
        try
        {
            do
            {
                var h = tok.ReadToken(27);
                if (Text.Decode(h.Sub(0, 4), "latin1") != "OggS") throw new OggContentError("Invalid Ogg capture pattern");
                var flags = h.At(5);
                var header = new OggPage((flags & 1) != 0, (flags & 2) != 0, (flags & 4) != 0,
                    (double)(ulong)h.U64LE(6), h.U32LE(14), h.U32LE(18), h.U8At(26));
                var stream = streams.Find(s => s.Serial == header.Serial);
                if (stream is null) { stream = new Stream(header.Serial); streams.Add(stream); }
                ParsePage(stream, header);
                if (stream.PageNumber > 12) break; // (duration: false)
            } while (!streams.All(s => s.Closed));
        }
        catch (EndOfStream) { endOfStream = true; }
        catch (OggContentError) { }
        foreach (var s in streams)
        {
            if (!s.Closed) s.Consumer?.Flush();
            s.Consumer?.CalculateDuration(endOfStream);
        }
    }

    private void ParsePage(Stream stream, OggPage header)
    {
        stream.PageNumber = header.Sequence;
        var table = tok.ReadToken(header.Segments);
        var total = 0;
        for (var i = 0; i < header.Segments; i++) total += table.At(i);
        var pageData = tok.ReadToken(total);
        if (header.FirstPage)
        {
            md.SetFormat("container", "Ogg");
            var id = new string(pageData.Sub(0, 7).Span.ToArray().Where(b => b >= 32 && b <= 126).Select(b => (char)b).ToArray());
            stream.Consumer = id switch
            {
                "vorbis" => new VorbisConsumer(md),
                "OpusHea" => new OpusConsumer(md),
                "Speex  " => new SpeexConsumer(md),
                "fishead" or "theora" => new TheoraConsumer(md),
                "FLAC" => new OggFlacConsumer(md, tok),
                _ => throw new OggContentError($"Ogg codec not recognized (id={id}")
            };
        }
        if (header.LastPage) stream.Closed = true;
        if (stream.Consumer is null) throw new JsError("pageConsumer should be initialized");
        stream.Consumer.ParsePage(header, pageData);
    }
}
