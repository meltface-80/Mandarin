// ServicesRescan.cs — Rescan library brings the services' albums up to date too (item 457): the owner tapped Rescan
// library and found it read the music folders only, each service's library updated by its own Update library now or its
// own watch. Now a rescan the owner asks for also asks each signed-in service again, as its Update library now does:
// Qobuz's and Tidal's favourites and purchases where they are in the library (Import.cs), iBroadcast's library where
// it is shown (IBroadcastLibrary.cs). Each runs beside the scan, on its own; one that fails says why in the log, and
// takes nothing else with it.
using Mandarin.Server.Services.IBroadcast;

namespace Mandarin.Server.Services;

internal static class ServicesRescan
{
    /// <summary>Each signed-in service whose albums are in the library asked again, beside the scan: their names, as said.</summary>
    public static List<string> Kick()
    {
        var names = new List<string>();
        if (global::Mandarin.Server.Jobs.Holds("import"))
            foreach (var svc in new Catalogue?[] { global::Mandarin.Server.Jobs.Qobuz, global::Mandarin.Server.Jobs.Tidal, global::Mandarin.Server.Jobs.Spotify }.OfType<Catalogue>())
                if (svc.Connected() && svc.Settings().Import) { names.Add(svc.Name); _ = Run(svc.Name, async () => await svc.ImportLibrary()); }
        if (IBroadcast.IBroadcast.Connected() && IBroadcastLibrary.Shown() && global::Mandarin.Server.Jobs.IBroadcastLibrary is { } lib)
        {
            names.Add("iBroadcast");
            _ = Run("iBroadcast", async () => await lib.Read(true));
        }
        if (names.Count > 0) Server.Log("[scan] rescan: " + string.Join(", ", names) + " brought up to date too");
        return names;
    }

    /* [name]'s update run, what stops it said. */
    private static async Task Run(string name, Func<Task> update)
    {
        try { await update(); }
        catch (Exception e) when (e is ServiceError or Tags.JsError or HttpRequestException or IOException or TaskCanceledException)
        {
            Server.Log($"[scan] rescan: {name} couldn't be brought up to date: {e.Message}");
        }
    }
}
