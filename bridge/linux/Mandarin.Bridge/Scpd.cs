// Scpd.cs — what the renderer says of itself (the Android app's Scpd.kt, the same words): its description document
// and the three services' SCPDs (AVTransport:1, RenderingControl:1, ConnectionManager:1).
using System.Text;

namespace Mandarin.Bridge;

internal static class Scpd
{
    public const string Avt = "urn:schemas-upnp-org:service:AVTransport:1";
    public const string Rcs = "urn:schemas-upnp-org:service:RenderingControl:1";
    public const string Cms = "urn:schemas-upnp-org:service:ConnectionManager:1";
    public const string Device = "urn:schemas-upnp-org:device:MediaRenderer:1";
    public const string Model = "Mandarin Bridge";

    public static string Description(string friendlyName, string udn, string serial) => $"""
        <?xml version="1.0" encoding="utf-8"?>
        <root xmlns="urn:schemas-upnp-org:device-1-0" xmlns:dlna="urn:schemas-dlna-org:device-1-0">
        <specVersion><major>1</major><minor>0</minor></specVersion>
        <device>
        <deviceType>{Device}</deviceType>
        <friendlyName>{Xml.Escape(friendlyName)}</friendlyName>
        <manufacturer>Mandarin</manufacturer>
        <manufacturerURL>https://github.com/meltface-80/Mandarin</manufacturerURL>
        <modelDescription>A USB DAC played bit-perfect by Mandarin's own audio engine</modelDescription>
        <modelName>{Model}</modelName>
        <modelNumber>{Program.Version}</modelNumber>
        <modelURL>https://github.com/meltface-80/Mandarin/tree/dev/bridge</modelURL>
        <serialNumber>{Xml.Escape(serial)}</serialNumber>
        <UDN>{udn}</UDN>
        <dlna:X_DLNADOC>DMR-1.50</dlna:X_DLNADOC>
        <presentationURL>/</presentationURL>
        <serviceList>
        <service><serviceType>{Avt}</serviceType><serviceId>urn:upnp-org:serviceId:AVTransport</serviceId><SCPDURL>/scpd/AVTransport.xml</SCPDURL><controlURL>/control/AVTransport</controlURL><eventSubURL>/event/AVTransport</eventSubURL></service>
        <service><serviceType>{Rcs}</serviceType><serviceId>urn:upnp-org:serviceId:RenderingControl</serviceId><SCPDURL>/scpd/RenderingControl.xml</SCPDURL><controlURL>/control/RenderingControl</controlURL><eventSubURL>/event/RenderingControl</eventSubURL></service>
        <service><serviceType>{Cms}</serviceType><serviceId>urn:upnp-org:serviceId:ConnectionManager</serviceId><SCPDURL>/scpd/ConnectionManager.xml</SCPDURL><controlURL>/control/ConnectionManager</controlURL><eventSubURL>/event/ConnectionManager</eventSubURL></service>
        </serviceList>
        </device>
        </root>

        """;

    private static (string, string, string) In(string n, string v) => (n, "in", v);
    private static (string, string, string) Out(string n, string v) => (n, "out", v);

    private static string Action(string name, params (string Name, string Dir, string Var)[] args)
    {
        var sb = new StringBuilder("<action><name>").Append(name).Append("</name>");
        if (args.Length > 0)
        {
            sb.Append("<argumentList>");
            foreach (var (n, d, v) in args) sb.Append("<argument><name>").Append(n).Append("</name><direction>").Append(d).Append("</direction><relatedStateVariable>").Append(v).Append("</relatedStateVariable></argument>");
            sb.Append("</argumentList>");
        }
        return sb.Append("</action>").ToString();
    }

    private static string Var(string name, string type, bool evented = false, string[]? allowed = null, string? range = null) =>
        "<stateVariable sendEvents=\"" + (evented ? "yes" : "no") + "\"><name>" + name + "</name><dataType>" + type + "</dataType>" +
        (allowed == null ? "" : "<allowedValueList>" + string.Concat(allowed.Select(v => "<allowedValue>" + v + "</allowedValue>")) + "</allowedValueList>") + (range ?? "") + "</stateVariable>";

    private static string Doc(string actions, string variables) =>
        "<?xml version=\"1.0\" encoding=\"utf-8\"?><scpd xmlns=\"urn:schemas-upnp-org:service-1-0\"><specVersion><major>1</major><minor>0</minor></specVersion>" +
        "<actionList>" + actions + "</actionList><serviceStateTable>" + variables + "</serviceStateTable></scpd>";

    private static readonly (string, string, string) Id = In("InstanceID", "A_ARG_TYPE_InstanceID");

    public static readonly string AvTransport = Doc(
        Action("SetAVTransportURI", Id, In("CurrentURI", "AVTransportURI"), In("CurrentURIMetaData", "AVTransportURIMetaData")) +
        Action("SetNextAVTransportURI", Id, In("NextURI", "NextAVTransportURI"), In("NextURIMetaData", "NextAVTransportURIMetaData")) +
        Action("GetMediaInfo", Id, Out("NrTracks", "NumberOfTracks"), Out("MediaDuration", "CurrentMediaDuration"), Out("CurrentURI", "AVTransportURI"),
            Out("CurrentURIMetaData", "AVTransportURIMetaData"), Out("NextURI", "NextAVTransportURI"), Out("NextURIMetaData", "NextAVTransportURIMetaData"),
            Out("PlayMedium", "PlaybackStorageMedium"), Out("RecordMedium", "RecordStorageMedium"), Out("WriteStatus", "RecordMediumWriteStatus")) +
        Action("GetTransportInfo", Id, Out("CurrentTransportState", "TransportState"), Out("CurrentTransportStatus", "TransportStatus"), Out("CurrentSpeed", "TransportPlaySpeed")) +
        Action("GetPositionInfo", Id, Out("Track", "CurrentTrack"), Out("TrackDuration", "CurrentTrackDuration"), Out("TrackMetaData", "CurrentTrackMetaData"),
            Out("TrackURI", "CurrentTrackURI"), Out("RelTime", "RelativeTimePosition"), Out("AbsTime", "AbsoluteTimePosition"), Out("RelCount", "RelativeCounterPosition"), Out("AbsCount", "AbsoluteCounterPosition")) +
        Action("GetDeviceCapabilities", Id, Out("PlayMedia", "PossiblePlaybackStorageMedia"), Out("RecMedia", "PossibleRecordStorageMedia"), Out("RecQualityModes", "PossibleRecordQualityModes")) +
        Action("GetTransportSettings", Id, Out("PlayMode", "CurrentPlayMode"), Out("RecQualityMode", "CurrentRecordQualityMode")) +
        Action("Stop", Id) + Action("Play", Id, In("Speed", "TransportPlaySpeed")) + Action("Pause", Id) +
        Action("Seek", Id, In("Unit", "A_ARG_TYPE_SeekMode"), In("Target", "A_ARG_TYPE_SeekTarget")) +
        Action("Next", Id) + Action("Previous", Id) + Action("SetPlayMode", Id, In("NewPlayMode", "CurrentPlayMode")) +
        Action("GetCurrentTransportActions", Id, Out("Actions", "CurrentTransportActions")),
        Var("TransportState", "string", allowed: ["STOPPED", "PLAYING", "TRANSITIONING", "PAUSED_PLAYBACK", "NO_MEDIA_PRESENT"]) +
        Var("TransportStatus", "string", allowed: ["OK", "ERROR_OCCURRED"]) +
        Var("PlaybackStorageMedium", "string", allowed: ["NETWORK", "NONE"]) + Var("RecordStorageMedium", "string", allowed: ["NOT_IMPLEMENTED"]) +
        Var("PossiblePlaybackStorageMedia", "string") + Var("PossibleRecordStorageMedia", "string") +
        Var("CurrentPlayMode", "string", allowed: ["NORMAL"]) + Var("TransportPlaySpeed", "string", allowed: ["1"]) +
        Var("RecordMediumWriteStatus", "string", allowed: ["NOT_IMPLEMENTED"]) + Var("CurrentRecordQualityMode", "string", allowed: ["NOT_IMPLEMENTED"]) +
        Var("PossibleRecordQualityModes", "string") + Var("NumberOfTracks", "ui4") + Var("CurrentTrack", "ui4") +
        Var("CurrentTrackDuration", "string") + Var("CurrentMediaDuration", "string") + Var("CurrentTrackMetaData", "string") + Var("CurrentTrackURI", "string") +
        Var("AVTransportURI", "string") + Var("AVTransportURIMetaData", "string") + Var("NextAVTransportURI", "string") + Var("NextAVTransportURIMetaData", "string") +
        Var("RelativeTimePosition", "string") + Var("AbsoluteTimePosition", "string") + Var("RelativeCounterPosition", "i4") + Var("AbsoluteCounterPosition", "i4") +
        Var("CurrentTransportActions", "string") + Var("LastChange", "string", evented: true) +
        Var("A_ARG_TYPE_SeekMode", "string", allowed: ["REL_TIME", "ABS_TIME", "TRACK_NR"]) + Var("A_ARG_TYPE_SeekTarget", "string") + Var("A_ARG_TYPE_InstanceID", "ui4"));

    public static readonly string RenderingControl = Doc(
        Action("ListPresets", Id, Out("CurrentPresetNameList", "PresetNameList")) + Action("SelectPreset", Id, In("PresetName", "A_ARG_TYPE_PresetName")) +
        Action("GetMute", Id, In("Channel", "A_ARG_TYPE_Channel"), Out("CurrentMute", "Mute")) + Action("SetMute", Id, In("Channel", "A_ARG_TYPE_Channel"), In("DesiredMute", "Mute")) +
        Action("GetVolume", Id, In("Channel", "A_ARG_TYPE_Channel"), Out("CurrentVolume", "Volume")) + Action("SetVolume", Id, In("Channel", "A_ARG_TYPE_Channel"), In("DesiredVolume", "Volume")),
        Var("PresetNameList", "string") + Var("LastChange", "string", evented: true) + Var("Mute", "boolean") +
        Var("Volume", "ui2", range: "<allowedValueRange><minimum>0</minimum><maximum>100</maximum><step>1</step></allowedValueRange>") +
        Var("A_ARG_TYPE_Channel", "string", allowed: ["Master"]) + Var("A_ARG_TYPE_PresetName", "string", allowed: ["FactoryDefaults"]) + Var("A_ARG_TYPE_InstanceID", "ui4"));

    public static readonly string ConnectionManager = Doc(
        Action("GetProtocolInfo", Out("Source", "SourceProtocolInfo"), Out("Sink", "SinkProtocolInfo")) +
        Action("GetCurrentConnectionIDs", Out("ConnectionIDs", "CurrentConnectionIDs")) +
        Action("GetCurrentConnectionInfo", In("ConnectionID", "A_ARG_TYPE_ConnectionID"), Out("RcsID", "A_ARG_TYPE_RcsID"), Out("AVTransportID", "A_ARG_TYPE_AVTransportID"),
            Out("ProtocolInfo", "A_ARG_TYPE_ProtocolInfo"), Out("PeerConnectionManager", "A_ARG_TYPE_ConnectionManager"), Out("PeerConnectionID", "A_ARG_TYPE_ConnectionID"),
            Out("Direction", "A_ARG_TYPE_Direction"), Out("Status", "A_ARG_TYPE_ConnectionStatus")),
        Var("SourceProtocolInfo", "string", evented: true) + Var("SinkProtocolInfo", "string", evented: true) + Var("CurrentConnectionIDs", "string", evented: true) +
        Var("A_ARG_TYPE_ConnectionStatus", "string", allowed: ["OK", "ContentFormatMismatch", "InsufficientBandwidth", "UnreliableChannel", "Unknown"]) +
        Var("A_ARG_TYPE_ConnectionManager", "string") + Var("A_ARG_TYPE_Direction", "string", allowed: ["Input", "Output"]) +
        Var("A_ARG_TYPE_ProtocolInfo", "string") + Var("A_ARG_TYPE_ConnectionID", "i4") + Var("A_ARG_TYPE_AVTransportID", "i4") + Var("A_ARG_TYPE_RcsID", "i4"));
}
