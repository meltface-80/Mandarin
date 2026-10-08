// Tok.cs — strtok3 10.3.5's tokenizers, for the tag reader (v0.8.13).
//
// Where a read past the end throws End-Of-Stream (and where it quietly reads
// less), how ignore() stops at the end of the file, and how a position is
// kept: each parser was written against these, and stops where they say.
using Microsoft.Win32.SafeHandles;

namespace Mandarin.Server.Tags;

internal sealed class EndOfStream() : JsError("End-Of-Stream");

internal abstract class Tokenizer
{
    public long Position;
    public long? Size;
    public string? Path;

    public abstract int ReadBuffer(U8 into, long? position = null, int? length = null, bool mayBeLess = false);
    public abstract int PeekBuffer(U8 into, long? position = null, int? length = null, bool mayBeLess = false);

    public U8 ReadToken(int len, long? position = null)
    {
        var a = new U8(len);
        var n = ReadBuffer(a, position ?? Position);
        if (n < len) throw new EndOfStream();
        return a;
    }

    public U8 PeekToken(int len, long? position = null)
    {
        var a = new U8(len);
        var n = PeekBuffer(a, position ?? Position);
        if (n < len) throw new EndOfStream();
        return a;
    }

    /* readNumber: into an 8-byte scratch buffer (its length sets the DataView's end). */
    public U8 ReadNumber(int len)
    {
        var a = new U8(8);
        var n = ReadBuffer(a, null, len);
        if (n < len) throw new EndOfStream();
        return a;
    }

    public long Ignore(long length)
    {
        if (length < 0) throw new JsError("ignore length must be >= 0 bytes");
        if (Size is long size)
        {
            var left = size - Position;
            if (length > left) { Position += left; return left; }
        }
        Position += length;
        return length;
    }

    public void SetPosition(long p) => Position = p;
}

internal sealed class FileTok : Tokenizer, IDisposable
{
    private readonly SafeFileHandle handle;

    public FileTok(string path)
    {
        handle = File.OpenHandle(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        Size = RandomAccess.GetLength(handle);
        Path = path;
    }

    private int ReadAt(Span<byte> into, long pos)
    {
        if (pos < 0) throw new JsError("The value of \"position\" is out of range.");
        var total = 0;
        while (total < into.Length)
        {
            var n = RandomAccess.Read(handle, into[total..], pos + total);
            if (n <= 0) break;
            total += n;
        }
        return total;
    }

    public override int ReadBuffer(U8 into, long? position = null, int? length = null, bool mayBeLess = false)
    {
        var pos = position ?? Position;
        var len = length ?? into.Length;
        Position = pos;
        if (len == 0) return 0;
        var n = ReadAt(into.Buf.AsSpan(into.Off, len), pos);
        Position += n;
        if (n < len && !mayBeLess) throw new EndOfStream();
        return n;
    }

    public override int PeekBuffer(U8 into, long? position = null, int? length = null, bool mayBeLess = false)
    {
        var pos = position ?? Position;
        var len = length ?? into.Length;
        var n = len == 0 ? 0 : ReadAt(into.Buf.AsSpan(into.Off, len), pos);
        if (!mayBeLess && n < len) throw new EndOfStream();
        return n;
    }

    public void Dispose() => handle.Dispose();
}

internal sealed class BufferTok : Tokenizer
{
    private readonly U8 data;

    public BufferTok(U8 data) { this.data = data; Size = data.Length; }

    public override int ReadBuffer(U8 into, long? position = null, int? length = null, bool mayBeLess = false)
    {
        // (strtok3 takes a given position only when it isn't 0.)
        if (position is long p && p != 0) Position = p;
        var n = PeekBuffer(into, position, length, mayBeLess);
        Position += n;
        return n;
    }

    public override int PeekBuffer(U8 into, long? position = null, int? length = null, bool mayBeLess = false)
    {
        var pos = position ?? Position;
        var len = length ?? into.Length;
        var n = (int)Math.Min(data.Length - pos, len);
        if (!mayBeLess && n < len) throw new EndOfStream();
        if (n > 0) data.Span.Slice((int)pos, n).CopyTo(into.Buf.AsSpan(into.Off));
        return n;
    }
}
