// Updater.Swap.cs — this program of the new version, and the order an update puts things in (bug list item 180).
//
// The new program is fetched and checked first (Prepare), and kept beside the running one (<bin>.new); nothing is
// changed if it can't be had, nor if a folder or file the bundle is laid over, or the program's folder, can't be
// written: refused before anything is laid in, never part way through. The bundle's files are
// laid in next, and the program swapped in last: the running one kept as <bin>.prev, the new one put in its place,
// <bin>.version written. Anything that fails before the swap leaves the old program (the files laid in so far stay,
// the old program serving them); anything that fails after it puts <bin>.prev back, and the <bin>.version there was.
// Until then, a scan the server starts runs the old program, as the rest of the install is.
using System.Runtime.InteropServices;

namespace Mandarin.Server.Admin;

internal sealed partial class Updater
{
    [LibraryImport("libc", EntryPoint = "access", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
    private static partial int Access(string path, int mode);

    private static bool Writable(string d)
    {
        try { return Access(d, 2) == 0; }
        catch (Exception e) when (e is EntryPointNotFoundException or DllNotFoundException) { return true; }
    }

    /* The program this one runs from: told (the tests) or its own file. */
    public static string BinPath() => Env("MANDARIN_SERVER_BIN") ?? Environment.ProcessPath ?? "";

    /*
     * csharp-update.js prepare: this program of the version being installed,
     * fetched and checked before the update stages anything, beside the running
     * one (its path; null with its updates switched off); throws, and nothing
     * has changed, when it can't be had or the install can't be written where
     * [staged] would be laid over it.
     */
    private async Task<string?> Prepare(string staged, string target)
    {
        var (platform, arch) = Machine();
        var mac = platform == "darwin";
        var getAgain = GetAgain(mac);
        if (Unwritable(staged, dir) is { } locked) throw new UpdateError($"{locked} can't be written to; {getAgain} instead");
        if (Env("MANDARIN_SERVER_UPDATE") == "0") return null;
        if (Build() == null) throw new UpdateError($"no C# server is built for this machine ({platform} {arch}); the update would leave it behind");
        var bin = BinPath();
        if (bin.Length == 0 || !File.Exists(bin)) throw new UpdateError($"no C# server at {bin}");
        var binDir = Path.GetDirectoryName(bin) ?? ".";
        if (!Writable(binDir)) throw new UpdateError($"{binDir} can't be written to; {getAgain} instead");
        log($"[update] fetching the C# server {target} before the update");
        try { return await FetchProgram(bin, target, mac); }
        catch (Exception e)
        {
            throw new UpdateError($"the C# server {target} couldn't be fetched ({e.Message}); nothing was changed");
        }
    }

    /* The first of the install's folders and files [staged] would be laid over (as CopyOverlay lays it) that can't be written, or null. */
    private static string? Unwritable(string staged, string into)
    {
        if (!Writable(into)) return into;
        foreach (var name in Directory.GetFileSystemEntries(staged).Select(Path.GetFileName).OfType<string>().Order(StringComparer.Ordinal))
        {
            if (Skip.Contains(name)) continue;
            string s = Path.Combine(staged, name), d = Path.Combine(into, name);
            if (Directory.Exists(s)) { if (Directory.Exists(d) && Unwritable(s, d) is { } inside) return inside; }
            else if (File.Exists(d) && !Writable(d)) return d;
        }
        return null;
    }

    /* The staged bundle laid over the install, then [next] (the new program, or null) swapped in for this one. */
    private void LayIn(string staged, string? next, string target)
    {
        try { ApplyStaged(staged, dir); }
        catch
        {
            if (next != null) { try { File.Delete(next); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* left behind */ } }
            throw;
        }
        if (next != null) Swap(next, BinPath(), target);
    }

    /* [next] in place of [bin], [bin] kept as <bin>.prev; on any failure, [bin] and its .version as they were. */
    private void Swap(string next, string bin, string target)
    {
        string prev = bin + ".prev", marker = bin + ".version";
        var wasMarker = File.Exists(marker) ? File.ReadAllText(marker) : null;
        File.Copy(bin, prev, overwrite: true);
        try
        {
            File.Move(next, bin, overwrite: true);
            File.WriteAllText(marker, target + "\n");
        }
        catch
        {
            Restore(bin, prev, next, marker, wasMarker);
            throw;
        }
        log($"[update] the C# server {target} is in place, the one before kept as {Path.GetFileName(prev)}; it starts with the update");
    }

    private void Restore(string bin, string prev, string next, string marker, string? wasMarker)
    {
        try
        {
            File.Move(prev, bin, overwrite: true);
            if (wasMarker != null) File.WriteAllText(marker, wasMarker);
            else if (File.Exists(marker)) File.Delete(marker);
            if (File.Exists(next)) File.Delete(next);
            log("[update] the update stopped once the C# server was swapped in; the one before is back");
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            log($"[update] the C# server before couldn't be put back ({e.Message}); it is at {prev}");
        }
    }
}
