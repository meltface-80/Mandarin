// BuiltInKeys.cs — Mandarin's own keys for AcoustID and FanArt.tv (item 491), as their developers mean them to be used:
// an application's key, registered once by its developer and carried in the program, so nobody using Mandarin is asked
// for one. Put in at build time from the repository's secrets (server/build.sh: MANDARIN_ACOUSTID_KEY and
// MANDARIN_FANART_KEY, as assembly metadata), never written in the source, which is public. A build made without them
// (from source) carries none, and a key saved on the server (one pasted before item 491, or a test's) is used first.
using System.Reflection;

namespace Mandarin.Server;

internal static class BuiltInKeys
{
    private static readonly Dictionary<string, string> Carried = typeof(BuiltInKeys).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>()
        .Where(a => a.Key is "AcoustIdKey" or "FanartKey" && !string.IsNullOrWhiteSpace(a.Value))
        .ToDictionary(a => a.Key, a => a.Value!.Trim(), StringComparer.Ordinal);

    // The tests' (MANDARIN_CONFIG's acoustid_built_in and fanart_built_in): a build's own, without building one.
    private static string? acoustId, fanart;

    /// <summary>The configuration's stand-ins for the build's keys, where it has them (Jobs.cs).</summary>
    public static void Configure(string? acoustIdKey, string? fanartKey) { acoustId = acoustIdKey; fanart = fanartKey; }

    /// <summary>Mandarin's AcoustID application key; "" in a build without one.</summary>
    public static string AcoustId => acoustId ?? Carried.GetValueOrDefault("AcoustIdKey") ?? "";

    /// <summary>Mandarin's FanArt.tv project key; "" in a build without one.</summary>
    public static string Fanart => fanart ?? Carried.GetValueOrDefault("FanartKey") ?? "";

    /// <summary>Which the build carries, by name, never the keys: `mandarin-server --built-in-keys`, as the workflows check it.</summary>
    public static string Said() => string.Join(" ", new[] { ("acoustid", Carried.ContainsKey("AcoustIdKey")), ("fanart", Carried.ContainsKey("FanartKey")) }
        .Select(k => k.Item1 + (k.Item2 ? "=yes" : "=no")));
}
