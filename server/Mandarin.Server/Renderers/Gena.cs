// Gena.cs — UPnP eventing (GENA), the pure parts (v0.8.37, stage 2a of
// docs/specs/csharp-migration.md): lib/renderers/gena.js's parseNotify, the
// lifetime read from a SUBSCRIBE answer's TIMEOUT header, and the lifetime
// asked for, rule for rule. The subscriptions themselves (SUBSCRIBE, renew,
// UNSUBSCRIBE) are network code and move with playback (stage 6).
//
// A renderer tells the server when its transport changes by POSTing a NOTIFY
// to the callback it was given: a propertyset of the variables that changed.
// AVTransport and RenderingControl wrap theirs in a LastChange document (an
// escaped XML string inside the propertyset) naming TransportState, the
// current URI, the volume and so on, each as a val attribute; plain variables
// come as they are. Both are read as lib/xml.js reads them (Playback/Xml.cs).
using Mandarin.Server.Tags;

namespace Mandarin.Server.Renderers;

using Js = Mandarin.Server.Tags.Js;
using Xml = Mandarin.Server.Playback.Xml;

internal static class Gena
{
    /* The lifetime asked for, in seconds; and assumed when the answer gives none. */
    public const double TimeoutS = 1800;

    /* A TIMEOUT header ("Second-1800") → seconds: /Second-(\d+)/i, else TimeoutS. */
    public static double Seconds(object? v)
    {
        var s = Js.Truthy(v) ? Js.Str(v) : "";
        for (var i = 0; i + 7 < s.Length; i++)
        {
            if (!Prop.AsciiAt(s, i, "Second-") || s[i + 7] is < '0' or > '9') continue;
            var end = i + 7;
            while (end < s.Length && s[end] is >= '0' and <= '9') end++;
            return Js.StringToNumber(s[(i + 7)..end]);
        }
        return TimeoutS;
    }

    /* A NOTIFY body → the changed variables, flat: { TransportState: "PLAYING", … }. */
    public static JsObj ParseNotify(object? body)
    {
        var o = new JsObj();
        var doc = Xml.Parse(body);
        var ps = (doc as JsObj)?["propertyset"];
        if (!Js.Truthy(ps)) return o;
        foreach (var prop in Xml.ListOf(Prop.Get(ps, "property")))
        {
            foreach (var (k, v) in Prop.Entries(Prop.Or(prop, new JsObj())))
            {
                if (k.StartsWith('@')) continue;
                if (k != "LastChange") { o[k] = Xml.Text(v); continue; }
                var ev = (Xml.Parse(Xml.Text(v)) as JsObj)?["Event"];
                foreach (var inst in Xml.ListOf(Js.Truthy(ev) ? Prop.Get(ev, "InstanceID") : ev))
                {
                    foreach (var (name, node) in Prop.Entries(Prop.Or(inst, new JsObj())))
                    {
                        if (name.StartsWith('@')) continue;
                        var list = Xml.ListOf(node);
                        if (list.Count > 0 && list[0] is JsObj first && !Js.IsNullish(first["@val"])) o[name] = Js.Str(first["@val"]);
                    }
                }
            }
        }
        return o;
    }
}
