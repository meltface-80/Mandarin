// Lastfm.Kept.cs — Last.fm's answers kept in the database as well (its cache
// table, "lastfm"), for the week they are kept in memory (Lastfm.cs): the
// server started again (an update, a restart) has them still, where Last.fm
// was asked again — an album's similar albums are ten calls, three to four
// seconds. A week's, no more: older ones go as each new one comes. Failures
// aren't kept here; nor is anything for the tests' client alone
// (LastfmCommand.cs), which has no database.
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Extras;

internal sealed partial class Lastfm
{
    private const string Ns = "lastfm";

    /* Kept in the database too (the server's own client, Jobs.cs). */
    public bool KeptInDb { get; init; }

    private static string DbKey(string kind, string artist) => kind + ":" + Names.JsTrim(artist).ToLowerInvariant();

    /* An answer kept from an earlier run, under a week old: when it was had, and what. */
    private (long At, object? Value)? Stored(string kind, string artist)
    {
        if (!KeptInDb) return null;
        try
        {
            using var c = Db.Open();
            using var cmd = c.CreateCommand();
            cmd.CommandText = "SELECT value, ts FROM cache WHERE ns = $n AND key = $k AND ts > $old";
            cmd.Parameters.AddWithValue("$n", Ns);
            cmd.Parameters.AddWithValue("$k", DbKey(kind, artist));
            cmd.Parameters.AddWithValue("$old", Now - Ttl);
            using var r = cmd.ExecuteReader();
            if (!r.Read() || JsonNode.Parse(r.GetString(0)) is not JsonObject o) return null;
            object? value = kind == "similar" ? SimilarOf(o) : AlbumOf(o["album"] as JsonObject);
            return (r.GetInt64(1), value);
        }
        catch (Exception e) when (e is SqliteException or JsonException or InvalidOperationException) { return null; }
    }

    /* An answer kept for the next run. */
    private void Store(string kind, string artist, object? value)
    {
        if (!KeptInDb) return;
        try
        {
            using var c = Db.Open();
            using var cmd = c.CreateCommand();
            cmd.CommandText = "DELETE FROM cache WHERE ns = $n AND ts <= $old; " +
                "INSERT INTO cache(ns, key, value, ts) VALUES($n, $k, $v, $t) ON CONFLICT(ns, key) DO UPDATE SET value = excluded.value, ts = excluded.ts";
            cmd.Parameters.AddWithValue("$n", Ns);
            cmd.Parameters.AddWithValue("$k", DbKey(kind, artist));
            cmd.Parameters.AddWithValue("$v", Json(value).ToJsonString());
            cmd.Parameters.AddWithValue("$t", Now);
            cmd.Parameters.AddWithValue("$old", Now - Ttl);
            cmd.ExecuteNonQuery();
        }
        catch (SqliteException) { /* kept in memory alone */ }
    }

    /* Everything kept forgotten (a new key, Clear). */
    private void Unstore()
    {
        if (!KeptInDb) return;
        try
        {
            using var c = Db.Open();
            using var cmd = c.CreateCommand();
            cmd.CommandText = "DELETE FROM cache WHERE ns = $n";
            cmd.Parameters.AddWithValue("$n", Ns);
            cmd.ExecuteNonQuery();
        }
        catch (SqliteException) { /* gone with the database */ }
    }

    private static JsonObject Json(object? value) => value switch
    {
        LastfmSimilar s => new JsonObject
        {
            ["artist"] = s.Artist, ["url"] = s.Url,
            ["artists"] = new JsonArray(s.Artists.Select(a => (JsonNode?)new JsonObject { ["name"] = a.Name, ["url"] = a.Url, ["match"] = a.Match, ["image"] = a.Image }).ToArray()),
        },
        LastfmAlbum a => new JsonObject { ["album"] = new JsonObject { ["title"] = a.Title, ["artist"] = a.Artist, ["url"] = a.Url, ["image"] = a.Image } },
        _ => new JsonObject { ["album"] = null },
    };

    private static string Text(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : "";

    private static LastfmSimilar SimilarOf(JsonObject o) => new(Text(o["artist"]), Text(o["url"]),
        [.. (o["artists"] as JsonArray ?? []).OfType<JsonObject>().Select(a =>
            new LastfmArtist(Text(a["name"]), Text(a["url"]), a["match"] is JsonValue m && m.TryGetValue<double>(out var x) ? x : 0, Text(a["image"])))]);

    private static LastfmAlbum? AlbumOf(JsonObject? a) => a == null ? null : new(Text(a["title"]), Text(a["artist"]), Text(a["url"]), Text(a["image"]));
}
