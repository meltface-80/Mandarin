// QueueStore.cs — the queues the server keeps itself, kept on disk too
// (lib/sonos/queue-store.js, v0.8.49): a phone's and a renderer's queue
// written to the settings table as it changes (what is queued, after a
// moment's pause; where in the track, every ten seconds while it plays) and
// put back when the server starts (Hub.RestoreQueues). The rows are the Node
// server's, key for key ("queue:<id>") and field for field, so a queue one
// server kept is put back by the other across an update.
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Playback;

using AJs = Mandarin.Server.Js;

/* What is kept of a queue: the kind, the track ids, the place, the modes and the volume. */
internal sealed class QueueSnapshot
{
    public string Id = "", Kind = "";          // "phone" | "upnp"
    public string? DeviceId, Name;             // a phone's
    public List<long?> Ids = [];
    public double Index, Seconds;
    public string State = "stopped", Loop = "disabled";
    public bool Shuffle;
    public Volume? VolumeValue;
    public double At;

    public JsonObject Json()
    {
        var o = new JsonObject { ["kind"] = Kind };
        if (Kind == "phone") { o["deviceId"] = DeviceId; o["name"] = Name; }
        o["ids"] = new JsonArray(Ids.Select(i => (JsonNode?)i).ToArray());
        o["index"] = Index; o["seconds"] = Seconds; o["state"] = State;
        o["shuffle"] = Shuffle; o["loop"] = Loop;
        o["volume"] = VolumeValue == null ? null : new JsonObject { ["value"] = VolumeValue.Value, ["muted"] = VolumeValue.Muted };
        o["at"] = At;
        return o;
    }

    public static QueueSnapshot? Parse(string id, JsonNode? n)
    {
        if (n is not JsonObject o || o["ids"] is not JsonArray ids) return null;
        var s = new QueueSnapshot
        {
            Id = id, Kind = AJs.Str(o["kind"]), DeviceId = o["deviceId"] is JsonValue d ? AJs.Str(d) : null,
            Name = o["name"] is JsonValue nm ? AJs.Str(nm) : null,
            Ids = ids.Select(x => x is JsonValue v && v.TryGetValue<double>(out var num) ? (long?)num : null).ToList(),
            Index = Num(o["index"]), Seconds = Num(o["seconds"]),
            State = o["state"] is JsonValue st ? AJs.Str(st) : "stopped",
            Shuffle = AJs.Truthy(o["shuffle"]), Loop = o["loop"] is JsonValue lp ? AJs.Str(lp) : "disabled",
            At = Num(o["at"])
        };
        if (o["volume"] is JsonObject v) s.VolumeValue = new Volume(v["value"] is JsonValue vv && vv.TryGetValue<double>(out var val) ? val : null, AJs.Truthy(v["muted"]));
        return s;
    }

    private static double Num(JsonNode? n) => n is JsonValue v && v.TryGetValue<double>(out var d) ? d : 0;
}

internal sealed class QueueStore
{
    public const string Prefix = "queue:";
    private const int DebounceMs = 300, PositionMs = 10000;
    private readonly Dictionary<string, (Timer Timer, QueueSnapshot Snap)> timers = [];
    private readonly Dictionary<string, double> wroteAt = [];
    private readonly Action<string> log;
    private readonly object gate = new();

    public QueueStore(Action<string> log) { this.log = log; }

    private static string Key(string id) => Prefix + id;

    /* save(id, snap, light): kept after a moment's pause; a position alone every ten seconds. */
    public void Save(string id, QueueSnapshot snap, bool light = false)
    {
        lock (gate)
        {
            var had = timers.TryGetValue(id, out var t);
            if (light && had) return;
            var since = Hub.Now() - wroteAt.GetValueOrDefault(id);
            var wait = light ? Math.Max(DebounceMs, PositionMs - since) : DebounceMs;
            if (had) t.Timer.Dispose();
            Timer? timer = null;
            timer = new Timer(_ =>
            {
                lock (gate) { if (timers.TryGetValue(id, out var cur) && cur.Timer == timer) timers.Remove(id); else return; }
                Write(id, snap);
            }, null, (int)wait, Timeout.Infinite);
            timers[id] = (timer, snap);
        }
    }

    private void Write(string id, QueueSnapshot snap)
    {
        try
        {
            using var c = Db.Open();
            SetSetting(c, Key(id), snap.Json());
            lock (gate) wroteAt[id] = Hub.Now();
        }
        catch (Exception e) when (e is SqliteException or IOException) { log($"[queues] couldn't keep the queue of {id}: {e.Message}"); }
    }

    /* Nothing queued any more: nothing to put back. */
    public void Forget(string id)
    {
        lock (gate) { if (timers.Remove(id, out var t)) t.Timer.Dispose(); }
        try
        {
            using var c = Db.Open();
            using var cmd = c.CreateCommand();
            cmd.CommandText = "DELETE FROM settings WHERE key = $k";
            cmd.Parameters.AddWithValue("$k", Key(id));
            cmd.ExecuteNonQuery();
        }
        catch (Exception e) when (e is SqliteException or IOException) { /* nothing to forget */ }
    }

    /* Every kept queue, each with its zone id. */
    public List<QueueSnapshot> All()
    {
        var out_ = new List<QueueSnapshot>();
        try
        {
            using var c = Db.Open();
            foreach (var r in Library.Rows(c, "SELECT key, value FROM settings WHERE key LIKE $1", Prefix + "%"))
            {
                var key = (string)r[0]!;
                JsonNode? n;
                try { n = JsonNode.Parse((string)r[1]!); } catch (System.Text.Json.JsonException) { continue; }
                if (QueueSnapshot.Parse(key[Prefix.Length..], n) is { } snap) out_.Add(snap);
            }
        }
        catch (Exception e) when (e is SqliteException or IOException) { log($"[queues] {e.Message}"); }
        return out_;
    }

    /* Write whatever is still waiting (the server is stopping cleanly). */
    public void Flush(Func<string, QueueSnapshot?> build)
    {
        List<string> ids;
        lock (gate) { ids = timers.Keys.ToList(); foreach (var (t, _) in timers.Values) t.Dispose(); timers.Clear(); }
        foreach (var id in ids) if (build(id) is { } snap) Write(id, snap);
    }

    /* db.setSetting(key, value): the JSON the Node server writes (JSON.stringify). */
    public static void SetSetting(SqliteConnection c, string key, JsonNode? value)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO settings(key, value) VALUES($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
        cmd.Parameters.AddWithValue("$k", key);
        cmd.Parameters.AddWithValue("$v", value == null ? "null" : value.ToJsonString(Jsons.Out));
        cmd.ExecuteNonQuery();
    }
}

/* JSON written as the Node server writes it: no escaping past what JSON needs. */
internal static class Jsons
{
    public static readonly System.Text.Json.JsonSerializerOptions Out = new() { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
}
