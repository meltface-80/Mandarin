// Soap.cs — a SOAP answer, or a UPnP fault, as text (the Android app's Soap.kt).
using System.Text;

namespace Mandarin.Bridge;

/* A UPnP fault: its code and its words. */
internal sealed class Fault(int code, string description) : Exception("UPnP error " + code + ": " + description)
{
    public int Code { get; } = code;
    public string Description { get; } = description;
}

internal static class Soap
{
    private const string Head = "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body>";

    public static string Response(string service, string action, IEnumerable<(string Name, string Value)> args)
    {
        var sb = new StringBuilder(Head).Append("<u:").Append(action).Append("Response xmlns:u=\"").Append(service).Append("\">");
        foreach (var (k, v) in args) sb.Append('<').Append(k).Append('>').Append(Xml.Escape(v)).Append("</").Append(k).Append('>');
        return sb.Append("</u:").Append(action).Append("Response></s:Body></s:Envelope>").ToString();
    }

    public static string FaultText(int code, string description) => Head +
        "<s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns=\"urn:schemas-upnp-org:control-1-0\">" +
        "<errorCode>" + code + "</errorCode><errorDescription>" + Xml.Escape(description) + "</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>";
}
