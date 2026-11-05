package com.musicd.server.android

/**
 * What the renderer says of itself: its description document and the three
 * services' SCPDs (AVTransport:1, RenderingControl:1, ConnectionManager:1),
 * the actions a control point may call and the variables it may watch.
 */
object Scpd {
    const val AVT = "urn:schemas-upnp-org:service:AVTransport:1"
    const val RCS = "urn:schemas-upnp-org:service:RenderingControl:1"
    const val CMS = "urn:schemas-upnp-org:service:ConnectionManager:1"
    const val DEVICE = "urn:schemas-upnp-org:device:MediaRenderer:1"
    const val MODEL = "Mandarin Bridge"

    fun description(friendlyName: String, udn: String, serial: String): String = """<?xml version="1.0" encoding="utf-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0" xmlns:dlna="urn:schemas-dlna-org:device-1-0">
<specVersion><major>1</major><minor>0</minor></specVersion>
<device>
<deviceType>$DEVICE</deviceType>
<friendlyName>${Xml.escape(friendlyName)}</friendlyName>
<manufacturer>Mandarin</manufacturer>
<manufacturerURL>https://github.com/meltface-80/Mandarin</manufacturerURL>
<modelDescription>A USB DAC played bit-perfect by Mandarin's own USB Audio driver</modelDescription>
<modelName>$MODEL</modelName>
<modelNumber>${BuildConfig.VERSION_NAME}</modelNumber>
<modelURL>https://github.com/meltface-80/Mandarin/tree/dev/bridge</modelURL>
<serialNumber>${Xml.escape(serial)}</serialNumber>
<UDN>$udn</UDN>
<dlna:X_DLNADOC>DMR-1.50</dlna:X_DLNADOC>
<presentationURL>/</presentationURL>
<serviceList>
<service><serviceType>$AVT</serviceType><serviceId>urn:upnp-org:serviceId:AVTransport</serviceId><SCPDURL>/scpd/AVTransport.xml</SCPDURL><controlURL>/control/AVTransport</controlURL><eventSubURL>/event/AVTransport</eventSubURL></service>
<service><serviceType>$RCS</serviceType><serviceId>urn:upnp-org:serviceId:RenderingControl</serviceId><SCPDURL>/scpd/RenderingControl.xml</SCPDURL><controlURL>/control/RenderingControl</controlURL><eventSubURL>/event/RenderingControl</eventSubURL></service>
<service><serviceType>$CMS</serviceType><serviceId>urn:upnp-org:serviceId:ConnectionManager</serviceId><SCPDURL>/scpd/ConnectionManager.xml</SCPDURL><controlURL>/control/ConnectionManager</controlURL><eventSubURL>/event/ConnectionManager</eventSubURL></service>
</serviceList>
</device>
</root>
"""

    private fun action(name: String, vararg args: Triple<String, String, String>): String {
        val sb = StringBuilder("<action><name>$name</name>")
        if (args.isNotEmpty()) {
            sb.append("<argumentList>")
            for ((n, dir, v) in args) sb.append("<argument><name>$n</name><direction>$dir</direction><relatedStateVariable>$v</relatedStateVariable></argument>")
            sb.append("</argumentList>")
        }
        return sb.append("</action>").toString()
    }
    private fun inArg(n: String, v: String) = Triple(n, "in", v)
    private fun outArg(n: String, v: String) = Triple(n, "out", v)
    private fun variable(name: String, type: String, evented: Boolean = false, allowed: List<String>? = null, range: String? = null): String =
        "<stateVariable sendEvents=\"${if (evented) "yes" else "no"}\"><name>$name</name><dataType>$type</dataType>" +
            (allowed?.let { "<allowedValueList>" + it.joinToString("") { v -> "<allowedValue>$v</allowedValue>" } + "</allowedValueList>" } ?: "") + (range ?: "") + "</stateVariable>"
    private fun scpd(actions: String, variables: String) =
        "<?xml version=\"1.0\" encoding=\"utf-8\"?><scpd xmlns=\"urn:schemas-upnp-org:service-1-0\"><specVersion><major>1</major><minor>0</minor></specVersion>" +
            "<actionList>$actions</actionList><serviceStateTable>$variables</serviceStateTable></scpd>"

    val avTransport: String = scpd(
        action("SetAVTransportURI", inArg("InstanceID", "A_ARG_TYPE_InstanceID"), inArg("CurrentURI", "AVTransportURI"), inArg("CurrentURIMetaData", "AVTransportURIMetaData")) +
            action("SetNextAVTransportURI", inArg("InstanceID", "A_ARG_TYPE_InstanceID"), inArg("NextURI", "NextAVTransportURI"), inArg("NextURIMetaData", "NextAVTransportURIMetaData")) +
            action("GetMediaInfo", inArg("InstanceID", "A_ARG_TYPE_InstanceID"), outArg("NrTracks", "NumberOfTracks"), outArg("MediaDuration", "CurrentMediaDuration"), outArg("CurrentURI", "AVTransportURI"),
                outArg("CurrentURIMetaData", "AVTransportURIMetaData"), outArg("NextURI", "NextAVTransportURI"), outArg("NextURIMetaData", "NextAVTransportURIMetaData"),
                outArg("PlayMedium", "PlaybackStorageMedium"), outArg("RecordMedium", "RecordStorageMedium"), outArg("WriteStatus", "RecordMediumWriteStatus")) +
            action("GetTransportInfo", inArg("InstanceID", "A_ARG_TYPE_InstanceID"), outArg("CurrentTransportState", "TransportState"), outArg("CurrentTransportStatus", "TransportStatus"), outArg("CurrentSpeed", "TransportPlaySpeed")) +
            action("GetPositionInfo", inArg("InstanceID", "A_ARG_TYPE_InstanceID"), outArg("Track", "CurrentTrack"), outArg("TrackDuration", "CurrentTrackDuration"), outArg("TrackMetaData", "CurrentTrackMetaData"),
                outArg("TrackURI", "CurrentTrackURI"), outArg("RelTime", "RelativeTimePosition"), outArg("AbsTime", "AbsoluteTimePosition"), outArg("RelCount", "RelativeCounterPosition"), outArg("AbsCount", "AbsoluteCounterPosition")) +
            action("GetDeviceCapabilities", inArg("InstanceID", "A_ARG_TYPE_InstanceID"), outArg("PlayMedia", "PossiblePlaybackStorageMedia"), outArg("RecMedia", "PossibleRecordStorageMedia"), outArg("RecQualityModes", "PossibleRecordQualityModes")) +
            action("GetTransportSettings", inArg("InstanceID", "A_ARG_TYPE_InstanceID"), outArg("PlayMode", "CurrentPlayMode"), outArg("RecQualityMode", "CurrentRecordQualityMode")) +
            action("Stop", inArg("InstanceID", "A_ARG_TYPE_InstanceID")) +
            action("Play", inArg("InstanceID", "A_ARG_TYPE_InstanceID"), inArg("Speed", "TransportPlaySpeed")) +
            action("Pause", inArg("InstanceID", "A_ARG_TYPE_InstanceID")) +
            action("Seek", inArg("InstanceID", "A_ARG_TYPE_InstanceID"), inArg("Unit", "A_ARG_TYPE_SeekMode"), inArg("Target", "A_ARG_TYPE_SeekTarget")) +
            action("Next", inArg("InstanceID", "A_ARG_TYPE_InstanceID")) +
            action("Previous", inArg("InstanceID", "A_ARG_TYPE_InstanceID")) +
            action("SetPlayMode", inArg("InstanceID", "A_ARG_TYPE_InstanceID"), inArg("NewPlayMode", "CurrentPlayMode")) +
            action("GetCurrentTransportActions", inArg("InstanceID", "A_ARG_TYPE_InstanceID"), outArg("Actions", "CurrentTransportActions")),
        variable("TransportState", "string", allowed = listOf("STOPPED", "PLAYING", "TRANSITIONING", "PAUSED_PLAYBACK", "NO_MEDIA_PRESENT")) +
            variable("TransportStatus", "string", allowed = listOf("OK", "ERROR_OCCURRED")) +
            variable("PlaybackStorageMedium", "string", allowed = listOf("NETWORK", "NONE")) + variable("RecordStorageMedium", "string", allowed = listOf("NOT_IMPLEMENTED")) +
            variable("PossiblePlaybackStorageMedia", "string") + variable("PossibleRecordStorageMedia", "string") +
            variable("CurrentPlayMode", "string", allowed = listOf("NORMAL")) + variable("TransportPlaySpeed", "string", allowed = listOf("1")) +
            variable("RecordMediumWriteStatus", "string", allowed = listOf("NOT_IMPLEMENTED")) + variable("CurrentRecordQualityMode", "string", allowed = listOf("NOT_IMPLEMENTED")) +
            variable("PossibleRecordQualityModes", "string") + variable("NumberOfTracks", "ui4") + variable("CurrentTrack", "ui4") +
            variable("CurrentTrackDuration", "string") + variable("CurrentMediaDuration", "string") + variable("CurrentTrackMetaData", "string") + variable("CurrentTrackURI", "string") +
            variable("AVTransportURI", "string") + variable("AVTransportURIMetaData", "string") + variable("NextAVTransportURI", "string") + variable("NextAVTransportURIMetaData", "string") +
            variable("RelativeTimePosition", "string") + variable("AbsoluteTimePosition", "string") + variable("RelativeCounterPosition", "i4") + variable("AbsoluteCounterPosition", "i4") +
            variable("CurrentTransportActions", "string") + variable("LastChange", "string", evented = true) +
            variable("A_ARG_TYPE_SeekMode", "string", allowed = listOf("REL_TIME", "ABS_TIME", "TRACK_NR")) + variable("A_ARG_TYPE_SeekTarget", "string") + variable("A_ARG_TYPE_InstanceID", "ui4")
    )

    val renderingControl: String = scpd(
        action("ListPresets", inArg("InstanceID", "A_ARG_TYPE_InstanceID"), outArg("CurrentPresetNameList", "PresetNameList")) +
            action("SelectPreset", inArg("InstanceID", "A_ARG_TYPE_InstanceID"), inArg("PresetName", "A_ARG_TYPE_PresetName")) +
            action("GetMute", inArg("InstanceID", "A_ARG_TYPE_InstanceID"), inArg("Channel", "A_ARG_TYPE_Channel"), outArg("CurrentMute", "Mute")) +
            action("SetMute", inArg("InstanceID", "A_ARG_TYPE_InstanceID"), inArg("Channel", "A_ARG_TYPE_Channel"), inArg("DesiredMute", "Mute")) +
            action("GetVolume", inArg("InstanceID", "A_ARG_TYPE_InstanceID"), inArg("Channel", "A_ARG_TYPE_Channel"), outArg("CurrentVolume", "Volume")) +
            action("SetVolume", inArg("InstanceID", "A_ARG_TYPE_InstanceID"), inArg("Channel", "A_ARG_TYPE_Channel"), inArg("DesiredVolume", "Volume")),
        variable("PresetNameList", "string") + variable("LastChange", "string", evented = true) + variable("Mute", "boolean") +
            variable("Volume", "ui2", range = "<allowedValueRange><minimum>0</minimum><maximum>100</maximum><step>1</step></allowedValueRange>") +
            variable("A_ARG_TYPE_Channel", "string", allowed = listOf("Master")) + variable("A_ARG_TYPE_PresetName", "string", allowed = listOf("FactoryDefaults")) + variable("A_ARG_TYPE_InstanceID", "ui4")
    )

    val connectionManager: String = scpd(
        action("GetProtocolInfo", outArg("Source", "SourceProtocolInfo"), outArg("Sink", "SinkProtocolInfo")) +
            action("GetCurrentConnectionIDs", outArg("ConnectionIDs", "CurrentConnectionIDs")) +
            action("GetCurrentConnectionInfo", inArg("ConnectionID", "A_ARG_TYPE_ConnectionID"), outArg("RcsID", "A_ARG_TYPE_RcsID"), outArg("AVTransportID", "A_ARG_TYPE_AVTransportID"),
                outArg("ProtocolInfo", "A_ARG_TYPE_ProtocolInfo"), outArg("PeerConnectionManager", "A_ARG_TYPE_ConnectionManager"), outArg("PeerConnectionID", "A_ARG_TYPE_ConnectionID"),
                outArg("Direction", "A_ARG_TYPE_Direction"), outArg("Status", "A_ARG_TYPE_ConnectionStatus")),
        variable("SourceProtocolInfo", "string", evented = true) + variable("SinkProtocolInfo", "string", evented = true) + variable("CurrentConnectionIDs", "string", evented = true) +
            variable("A_ARG_TYPE_ConnectionStatus", "string", allowed = listOf("OK", "ContentFormatMismatch", "InsufficientBandwidth", "UnreliableChannel", "Unknown")) +
            variable("A_ARG_TYPE_ConnectionManager", "string") + variable("A_ARG_TYPE_Direction", "string", allowed = listOf("Input", "Output")) +
            variable("A_ARG_TYPE_ProtocolInfo", "string") + variable("A_ARG_TYPE_ConnectionID", "i4") + variable("A_ARG_TYPE_AVTransportID", "i4") + variable("A_ARG_TYPE_RcsID", "i4")
    )
}
