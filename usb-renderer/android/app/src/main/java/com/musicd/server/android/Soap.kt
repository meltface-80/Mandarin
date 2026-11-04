package com.musicd.server.android

/** A SOAP answer, or a UPnP fault, as text. */
object Soap {
    class Fault(val code: Int, val description: String) : Exception("UPnP error $code: $description")

    fun response(service: String, action: String, args: List<Pair<String, String>>): String {
        val sb = StringBuilder("<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body>")
        sb.append("<u:").append(action).append("Response xmlns:u=\"").append(service).append("\">")
        for ((k, v) in args) sb.append('<').append(k).append('>').append(Xml.escape(v)).append("</").append(k).append('>')
        sb.append("</u:").append(action).append("Response></s:Body></s:Envelope>")
        return sb.toString()
    }

    fun fault(code: Int, description: String): String =
        "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body>" +
            "<s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns=\"urn:schemas-upnp-org:control-1-0\">" +
            "<errorCode>$code</errorCode><errorDescription>${Xml.escape(description)}</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>"
}
