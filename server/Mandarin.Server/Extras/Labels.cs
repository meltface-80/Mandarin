// Labels.cs — the record labels' background work, as this server holds it
// (v0.8.20): the lookups (LabelLookup.cs) and the logos (LabelLogos.cs),
// made here once the Node server has handed them over (Jobs.cs). The routes
// that show them and start them are LabelRoutes.cs.
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Extras;

using Js = Mandarin.Server.Tags.Js;

internal static class Labels
{
    public static LabelLookup? Lookup { get; set; }
    public static LabelLogos? Logos { get; set; }

    /* db.setting(key): the stored JSON as JSON.parse reads it, undefined when there's none (or it won't parse). */
    public static object? Setting(string key)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT value FROM settings WHERE key = $k";
        cmd.Parameters.AddWithValue("$k", key);
        if (cmd.ExecuteScalar() is not string v) return Undef.V;
        try { return JsJson.Parse(v); } catch (Exception) { return Undef.V; }
    }

    /* db.setSetting(key, value): JSON.stringify's text. */
    public static void SetSetting(string key, object? value)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO settings(key, value) VALUES($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
        cmd.Parameters.AddWithValue("$k", key);
        cmd.Parameters.AddWithValue("$v", Js.Json(value) ?? "null");
        cmd.ExecuteNonQuery();
    }
}
