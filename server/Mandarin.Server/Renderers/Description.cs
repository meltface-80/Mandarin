// Description.cs — what a UPnP device says about itself (v0.8.37, stage 2a of
// docs/specs/csharp-migration.md): lib/renderers/description.js's
// parseDescription and shortType, rule for rule. Not used by anything that
// runs yet: playback (stage 6) will be.
//
// The LOCATION an SSDP answer points at is an XML document: the device's name
// (friendlyName, which is what its own app calls it), maker and model, its UDN
// (the id that survives an address change), and the services it offers with
// the URLs to drive them, each resolved against the document's URLBase or its
// own address (WebUrl.cs). Some devices nest the renderer inside a root device
// (a TV, a receiver with several personalities), so the whole tree is searched
// for the MediaRenderer; failing that the root device is read as it is. The
// XML is read as lib/xml.js reads it (Playback/Xml.cs), so the same sloppy documents
// give the same records, and the same garbage gives null.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Renderers;

using Js = Mandarin.Server.Tags.Js;
using Xml = Mandarin.Server.Playback.Xml;

internal static class Description
{
    /* urn:schemas-upnp-org:service:AVTransport:1 → AVTransport: /:service:([^:]+):/i, or "". */
    public static string ShortType(object? serviceType)
    {
        var s = Js.Truthy(serviceType) ? Js.Str(serviceType) : "";
        for (var i = 0; i < s.Length; i++)
        {
            if (!Prop.AsciiAt(s, i, ":service:")) continue;
            var start = i + 9;
            var end = start;
            while (end < s.Length && s[end] != ':') end++;
            if (end > start && end < s.Length) return s[start..end];
        }
        return "";
    }

    private static bool IsRenderer(string deviceType) => Prop.AsciiContains(deviceType, "device:MediaRenderer:");

    // new URL(rel, base).toString(), or "" for nothing to resolve or where it throws.
    private static string Resolve(string rel, object? baseUrl)
    {
        if (rel.Length == 0) return "";
        return WebUrl.Href(rel, baseUrl is Undef ? null : Js.Str(baseUrl)) ?? "";
    }

    private static object? FindRenderer(object? device)
    {
        if (!Js.Truthy(device) || device is not (JsObj or List<object?>)) return null;
        if (IsRenderer(Xml.Text(Prop.Get(device, "deviceType")))) return device;
        var list = Prop.Get(device, "deviceList");
        var kids = Js.Truthy(list) ? Xml.ListOf(Prop.Get(list, "device")) : [];
        foreach (var k in kids) if (FindRenderer(k) is { } r) return r;
        return null;
    }

    /* The XML text and where it came from → a device record, or null. */
    public static JsObj? Parse(object? xml, object? location)
    {
        var doc = Xml.Parse(xml);
        var root = (doc as JsObj)?["root"];
        if (!Js.Truthy(root)) return null;
        var baseUrl = Prop.Or(Xml.Text(Prop.Get(root, "URLBase")), location);
        var dev = FindRenderer(Prop.Get(root, "device")) ?? Prop.Get(root, "device");
        if (!Js.Truthy(dev) || dev is not (JsObj or List<object?>)) return null;
        var services = new JsObj();
        var openhome = false;
        var serviceList = Prop.Get(dev, "serviceList");
        foreach (var s in Xml.ListOf(Js.Truthy(serviceList) ? Prop.Get(serviceList, "service") : serviceList))
        {
            var type = Xml.Text(Prop.Get(s, "serviceType"));
            var name = ShortType(type);
            if (name.Length == 0) continue;
            if (Prop.AsciiContains(type, "av-openhome-org")) openhome = true;
            var svc = new JsObj();
            svc["type"] = type;
            svc["controlUrl"] = Resolve(Xml.Text(Prop.Get(s, "controlURL")), baseUrl);
            svc["eventSubUrl"] = Resolve(Xml.Text(Prop.Get(s, "eventSubURL")), baseUrl);
            svc["scpdUrl"] = Resolve(Xml.Text(Prop.Get(s, "SCPDURL")), baseUrl);
            // services.__proto__ = {…} sets the object's prototype: no key of its own.
            if (name != "__proto__") services[name] = svc;
        }
        var d = new JsObj();
        d["udn"] = Js.Trim(Xml.Text(Prop.Get(dev, "UDN")));
        d["deviceType"] = Xml.Text(Prop.Get(dev, "deviceType"));
        d["friendlyName"] = Js.Trim(Xml.Text(Prop.Get(dev, "friendlyName")));
        d["manufacturer"] = Js.Trim(Xml.Text(Prop.Get(dev, "manufacturer")));
        d["modelName"] = Js.Trim(Xml.Text(Prop.Get(dev, "modelName")));
        d["modelNumber"] = Js.Trim(Xml.Text(Prop.Get(dev, "modelNumber")));
        d["modelDescription"] = Js.Trim(Xml.Text(Prop.Get(dev, "modelDescription")));
        d["serialNumber"] = Js.Trim(Xml.Text(Prop.Get(dev, "serialNumber")));
        d["presentationUrl"] = Resolve(Xml.Text(Prop.Get(dev, "presentationURL")), baseUrl);
        d["services"] = services;
        d["openhome"] = openhome;
        d["renderer"] = IsRenderer(Xml.Text(Prop.Get(dev, "deviceType")));
        // LinkPlay firmware (WiiM, Arylic, Audio Pro…) names itself in the
        // description one way or another; the probe confirms it.
        var head = (string)xml!;
        if (head.Length > 8000) head = head[..8000];
        d["linkplayHint"] = Prop.AsciiContains(head, "linkplay") || Prop.AsciiContains(head, "wiim");
        return d;
    }
}
