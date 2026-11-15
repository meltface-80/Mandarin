// Library.AutoCover.cs — a cover the cover finder found (Extras/AutoCovers.cs,
// item 409) kept as Edit album keeps one you chose (AlbumEditRoutes.cs): in
// album_edits, its source "auto:…", told, and the sizes drawn of the album's
// old cover gone, so the next ask draws the new one.
//
// Kept only where the album still has nothing of its own in album_edits and
// the owner hasn't had the last word on its cover: looked at and written under
// the edits' own lock, so an edit made meanwhile is never written over.
using System.Text.Json.Nodes;
using Mandarin.Server.Extras;

namespace Mandarin.Server;

internal static partial class Library
{
    /* The album's track titles, in playing order, corrected titles laid over the tagged ones (as the editor's search reads them). */
    internal static List<object?> TrackTitles(Snapshot s, Album al)
    {
        using var c = Db.Open();
        return Tracks(c, s, al).Select(t => (object?)t.Title).ToList();
    }

    /* The app's name and version, as the catalogues are told it. */
    internal static string Version => AppVersion;

    /*
     * [art] (a found cover, made ready by FoundCover) kept as the album's cover
     * from [source] (auto:itunes, auto:deezer, auto:caa). False when the album
     * has a cover in album_edits by now, or its cover is the owner's.
     */
    internal static async Task<bool> KeepAutoCover(Album al, byte[] art, string source)
    {
        lock (EditGate)
        {
            using (var c = Db.Open())
            using (var cmd = c.CreateCommand())
            {
                cmd.CommandText = "SELECT 1 FROM album_edits WHERE key = $k AND art IS NOT NULL";
                cmd.Parameters.AddWithValue("$k", al.Key);
                if (cmd.ExecuteScalar() != null) return false;
            }
            if (AutoCoverStore.IsOwners(al.Key)) return false;
            SaveEditNow(al, new EditFields { HasArt = true, Art = art, ArtSource = source });
        }
        await Tell(new JsonObject { ["edits"] = true });
        // The sizes drawn for its placeholder go: its address now names the found cover.
        if (await Current() is var (s, _) && s.Find(al.Id) is { } now && now.ImageKey != al.ImageKey && Images.ArtDir.Length > 0)
            Covers.Forget(Images.ArtDir, al.Id, now.ImageKey);
        return true;
    }
}
