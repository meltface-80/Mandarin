using System.Buffers.Binary;
using System.Text;

namespace Mandarin.Tests;

/// <summary>The tag layouts ffmpeg doesn't write, built byte by byte (test/tagfixtures.js's byte builders, in C#).</summary>
public static partial class TagFixtures
{
    private static byte[] U8(params int[] a) => [.. a.Select(x => (byte)x)];
    private static byte[] Cat(params byte[][] parts) => [.. parts.SelectMany(p => p)];
    private static byte[] Be32(long n) { var b = new byte[4]; BinaryPrimitives.WriteUInt32BigEndian(b, unchecked((uint)n)); return b; }
    private static byte[] Le32(long n) { var b = new byte[4]; BinaryPrimitives.WriteUInt32LittleEndian(b, unchecked((uint)n)); return b; }
    private static byte[] Syncsafe(int n) => U8((n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f);
    private static byte[] Latin1(string s) => Encoding.Latin1.GetBytes(s);
    private static byte[] Utf8(string s) => Encoding.UTF8.GetBytes(s);
    private static byte[] Utf16(string s) => Cat(U8(0xff, 0xfe), Encoding.Unicode.GetBytes(s));
    private static byte[] Utf16be(string s) => Encoding.BigEndianUnicode.GetBytes(s);

    private static byte[] F22(string id, byte[] body) => Cat(Latin1(id), Be32(body.Length)[1..], body);
    private static byte[] F23(string id, byte[] body, int flags = 0) => Cat(Latin1(id), Be32(body.Length), U8(flags >> 8, flags & 0xff), body);
    private static byte[] F24(string id, byte[] body, int flags = 0) => Cat(Latin1(id), Syncsafe(body.Length), U8(flags >> 8, flags & 0xff), body);
    private static byte[] Tag(int major, byte[][] frames, int flags = 0, byte[]? ext = null, int padding = 0)
    {
        var body = Cat([ext ?? [], .. frames, new byte[padding]]);
        return Cat(Latin1("ID3"), U8(major, 0, flags), Syncsafe(body.Length), body);
    }
    private static byte[] Txt(int enc, string s) => Cat(U8(enc), enc == 0 ? Latin1(s) : enc == 1 ? Utf16(s) : enc == 2 ? Utf16be(s) : Utf8(s));

    private static byte[][] Rich23() =>
    [
        F23("TIT2", Txt(1, "Rich Title ü")), F23("TPE1", Txt(0, "AC/DC")), F23("TPE2", Txt(0, "Album Artist")),
        F23("TALB", Txt(1, "Album – Ünïcode")), F23("TRCK", Txt(0, "4/10")), F23("TPOS", Txt(0, "2/3")),
        F23("TCON", Txt(0, "(17)Rock")), F23("TYER", Txt(0, "2011")), F23("TORY", Txt(0, "1977")), F23("TPUB", Txt(1, "Big Label")),
        F23("TSRC", Txt(0, "USRC17607839")), F23("TCMP", Txt(0, "1")), F23("TBPM", Txt(0, "120")), F23("TSO2", Txt(0, "Artist, Album")),
        F23("TXXX", Cat(U8(1), Utf16("MusicBrainz Album Id"), U8(0, 0), Utf16("0b9d1a8f-5c2e-4b4d-9f8c-1a2b3c4d5e6f"))),
        F23("TXXX", Cat(U8(0), Latin1("BARCODE\0"), Latin1("0 39841 50052 3"))),
        F23("TXXX", Cat(U8(0), Latin1("CATALOGNUMBER\0"), Latin1("ABC/123"))),
        F23("TXXX", Cat(U8(0), Latin1("REPLAYGAIN_TRACK_GAIN\0"), Latin1("-7.21 dB"))),
        F23("TXXX", Cat(U8(0), Latin1("REPLAYGAIN_TRACK_PEAK\0"), Latin1("0.988159"))),
        F23("TXXX", Cat(U8(0), Latin1("REPLAYGAIN_ALBUM_GAIN\0"), Latin1("-6.50dB"))),
        F23("TXXX", Cat(U8(0), Latin1("RELEASECOUNTRY\0"), Latin1("GB"))),
        F23("TXXX", Cat(U8(0), Latin1("\0"), Latin1("no description"))),
        F23("TXXX", Cat(U8(0), Latin1("LONG\0"), Latin1(new string('x', 5000)))),
        F23("UFID", Cat(Latin1("http://musicbrainz.org\0"), Latin1("9ab1c2d3-e4f5-6789-abcd-ef0123456789"))),
        F23("POPM", Cat(Latin1("Windows Media Player 9 Series\0"), U8(196), Be32(12))),
        F23("PCNT", Be32(1234567)),
        F23("COMM", Cat(U8(1), Latin1("eng"), U8(0xff, 0xfe, 0, 0), Utf16("Comment one"))),
        F23("COMM", Cat(U8(0), Latin1("engiTunPGAP\0"), Latin1("1"))),
        F23("USLT", Cat(U8(0), Latin1("eng\0"), Latin1("Line one\nLine two"))),
        F23("SYLT", Cat(U8(0), Latin1("eng"), U8(2, 1), Latin1("sync\0La\0"), Be32(1000), Latin1("Lo\0"), Be32(2000))),
        F23("WXXX", Cat(U8(0), Latin1("Site\0https://example.com/x"))),
        F23("WOAR", Latin1("https://artist.example.com")),
        F23("PRIV", Cat(Latin1("AverageLevel\0"), U8(0x10, 0x20, 0x30, 0x40))),
        F23("PRIV", Cat(Latin1("PeakValue\0"), U8(1, 2, 3))),
        F23("GEOB", Cat(U8(0), Latin1("text/plain\0a.txt\0obj\0hello"))),
        F23("MCDI", [.. Enumerable.Range(0, 20).Select(i => (byte)i)]),
        F23("IPLS", Txt(0, "producer\0P One")),
        F23("APIC", Cat(U8(0), Latin1("image/jpeg\0"), U8(3), Latin1("\0"), U8(0xff, 0xd8, 0xff)))
    ];

    private static byte[][] Rich24()
    {
        var chapTitle = F24("TIT2", Txt(3, "Chapter 1"));
        var tocTitle = F24("TIT2", Txt(3, "TOC"));
        return
        [
            F24("TIT2", Txt(3, "UTF8 Tïtle")), F24("TPE1", Txt(3, "First\0Second")), F24("TALB", Txt(2, "UTF16BE Älbum")),
            F24("TRCK", Txt(0, "7")), F24("TDRC", Txt(0, "2011-04-02")), F24("TDOR", Txt(0, "1977")),
            F24("TCON", Txt(0, "(17)Rock\0Jazz")), F24("TIPL", Txt(3, "producer\0P One\0engineer\0E One,E Two")),
            F24("TMCL", Txt(3, "guitar\0G Player")), F24("TXXX", Cat(U8(3), Utf8("Artists\0A\0B"))),
            F24("TXXX", Cat(U8(0), Latin1("MusicBrainz Release Group Id\0"), Latin1("11111111-2222-3333-4444-555555555555"))),
            // Unsynchronised, and with a data length indicator.
            F24("TPE2", Cat(U8(0), Latin1("Un\xff\0\0sync")), 0x0002),
            F24("TCOM", Cat(Syncsafe(9), U8(0), Latin1("Composer")), 0x0001),
            F24("CHAP", Cat(Latin1("ch1\0"), Be32(0), Be32(1000), Be32(0xffffffff), Be32(0xffffffff), chapTitle)),
            F24("CTOC", Cat(Latin1("toc\0"), U8(3, 1), Latin1("ch1\0"), tocTitle)),
            F24("PCST", Txt(0, "")), F24("TKEY", Txt(0, "Am"))
        ];
    }

    // APEv2: items, with a header (and the footer) as most writers make them.
    private static byte[] Ape((string K, byte[] V, int Flags)[] items, bool header = true)
    {
        var body = Cat([.. items.Select(x => Cat(Le32(x.V.Length), Le32(x.Flags), Latin1(x.K + "\0"), x.V))]);
        int size = body.Length + 32;
        byte[] Part(bool isHeader) => Cat(Latin1("APETAGEX"), Le32(2000), Le32(size), Le32(items.Length), Le32((header ? 1L << 31 : 0L) | (isHeader ? 1L << 29 : 0L)), new byte[8]);
        return Cat(header ? Part(true) : [], body, Part(false));
    }
    private static (string, byte[], int) Item(string k, string v, int flags = 0) => (k, Utf8(v), flags);

    private static byte[] Id3v1(string title = "V1 Title", int track = 5)
    {
        static byte[] Pad(string s, int n) => Cat(Latin1(s), new byte[n])[..n];
        return Cat(Latin1("TAG"), Pad(title, 30), Pad("V1 Artist", 30), Pad("V1 Album", 30), Latin1("1984"), Pad("cmt", 28), U8(0, track, 17));
    }

    // FLAC: the metadata blocks of an ffmpeg-made file, its comment block replaced.
    private static byte[] VorbisComment(string[] comments, string vendor = "test vendor")
    {
        var parts = new List<byte[]> { Le32(Encoding.UTF8.GetByteCount(vendor)), Utf8(vendor), Le32(comments.Length) };
        foreach (var c in comments) { var b = Utf8(c); parts.Add(Le32(b.Length)); parts.Add(b); }
        return Cat([.. parts]);
    }
    private static byte[] FlacWithComments(string src, string[] comments, params (int Type, byte[] Body)[] extraBlocks)
    {
        var buf = File.ReadAllBytes(src);
        int off = 4;
        var blocks = new List<(int Type, byte[] Body)>();
        for (; ; )
        {
            int last = buf[off] & 0x80, type = buf[off] & 0x7f, len = (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3];
            if (type != 4) blocks.Add((type, buf[(off + 4)..(off + 4 + len)]));
            off += 4 + len;
            if (last != 0) break;
        }
        blocks.InsertRange(1, [(4, VorbisComment(comments)), .. extraBlocks]);
        var output = new List<byte[]> { Latin1("fLaC") };
        for (int i = 0; i < blocks.Count; i++)
        {
            var (t, body) = blocks[i];
            output.Add(U8((i == blocks.Count - 1 ? 0x80 : 0) | t, (body.Length >> 16) & 0xff, (body.Length >> 8) & 0xff, body.Length & 0xff));
            output.Add(body);
        }
        output.Add(buf[off..]);
        return Cat([.. output]);
    }
    private static (int, byte[]) FlacPicture()
    {
        byte[] mime = Latin1("image/png"), data = Cat(U8(0x89, 0x50, 0x4e, 0x47), new byte[32]);
        return (6, Cat(Be32(3), Be32(mime.Length), mime, Be32(0), Be32(1), Be32(1), Be32(24), Be32(0), Be32(data.Length), data));
    }

    private static byte[] Dsf(bool withTag, int rate = 2822400)
    {
        var audio = Enumerable.Repeat((byte)0x69, 4096 * 2).ToArray();
        var t = withTag ? Tag(4, [F24("TIT2", Txt(3, "DSD Title")), F24("TPE1", Txt(3, "DSD Artist")), F24("TRCK", Txt(3, "2"))]) : [];
        var fmt = new byte[52]; Latin1("fmt ").CopyTo(fmt, 0); BinaryPrimitives.WriteUInt64LittleEndian(fmt.AsSpan(4), 52);
        uint[] vals = [1, 0, 2, 2, (uint)rate, 1];
        for (int i = 0; i < vals.Length; i++) BinaryPrimitives.WriteUInt32LittleEndian(fmt.AsSpan(12 + i * 4), vals[i]);
        BinaryPrimitives.WriteUInt64LittleEndian(fmt.AsSpan(36), (ulong)rate * 2); BinaryPrimitives.WriteUInt32LittleEndian(fmt.AsSpan(44), 4096);
        var data = new byte[12]; Latin1("data").CopyTo(data, 0); BinaryPrimitives.WriteUInt64LittleEndian(data.AsSpan(4), (ulong)(12 + audio.Length));
        long total = 28 + 52 + 12 + audio.Length + t.Length;
        var hdr = new byte[28]; Latin1("DSD ").CopyTo(hdr, 0); BinaryPrimitives.WriteUInt64LittleEndian(hdr.AsSpan(4), 28); BinaryPrimitives.WriteUInt64LittleEndian(hdr.AsSpan(12), (ulong)total);
        BinaryPrimitives.WriteUInt64LittleEndian(hdr.AsSpan(20), withTag ? (ulong)(28 + 52 + 12 + audio.Length) : 0);
        return Cat(hdr, fmt, data, audio, t);
    }

    private static byte[] Dff(bool withTag)
    {
        static byte[] Chunk(string id, byte[] body) { var h = new byte[12]; Latin1(id).CopyTo(h, 0); BinaryPrimitives.WriteInt64BigEndian(h.AsSpan(4), body.Length); return Cat(h, body); }
        var prop = Chunk("PROP", Cat(Latin1("SND "), Chunk("FS  ", Be32(2822400)), Chunk("CHNL", Cat(U8(0, 2), Latin1("SLFTSRGT"))),
            Chunk("CMPR", Cat(Latin1("DSD "), U8(14), Latin1("not compressed"), U8(0))), Chunk("ABSS", new byte[8]), Chunk("LSCO", U8(0, 0))));
        var body = Cat(Latin1("DSD "), Chunk("FVER", Be32(0x01050000)), prop, Chunk("DSD ", Enumerable.Repeat((byte)0x69, 2822400 / 8 * 2).ToArray()));
        if (withTag)
        {
            var t = Tag(4, [F24("TIT2", Txt(3, "DFF Title")), F24("TPE1", Txt(3, "DFF Artist"))]);
            if (t.Length % 2 != 0) t = Cat(t, U8(0));
            body = Cat(body, Chunk("ID3 ", t));
        }
        return Chunk("FRM8", body);
    }

    private static byte[] Monkeys(bool withTag)
    {
        var audio = new byte[64];
        var desc = Cat(Latin1("MAC "), Le32(3990), Le32(52), Le32(24), Le32(0), Le32(0), Le32(audio.Length), Le32(0), Le32(0), new byte[16]);
        var hdr = new byte[24];
        BinaryPrimitives.WriteUInt16LittleEndian(hdr.AsSpan(0), 2000); BinaryPrimitives.WriteUInt32LittleEndian(hdr.AsSpan(4), 73728);
        BinaryPrimitives.WriteUInt32LittleEndian(hdr.AsSpan(8), 1000); BinaryPrimitives.WriteUInt32LittleEndian(hdr.AsSpan(12), 10);
        BinaryPrimitives.WriteUInt16LittleEndian(hdr.AsSpan(16), 16); BinaryPrimitives.WriteUInt16LittleEndian(hdr.AsSpan(18), 2); BinaryPrimitives.WriteUInt32LittleEndian(hdr.AsSpan(20), 44100);
        return Cat(desc, hdr, audio, withTag ? Ape([Item("Title", "Monkey Title"), Item("Artist", "Monkey Artist"), Item("Track", "3/7"), Item("Year", "2003")]) : []);
    }
}
