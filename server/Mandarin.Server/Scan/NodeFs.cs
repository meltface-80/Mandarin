// NodeFs.cs — the file system as Node's fs module sees it (v0.8.18), for the
// scan: a folder's entries in the order fs.readdir gives them (libuv's
// scandir sorts them byte by byte, where .NET gives the disk's own order),
// each entry's type as a Dirent has it, and stat's times to the nanosecond
// (mtimeMs is seconds × 1000 + nanoseconds ÷ 10⁶, as a double: .NET keeps
// only tenths of a microsecond, and a cover's fingerprint is made from it).
using System.Runtime.InteropServices;
using System.Text;

namespace Mandarin.Server.Scan;

internal enum EntryType { Unknown, File, Dir, Link, Other }

internal readonly record struct Entry(string Name, EntryType Type);

/* What fs.statSync says of a path: what it is, its size, and mtimeMs. */
internal readonly record struct Stat(EntryType Type, double Size, double MtimeMs)
{
    public bool IsDirectory => Type == EntryType.Dir;
    public bool IsFile => Type == EntryType.File;
}

internal sealed class FsError(string message) : IOException(message);

internal static unsafe partial class NodeFs
{
    [LibraryImport("libc", EntryPoint = "opendir", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
    private static partial nint OpenDir(string name);

    [LibraryImport("libc", EntryPoint = "readdir", SetLastError = true)]
    private static partial nint ReadDir(nint dir);

    [LibraryImport("libc", EntryPoint = "closedir")]
    private static partial int CloseDir(nint dir);

    [LibraryImport("libc", EntryPoint = "statx", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
    private static partial int Statx(int dirfd, string path, int flags, uint mask, byte* buf);

    [LibraryImport("libc", EntryPoint = "realpath", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
    private static partial nint RealPath(string path, nint resolved);

    [LibraryImport("libc", EntryPoint = "free")]
    private static partial void Free(nint p);

    private const int AtFdCwd = -100;
    private const int AtSymlinkNoFollow = 0x100;
    private const uint StatxBasicStats = 0x7ff;

    // struct dirent (glibc and musl, 64-bit): d_ino, d_off, d_reclen, d_type, d_name.
    private const int DType = 18, DName = 19;

    private static EntryType FromDType(byte t) => t switch
    {
        4 => EntryType.Dir,
        8 => EntryType.File,
        10 => EntryType.Link,
        0 => EntryType.Unknown,
        _ => EntryType.Other
    };

    private static EntryType FromMode(int mode) => (mode & 0xF000) switch
    {
        0x4000 => EntryType.Dir,
        0x8000 => EntryType.File,
        0xA000 => EntryType.Link,
        _ => EntryType.Other
    };

    private static int ByteOrder(byte[] a, byte[] b)
    {
        var n = Math.Min(a.Length, b.Length);
        for (var i = 0; i < n; i++) if (a[i] != b[i]) return a[i] - b[i];
        return a.Length - b.Length;
    }

    private static string Error(string what, string path, int errno) =>
        $"{ErrName(errno)}: {Marshal.GetPInvokeErrorMessage(errno).ToLowerInvariant()}, {what} '{path}'";

    private static string ErrName(int errno) => errno switch
    {
        1 => "EPERM", 2 => "ENOENT", 5 => "EIO", 13 => "EACCES", 20 => "ENOTDIR", 40 => "ELOOP", 116 => "ESTALE", 110 => "ETIMEDOUT", 107 => "ENOTCONN",
        _ => "E" + errno
    };

    /*
     * fs.readdir(dir, { withFileTypes: true }): every entry but "." and "..",
     * byte order, each with its type (an entry the folder doesn't type is
     * looked at, as Node does). Throws as Node throws when it can't be read.
     */
    public static List<Entry> ReadDir(string dir)
    {
        var raw = new List<(byte[] Name, byte Type)>();
        var d = OpenDir(dir);
        if (d == 0) throw new FsError(Error("scandir", dir, Marshal.GetLastPInvokeError()));
        try
        {
            while (true)
            {
                Marshal.SetLastPInvokeError(0);
                var e = ReadDir(d);
                if (e == 0)
                {
                    var err = Marshal.GetLastPInvokeError();
                    if (err != 0) throw new FsError(Error("scandir", dir, err));
                    break;
                }
                var p = (byte*)e;
                var len = 0;
                while (p[DName + len] != 0) len++;
                if (len == 1 && p[DName] == '.') continue;
                if (len == 2 && p[DName] == '.' && p[DName + 1] == '.') continue;
                var name = new byte[len];
                for (var i = 0; i < len; i++) name[i] = p[DName + i];
                raw.Add((name, p[DType]));
            }
        }
        finally { CloseDir(d); }
        raw.Sort((a, b) => ByteOrder(a.Name, b.Name));
        var outList = new List<Entry>(raw.Count);
        foreach (var (nameBytes, type) in raw)
        {
            var name = Encoding.UTF8.GetString(nameBytes);
            var t = FromDType(type);
            if (t == EntryType.Unknown)
            {
                var full = dir.EndsWith('/') ? dir + name : dir + "/" + name;
                t = TryStat(full, follow: false, out var st) ? st.Type : EntryType.Unknown;
            }
            outList.Add(new Entry(name, t));
        }
        return outList;
    }

    /* fs.readdirSync(dir): the names alone. */
    public static List<string> ReadDirNames(string dir) => ReadDir(dir).Select(e => e.Name).ToList();

    private static bool haveStatx = true;

    /* fs.statSync (follow) or fs.lstatSync; false where it would throw. */
    public static bool TryStat(string path, bool follow, out Stat st)
    {
        st = default;
        if (haveStatx)
        {
            try
            {
                var buf = stackalloc byte[256];
                if (Statx(AtFdCwd, path, follow ? 0 : AtSymlinkNoFollow, StatxBasicStats, buf) != 0) return false;
                int mode = *(ushort*)(buf + 28);
                ulong size = *(ulong*)(buf + 40);
                long sec = *(long*)(buf + 112);
                uint nsec = *(uint*)(buf + 120);
                // lib/internal/fs/utils.js msFromTimeSpec: sec * 1e3 + nsec / 1e6.
                st = new Stat(FromMode(mode), size, sec * 1e3 + nsec / 1e6);
                return true;
            }
            catch (EntryPointNotFoundException) { haveStatx = false; }
        }
        // A C library without statx: .NET's own, to a tenth of a microsecond.
        try
        {
            FileSystemInfo fi = new FileInfo(path);
            if (!follow && fi.LinkTarget != null) { st = new Stat(EntryType.Link, 0, Ms(fi.LastWriteTimeUtc)); return true; }
            if (follow && fi.LinkTarget != null) { var t = fi.ResolveLinkTarget(true); if (t == null || !t.Exists) return false; fi = t; }
            if (Directory.Exists(fi.FullName)) { var di = new DirectoryInfo(fi.FullName); st = new Stat(EntryType.Dir, 4096, Ms(di.LastWriteTimeUtc)); return true; }
            if (!fi.Exists) return false;
            st = new Stat(EntryType.File, ((FileInfo)fi).Length, Ms(fi.LastWriteTimeUtc));
            return true;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException) { return false; }
    }

    private static double Ms(DateTime utc) => (utc - DateTime.UnixEpoch).Ticks / 1e4;

    /* fs.existsSync */
    public static bool Exists(string path) => path.Length > 0 && TryStat(path, follow: true, out _);

    /* fs.realpathSync; null where it would throw. */
    public static string? RealPathOf(string path)
    {
        var p = RealPath(path, 0);
        if (p == 0) return null;
        try { return Marshal.PtrToStringUTF8(p); }
        finally { Free(p); }
    }
}
