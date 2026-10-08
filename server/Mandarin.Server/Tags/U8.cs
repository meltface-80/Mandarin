// U8.cs — a Uint8Array as the tag reader's JavaScript had it (v0.8.13).
//
// A view on a buffer: subarray() shares the buffer, slice() copies it. Index
// past the view's end reads as undefined; the integer readers (token-types,
// through a DataView from the view's start to the BUFFER's end) read on past
// the view and fail only at the buffer's end, as the Node reader's did. Text
// is decoded the way @borewit/text-codec 0.2.2 decodes it.
using System.Buffers.Binary;
using System.Numerics;
using System.Text;

namespace Mandarin.Server.Tags;

internal sealed class U8
{
    public readonly byte[] Buf;
    public readonly int Off;
    public readonly int Length;

    public U8(byte[] buf, int off, int length) { Buf = buf; Off = off; Length = length; }
    public U8(byte[] buf) : this(buf, 0, buf.Length) { }
    public U8(int length) : this(new byte[length]) { }

    public static readonly U8 Empty = new([]);

    public byte At(int i) => Buf[Off + i];
    /* arr[i]: undefined past the end. */
    public int? Get(int i) => i >= 0 && i < Length ? Buf[Off + i] : null;
    public void Put(int i, byte b) => Buf[Off + i] = b;
    public ReadOnlySpan<byte> Span => Buf.AsSpan(Off, Length);

    private static int Rel(int i, int len) => i < 0 ? Math.Max(len + i, 0) : Math.Min(i, len);

    /* subarray(start, end): the same buffer. */
    public U8 Sub(int start, int? end = null)
    {
        var a = Rel(start, Length);
        var b = end is int e ? Rel(e, Length) : Length;
        return new U8(Buf, Off + a, Math.Max(b - a, 0));
    }

    /* slice(start, end): a copy. */
    public U8 Slice(int start, int? end = null)
    {
        var s = Sub(start, end);
        return new U8(s.Span.ToArray());
    }

    public U8 Copy() => new(Span.ToArray());

    public int IndexOf(byte b, int from = 0)
    {
        if (from < 0) from = Math.Max(Length + from, 0);
        for (var i = from; i < Length; i++) if (Buf[Off + i] == b) return i;
        return -1;
    }

    // DataView reads: from the view's start to the buffer's end.
    private int Dv(int off, int n)
    {
        var abs = (long)Off + off;
        if (off < 0 || abs + n > Buf.Length) throw new JsError("Offset is outside the bounds of the DataView");
        return (int)abs;
    }
    public int U8At(int off) => Buf[Dv(off, 1)];
    public int I8At(int off) => (sbyte)Buf[Dv(off, 1)];
    public int U16BE(int off) => BinaryPrimitives.ReadUInt16BigEndian(Buf.AsSpan(Dv(off, 2)));
    public int U16LE(int off) => BinaryPrimitives.ReadUInt16LittleEndian(Buf.AsSpan(Dv(off, 2)));
    public int I16BE(int off) => BinaryPrimitives.ReadInt16BigEndian(Buf.AsSpan(Dv(off, 2)));
    public int I16LE(int off) => BinaryPrimitives.ReadInt16LittleEndian(Buf.AsSpan(Dv(off, 2)));
    public int U24BE(int off) { Dv(off, 3); return (U16BE(off) << 8) + U8At(off + 2); }
    public int U24LE(int off) { Dv(off, 3); return U8At(off) + (U16LE(off + 1) << 8); }
    public int I24BE(int off)
    {
        Dv(off, 3);
        var unsigned = U16BE(off) * 256 + U8At(off + 2);
        return (unsigned & 0x800000) != 0 ? unsigned - 0x1000000 : unsigned;
    }
    public uint U32BE(int off) => BinaryPrimitives.ReadUInt32BigEndian(Buf.AsSpan(Dv(off, 4)));
    public uint U32LE(int off) => BinaryPrimitives.ReadUInt32LittleEndian(Buf.AsSpan(Dv(off, 4)));
    public int I32BE(int off) => BinaryPrimitives.ReadInt32BigEndian(Buf.AsSpan(Dv(off, 4)));
    public int I32LE(int off) => BinaryPrimitives.ReadInt32LittleEndian(Buf.AsSpan(Dv(off, 4)));
    public BigInteger U64LE(int off) => BinaryPrimitives.ReadUInt64LittleEndian(Buf.AsSpan(Dv(off, 8)));
    public BigInteger U64BE(int off) => BinaryPrimitives.ReadUInt64BigEndian(Buf.AsSpan(Dv(off, 8)));
    public BigInteger I64LE(int off) => BinaryPrimitives.ReadInt64LittleEndian(Buf.AsSpan(Dv(off, 8)));
    public BigInteger I64BE(int off) => BinaryPrimitives.ReadInt64BigEndian(Buf.AsSpan(Dv(off, 8)));
}

/* @borewit/text-codec's textDecode, and music-metadata's decodeString (common/Util.js). */
internal static class Text
{
    private static readonly UTF8Encoding Utf8 = new(false, false);
    private static readonly Dictionary<int, char> W1252 = new()
    {
        [0x80] = '€', [0x82] = '‚', [0x83] = 'ƒ', [0x84] = '„', [0x85] = '…', [0x86] = '†', [0x87] = '‡', [0x88] = 'ˆ',
        [0x89] = '‰', [0x8a] = 'Š', [0x8b] = '‹', [0x8c] = 'Œ', [0x8e] = 'Ž', [0x91] = '‘', [0x92] = '’', [0x93] = '“',
        [0x94] = '”', [0x95] = '•', [0x96] = '–', [0x97] = '—', [0x98] = '˜', [0x99] = '™', [0x9a] = 'š', [0x9b] = '›',
        [0x9c] = 'œ', [0x9e] = 'ž', [0x9f] = 'Ÿ'
    };

    public static string Decode(U8 bytes, string encoding = "utf-8")
    {
        var span = bytes.Span;
        switch (encoding.ToLowerInvariant())
        {
            case "utf-8":
            case "utf8":
                // TextDecoder("utf-8"): a leading BOM is dropped, bad bytes become U+FFFD.
                if (span.Length >= 3 && span[0] == 0xEF && span[1] == 0xBB && span[2] == 0xBF) span = span[3..];
                return Utf8.GetString(span);
            case "utf-16le":
                return Utf16Le(span);
            case "us-ascii":
            case "ascii":
            {
                var c = new char[span.Length];
                for (var i = 0; i < span.Length; i++) c[i] = (char)(span[i] & 0x7f);
                return new string(c);
            }
            case "latin1":
            case "iso-8859-1":
            {
                var c = new char[span.Length];
                for (var i = 0; i < span.Length; i++) c[i] = (char)span[i];
                return new string(c);
            }
            case "windows-1252":
            {
                var c = new char[span.Length];
                for (var i = 0; i < span.Length; i++) c[i] = W1252.TryGetValue(span[i], out var x) ? x : (char)span[i];
                return new string(c);
            }
            default:
                throw new JsError($"Encoding '{encoding}' not supported");
        }
    }

    private static string Utf16Le(ReadOnlySpan<byte> b)
    {
        var sb = new StringBuilder(b.Length / 2);
        var i = 0;
        while (i + 1 < b.Length)
        {
            var u1 = b[i] | (b[i + 1] << 8);
            i += 2;
            if (u1 >= 0xD800 && u1 <= 0xDBFF)
            {
                if (i + 1 < b.Length)
                {
                    var u2 = b[i] | (b[i + 1] << 8);
                    if (u2 >= 0xDC00 && u2 <= 0xDFFF) { sb.Append((char)u1).Append((char)u2); i += 2; }
                    else sb.Append('\uFFFD');
                }
                else sb.Append('\uFFFD');
                continue;
            }
            if (u1 >= 0xDC00 && u1 <= 0xDFFF) { sb.Append('\uFFFD'); continue; }
            sb.Append((char)u1);
        }
        if (i < b.Length) sb.Append('\uFFFD');
        return sb.ToString();
    }

    private static U8 SwapInPlace(U8 a)
    {
        if ((a.Length & 1) != 0) throw new JsError("Buffer length must be even");
        for (var i = 0; i < a.Length; i += 2)
        {
            var x = a.At(i);
            a.Put(i, a.At(i + 1));
            a.Put(i + 1, x);
        }
        return a;
    }

    /* Util.decodeString: a BOM's ways, as the Node reader takes them. */
    public static string DecodeString(U8 a, string encoding)
    {
        if (a.Get(0) == 0xff && a.Get(1) == 0xfe) return DecodeString(a.Sub(2), encoding);
        if (encoding == "utf-16le" && a.Get(0) == 0xfe && a.Get(1) == 0xff)
        {
            if ((a.Length & 1) != 0) throw new JsError("Expected even number of octets for 16-bit unicode string");
            return DecodeString(SwapInPlace(a), encoding);
        }
        if (encoding == "utf-16be")
        {
            if ((a.Length & 1) != 0) throw new JsError("Expected even number of octets for 16-bit unicode string");
            return Decode(SwapInPlace(a.Copy()), "utf-16le");
        }
        return Decode(a, encoding);
    }

    /* Util.findZero */
    public static int FindZero(U8 a, string encoding)
    {
        var len = a.Length;
        if (encoding == "utf-16le" || encoding == "utf-16be")
        {
            for (var i = 0; i + 1 < len; i += 2) if (a.At(i) == 0 && a.At(i + 1) == 0) return i;
            return len;
        }
        for (var i = 0; i < len; i++) if (a.At(i) == 0) return i;
        return len;
    }

    public static string TrimRightNull(string x)
    {
        var p = x.IndexOf('\0');
        return p == -1 ? x : x[..p];
    }

    /* Util.stripNulls: leading and trailing NULs. */
    public static string StripNulls(string s)
    {
        int a = 0, b = s.Length;
        while (a < b && s[a] == '\0') a++;
        while (b > a && s[b - 1] == '\0') b--;
        return s[a..b];
    }
}
