// Formats.cs — WAV, AIFF, DSF, DSDIFF, WavPack, Monkey's Audio and ASF/WMA
// (v0.8.13), from music-metadata's wav/, aiff/, dsf/, dsdiff/, wavpack/,
// apev2/ and asf/ parsers, each as the scanner reads it (no covers).
using System.Numerics;

namespace Mandarin.Server.Tags;

internal sealed class WaveParser(Collector md, Tokenizer tok)
{
    private int? codePage;
    private readonly List<(string Id, long Size, U8 Bytes)> pending = [];
    private long blockAlign;
    private double? factSamples;

    private static readonly Dictionary<int, string> FormatNames = new()
    {
        [0x0001] = "PCM", [0x0002] = "ADPCM", [0x0003] = "IEEE_FLOAT", [0x0006] = "ALAW", [0x0007] = "MULAW",
        [0x0011] = "DVI_ADPCM", [0x0031] = "GSM610", [0x1600] = "MPEG_ADTS_AAC", [0x1602] = "MPEG_LOAS", [0x00ff] = "RAW_AAC1",
        [0x0092] = "DOLBY_AC3_SPDIF", [0x2000] = "DVM", [0x0240] = "RAW_SPORT", [0x0241] = "ESST_AC3", [0x0009] = "DRM",
        [0x2001] = "DTS2", [0x0050] = "MPEG", [0x0055] = "MPEGLAYER3"
    };

    public void Parse()
    {
        var h = tok.ReadToken(8);
        if (Text.Decode(h.Sub(0, 4), "latin1") != "RIFF") return;
        md.SetAudioOnly();
        try
        {
            var type = FourCc.Get(tok.ReadToken(4), 0);
            md.SetFormat("container", type);
            if (type != "WAVE") throw new JsError($"Unsupported RIFF format: RIFF/{type}");
            ReadWaveChunk((long)h.U32LE(4) - 4);
        }
        catch (EndOfStream) { }
        Flush();
    }

    private string? InfoEncoding() => codePage switch
    {
        null or 0 or 28591 => "latin1",
        1252 => "windows-1252",
        65001 => "utf-8",
        _ => null
    };

    private void AddInfo(string id, long size, U8 bytes)
    {
        if (InfoEncoding() is not string enc) return;
        var value = Text.Decode(bytes.Sub(0, (int)Math.Min(size, int.MaxValue)), enc);
        var nul = value.IndexOf('\0');
        md.AddTag("exif", id, nul >= 0 ? value[..nul] : value);
    }

    private void Flush()
    {
        var list = pending.ToList();
        pending.Clear();
        foreach (var (id, size, bytes) in list) AddInfo(id, size, bytes);
    }

    private void ReadWaveChunk(long remaining)
    {
        while (remaining >= 8)
        {
            var h = tok.ReadToken(8);
            var id = Text.Decode(h.Sub(0, 4), "latin1");
            long size = h.U32LE(4);
            remaining -= 8 + size;
            switch (id)
            {
                case "CSET":
                {
                    if (size < 8) throw new JsError("CSET chunk must contain at least 8 bytes");
                    var cset = tok.ReadToken((int)size);
                    codePage = cset.U16LE(0);
                    Flush();
                    break;
                }
                case "LIST":
                {
                    var listType = Text.Decode(tok.ReadToken(4), "latin1");
                    if (listType == "INFO") InfoTags(size - 4);
                    else tok.Ignore(size - 4);
                    break;
                }
                case "fact":
                {
                    md.SetFormat("lossless", false);
                    if (size < 4) throw new JsError("Invalid fact chunk size.");
                    factSamples = tok.ReadToken((int)size).U32LE(0);
                    break;
                }
                case "fmt ":
                {
                    if (size < 16) throw new JsError("Invalid chunk size");
                    var f = tok.ReadToken((int)size);
                    var tag = f.U16LE(0);
                    md.SetFormat("codec", FormatNames.TryGetValue(tag, out var n) ? n : $"non-PCM ({tag})");
                    md.SetFormat("bitsPerSample", (double)f.U16LE(14));
                    md.SetFormat("sampleRate", (double)f.U32LE(4));
                    md.SetFormat("numberOfChannels", (double)f.U16LE(2));
                    blockAlign = f.U16LE(12);
                    f.U32LE(8);
                    break;
                }
                case "id3 ":
                case "ID3 ":
                {
                    var data = tok.ReadToken((int)size);
                    Id3v2.Parse(md, new BufferTok(data), true);
                    break;
                }
                case "data":
                {
                    if (md.Fmt("lossless") is not false) md.SetFormat("lossless", true);
                    var chunkSize = size;
                    if (tok.Size is long fs && fs != 0)
                    {
                        var calc = fs - tok.Position;
                        if (calc < chunkSize) chunkSize = calc;
                    }
                    double? samples = factSamples ?? (chunkSize == 0xffffffff ? null : (double)chunkSize / blockAlign);
                    if (Js.Truthy(samples))
                    {
                        md.SetFormat("numberOfSamples", samples);
                        if (Js.Truthy(md.Fmt("sampleRate"))) md.SetFormat("duration", samples!.Value / Js.ToNumber(md.Fmt("sampleRate")));
                    }
                    tok.Ignore(size);
                    break;
                }
                case "bext":
                {
                    var b = tok.ReadToken(420);
                    string S(int off, int len) => Js.Trim(Text.StripNulls(Text.Decode(b.Sub(off, off + len), "ascii")));
                    var u32 = new[] { b.U32LE(338), b.U32LE(342) };
                    var version = b.U16LE(346);
                    var umid = b.Sub(348, 412);
                    var loud = new[] { b.U16LE(412), b.U16LE(414), b.U16LE(416), b.U16LE(418) };
                    md.AddTag("exif", "bext.description", S(0, 256));
                    md.AddTag("exif", "bext.originator", S(256, 32));
                    md.AddTag("exif", "bext.originatorReference", S(288, 32));
                    md.AddTag("exif", "bext.originationDate", S(320, 10));
                    md.AddTag("exif", "bext.originationTime", S(330, 8));
                    md.AddTag("exif", "bext.timeReferenceLow", (double)u32[0]);
                    md.AddTag("exif", "bext.timeReferenceHigh", (double)u32[1]);
                    md.AddTag("exif", "bext.version", (double)version);
                    md.AddTag("exif", "bext.umid", umid);
                    md.AddTag("exif", "bext.loudnessValue", (double)loud[0]);
                    md.AddTag("exif", "bext.maxTruePeakLevel", (double)loud[1]);
                    md.AddTag("exif", "bext.maxMomentaryLoudness", (double)loud[2]);
                    md.AddTag("exif", "bext.maxShortTermLoudness", (double)loud[3]);
                    tok.Ignore(size - 420);
                    break;
                }
                default:
                    tok.Ignore(size);
                    break;
            }
            if (size % 2 == 1) tok.Ignore(1);
        }
    }

    private void InfoTags(long size)
    {
        while (size >= 8)
        {
            var h = tok.ReadToken(8);
            var id = Text.Decode(h.Sub(0, 4), "latin1");
            long chunk = h.U32LE(4);
            var len = chunk + (chunk & 1);
            var bytes = tok.ReadToken((int)len);
            if (codePage is null) pending.Add((id, chunk, bytes));
            else AddInfo(id, chunk, bytes);
            size -= 8 + len;
        }
        if (size != 0) throw new JsError($"Illegal remaining size: {size}");
    }
}

internal sealed class AiffParser(Collector md, Tokenizer tok)
{
    private static readonly Dictionary<string, string> CompressionTypes = new(StringComparer.Ordinal)
    {
        ["NONE"] = "not compressed\tPCM\tApple Computer", ["sowt"] = "PCM (byte swapped)",
        ["fl32"] = "32-bit floating point IEEE 32-bit float", ["fl64"] = "64-bit floating point IEEE 64-bit float\tApple Computer",
        ["alaw"] = "ALaw 2:1\t8-bit ITU-T G.711 A-law", ["ulaw"] = "µLaw 2:1\t8-bit ITU-T G.711 µ-law\tApple Computer",
        ["ULAW"] = "CCITT G.711 u-law 8-bit ITU-T G.711 µ-law", ["ALAW"] = "CCITT G.711 A-law 8-bit ITU-T G.711 A-law",
        ["FL32"] = "Float 32\tIEEE 32-bit float "
    };

    private bool compressed;

    public void Parse()
    {
        var h = tok.ReadToken(8);
        if (FourCc.Get(h, 0) != "FORM") throw new JsError("Invalid Chunk-ID, expected 'FORM'");
        h.U32BE(4);
        var type = FourCc.Get(tok.ReadToken(4), 0);
        switch (type)
        {
            case "AIFF": md.SetFormat("container", "AIFF"); compressed = false; break;
            case "AIFC": md.SetFormat("container", "AIFF-C"); compressed = true; break;
            default: throw new JsError($"Unsupported AIFF type: {type}");
        }
        md.SetFormat("lossless", !compressed);
        md.SetAudioOnly();
        try
        {
            while (tok.Size is not long s || s == 0 || s - tok.Position >= 8)
            {
                var c = tok.ReadToken(8);
                var id = FourCc.Get(c, 0);
                long size = c.U32BE(4);
                var next = (long)(2 * Js.Round(size / 2.0));
                var read = ReadData(id, size);
                tok.Ignore(next - read);
            }
        }
        catch (EndOfStream) { }
    }

    private long ReadData(string id, long size)
    {
        switch (id)
        {
            case "COMM":
            {
                var min = compressed ? 22 : 18;
                if (size < min) throw new JsError($"COMMON CHUNK size should always be at least {min}");
                var b = tok.ReadToken((int)size);
                var shift = b.U16BE(8) - 16398;
                var baseRate = b.U16BE(10);
                var channels = b.U16BE(0);
                double frames = b.U32BE(2);
                var sampleSize = b.U16BE(6);
                double rate = shift < 0 ? baseRate >> Math.Abs(shift) : baseRate << shift;
                string? compressionType = null;
                object? compressionName = Undef.V;
                if (compressed)
                {
                    compressionType = FourCc.Get(b, 18);
                    if (size > 22)
                    {
                        var strLen = b.U8At(22);
                        if (strLen > 0)
                        {
                            var padding = (strLen + 1) % 2;
                            if (23 + strLen + padding == size) compressionName = Text.Decode(b.Sub(23, 23 + strLen), "latin1");
                            else throw new JsError("Illegal pstring length");
                        }
                    }
                }
                else compressionName = "PCM";
                md.SetFormat("bitsPerSample", (double)sampleSize);
                md.SetFormat("sampleRate", rate);
                md.SetFormat("numberOfChannels", (double)channels);
                md.SetFormat("numberOfSamples", frames);
                md.SetFormat("duration", frames / rate);
                if (Js.Truthy(compressionName) || Js.Truthy(compressionType))
                {
                    object? codec = compressionName is string cn ? cn
                        : compressionType is not null && CompressionTypes.TryGetValue(compressionType, out var ct) ? ct : Undef.V;
                    md.SetFormat("codec", codec);
                }
                return size;
            }
            case "ID3 ":
            {
                var data = tok.ReadToken((int)size);
                Id3v2.Parse(md, new BufferTok(data), true);
                return size;
            }
            case "SSND":
                return 0;
            case "NAME":
            case "AUTH":
            case "(c) ":
            case "ANNO":
            {
                var value = Text.Decode(tok.ReadToken((int)size), "ascii");
                foreach (var v in value.Split('\0').Select(Js.Trim).Where(v => v.Length > 0)) md.AddTag("AIFF", id, v);
                return size;
            }
            default:
                return 0;
        }
    }
}

internal sealed class DsfParser(Collector md, Tokenizer tok, ApeFooterAt? ape) : Id3Parser(md, tok, ape)
{
    protected override void PostId3v2Parse()
    {
        var p0 = Tok.Position;
        var h = Tok.ReadToken(12);
        var id = FourCc.Get(h, 0);
        var size = h.U64LE(4);
        if (id != "DSD ") throw new JsError("Invalid chunk signature");
        if (size != 28) throw new JsError($"Invalid DSD chunk size: {size}");
        Md.SetFormat("container", "DSF");
        Md.SetFormat("lossless", true);
        Md.SetAudioOnly();
        var d = Tok.ReadToken(16);
        var fileSize = d.U64LE(0);
        var metadataPointer = d.U64LE(8);
        if (fileSize < size) throw new JsError($"Invalid DSF file size: {fileSize}");
        ParseChunks(fileSize - size);
        if (metadataPointer == 0) return;
        var metadataOffset = metadataPointer - (Tok.Position - p0);
        if (metadataOffset < 0 || metadataOffset > 9007199254740991 || metadataPointer + 10 > fileSize)
            throw new JsError($"Invalid metadata pointer: {metadataPointer}");
        Tok.Ignore((long)metadataOffset);
        Id3v2.Parse(Md, Tok, true);
    }

    private void ParseChunks(BigInteger remaining)
    {
        while (remaining >= 12)
        {
            var h = Tok.ReadToken(12);
            var id = FourCc.Get(h, 0);
            var size = h.U64LE(4);
            if (size < 12) throw new JsError($"Invalid {id} chunk size: {size}");
            if (size > remaining) throw new JsError($"{id} chunk exceeds remaining file size");
            var payload = size - 12;
            if (id == "fmt ")
            {
                if (payload < 40) throw new JsError($"Invalid fmt chunk size: {size}");
                var f = Tok.ReadToken(40);
                for (var o = 0; o <= 20; o += 4) f.I32LE(o);
                var channels = f.I32LE(12);
                var rate = f.I32LE(16);
                var bits = f.I32LE(20);
                var count = f.I64LE(24);
                f.I32LE(32);
                Md.SetFormat("numberOfChannels", (double)channels);
                Md.SetFormat("sampleRate", (double)rate);
                Md.SetFormat("bitsPerSample", (double)bits);
                Md.SetFormat("numberOfSamples", count);
                Md.SetFormat("duration", (double)count / rate);
                return;
            }
            Tok.Ignore((long)(double)payload);
            remaining -= size;
        }
    }
}

internal sealed class DsdiffParser(Collector md, Tokenizer tok)
{
    private (string Id, BigInteger Size) Header()
    {
        var h = tok.ReadToken(12);
        return (FourCc.Get(h, 0), h.I64BE(4));
    }

    public void Parse()
    {
        var (id, size) = Header();
        if (id != "FRM8") throw new JsError("Unexpected chunk-ID");
        md.SetAudioOnly();
        var type = Js.Trim(FourCc.Get(tok.ReadToken(4), 0));
        if (type != "DSD") throw new JsError($"Unsupported DSDIFF type: {type}");
        md.SetFormat("container", "DSDIFF/DSD");
        md.SetFormat("lossless", true);
        var remaining = size - 4;
        while (remaining >= 12)
        {
            var (cid, csize) = Header();
            ReadData(cid, csize);
            remaining -= 12 + csize;
        }
    }

    private void ReadData(string id, BigInteger size)
    {
        var p0 = tok.Position;
        switch (Js.Trim(id))
        {
            case "FVER":
                tok.ReadToken(4);
                break;
            case "PROP":
            {
                var propType = FourCc.Get(tok.ReadToken(4), 0);
                if (propType != "SND ") throw new JsError("Unexpected PROP-chunk ID");
                SoundProperties(size - 4);
                break;
            }
            case "ID3":
            {
                var data = tok.ReadToken((int)(double)size);
                Id3v2.Parse(md, new BufferTok(data), true);
                break;
            }
            case "DSD":
            {
                if (Js.Truthy(md.Fmt("numberOfChannels")))
                    md.SetFormat("numberOfSamples", (double)(size * 8 / new BigInteger(Js.ToNumber(md.Fmt("numberOfChannels")))));
                if (Js.Truthy(md.Fmt("numberOfSamples")) && Js.Truthy(md.Fmt("sampleRate")))
                    md.SetFormat("duration", Js.ToNumber(md.Fmt("numberOfSamples")) / Js.ToNumber(md.Fmt("sampleRate")));
                break;
            }
        }
        var left = size - (tok.Position - p0);
        if (left > 0) tok.Ignore((long)(double)left);
    }

    private void SoundProperties(BigInteger remaining)
    {
        while (remaining > 0)
        {
            var (id, size) = Header();
            var p0 = tok.Position;
            switch (Js.Trim(id))
            {
                case "FS":
                    md.SetFormat("sampleRate", (double)tok.ReadToken(4).U32BE(0));
                    break;
                case "CHNL":
                {
                    md.SetFormat("numberOfChannels", (double)tok.ReadToken(2).U16BE(0));
                    var left = size - 2;
                    while (left >= 4) { FourCc.Get(tok.ReadToken(4), 0); left -= 4; }
                    break;
                }
                case "CMPR":
                {
                    var code = Js.Trim(FourCc.Get(tok.ReadToken(4), 0));
                    var count = tok.ReadToken(1).U8At(0);
                    var name = Text.Decode(tok.ReadToken(count), "ascii");
                    if (code == "DSD") { md.SetFormat("lossless", true); md.SetFormat("bitsPerSample", 1.0); }
                    md.SetFormat("codec", $"{code} ({name})");
                    break;
                }
                case "ABSS":
                    tok.ReadToken(2); tok.ReadToken(1); tok.ReadToken(1); tok.ReadToken(4);
                    break;
                case "LSCO":
                    tok.ReadToken(2);
                    break;
                default:
                    tok.Ignore((long)(double)size);
                    break;
            }
            var rest = size - (tok.Position - p0);
            if (rest > 0) tok.Ignore((long)(double)rest);
            remaining -= 12 + size;
        }
    }
}

internal sealed class WavPackParser(Collector md, Tokenizer tok)
{
    private static readonly int[] SampleRates = [6000, 8000, 9600, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 64000, 88200, 96000, 192000, -1];

    public void Parse()
    {
        md.SetAudioOnly();
        do
        {
            var id = FourCc.Get(tok.PeekToken(4), 0);
            if (id != "wvpk") break;
            var h = tok.ReadToken(32);
            if (FourCc.Get(h, 0) != "wvpk") throw new JsError("Invalid WavPack Block-ID");
            long blockSize = h.U32LE(4);
            h.U16LE(8);
            double totalSamples = h.U32LE(12);
            long blockIndex = h.U32LE(16);
            h.U32LE(20);
            var flags = h.U32LE(24);
            var isDsd = (flags >> 31 & 1) == 1;
            if (isDsd) totalSamples *= 8;
            var rate = SampleRates[(int)(flags >> 23 & 0xf)];
            if (blockIndex == 0 && !Js.Truthy(md.Fmt("container")))
            {
                md.SetFormat("container", "WavPack");
                md.SetFormat("lossless", (flags >> 3 & 1) != 1);
                md.SetFormat("bitsPerSample", (double)((1 + (int)(flags & 3)) * 8));
                if (!isDsd)
                {
                    md.SetFormat("sampleRate", (double)rate);
                    md.SetFormat("duration", totalSamples / rate);
                }
                md.SetFormat("numberOfChannels", (flags >> 2 & 1) == 1 ? 1.0 : 2.0);
                md.SetFormat("numberOfSamples", totalSamples);
                md.SetFormat("codec", isDsd ? "DSD" : "PCM");
            }
            var ignore = blockSize - 24;
            if (blockIndex == 0) MetadataSubBlocks(ignore, isDsd, rate, totalSamples);
            else tok.Ignore(ignore);
        } while (tok.Size is not long s || s == 0 || s - tok.Position >= 32);
        Ape.TryParseHeader(md, tok);
    }

    private void MetadataSubBlocks(long remaining, bool isDsd, int rate, double totalSamples)
    {
        while (remaining > 1)
        {
            var idByte = tok.ReadToken(1).At(0);
            var functionId = idByte & 0x3f;
            var oddSize = (idByte & 0x40) != 0;
            var large = (idByte & 0x80) != 0;
            var num = tok.ReadNumber(large ? 3 : 1);
            long words = large ? num.U24LE(0) : num.U8At(0);
            var data = new U8((int)(words * 2 - (oddSize ? 1 : 0)));
            tok.ReadBuffer(data);
            if (functionId == 0xe)
            {
                var mp = 1 << data.U8At(0);
                var sampleRate = (double)rate * mp * 8;
                if (!isDsd) throw new JsError("Only expect DSD block if DSD-flag is set");
                md.SetFormat("sampleRate", sampleRate);
                md.SetFormat("duration", totalSamples / sampleRate);
            }
            remaining -= 1 + (large ? 3 : 1) + words * 2;
            if (oddSize) tok.Ignore(1);
        }
        if (remaining != 0) throw new JsError("metadata-sub-block should fit it remaining length");
    }
}

internal sealed class ApeFileParser(Collector md, Tokenizer tok)
{
    public void Parse()
    {
        var d = tok.ReadToken(52);
        var id = FourCc.Get(d, 0);
        for (var o = 4; o <= 32; o += 4) d.U32LE(o);
        if (id != "MAC ") throw new JsError("Unexpected descriptor ID");
        long descriptorBytes = d.U32LE(8);
        var lenExp = descriptorBytes - 52;
        if (lenExp > 0) tok.Ignore(lenExp);
        var h = tok.ReadToken(24);
        h.U16LE(0); h.U16LE(2);
        double blocksPerFrame = h.U32LE(4);
        double finalFrameBlocks = h.U32LE(8);
        double totalFrames = h.U32LE(12);
        var bits = h.U16LE(16);
        var channels = h.U16LE(18);
        double rate = h.U32LE(20);
        md.SetFormat("lossless", true);
        md.SetFormat("container", "Monkey's Audio");
        md.SetFormat("bitsPerSample", (double)bits);
        md.SetFormat("sampleRate", rate);
        md.SetFormat("numberOfChannels", (double)channels);
        var duration = totalFrames > 1 ? blocksPerFrame * (totalFrames - 1) : 0;
        duration += finalFrameBlocks;
        md.SetFormat("duration", duration / rate);
        var forward = (double)d.U32LE(16) + d.U32LE(20) + d.U32LE(24) + d.U32LE(32);
        md.SetAudioOnly();
        tok.Ignore((long)forward);
        Ape.TryParseHeader(md, tok);
    }
}

internal sealed class AsfParser(Collector md, Tokenizer tok)
{
    private const string HeaderObject = "75B22630-668E-11CF-A6D9-00AA0062CE6C";
    private const string FileProperties = "8CABDCA1-A947-11CF-8EE4-00C00C205365";
    private const string StreamProperties = "B7DC0791-A9B7-11CF-8EE6-00C00C205365";
    private const string HeaderExtension = "5FBF03B5-A92E-11CF-8EE3-00C00C205365";
    private const string CodecList = "86D15240-311D-11D0-A3A4-00A0C90348F6";
    private const string ContentDescription = "75B22633-668E-11CF-A6D9-00AA0062CE6C";
    private const string ExtendedContentDescription = "D2D0A440-E307-11D2-97F0-00A0C95EA850";
    private const string ExtendedStreamProperties = "14E6A5CB-C672-4332-8399-A96952065B5A";
    private const string MetadataObject = "C5F8CBEA-5BAF-4877-8467-AA8C44FA4CCA";
    private const string MetadataLibrary = "44231C94-9498-49D1-A141-1D134E457054";
    private const long MaxObject = 16 * 1024 * 1024;

    private static readonly Dictionary<string, string> MediaTypes = new(StringComparer.Ordinal)
    {
        ["F8699E40-5B4D-11CF-A8FD-00805F5C442B"] = "audio", ["BC19EFC0-5B4D-11CF-A8FD-00805F5C442B"] = "video",
        ["59DACFC0-59E6-11D0-A3AC-00A0C90348F6"] = "command", ["35907DE0-E415-11CF-A917-00805F5C442B"] = "degradable-jpeg",
        ["91BD222C-F21C-497A-8B6D-5AA86BFC0185"] = "file-transfer", ["3AFB65E2-47EF-40F2-AC2C-70A90D71D343"] = "binary"
    };

    public static string Guid(U8 b, int off)
    {
        var s = b.Sub(off, off + 16);
        if (s.Length != 16) throw new JsError("GUID must be exactly 16 bytes");
        string Hx(int i) => s.At(i).ToString("x2", System.Globalization.CultureInfo.InvariantCulture);
        return $"{Hx(3)}{Hx(2)}{Hx(1)}{Hx(0)}-{Hx(5)}{Hx(4)}-{Hx(7)}{Hx(6)}-{Hx(8)}{Hx(9)}-{Hx(10)}{Hx(11)}{Hx(12)}{Hx(13)}{Hx(14)}{Hx(15)}".ToUpperInvariant();
    }

    private (string Id, long Size) ObjectHeader(U8 b)
    {
        var size = (ulong)b.U64LE(16);
        if (size < 24 || size > 9007199254740991UL) throw new JsError($"Invalid ASF header object size: {size}");
        return (Guid(b, 0), (long)size);
    }

    public void Parse()
    {
        var top = tok.ReadToken(30);
        var (id, size) = ObjectHeader(top);
        if (size < 30) throw new JsError($"Invalid ASF top-level header object size: {size}");
        var count = top.U32LE(24);
        if (id != HeaderObject) throw new JsError("expected asf header; but was not found");
        if (count < 1 || count > 10000) throw new JsError($"Unrealistic number of ASF header objects: {count}");
        var remaining = size - 30;
        for (var i = 0; i < count; i++)
        {
            var (oid, osize, payload) = ReadObjectHeader(remaining);
            switch (oid)
            {
                case FileProperties:
                {
                    Limit(payload);
                    var b = tok.ReadToken((int)payload);
                    Guid(b, 0);
                    for (var o = 16; o <= 56; o += 8) b.U64LE(o);
                    var play = (ulong)b.U64LE(40);
                    var preroll = (ulong)b.U64LE(56);
                    b.U32LE(68); b.U32LE(72); b.U32LE(76);
                    md.SetFormat("duration", (double)(play / 1000) / 10000 - (double)preroll / 1000);
                    break;
                }
                case StreamProperties:
                {
                    Limit(payload);
                    var b = tok.ReadToken((int)payload);
                    var media = Guid(b, 0);
                    Guid(b, 8);
                    md.SetFormat("container", $"ASF/{(MediaTypes.TryGetValue(media, out var mt) ? mt : "undefined")}");
                    break;
                }
                case HeaderExtension:
                {
                    if (payload < 22) throw new JsError("ASF Header Extension Object payload is too small");
                    var b = tok.ReadToken(22);
                    Guid(b, 0);
                    b.U16LE(16);
                    long ext = b.U32LE(18);
                    if (ext != payload - 22) throw new JsError("ASF extension data size does not match enclosing payload size");
                    Extension(ext);
                    break;
                }
                case ContentDescription:
                {
                    Limit(payload);
                    var b = tok.ReadToken((int)payload);
                    string[] names = ["Title", "Author", "Copyright", "Description", "Rating"];
                    var pos = 10;
                    var tags = new List<(string, object?)>();
                    for (var n = 0; n < names.Length; n++)
                    {
                        var len = b.U16LE(n * 2);
                        if (len > 0) { tags.Add((names[n], Unicode(b.Sub(pos, pos + len)))); pos += len; }
                    }
                    foreach (var (k, v) in tags) md.AddTag("asf", k, v);
                    break;
                }
                case ExtendedContentDescription:
                {
                    Limit(payload);
                    var b = tok.ReadToken((int)payload);
                    var n = b.U16LE(0);
                    var pos = 2;
                    var tags = new List<(string, object?)>();
                    for (var a = 0; a < n; a++)
                    {
                        var nameLen = b.U16LE(pos); pos += 2;
                        var name = Unicode(b.Sub(pos, pos + nameLen)); pos += nameLen;
                        var type = b.U16LE(pos); pos += 2;
                        var valueLen = b.U16LE(pos); pos += 2;
                        var value = b.Sub(pos, pos + valueLen); pos += valueLen;
                        tags.Add((name, Attribute(b, name, type, value)));
                    }
                    foreach (var (k, v) in tags) md.AddTag("asf", k, v);
                    break;
                }
                case CodecList:
                    Limit(payload);
                    md.SetFormat("codec", Codecs(payload));
                    break;
                default:
                    Skip(payload);
                    break;
            }
            remaining -= osize;
        }
        if (remaining != 0) throw new JsError($"ASF header child objects leave {remaining} payload byte(s) unaccounted");
    }

    private static void Limit(long payload)
    {
        if (payload > MaxObject) throw new JsError("ASF object payload size exceeds allocation limit");
    }

    private void Skip(long payload)
    {
        if (tok.Ignore(payload) != payload) throw new JsError("Unexpected end of ASF object");
    }

    private (string Id, long Size, long Payload) ReadObjectHeader(long remaining)
    {
        if (remaining < 24) throw new JsError($"Insufficient ASF data for an object header: {remaining} bytes");
        var (id, size) = ObjectHeader(tok.ReadToken(24));
        if (size > remaining) throw new JsError("ASF object size exceeds remaining payload size");
        var payload = size - 24;
        if (tok.Size is long fs && payload > fs - tok.Position) throw new JsError("ASF object payload size exceeds available input size");
        return (id, size, payload);
    }

    private void Extension(long size)
    {
        while (size > 0)
        {
            var (id, osize, payload) = ReadObjectHeader(size);
            switch (id)
            {
                case ExtendedStreamProperties:
                {
                    Limit(payload);
                    var b = tok.ReadToken((int)payload);
                    b.U64LE(0); b.U64LE(8);
                    for (var o = 12; o <= 36; o += 4) b.I32LE(o);
                    b.I16LE(42); b.I16LE(44); b.I32LE(52); b.I32LE(54); b.I32LE(56);
                    break;
                }
                case MetadataObject:
                case MetadataLibrary:
                {
                    Limit(payload);
                    var b = tok.ReadToken((int)payload);
                    var n = b.U16LE(0);
                    var pos = 2;
                    var tags = new List<(string, object?)>();
                    for (var r = 0; r < n; r++)
                    {
                        pos += 4;
                        var nameLen = b.U16LE(pos); pos += 2;
                        var type = b.U16LE(pos); pos += 2;
                        long dataLen = b.U32LE(pos); pos += 4;
                        var name = Unicode(b.Sub(pos, pos + nameLen)); pos += nameLen;
                        var end = (int)Math.Min(int.MaxValue, pos + dataLen);
                        var data = b.Sub(pos, end);
                        pos = end;
                        tags.Add((name, Attribute(b, name, type, data)));
                    }
                    foreach (var (k, v) in tags) md.AddTag("asf", k, v);
                    break;
                }
                default:
                    Skip(payload);
                    break;
            }
            size -= osize;
        }
    }

    private static string Unicode(U8 a) => Text.StripNulls(Text.DecodeString(a, "utf-16le"));

    /* State.postProcessTag: the value by its type; WM/Picture read as there (from the object's start). */
    private static object? Attribute(U8 obj, string name, int type, U8 data)
    {
        if (name == "WM/Picture")
        {
            obj.U8At(0);
            obj.I32LE(1);
            var index = 5;
            while (obj.U16BE(index) != 0) index += 2;
            var pic = new JsObj();
            pic["format"] = Text.Decode(data.Sub(5, 5 + (index - 5)), "utf-16le");
            pic["data"] = data.Slice(index + 4);
            return pic;
        }
        return type switch
        {
            0 => Unicode(data),
            1 or 6 => data.Copy(),
            2 => data.U16LE(0) == 1,
            3 => (double)data.U32LE(0),
            4 => (BigInteger)(ulong)data.U64LE(0),
            5 => (double)data.U16LE(0),
            _ => throw new JsError($"unexpected value headerType: {type}")
        };
    }

    private string Codecs(long payload)
    {
        var remaining = payload;
        U8 Take(int len)
        {
            if (len > remaining) throw new JsError("ASF Codec List field size exceeds remaining object payload size");
            var b = tok.ReadToken(len);
            remaining -= len;
            return b;
        }
        var head = Take(20);
        var entries = head.U16LE(16);
        var audio = new List<string>();
        for (var i = 0; i < entries; i++)
        {
            var type = Take(2).U16LE(0);
            var nameLen = Take(2).U16LE(0);
            var name = Text.Decode(Take(nameLen * 2), "utf-16le");
            var nul = name.IndexOf('\0');
            if (nul >= 0) name = name.Remove(nul, 1);
            var descLen = Take(2).U16LE(0);
            Take(descLen * 2);
            var infoLen = Take(2).U16LE(0);
            if (infoLen > remaining) throw new JsError("ASF Codec List field size exceeds remaining object payload size");
            tok.ReadBuffer(new U8(infoLen));
            remaining -= infoLen;
            if ((type & 2) == 2) audio.Add(name);
        }
        if (tok.Ignore(remaining) != remaining) throw new JsError("Unexpected end of ASF Codec List Object");
        return string.Join("/", audio);
    }
}
