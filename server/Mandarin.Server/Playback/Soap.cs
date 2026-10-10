// Soap.cs — the text of a UPnP action sent to a player, and the reading of its
// answer: the pure parts of lib/sonos/soap.js (v0.8.37), rule for rule, held
// to it by test/sonos-csharp.test.js. Sending it (HTTP, the retry on a reused
// socket) waits for stage 6 of docs/specs/csharp-migration.md.
//
// An unreachable or unhappy player is an ordinary thing on a home network, so
// every failure is one UPnPError, its code the player's own (or 501) and its
// description the player's, or the usual text for the code. An answer's
// arguments come back as strings by name, in the order the player wrote them;
// a DIDL document or a ZoneGroupState inside one comes back as the text it
// carried, entities decoded, ready for Didl.cs or Topology.cs.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

using Js = Mandarin.Server.Tags.Js;

internal sealed class UPnPError : Exception
{
    public readonly double Code;
    public readonly string Description;

    private UPnPError(string message, double code, string description) : base(message) { Code = code; Description = description; }

    private static readonly Dictionary<string, string> ErrorText = new()
    {
        ["401"] = "Invalid Action",
        ["402"] = "Invalid Args",
        ["501"] = "Action Failed",
        ["600"] = "Argument Value Invalid",
        ["701"] = "Transition not available",
        ["702"] = "No contents",
        ["705"] = "Transport is locked",
        ["710"] = "Seek mode not supported",
        ["711"] = "Illegal seek target",
        ["714"] = "Illegal MIME-type",
        ["718"] = "Invalid InstanceID",
        ["800"] = "Command not supported (grouped room?)",
        ["804"] = "Queue full or bad index"
    };

    /* new UPnPError(code, description) */
    public static UPnPError Of(double code, string description)
    {
        var desc = description.Length > 0 ? description : ErrorText.GetValueOrDefault(Js.Num(code), "Unknown error");
        return new UPnPError($"UPnP error {Js.Num(code)}: {desc}", double.IsNaN(code) || code == 0 ? 501 : code, desc);
    }
}

internal static class Soap
{
    /* The arguments as elements, in their order, each value escaped (null and undefined as ""). */
    public static string BuildArgs(object? args)
    {
        var sb = new System.Text.StringBuilder();
        IEnumerable<(string, object?)> entries = args switch
        {
            JsObj o => o.Keys.Select(k => (k, o[k])),
            List<object?> l => l.Select((v, i) => (i.ToString(System.Globalization.CultureInfo.InvariantCulture), v)),
            string s => s.Select((c, i) => (i.ToString(System.Globalization.CultureInfo.InvariantCulture), (object?)c.ToString())),
            _ => []
        };
        foreach (var (k, v) in entries) sb.Append('<').Append(k).Append('>').Append(Xml.Escape(Js.IsNullish(v) ? "" : v)).Append("</").Append(k).Append('>');
        return sb.ToString();
    }

    /* buildRequest(): the SOAP envelope for one action. */
    public static string BuildRequest(object? serviceType, object? action, object? args) =>
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
        "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\"" +
        " s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">" +
        $"<s:Body><u:{Js.Str(action)} xmlns:u=\"{Js.Str(serviceType)}\">{BuildArgs(args)}</u:{Js.Str(action)}></s:Body>" +
        "</s:Envelope>";

    // A function or a prototype object: what JavaScript finds for a name a plain object, a string or an array inherits.
    private sealed class Inherited { public static readonly Inherited Function = new(), Prototype = new(); }

    private static readonly HashSet<string> ObjectProto = ["constructor", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toString", "valueOf", "toLocaleString", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"];
    private static readonly HashSet<string> StringProto = ["anchor", "at", "big", "blink", "bold", "charAt", "charCodeAt", "codePointAt", "concat", "endsWith", "fontcolor", "fontsize", "fixed", "includes", "indexOf", "isWellFormed", "italics", "lastIndexOf", "link", "localeCompare", "match", "matchAll", "normalize", "padEnd", "padStart", "repeat", "replace", "replaceAll", "search", "slice", "small", "split", "strike", "sub", "substr", "substring", "sup", "startsWith", "toString", "toWellFormed", "trim", "trimStart", "trimLeft", "trimEnd", "trimRight", "toLocaleLowerCase", "toLocaleUpperCase", "toLowerCase", "toUpperCase", "valueOf"];
    private static readonly HashSet<string> ArrayProto = ["at", "concat", "copyWithin", "entries", "every", "fill", "filter", "find", "findIndex", "findLast", "findLastIndex", "flat", "flatMap", "forEach", "includes", "indexOf", "join", "keys", "lastIndexOf", "map", "pop", "push", "reduce", "reduceRight", "reverse", "shift", "slice", "some", "sort", "splice", "toLocaleString", "toReversed", "toSorted", "toSpliced", "toString", "unshift", "values", "with"];

    /* obj[key] for a name the caller chose (the action's): own keys, indexes and length, then what is inherited. */
    private static object? Get(object? obj, string key)
    {
        switch (obj)
        {
            case JsObj o when o.Has(key): return o[key];
            case string s:
                if (key == "length") return (double)s.Length;
                if (Js.IsIndex(key, out var i) && i < s.Length) return s[(int)i].ToString();
                if (StringProto.Contains(key)) return Inherited.Function;
                break;
            case List<object?> l:
                if (key == "length") return (double)l.Count;
                if (Js.IsIndex(key, out var j) && j < l.Count) return l[(int)j];
                if (ArrayProto.Contains(key)) return Inherited.Function;
                break;
        }
        if (key == "__proto__") return Inherited.Prototype;
        return ObjectProto.Contains(key) ? Inherited.Function : Undef.V;
    }

    private static IEnumerable<object?> Values(object? obj) => obj switch
    {
        JsObj o => o.Keys.Select(k => o[k]),
        List<object?> l => l,
        string s => s.Select(c => (object?)c.ToString()),
        _ => []
    };

    /* parseResponse(): the answer's arguments by name, or the UPnPError it carries (or that it isn't SOAP at all). */
    public static JsObj ParseResponse(object? body, object? action)
    {
        var doc = Xml.Parse(body);
        var soapBody = Xml.Prop(Xml.Prop(doc, "Envelope"), "Body");
        if (!Js.Truthy(soapBody)) throw UPnPError.Of(501, "Malformed SOAP response");
        var fault = Xml.Prop(soapBody, "Fault");
        if (Js.Truthy(fault))
        {
            var detail = Xml.Prop(fault, "detail");
            var err = Js.Truthy(detail) ? Xml.Prop(detail, "UPnPError") : Undef.V;
            var code = Js.Truthy(err) ? Js.ToNumber(Xml.Text(Xml.Prop(err, "errorCode"))) : 0;
            var desc = Js.Truthy(err) ? Xml.Text(Xml.Prop(err, "errorDescription")) : "";
            throw UPnPError.Of(double.IsNaN(code) || code == 0 ? 501 : code, desc);
        }
        var name = Js.Str(action);
        var node = Get(soapBody, name + "Response");
        if (!Js.Truthy(node)) node = Get(soapBody, name);
        if (!Js.Truthy(node)) node = Values(soapBody).FirstOrDefault(v => v is JsObj or List<object?>) ?? Undef.V;
        var o = new JsObj();
        switch (node)
        {
            case JsObj n:
                foreach (var k in n.Keys) if (!k.StartsWith('@')) o[k] = Xml.Text(n[k]);
                break;
            case List<object?> l:
                for (var i = 0; i < l.Count; i++) o[i.ToString(System.Globalization.CultureInfo.InvariantCulture)] = Xml.Text(l[i]);
                break;
        }
        return o;
    }
}
