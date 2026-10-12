// Register.cs — the audio_devices table: every player Mandarin has met
// (lib/renderers/registry.js, v0.8.49, stage 6). A row per device — a Sonos
// room, a phone running the app, a UPnP renderer, a sound device on this
// computer — with the name its own network gives it, the name you gave it
// here, what it is, what it can take (caps, in layers) and its settings. The
// rows are written as registry.js writes them, field for field. Nothing
// leaves by itself: a device off for a month is still here until Forget.
using System.Text.Json.Nodes;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Playback;

using AJs = Mandarin.Server.Js;
using TJs = Mandarin.Server.Tags.Js;

/* A row as registry.js's row() reads it: caps and settings as objects. */
internal sealed class DeviceRecord
{
    public string Id = "", Kind = "", Family = "", NetworkName = "", Manufacturer = "", Model = "", ModelNumber = "", Firmware = "", Ip = "", Location = "";
    public string? Name;
    public JsObj Caps = new(), Settings = new();
    public double FirstSeen, LastSeen;
}

/* What a device says of itself as it is seen (discovery's record, a room's, a phone's). */
internal sealed class SeenInfo
{
    public string Id { get; set; } = "";
    public string Kind { get; set; } = "";
    public string? Family { get; set; }
    public string? NetworkName { get; set; }
    public string? Manufacturer { get; set; }
    public string? Model { get; set; }
    public string? ModelNumber { get; set; }
    public string? Firmware { get; set; }
    public string? Ip { get; set; }
    public string? Location { get; set; }
    public JsObj? Caps { get; set; }            // { advertised: … }
    public bool? Playable { get; set; }
    public bool? Openhome { get; set; }
    public JsObj? Services { get; set; }
    public JsObj? Events { get; set; }
    public JsObj? Linkplay { get; set; }
}

internal static class Register
{
    public const int NameMax = 60;

    /* cleanName(v): control characters out, trimmed, at most 60 characters. */
    public static string CleanName(object? v)
    {
        var s = TJs.Str(Jv.Nullish(v) ? "" : v);
        var sb = new System.Text.StringBuilder(s.Length);
        foreach (var ch in s) if (ch > '\u001f') sb.Append(ch);
        var t = TJs.Trim(sb.ToString());
        return t.Length > NameMax ? t[..NameMax] : t;
    }

    private static JsObj ParseJson(object? s)
    {
        if (s is not string text) return new JsObj();
        try { return JsJson.Parse(text) as JsObj ?? new JsObj(); } catch (JsError) { return new JsObj(); }
    }

    private static DeviceRecord Row(object?[] r, Dictionary<string, int> col)
    {
        object? F(string n) => col.TryGetValue(n, out var i) ? r[i] : null;
        string S(string n) => F(n) as string ?? "";
        return new DeviceRecord
        {
            Id = S("id"), Kind = S("kind"), Family = S("family"), NetworkName = S("network_name"), Name = F("name") as string,
            Manufacturer = S("manufacturer"), Model = S("model"), ModelNumber = S("model_number"), Firmware = S("firmware"),
            Ip = S("ip"), Location = S("location"), Caps = ParseJson(F("caps")), Settings = ParseJson(F("settings")),
            FirstSeen = F("first_seen") is long fs ? fs : 0, LastSeen = F("last_seen") is long ls ? ls : 0
        };
    }

    private static Dictionary<string, int> Cols(SqliteConnection c)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT * FROM audio_devices LIMIT 0";
        using var r = cmd.ExecuteReader(System.Data.CommandBehavior.SchemaOnly);
        var col = new Dictionary<string, int>();
        for (int i = 0; i < r.FieldCount; i++) col[r.GetName(i)] = i;
        return col;
    }

    public static List<DeviceRecord> All(SqliteConnection c)
    {
        var col = Cols(c);
        return Library.Rows(c, "SELECT * FROM audio_devices ORDER BY network_name COLLATE NOCASE").Select(r => Row(r, col)).ToList();
    }

    public static DeviceRecord? Get(SqliteConnection c, string? id)
    {
        var rows = Library.Rows(c, "SELECT * FROM audio_devices WHERE id = $1", id ?? "");
        return rows.Count == 0 ? null : Row(rows[0], Cols(c));
    }

    /* nameOf(id): the name you gave it, or null. */
    public static string? NameOf(SqliteConnection c, string id)
    {
        var rows = Library.Rows(c, "SELECT name FROM audio_devices WHERE id = $1", id);
        return rows.Count > 0 && rows[0][0] is string s && s.Length > 0 ? s : null;
    }

    /*
     * A device is on the network (again). Identity fields are only overwritten
     * with something, and the caps written here are the advertised layer; yours
     * and the verified ones are kept.
     */
    public static DeviceRecord? Seen(SqliteConnection c, SeenInfo info)
    {
        var now = (long)Hub.Now();
        var cur = Get(c, info.Id);
        string Keep(string? v, string? was) => v != null && TJs.Trim(v).Length > 0 ? TJs.Trim(v) : was ?? "";
        var caps = new JsObj();
        if (cur != null) foreach (var k in cur.Caps.Keys) caps[k] = cur.Caps[k];
        if (info.Caps != null && Jv.T(info.Caps["advertised"])) caps["advertised"] = info.Caps["advertised"];
        if (info.Playable != null) caps["playable"] = info.Playable.Value;
        if (info.Services != null) caps["services"] = info.Services;
        if (info.Openhome != null) caps["openhome"] = info.Openhome.Value;
        if (info.Events != null) caps["events"] = info.Events;
        if (info.Linkplay != null) caps["linkplay"] = info.Linkplay;
        var networkName = CleanName(info.NetworkName) is { Length: > 0 } nn ? nn : cur?.NetworkName is { Length: > 0 } cn ? cn : "Unnamed device";
        var kind = info.Kind.Length > 0 ? info.Kind : cur?.Kind is { Length: > 0 } ck ? ck : "upnp";
        using var cmd = c.CreateCommand();
        cmd.CommandText = cur != null
            ? "UPDATE audio_devices SET kind = $kind, family = $family, network_name = $network_name, manufacturer = $manufacturer, model = $model, model_number = $model_number, firmware = $firmware, ip = $ip, location = $location, caps = $caps, last_seen = $now WHERE id = $id"
            : "INSERT INTO audio_devices(id, kind, family, network_name, manufacturer, model, model_number, firmware, ip, location, caps, settings, first_seen, last_seen) VALUES($id, $kind, $family, $network_name, $manufacturer, $model, $model_number, $firmware, $ip, $location, $caps, $settings, $now, $now)";
        cmd.Parameters.AddWithValue("$id", info.Id);
        cmd.Parameters.AddWithValue("$kind", kind);
        cmd.Parameters.AddWithValue("$family", Keep(info.Family, cur?.Family));
        cmd.Parameters.AddWithValue("$network_name", networkName);
        cmd.Parameters.AddWithValue("$manufacturer", Keep(info.Manufacturer, cur?.Manufacturer));
        cmd.Parameters.AddWithValue("$model", Keep(info.Model, cur?.Model));
        cmd.Parameters.AddWithValue("$model_number", Keep(info.ModelNumber, cur?.ModelNumber));
        cmd.Parameters.AddWithValue("$firmware", Keep(info.Firmware, cur?.Firmware));
        cmd.Parameters.AddWithValue("$ip", Keep(info.Ip, cur?.Ip));
        cmd.Parameters.AddWithValue("$location", Keep(info.Location, cur?.Location));
        cmd.Parameters.AddWithValue("$caps", TJs.Json(caps) ?? "{}");
        cmd.Parameters.AddWithValue("$settings", TJs.Json(cur?.Settings ?? new JsObj()) ?? "{}");
        cmd.Parameters.AddWithValue("$now", now);
        cmd.ExecuteNonQuery();
        return Get(c, info.Id);
    }

    /* Still here (a Sonos room read from the household, a phone polling). */
    public static void Touch(SqliteConnection c, string id, string? networkName = null)
    {
        var cur = Get(c, id);
        if (cur == null) return;
        using var cmd = c.CreateCommand();
        cmd.CommandText = "UPDATE audio_devices SET last_seen = $t, network_name = $n WHERE id = $id";
        cmd.Parameters.AddWithValue("$t", (long)Hub.Now());
        cmd.Parameters.AddWithValue("$n", CleanName(networkName) is { Length: > 0 } nn ? nn : cur.NetworkName);
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
    }

    /* setSettings(id, patch): merged over what is there; a key set to null is dropped. */
    public static DeviceRecord? SetSettings(SqliteConnection c, string id, JsObj patch)
    {
        var cur = Get(c, id);
        if (cur == null) return null;
        var next = new JsObj();
        foreach (var k in cur.Settings.Keys) next[k] = cur.Settings[k];
        foreach (var k in patch.Keys) next[k] = patch[k];
        var dropped = new JsObj();
        foreach (var k in next.Keys) if (!Jv.Nullish(next[k])) dropped[k] = next[k];
        using var cmd = c.CreateCommand();
        cmd.CommandText = "UPDATE audio_devices SET settings = $s WHERE id = $id";
        cmd.Parameters.AddWithValue("$s", TJs.Json(dropped) ?? "{}");
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
        return Get(c, id);
    }

    /* Something the device itself confirmed: { rate?, bits? } at now. */
    public static void MarkVerified(SqliteConnection c, string id, double? rate, double? bits)
    {
        var cur = Get(c, id);
        if (cur == null) return;
        var caps = new JsObj();
        foreach (var k in cur.Caps.Keys) caps[k] = cur.Caps[k];
        var v = caps["verified"] as JsObj ?? new JsObj();
        var rates = v["rates"] as JsObj ?? new JsObj();
        var bitsV = v["bits"] as JsObj ?? new JsObj();
        var when = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture);
        if (rate is > 0) rates[TJs.Num(rate.Value)] = when;
        if (bits is > 0) bitsV[TJs.Num(bits.Value)] = when;
        var next = new JsObj(); next["rates"] = rates; next["bits"] = bitsV;
        foreach (var k in v.Keys) if (k is not ("rates" or "bits")) next[k] = v[k];
        caps["verified"] = next;
        WriteCaps(c, id, caps);
    }

    public static void WriteCaps(SqliteConnection c, string id, JsObj caps)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = "UPDATE audio_devices SET caps = $c WHERE id = $id";
        cmd.Parameters.AddWithValue("$c", TJs.Json(caps) ?? "{}");
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
    }

    public static void Rename(SqliteConnection c, string id, string? name)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = "UPDATE audio_devices SET name = $n WHERE id = $id";
        cmd.Parameters.AddWithValue("$n", CleanName(name) is { Length: > 0 } n ? n : DBNull.Value);
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
    }

    /* Gone for good — until it is seen again, when it starts fresh. */
    public static void Forget(SqliteConnection c, string id)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = "DELETE FROM audio_devices WHERE id = $id";
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
    }
}
