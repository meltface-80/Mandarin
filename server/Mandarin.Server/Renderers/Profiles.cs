// Profiles.cs — what a model can take that it does not say for itself
// (v0.8.37, stage 2a of docs/specs/csharp-migration.md): lib/renderers/
// profiles.js rule for rule — its tables, profileFor and effective. Not used
// by anything that runs yet: Audio Devices (stage 5) and playback (stage 6)
// will be.
//
// GetProtocolInfo names containers, never "up to 192 kHz"; so the rates and
// depths a device is offered come in layers, in rising order of trust:
//
//   advertised   what the device's own description said (containers, and the
//                odd rate from a raw-PCM entry)
//   profile      this file: the model looked up by maker and name
//   user         what you ticked on the device's page
//   verified     what the device itself reported having played (WiiM's API),
//                or a test play that went through
//
// The chips on the page show which layer each came from. A profile never
// takes away what a device advertises; it adds what the device cannot say.
// A register row is read as the Node code reads it, odd shapes and all (a
// rates list written as a string is searched as one; an object where a list
// belongs throws, as it does there).
using Mandarin.Server.Tags;

namespace Mandarin.Server.Renderers;

using Js = Mandarin.Server.Tags.Js;

internal static class Profiles
{
    public static readonly double[] Rates = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000];
    public static readonly double[] Bits = [16, 24, 32];
    public static readonly double[] Dsd = [64, 128, 256];
    public static readonly double[] FloorRates = [44100, 48000], FloorBits = [16, 24];

    private static double[] UpTo(double max) => Rates.Where(r => r <= max).ToArray();

    /* A model's match: what it is tested against, and the pattern as profiles.js writes it. */
    internal sealed record Match(Func<string, bool>? Model = null, Func<string, bool>? Manufacturer = null, Func<string, bool>? Any = null,
        string? ModelSource = null, string? ManufacturerSource = null, string? AnySource = null);

    internal sealed record Profile(string Id, string Label, Match? Match, double[] Rates, double[] Bits, double[] Dsd,
        bool? SetNext, string? Api, string Volume, string? Notes = null, bool HasMatch = true);

    // The patterns, as JavaScript reads them: /i folds ASCII letters only, \s is JavaScript's white space, \b ASCII's.
    private static int SkipWs(string s, int i)
    {
        while (i < s.Length && Js.IsWs(s[i])) i++;
        return i;
    }

    // words joined by \s*, from i: where the match ends, or -1.
    private static int Seq(string s, int i, params string[] words)
    {
        for (var w = 0; w < words.Length; w++)
        {
            if (w > 0) i = SkipWs(s, i);
            if (!Prop.AsciiAt(s, i, words[w])) return -1;
            i += words[w].Length;
        }
        return i;
    }

    private static bool Anywhere(string s, Func<int, bool> at)
    {
        for (var i = 0; i < s.Length; i++) if (at(i)) return true;
        return false;
    }

    private static bool Word(char c) => c is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or '_';

    private static Func<string, bool> Words(params string[] words) => s => Anywhere(s, i => Seq(s, i, words) >= 0);

    // /wiim\s*pro(?!\s*plus)/i
    private static bool WiimProNotPlus(string s) => Anywhere(s, i => Seq(s, i, "wiim", "pro") is var e and >= 0 && !Prop.AsciiAt(s, SkipWs(s, e), "plus"));

    // /\bpoly\b/i
    private static bool Poly(string s) => Anywhere(s, i => Prop.AsciiAt(s, i, "poly") && (i == 0 || !Word(s[i - 1])) && (i + 4 == s.Length || !Word(s[i + 4])));

    private static readonly double[] None = [];

    public static readonly Profile[] All =
    [
        new("wiim-pro-plus", "WiiM Pro Plus", new(Model: Words("wiim", "pro", "plus"), ModelSource: @"/wiim\s*pro\s*plus/i"),
            UpTo(192000), [16, 24], None, true, "linkplay", "upnp",
            "Bit-perfect to 24-bit/192 kHz on its optical and coaxial outputs. 32-bit: to verify."),
        new("wiim-ultra", "WiiM Ultra", new(Model: Words("wiim", "ultra"), ModelSource: @"/wiim\s*ultra/i"),
            UpTo(192000), [16, 24], None, true, "linkplay", "upnp"),
        new("wiim-amp", "WiiM Amp", new(Model: Words("wiim", "amp"), ModelSource: @"/wiim\s*amp/i"),
            UpTo(192000), [16, 24], None, true, "linkplay", "upnp"),
        new("wiim-pro", "WiiM Pro", new(Model: WiimProNotPlus, ModelSource: @"/wiim\s*pro(?!\s*plus)/i"),
            UpTo(192000), [16, 24], None, true, "linkplay", "upnp"),
        new("wiim-mini", "WiiM Mini", new(Model: Words("wiim", "mini"), ModelSource: @"/wiim\s*mini/i"),
            UpTo(192000), [16, 24], None, true, "linkplay", "upnp"),
        new("wiim", "WiiM", new(Any: Words("wiim"), AnySource: "/wiim/i"),
            UpTo(192000), [16, 24], None, true, "linkplay", "upnp"),
        new("chord-poly", "Chord Poly", new(Model: Poly, Manufacturer: Words("chord"), ModelSource: @"/\bpoly\b/i", ManufacturerSource: "/chord/i"),
            UpTo(768000), [16, 24, 32], [64, 128, 256], null, "mpd", "fixed",
            "Feeds a Mojo 2: PCM to 768 kHz, DSD64–256 as DoP. Gapless over UPnP and 32-bit pass-through: to verify. Volume is Mojo 2's own."),
        new("linkplay", "LinkPlay player", new(Any: Words("linkplay"), AnySource: "/linkplay/i"),
            UpTo(192000), [16, 24], None, true, "linkplay", "upnp"),
        new("generic", "UPnP renderer", null,
            FloorRates, FloorBits, None, null, null, "upnp",
            "Only 44.1 and 48 kHz are assumed. Tick the rates it takes; a rate it cannot play stops with an error and is unticked.")
    ];

    /*
     * A sound device on this computer (v0.6.18): the rates and depths it lists
     * itself (a USB DAC on Linux), or the rate the Mac has it set to, over the
     * 44.1/48 floor; yours when ticked.
     */
    public static readonly Profile Local = new("local", "Sound output on this computer", null, None, None, None, true, null, "upnp", HasMatch: false);

    private static Profile Generic => All[^1];

    // String(v || "")
    private static string Text(object? v) => Js.Truthy(v) ? Js.Str(v) : "";

    /* The profile for a device: by model, then maker, then the generic one. profileFor({ manufacturer, model, family } = {}). */
    public static Profile For(object? device)
    {
        if (device is null) throw new JsError("Cannot destructure 'undefined' as it is null.");
        object? manufacturer = "", model = "", family = "";
        if (device is not Undef)
        {
            if (Prop.Get(device, "manufacturer") is var m and not Undef) manufacturer = m;
            if (Prop.Get(device, "model") is var md and not Undef) model = md;
            if (Prop.Get(device, "family") is var f and not Undef) family = f;
        }
        if (family is "local") return Local;
        foreach (var p in All)
        {
            var m = p.Match;
            if (m == null) continue;
            if (m.Model != null && m.Manufacturer != null)
            {
                if (m.Model(Text(model)) && m.Manufacturer(Text(manufacturer))) return p;
                continue;
            }
            if (m.Model != null && m.Model(Text(model))) return p;
            if (m.Any != null && (m.Any(Text(model)) || m.Any(Text(manufacturer)) || m.Any(Text(family)))) return p;
        }
        if (family is "wiim") return All.First(p => p.Id == "wiim");
        return Generic;
    }

    /* list.includes(v), on whatever the row holds: a list searched, a string searched as text, anything else throws. */
    private static bool Includes(object? list, object v) => list switch
    {
        List<object?> l => l.Any(x => (x, v) switch
        {
            (double a, double b) => a == b,
            (string a, string b) => a == b,
            _ => false
        }),
        string s => s.Contains(Js.Str(v), StringComparison.Ordinal),
        _ => throw new JsError("includes is not a function")
    };

    private static JsObj Chip(string key, double v, bool on, string source)
    {
        var o = new JsObj();
        o[key] = v;
        o["on"] = on;
        o["source"] = source;
        return o;
    }

    private static List<object?> Fixed(string key, double[] all, Func<double, bool> on, string source) =>
        all.Select(v => (object?)Chip(key, v, on(v), on(v) ? source : "off")).ToList();

    /*
     * The chips: every rate, depth and DSD step, on or off, with where "on" came
     * from. `record` is a register row (caps parsed), with kind and family.
     */
    public static JsObj Effective(object? record)
    {
        var kind = Prop.Or(Prop.Get(record, "kind"), "upnp");
        var caps = Prop.Or(Prop.Get(record, "caps"), new JsObj());
        var adv = Prop.Or(Prop.Get(caps, "advertised"), new JsObj());
        var user = Prop.Or(Prop.Get(caps, "user"), null);
        var verified = Prop.Or(Prop.Get(caps, "verified"), new JsObj());
        var containers = Prop.Or(Prop.Get(adv, "containers"), new List<object?>());
        var o = new JsObj();

        if (kind is "sonos" or "phone")
        {
            var sonos = kind is "sonos";
            var profile = new JsObj();
            profile["id"] = sonos ? "sonos" : "phone";
            profile["label"] = sonos ? "Sonos" : "Phone";
            o["profile"] = profile;
            o["rates"] = Fixed("hz", Rates, hz => hz <= (sonos ? 48000 : 192000), (string)profile["id"]!);
            o["bits"] = Fixed("n", Bits, n => n <= 24, (string)profile["id"]!);
            o["dsd"] = Fixed("n", Dsd, _ => false, "off");
            o["containers"] = (sonos ? new[] { "flac", "mp3", "alac", "aac", "ogg", "wav", "aiff" } : ["flac", "mp3", "alac", "aac", "ogg", "opus", "wav"])
                .Select(x => (object?)x).ToList();
            o["editable"] = false;
            o["playable"] = true;
            return o;
        }

        var p = For(record);
        (bool On, string Source) Pick(double v, string key, double[] floor)
        {
            var own = key == "rates" ? p.Rates : key == "bits" ? p.Bits : p.Dsd;
            var inProfile = own.Contains(v);
            var inAdv = key is "rates" or "bits" && Includes(Prop.Or(Prop.Get(adv, key), new List<object?>()), v);
            var layer = Prop.Get(verified, key);
            var isVerified = Js.Truthy(layer) && Js.Truthy(Prop.Get(layer, Js.Num(v)));
            var inFloor = floor.Contains(v);
            if (Js.Truthy(user) && Prop.Get(user, key) is List<object?> mine)
            {
                var on = Includes(mine, v);
                return (on, !on ? "off" : isVerified ? "verified" : "user");
            }
            var any = isVerified || inProfile || inAdv || inFloor;
            return (any, !any ? "off" : isVerified ? "verified" : inProfile && p.Id != "generic" && p.Id != "local" ? "profile" : inAdv ? "advertised" : "floor");
        }

        var profileOut = new JsObj();
        profileOut["id"] = p.Id;
        profileOut["label"] = p.Label;
        profileOut["notes"] = p.Notes ?? "";
        profileOut["setNext"] = p.SetNext;
        profileOut["api"] = p.Api;
        profileOut["volume"] = p.Volume;
        o["profile"] = profileOut;
        o["rates"] = Rates.Select(hz => { var (on, source) = Pick(hz, "rates", FloorRates); return (object?)Chip("hz", hz, on, source); }).ToList();
        o["bits"] = Bits.Select(n => { var (on, source) = Pick(n, "bits", FloorBits); return (object?)Chip("n", n, on, source); }).ToList();
        o["dsd"] = DsdChips(p, containers, user);
        o["containers"] = containers;
        o["editable"] = true;
        o["playable"] = Js.Truthy(Prop.Get(record, "playable"));
        return o;
    }

    /*
     * DSD to a renderer (v0.6.0-RC3): the DSF or DFF file itself, for a device
     * that says it takes DSD files (GetProtocolInfo) — at the multiples its
     * profile lists, or DSD64 for a device with no profile of its own. Yours,
     * when you have set them. Anything else is played as PCM, as before.
     */
    private static List<object?> DsdChips(Profile p, object? containers, object? user)
    {
        var takes = Includes(containers, "dsd");
        double[] own = p.Id == "generic" ? [64] : p.Dsd;
        return Dsd.Select(n =>
        {
            if (!takes) return (object?)Chip("n", n, false, "off");
            if (Js.Truthy(user) && Prop.Get(user, "dsd") is List<object?> mine)
            {
                var on = Includes(mine, n);
                return Chip("n", n, on, on ? "user" : "off");
            }
            var ok = own.Contains(n);
            return Chip("n", n, ok, !ok ? "off" : p.Id == "generic" ? "advertised" : "profile");
        }).ToList();
    }

    /* A profile as JSON, its patterns written as profiles.js writes them (String(re)). */
    public static JsObj ToJs(Profile p)
    {
        var o = new JsObj();
        o["id"] = p.Id;
        o["label"] = p.Label;
        if (p.HasMatch)
        {
            if (p.Match is { } m)
            {
                var mo = new JsObj();
                if (m.ModelSource != null) mo["model"] = m.ModelSource;
                if (m.ManufacturerSource != null) mo["manufacturer"] = m.ManufacturerSource;
                if (m.AnySource != null) mo["any"] = m.AnySource;
                o["match"] = mo;
            }
            else o["match"] = null;
        }
        o["rates"] = p.Rates.Select(x => (object?)x).ToList();
        o["bits"] = p.Bits.Select(x => (object?)x).ToList();
        o["dsd"] = p.Dsd.Select(x => (object?)x).ToList();
        o["setNext"] = p.SetNext;
        o["api"] = p.Api;
        o["volume"] = p.Volume;
        if (p.Notes != null) o["notes"] = p.Notes;
        return o;
    }
}
