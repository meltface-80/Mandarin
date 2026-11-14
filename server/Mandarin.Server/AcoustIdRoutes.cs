// AcoustIdRoutes.cs — Settings → API Keys' AcoustID key (bug list item 414c), as the others there (LabelRoutes.cs'
// FanArt.tv and Discogs): GET says enough of the key to know it and whether AcoustID takes it, POST keeps one and
// checks it at once. The check is remembered as theirs: twelve hours when it works, an hour when it was refused, ten
// minutes with no answer either way. A key saved that works puts the albums the scan couldn't place, or only
// proposed, back in its queue (Identifier.PackUpdated's rule: never one declined or matched by hand), to be matched by
// sound.
using Mandarin.Server.Extras;
using Mandarin.Server.Identify;
using Mandarin.Server.Tags;

namespace Mandarin.Server;

using TJs = Mandarin.Server.Tags.Js;

internal static partial class Library
{
    private static readonly Dictionary<string, (string State, long At)> acoustIdChecks = [];

    private static string AcoustIdMasked(string v) => v.Length > 0 ? "••••" + (v.Length > 4 ? v[^4..] : v) : "";

    /* Does [key] work? Asked again once its answer is old, or [fresh] (a key just saved). */
    private static async Task<string?> AcoustIdCheck(AcoustId sound, string key, bool fresh)
    {
        if (key.Length == 0) return null;
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        lock (acoustIdChecks)
        {
            if (!fresh && acoustIdChecks.TryGetValue(key, out var hit)
                && now - hit.At < (hit.State == "ok" ? 12 * 3600000L : hit.State == "invalid" ? 3600000L : 600000L)) return hit.State;
        }
        var state = await sound.Check(key);
        lock (acoustIdChecks) acoustIdChecks[key] = (state, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        if (state != "ok") Server.Log($"[settings] acoustid key check: {state}");
        return state;
    }

    private static async Task<JsObj> AcoustIdState(AcoustId sound, bool fresh)
    {
        var v = AcoustId.Key();
        var o = new JsObj();
        o["set"] = v.Length > 0;
        o["configured"] = v.Length > 0;
        o["masked"] = AcoustIdMasked(v);
        o["check"] = await AcoustIdCheck(sound, v, fresh);
        return o;
    }

    /* GET /api/settings/acoustid-key */
    private static async Task<bool> AcoustIdKeyState(HttpContext ctx, Snapshot s, LibState st)
    {
        if (Jobs.Identify?.Sound is not { } sound) return false;
        return await SendJs(ctx, await AcoustIdState(sound, false));
    }

    /* POST /api/settings/acoustid-key { key }: kept, checked at once; one that works matches the albums left unsure. */
    private static async Task<bool> SaveAcoustIdKey(HttpContext ctx, Snapshot s, LibState st)
    {
        if (Jobs.Identify is not { Sound: { } sound } id) return false;
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        var given = TJs.Trim(TJs.Truthy((FromNode(b) as JsObj ?? new JsObj())["key"]) ? TJs.Str((FromNode(b) as JsObj)!["key"]) : "");
        var before = AcoustId.Key();
        Labels.SetSetting(AcoustId.Setting, given);
        sound.State = null;
        Interlocked.Exchange(ref sound.PausedUntil, 0);
        var o = await AcoustIdState(sound, true);
        if (given.Length > 0 && given != before && !TJs.StrictEq(o["check"], "invalid")) await id.SoundKeyed();
        o["ok"] = true;
        return await SendJs(ctx, o);
    }
}
