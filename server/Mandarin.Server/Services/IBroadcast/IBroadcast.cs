// IBroadcast.cs — the iBroadcast account (item 443): signed in with a code shown in Settings → Services → iBroadcast and
// approved on iBroadcast, what the account is (its name, whether it is Premium, the formats iBroadcast takes), and
// signed out again (the sign-in let go at iBroadcast too). Kept in the setting "ibroadcast":
//   { token: { access, refresh, expires, scope }, user: { id, name }, premium, formats, checked, since }
// The tokens are never logged or shown. A sign-in under way lives here, in memory: iBroadcast asked at the interval it
// gave until the code is approved, turned down or expired, or the sign-in is let go. What iBroadcast's account answer
// holds is said in the log by its names once (never its values), for the parts it doesn't document.
using System.Text.Json.Nodes;

namespace Mandarin.Server.Services.IBroadcast;

internal sealed class IBroadcast
{
    /// <summary>The setting the account is kept in.</summary>
    public const string Key = "ibroadcast";

    /// <summary>iBroadcast's servers, asked with this account's tokens.</summary>
    public IBroadcastApi Api { get; }

    private sealed class Pending
    {
        public required IBroadcastApi.DeviceCode Code;
        public double Expires;
        public double Interval;
        public Timer? Timer;
        public string? Error;
    }

    private readonly object gate = new();
    private Pending? pending;

    /// <summary>The account, asked of iBroadcast's servers, or of [testBase]'s stand-in.</summary>
    public IBroadcast(string? testBase) => Api = new IBroadcastApi(testBase, () => Account()?["token"] as JsonObject, KeepToken);

    /// <summary>The account as kept; null when signed out.</summary>
    public static JsonObject? Account()
    {
        using var c = Db.Open();
        return Db.Setting(c, Key) as JsonObject;
    }

    /// <summary>Signed in: a token kept.</summary>
    public static bool Connected() => IBroadcastApi.Str(Account()?["token"]?["access"]) != null;

    private static void Save(JsonObject? account)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = account == null ? "DELETE FROM settings WHERE key = $k"
            : "INSERT INTO settings(key, value) VALUES($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
        cmd.Parameters.AddWithValue("$k", Key);
        if (account != null) cmd.Parameters.AddWithValue("$v", account.ToJsonString());
        cmd.ExecuteNonQuery();
    }

    private static void KeepToken(JsonObject t)
    {
        if (Account() is not { } a) return;
        a["token"] = t;
        Save(a);
    }

    /// <summary>A sign-in begun: a code from iBroadcast to approve there; one under way that hasn't failed or expired, as it is.</summary>
    public async Task<JsonObject> BeginSignIn()
    {
        if (Connected()) return Status();
        lock (gate) if (pending is { Error: null } p && IBroadcastApi.Now() < p.Expires) return Status();
        CancelSignIn();
        var code = await Api.BeginDevice();
        var next = new Pending { Code = code, Expires = IBroadcastApi.Now() + code.ExpiresIn * 1000, Interval = code.Interval };
        lock (gate) pending = next;
        Later(next);
        Server.Log("[ibroadcast] sign-in begun: waiting for the code to be approved on iBroadcast");
        return Status();
    }

    private void Later(Pending p)
    {
        lock (gate)
        {
            if (pending != p) return;
            p.Timer?.Dispose();
            p.Timer = new Timer(_ => _ = Ask(p), null, TimeSpan.FromSeconds(p.Interval), Timeout.InfiniteTimeSpan);
        }
    }

    /* iBroadcast asked once: not yet, asked again; approved, the account kept; refused or expired, said on the page. */
    private async Task Ask(Pending p)
    {
        try
        {
            lock (gate)
            {
                if (pending != p) return;
                if (IBroadcastApi.Now() > p.Expires) { p.Error = "The code expired: sign in again for a new one"; return; }
            }
            var (token, slower) = await Api.PollDevice(p.Code.Code);
            lock (gate) if (pending != p) return;
            if (token == null)
            {
                if (slower) p.Interval += 5;
                Later(p);
                return;
            }
            await Finish(token);
        }
        catch (Exception e)
        {
            lock (gate) if (pending == p) p.Error = e is ServiceError ? e.Message : "The sign-in failed: " + e.Message;
            Server.Log("[ibroadcast] sign-in: " + (e is ServiceError ? e.Message : e.GetType().Name + ": " + e.Message));
        }
    }

    private async Task Finish(JsonObject token)
    {
        Save(new JsonObject { ["token"] = token, ["since"] = IBroadcastApi.Now() });
        CancelSignIn();
        try { await Describe(); }
        catch (ServiceError e) { Server.Log("[ibroadcast] signed in; the account couldn't be read: " + e.Message); return; }
        Server.Log($"[ibroadcast] signed in as {new Personal(IBroadcastApi.Str(Account()?["user"]?["name"]) ?? "the account")}");
    }

    /// <summary>The account read again from iBroadcast: its name, whether it is Premium, the formats it takes; kept.</summary>
    public async Task<JsonObject> Describe()
    {
        var j = await Api.Json("status", new JsonObject { ["supported_types"] = true });
        var user = j["user"] as JsonObject;
        var a = Account() ?? throw new ServiceError("Not signed in to iBroadcast", 401);
        a["user"] = new JsonObject
        {
            ["id"] = user?["id"]?.DeepClone(),
            ["name"] = new[] { "username", "user_name", "email_address", "email", "name" }.Select(k => IBroadcastApi.Str(user?[k])).FirstOrDefault(s => s != null),
        };
        a["premium"] = Premium(user);
        a["formats"] = new JsonArray([.. Formats(j).Select(f => (JsonNode?)f)]);
        a["checked"] = IBroadcastApi.Now();
        Save(a);
        Server.Log("[ibroadcast] the account answer holds: " + string.Join(", ", j.Select(kv => kv.Key)) + "; its user: " + string.Join(", ", (user ?? []).Select(kv => kv.Key)));
        return a;
    }

    /* Premium as the account answer says it (user.premium, a flag or 0/1); null where it doesn't. */
    private static bool? Premium(JsonObject? user) => user?["premium"] is JsonValue v
        ? v.TryGetValue<bool>(out var b) ? b : v.TryGetValue<double>(out var n) ? n != 0 : v.TryGetValue<string>(out var s) ? s is "1" or "true" : null
        : null;

    /* The file types iBroadcast takes ("supported": [{ extension: ".flac", … }]), as extensions without the dot. */
    private static IEnumerable<string> Formats(JsonObject j) => (j["supported"] as JsonArray ?? [])
        .Select(f => IBroadcastApi.Str(f is JsonObject o ? o["extension"] : f)?.TrimStart('.').ToLowerInvariant())
        .OfType<string>().Where(e => e.Length > 0).Distinct().Order(StringComparer.Ordinal);

    /// <summary>The state as the page reads it: signed in or not, the account, a sign-in under way. Never a token.</summary>
    public JsonObject Status()
    {
        var a = Account();
        var on = IBroadcastApi.Str(a?["token"]?["access"]) != null;
        var o = new JsonObject { ["connected"] = on };
        if (on)
        {
            o["user"] = new JsonObject { ["name"] = IBroadcastApi.Str(a!["user"]?["name"]) };
            o["premium"] = a["premium"]?.DeepClone();
            o["formats"] = a["formats"]?.DeepClone() ?? new JsonArray();
            o["since"] = a["since"]?.DeepClone();
            return o;
        }
        lock (gate)
            if (pending is { } p)
                o["pending"] = new JsonObject { ["url"] = p.Code.Url, ["code"] = p.Code.UserCode, ["expires_at"] = p.Expires, ["error"] = p.Error };
        return o;
    }

    /// <summary>A sign-in under way let go: iBroadcast asked no more.</summary>
    public void CancelSignIn()
    {
        lock (gate)
        {
            pending?.Timer?.Dispose();
            pending = null;
        }
    }

    /// <summary>Signed out: the account forgotten here, and its sign-in let go at iBroadcast.</summary>
    public async Task<JsonObject> SignOut()
    {
        CancelSignIn();
        var refresh = IBroadcastApi.Str(Account()?["token"]?["refresh"]);
        Save(null);
        if (refresh != null) await Api.Revoke(refresh);
        Server.Log("[ibroadcast] signed out");
        return Status();
    }
}
