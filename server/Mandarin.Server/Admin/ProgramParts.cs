// ProgramParts.cs — every part of this program read in before an update puts another program at its path (item 441).
//
// The server is one file (a single-file .NET program): each of its assemblies is read from that file, by its path, the
// first time it is needed, not when the program starts. An update swaps the new program in at that path while this one
// runs on, and stops it to start the new one; a part first needed after the swap (by the stop itself: the host's, the
// database's) was read from the new file at the old one's place in it, past the new file's end, or from the wrong
// bytes: the program died of SIGBUS, never starting the new one (systemd's restart hid it; a run without one stopped).
// (System.Net.Quic.dll, which the web host reaches for as it stops.) So, just before the swap, every assembly the
// program can reach is loaded: nothing is read from that path after it.
using System.Reflection;
using System.Runtime.Loader;

namespace Mandarin.Server.Admin;

internal static class ProgramParts
{
    /// <summary>Every assembly this program can reach, loaded now: those loaded, and all they reference, and all those
    /// reference, to the end (a single-file program has no list of what it carries). Returns how many were loaded here,
    /// and how many were already.</summary>
    public static (int Loaded, int Already) ReadIn()
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var todo = new Queue<Assembly>();
        foreach (var a in AppDomain.CurrentDomain.GetAssemblies())
            if (a.GetName().Name is { } n && seen.Add(n)) todo.Enqueue(a);
        int already = todo.Count, loaded = 0;
        while (todo.Count > 0)
        {
            foreach (var r in todo.Dequeue().GetReferencedAssemblies())
            {
                if (r.Name is not { } n || !seen.Add(n)) continue;
                try { todo.Enqueue(AssemblyLoadContext.Default.LoadFromAssemblyName(r)); loaded++; }
                catch (Exception e) when (e is FileNotFoundException or FileLoadException or BadImageFormatException) { /* not carried: never needed */ }
            }
        }
        return (loaded, already);
    }
}
