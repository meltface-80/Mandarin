// NodePath.cs — Node's path module, posix, to the letter (v0.8.18): the scan
// names folders and albums by these, and what it writes must be what the Node
// server's scan wrote (lib/library/scanner.js), so they are Node's own
// functions (lib/path.js), not .NET's, which differ at the edges.
namespace Mandarin.Server.Scan;

internal static class NodePath
{
    public const char Sep = '/';

    private static string NormalizeString(string path, bool allowAboveRoot)
    {
        var res = "";
        int lastSegmentLength = 0, lastSlash = -1, dots = 0;
        char code = '\0';
        for (int i = 0; i <= path.Length; ++i)
        {
            if (i < path.Length) code = path[i];
            else if (code == '/') break;
            else code = '/';

            if (code == '/')
            {
                if (lastSlash == i - 1 || dots == 1)
                {
                    // nothing
                }
                else if (dots == 2)
                {
                    if (res.Length < 2 || lastSegmentLength != 2 || res[^1] != '.' || res[^2] != '.')
                    {
                        if (res.Length > 2)
                        {
                            var lastSlashIndex = res.LastIndexOf('/');
                            if (lastSlashIndex == -1) { res = ""; lastSegmentLength = 0; }
                            else
                            {
                                res = res[..lastSlashIndex];
                                lastSegmentLength = res.Length - 1 - res.LastIndexOf('/');
                            }
                            lastSlash = i;
                            dots = 0;
                            continue;
                        }
                        else if (res.Length != 0)
                        {
                            res = "";
                            lastSegmentLength = 0;
                            lastSlash = i;
                            dots = 0;
                            continue;
                        }
                    }
                    if (allowAboveRoot)
                    {
                        res += res.Length > 0 ? "/.." : "..";
                        lastSegmentLength = 2;
                    }
                }
                else
                {
                    if (res.Length > 0) res += "/" + path[(lastSlash + 1)..i];
                    else res = path[(lastSlash + 1)..i];
                    lastSegmentLength = i - lastSlash - 1;
                }
                lastSlash = i;
                dots = 0;
            }
            else if (code == '.' && dots != -1) ++dots;
            else dots = -1;
        }
        return res;
    }

    /* path.resolve(...paths) */
    public static string Resolve(params string[] args)
    {
        var resolvedPath = "";
        var resolvedAbsolute = false;
        for (int i = args.Length - 1; i >= -1 && !resolvedAbsolute; i--)
        {
            var path = i >= 0 ? args[i] : Environment.CurrentDirectory;
            if (path.Length == 0) continue;
            resolvedPath = path + "/" + resolvedPath;
            resolvedAbsolute = path[0] == '/';
        }
        resolvedPath = NormalizeString(resolvedPath, !resolvedAbsolute);
        if (resolvedAbsolute) return "/" + resolvedPath;
        return resolvedPath.Length > 0 ? resolvedPath : ".";
    }

    /* path.normalize(path) */
    public static string Normalize(string path)
    {
        if (path.Length == 0) return ".";
        var isAbsolute = path[0] == '/';
        var trailingSeparator = path[^1] == '/';
        path = NormalizeString(path, !isAbsolute);
        if (path.Length == 0)
        {
            if (isAbsolute) return "/";
            return trailingSeparator ? "./" : ".";
        }
        if (trailingSeparator) path += "/";
        return isAbsolute ? "/" + path : path;
    }

    /* path.join(...paths) */
    public static string Join(params string[] args)
    {
        if (args.Length == 0) return ".";
        string? joined = null;
        foreach (var arg in args)
        {
            if (arg.Length == 0) continue;
            joined = joined == null ? arg : joined + "/" + arg;
        }
        return joined == null ? "." : Normalize(joined);
    }

    /* path.relative(from, to) */
    public static string Relative(string from, string to)
    {
        if (from == to) return "";
        from = Resolve(from);
        to = Resolve(to);
        if (from == to) return "";
        const int fromStart = 1;
        int fromEnd = from.Length;
        int fromLen = fromEnd - fromStart;
        const int toStart = 1;
        int toLen = to.Length - toStart;
        int length = fromLen < toLen ? fromLen : toLen;
        int lastCommonSep = -1;
        int i = 0;
        for (; i < length; i++)
        {
            var fromCode = from[fromStart + i];
            if (fromCode != to[toStart + i]) break;
            else if (fromCode == '/') lastCommonSep = i;
        }
        if (i == length)
        {
            if (toLen > length)
            {
                if (to[toStart + i] == '/') return to[(toStart + i + 1)..];
                if (i == 0) return to[(toStart + i)..];
            }
            else if (fromLen > length)
            {
                if (from[fromStart + i] == '/') lastCommonSep = i;
                else if (i == 0) lastCommonSep = 0;
            }
        }
        var outS = "";
        for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i)
        {
            if (i == fromEnd || from[i] == '/') outS += outS.Length == 0 ? ".." : "/..";
        }
        return outS + to[(toStart + lastCommonSep)..];
    }

    /* path.dirname(path) */
    public static string Dirname(string path)
    {
        if (path.Length == 0) return ".";
        var hasRoot = path[0] == '/';
        int end = -1;
        var matchedSlash = true;
        for (int i = path.Length - 1; i >= 1; --i)
        {
            if (path[i] == '/')
            {
                if (!matchedSlash) { end = i; break; }
            }
            else matchedSlash = false;
        }
        if (end == -1) return hasRoot ? "/" : ".";
        if (hasRoot && end == 1) return "//";
        return path[..end];
    }

    /* path.basename(path[, suffix]) */
    public static string Basename(string path, string? suffix = null)
    {
        int start = 0, end = -1;
        var matchedSlash = true;
        if (suffix != null && suffix.Length > 0 && suffix.Length <= path.Length)
        {
            if (suffix == path) return "";
            int extIdx = suffix.Length - 1;
            int firstNonSlashEnd = -1;
            for (int i = path.Length - 1; i >= 0; --i)
            {
                var code = path[i];
                if (code == '/')
                {
                    if (!matchedSlash) { start = i + 1; break; }
                }
                else
                {
                    if (firstNonSlashEnd == -1) { matchedSlash = false; firstNonSlashEnd = i + 1; }
                    if (extIdx >= 0)
                    {
                        if (code == suffix[extIdx]) { if (--extIdx == -1) end = i; }
                        else { extIdx = -1; end = firstNonSlashEnd; }
                    }
                }
            }
            if (start == end) end = firstNonSlashEnd;
            else if (end == -1) end = path.Length;
            return path[start..end];
        }
        for (int i = path.Length - 1; i >= 0; --i)
        {
            if (path[i] == '/')
            {
                if (!matchedSlash) { start = i + 1; break; }
            }
            else if (end == -1) { matchedSlash = false; end = i + 1; }
        }
        if (end == -1) return "";
        return path[start..end];
    }

    /* path.extname(path) */
    public static string Extname(string path)
    {
        int startDot = -1, startPart = 0, end = -1, preDotState = 0;
        var matchedSlash = true;
        for (int i = path.Length - 1; i >= 0; --i)
        {
            var code = path[i];
            if (code == '/')
            {
                if (!matchedSlash) { startPart = i + 1; break; }
                continue;
            }
            if (end == -1) { matchedSlash = false; end = i + 1; }
            if (code == '.')
            {
                if (startDot == -1) startDot = i;
                else if (preDotState != 1) preDotState = 1;
            }
            else if (startDot != -1) preDotState = -1;
        }
        if (startDot == -1 || end == -1 || preDotState == 0 || (preDotState == 1 && startDot == end - 1 && startDot == startPart + 1)) return "";
        return path[startDot..end];
    }

    /* scanner.js isInside: is p the folder dir, or somewhere inside it? */
    public static bool IsInside(string p, string dir) =>
        p == dir || p.StartsWith(dir.EndsWith('/') ? dir : dir + "/", StringComparison.Ordinal);
}
