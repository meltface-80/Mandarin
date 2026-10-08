// Mpeg.cs — MP3, MP2 and ADTS AAC (v0.8.13), from music-metadata's mpeg/MpegParser.js.
//
// Read as the scanner asks (duration: false): the first four frames only. The
// length comes from a Xing/Info header's frame count, else (a constant bit
// rate) from the file's size, else not at all; ADTS AAC gets none.
namespace Mandarin.Server.Tags;

internal static class Bits
{
    /* Util.getBitAllignedNumber: JavaScript's 32-bit shifts (a 36-bit read wraps as there). */
    public static int Get(U8 source, int byteOffset, int bitOffset, int len)
    {
        var byteOff = byteOffset + bitOffset / 8;
        var bitOff = bitOffset % 8;
        var value = source.Get(byteOff) ?? 0;
        value &= 0xff >> bitOff;
        var bitsRead = 8 - bitOff;
        var bitsLeft = len - bitsRead;
        if (bitsLeft < 0) value >>= 8 - bitOff - len;
        else if (bitsLeft > 0)
        {
            value <<= bitsLeft;
            value |= Get(source, byteOffset, bitOffset + bitsRead, bitsLeft);
        }
        return value;
    }

    public static bool IsSet(U8 source, int byteOffset, int bitOffset) => Get(source, byteOffset, bitOffset, 1) == 1;
}

internal sealed class MpegHeader
{
    private static readonly double?[] VersionId = [2.5, null, 2, 1];
    private static readonly int[] LayerDescription = [0, 3, 2, 1];
    private static readonly string[] ChannelModes = ["stereo", "joint_stereo", "dual_channel", "mono"];
    private static readonly string[] AudioObjectTypes = ["AAC Main", "AAC LC", "AAC SSR", "AAC LTP"];
    private static readonly double?[] SamplingFrequencies =
        [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350, null, null, null];
    private static readonly int[] ChannelConfigLengths = [-1, 1, 2, 3, 4, 5, 6, 8];
    private static readonly Dictionary<int, Dictionary<int, int>> BitrateIndex = new()
    {
        [1] = new() { [11] = 32, [12] = 32, [13] = 32, [21] = 32, [22] = 8, [23] = 8 },
        [2] = new() { [11] = 64, [12] = 48, [13] = 40, [21] = 48, [22] = 16, [23] = 16 },
        [3] = new() { [11] = 96, [12] = 56, [13] = 48, [21] = 56, [22] = 24, [23] = 24 },
        [4] = new() { [11] = 128, [12] = 64, [13] = 56, [21] = 64, [22] = 32, [23] = 32 },
        [5] = new() { [11] = 160, [12] = 80, [13] = 64, [21] = 80, [22] = 40, [23] = 40 },
        [6] = new() { [11] = 192, [12] = 96, [13] = 80, [21] = 96, [22] = 48, [23] = 48 },
        [7] = new() { [11] = 224, [12] = 112, [13] = 96, [21] = 112, [22] = 56, [23] = 56 },
        [8] = new() { [11] = 256, [12] = 128, [13] = 112, [21] = 128, [22] = 64, [23] = 64 },
        [9] = new() { [11] = 288, [12] = 160, [13] = 128, [21] = 144, [22] = 80, [23] = 80 },
        [10] = new() { [11] = 320, [12] = 192, [13] = 160, [21] = 160, [22] = 96, [23] = 96 },
        [11] = new() { [11] = 352, [12] = 224, [13] = 192, [21] = 176, [22] = 112, [23] = 112 },
        [12] = new() { [11] = 384, [12] = 256, [13] = 224, [21] = 192, [22] = 128, [23] = 128 },
        [13] = new() { [11] = 416, [12] = 320, [13] = 256, [21] = 224, [22] = 144, [23] = 144 },
        [14] = new() { [11] = 448, [12] = 384, [13] = 320, [21] = 256, [22] = 160, [23] = 160 }
    };

    public int VersionIndex, Layer, BitrateIndexValue = -1, SampRateFreqIndex = -1, ChannelModeIndex = -1;
    public double? Version, Bitrate, SamplingRate;
    public bool Padding, IsProtectedByCrc;
    public string Container = "", Codec = "";
    public string? CodecProfile, ChannelMode;
    public int ChannelConfigLength = -1;
    public long FrameLength;

    public MpegHeader(U8 buf, int off)
    {
        VersionIndex = Bits.Get(buf, off + 1, 3, 2);
        Layer = LayerDescription[Bits.Get(buf, off + 1, 5, 2)];
        if (VersionIndex > 1 && Layer == 0) ParseAdts(buf, off);
        else ParseMpeg(buf, off);
        IsProtectedByCrc = !Bits.IsSet(buf, off + 1, 7);
    }

    private void ParseMpeg(U8 buf, int off)
    {
        Container = "MPEG";
        BitrateIndexValue = Bits.Get(buf, off + 2, 0, 4);
        SampRateFreqIndex = Bits.Get(buf, off + 2, 4, 2);
        Padding = Bits.IsSet(buf, off + 2, 6);
        ChannelModeIndex = Bits.Get(buf, off + 3, 0, 2);
        Version = VersionId[VersionIndex];
        ChannelMode = ChannelModes[ChannelModeIndex];
        Codec = $"MPEG {(Version is double v ? Js.Num(v) : "null")} Layer {Layer}";
        var kbps = CalcBitrate();
        if (kbps is not > 0) throw new JsError("Cannot determine bit-rate");
        Bitrate = kbps * 1000.0;
        SamplingRate = CalcSamplingRate() ?? throw new JsError("Cannot determine sampling-rate");
    }

    private void ParseAdts(U8 buf, int off)
    {
        Version = VersionIndex == 2 ? 4 : 2;
        Container = $"ADTS/MPEG-{Js.Num(Version.Value)}";
        CodecProfile = AudioObjectTypes[Bits.Get(buf, off + 2, 0, 2)];
        Codec = "AAC";
        SamplingRate = SamplingFrequencies[Bits.Get(buf, off + 2, 2, 4)];
        ChannelConfigLength = ChannelConfigLengths[Bits.Get(buf, off + 2, 7, 3)];
        FrameLength = Bits.Get(buf, off + 3, 6, 2) << 11;
    }

    private int? CalcBitrate()
    {
        if (BitrateIndexValue is 0 or 0x0f) return null;
        if (Version is double v && v != 0 && BitrateIndexValue != 0)
        {
            var codecIndex = 10 * (int)Math.Floor(v) + Layer;
            return BitrateIndex.TryGetValue(BitrateIndexValue, out var row) && row.TryGetValue(codecIndex, out var k) ? k : null;
        }
        return null;
    }

    private double? CalcSamplingRate()
    {
        if (SampRateFreqIndex == 3 || Version is null) return null;
        int[] rates = Version switch { 1 => [44100, 48000, 32000], 2 => [22050, 24000, 16000], 2.5 => [11025, 12000, 8000], _ => [] };
        return SampRateFreqIndex >= 0 && SampRateFreqIndex < rates.Length ? rates[SampRateFreqIndex] : null;
    }

    public int SamplesPerFrame() => (Version == 1 ? [0, 384, 1152, 1152] : new[] { 0, 384, 1152, 576 })[Layer];

    public double? CalcDuration(double numFrames) => SamplingRate is double sr ? numFrames * SamplesPerFrame() / sr : null;

    public int? SideInfoLength()
    {
        if (Layer != 3) return 2;
        if (ChannelModeIndex == 3)
        {
            if (Version == 1) return 17;
            if (Version is 2 or 2.5) return 9;
        }
        else
        {
            if (Version == 1) return 32;
            if (Version is 2 or 2.5) return 17;
        }
        return null;
    }

    public int? SlotSize() => Layer switch { 1 => 4, 2 => 1, 3 => 1, _ => null };
}

internal sealed class MpegParser(Collector md, Tokenizer tok, ApeFooterAt? ape) : Id3Parser(md, tok, ape)
{
    private const int MaxPeekLen = 1024;
    private int frameCount;
    private int syncFrameCount = -1;
    private readonly List<double> bitrates = [];
    private long offset;
    private long frameSize;
    private int? samplesPerFrame;
    private readonly U8 frameHeaderBuf = new(4);
    private long? mpegOffset;
    private readonly U8 peekBuf = new(MaxPeekLen);
    private int peekLen;
    private MpegHeader? audioFrameHeader;

    protected override void PostId3v2Parse()
    {
        Md.SetFormat("lossless", false);
        Md.SetAudioOnly();
        try
        {
            var quit = false;
            while (!quit)
            {
                Sync();
                quit = ParseCommonHeader();
            }
        }
        catch (EndOfStream) { /* (the end's own duration needs duration: true) */ }
    }

    protected override void Finish()
    {
        var hasId3v1 = Md.NativeOf("ID3v1") is not null;
        if (mpegOffset is not long mo) return;
        if (Tok.Size is long size && size != 0 && Md.Fmt("codecProfile") is "CBR")
        {
            var mpegSize = size - mo - (hasId3v1 ? 128 : 0);
            if (samplesPerFrame is int spf)
            {
                var numberOfSamples = Js.Round((double)mpegSize / frameSize) * spf;
                Md.SetFormat("numberOfSamples", numberOfSamples);
                if (Js.Truthy(Md.Fmt("sampleRate")) && !Js.Truthy(Md.Fmt("duration")))
                    Md.SetFormat("duration", numberOfSamples / Js.ToNumber(Md.Fmt("sampleRate")));
            }
        }
    }

    private void Sync()
    {
        var gotFirstSync = false;
        while (true)
        {
            var bo = 0;
            peekLen = Tok.PeekBuffer(peekBuf, null, MaxPeekLen, true);
            if (peekLen <= 163) throw new EndOfStream();
            while (true)
            {
                if (gotFirstSync && ((peekBuf.Get(bo) ?? 0) & 0xe0) == 0xe0)
                {
                    frameHeaderBuf.Put(0, 0xff);
                    frameHeaderBuf.Put(1, peekBuf.At(bo));
                    Tok.Ignore(bo);
                    if (syncFrameCount == frameCount) { frameCount = 0; frameSize = 0; }
                    syncFrameCount = frameCount;
                    return;
                }
                gotFirstSync = false;
                bo = peekBuf.IndexOf(0xff, bo);
                if (bo == -1)
                {
                    if (peekLen < MaxPeekLen) throw new EndOfStream();
                    Tok.Ignore(peekLen);
                    break;
                }
                ++bo;
                gotFirstSync = true;
            }
        }
    }

    private bool ParseCommonHeader()
    {
        if (frameCount == 0) mpegOffset = Tok.Position - 1;
        Tok.PeekBuffer(frameHeaderBuf.Sub(1), null, 3);
        MpegHeader header;
        try { header = new MpegHeader(frameHeaderBuf, 0); }
        catch (JsError)
        {
            Tok.Ignore(1);
            return false;
        }
        Tok.Ignore(3);
        Md.SetFormat("container", header.Container);
        Md.SetFormat("codec", header.Codec);
        Md.SetFormat("lossless", false);
        Md.SetFormat("sampleRate", header.SamplingRate);
        frameCount++;
        return header.Version is double v && v >= 2 && header.Layer == 0 ? ParseAdts(header) : ParseAudioFrame(header);
    }

    private bool ParseAudioFrame(MpegHeader header)
    {
        Md.SetFormat("numberOfChannels", header.ChannelMode == "mono" ? 1.0 : 2.0);
        Md.SetFormat("bitrate", header.Bitrate);
        var slot = header.SlotSize() ?? throw new JsError("invalid slot_size");
        var spf = header.SamplesPerFrame();
        var bps = spf / 8.0;
        if (header.Bitrate is double br && header.SamplingRate is double sr)
        {
            var fsize = bps * br / sr + (header.Padding ? slot : 0);
            frameSize = (long)Math.Floor(fsize);
        }
        audioFrameHeader = header;
        if (header.Bitrate is double b) bitrates.Add(b);
        if (frameCount == 1)
        {
            offset = 4;
            SkipSideInformation();
            return false;
        }
        if (frameCount == 4)
        {
            if (bitrates.All(x => x == bitrates[0]))
            {
                samplesPerFrame = spf;
                Md.SetFormat("codecProfile", "CBR");
                if (Tok.Size is long s && s != 0) return true;
            }
            else if (Js.Truthy(Md.Fmt("duration"))) return true;
            return true; // duration: false
        }
        offset = 4;
        if (header.IsProtectedByCrc)
        {
            Tok.Ignore(2);
            offset += 2;
            SkipSideInformation();
            return false;
        }
        SkipSideInformation();
        return false;
    }

    private bool ParseAdts(MpegHeader header)
    {
        var buf = new U8(3);
        Tok.ReadBuffer(buf);
        header.FrameLength += Bits.Get(buf, 0, 0, 11);
        samplesPerFrame = 1024;
        Tok.Ignore(header.FrameLength > 7 ? header.FrameLength - 7 : 1);
        if (frameCount == 3)
        {
            Md.SetFormat("codecProfile", header.CodecProfile);
            if (header.ChannelConfigLength > 0) Md.SetFormat("numberOfChannels", (double)header.ChannelConfigLength);
            return true;
        }
        return false;
    }

    private void SkipSideInformation()
    {
        if (audioFrameHeader?.SideInfoLength() is not int len) return;
        Tok.ReadToken(len);
        offset += len;
        ReadXtraInfoHeader();
    }

    private void ReadXtraInfoHeader()
    {
        var tag = Text.Decode(Tok.ReadToken(4), "ascii");
        offset += 4;
        switch (tag)
        {
            case "Info":
                Md.SetFormat("codecProfile", "CBR");
                ReadXingInfoHeader();
                return;
            case "Xing":
            {
                var vbrScale = ReadXingInfoHeader();
                if (vbrScale is double v) Md.SetFormat("codecProfile", $"V{Js.Num(Math.Floor((100 - v) / 10))}");
                return;
            }
            case "Xtra":
                break;
            case "LAME":
                Tok.ReadToken(6);
                if (frameSize >= offset + 6)
                {
                    offset += 6;
                    SkipFrameData(frameSize - offset);
                    return;
                }
                break;
        }
        var left = frameSize - offset;
        if (left >= 0) SkipFrameData(left);
    }

    private static readonly System.Text.RegularExpressions.Regex LameVersion =
        new(@"[0-9]+[^\n\r\u2028\u2029][0-9]+", System.Text.RegularExpressions.RegexOptions.CultureInvariant);

    /* XingTag.readXingHeader, and what MpegParser takes from it. Returns the VBR scale, if any. */
    private double? ReadXingInfoHeader()
    {
        var start = Tok.Position;
        var flags = Tok.ReadToken(4);
        double? numFrames = null, streamSize = null, vbrScale = null;
        if (Bits.IsSet(flags, 0, 31)) numFrames = Tok.ReadToken(4).U32BE(0);
        if (Bits.IsSet(flags, 0, 30)) streamSize = Tok.ReadToken(4).U32BE(0);
        if (Bits.IsSet(flags, 0, 29)) Tok.ReadBuffer(new U8(100));
        if (Bits.IsSet(flags, 0, 28)) vbrScale = Tok.ReadToken(4).U32BE(0);
        var lameTag = Text.Decode(Tok.PeekToken(4), "ascii");
        if (lameTag == "LAME")
        {
            Tok.Ignore(4);
            var version = Text.Decode(Tok.ReadToken(5), "ascii");
            var m = LameVersion.Match(version);
            if (m.Success)
            {
                var parts = m.Value.Split('.');
                var major = Js.ParseInt(parts[0]);
                var minor = parts.Length > 1 ? Js.ParseInt(parts[1]) : double.NaN;
                if (major >= 3 && minor >= 90)
                {
                    var ext = Tok.ReadToken(27);
                    // (music_length, misread one byte on as there: a later frame count corrects it.)
                    Md.SetFormat("duration", ext.U32BE(20) / 1000.0);
                }
            }
        }
        offset += Tok.Position - start;
        if (Js.Truthy(streamSize) && audioFrameHeader is not null && numFrames is double nf)
        {
            Md.SetFormat("duration", audioFrameHeader.CalcDuration(nf));
            return vbrScale;
        }
        SkipFrameData(frameSize - offset);
        return vbrScale;
    }

    private void SkipFrameData(long left)
    {
        if (left < 0) throw new JsError("frame-data-left cannot be negative");
        Tok.Ignore(left);
    }
}
