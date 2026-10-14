using System.Net.Http.Headers;
using System.Text;
using System.Text.RegularExpressions;

namespace Mandarin.Tests;

/// <summary>
/// One way in and one way out for every route (v0.9.2, the audit's Q1; server/Mandarin.Server/Http.cs):
/// a body turned down alike wherever it is sent (not JSON, or not an object or an array, a 400; a
/// charset that isn't a UTF one a 415; past 2 MB a 413, with a length or without); and a JSON answer
/// as res.json sent it, with its weak tag, "not modified" for a copy still current, no body to a HEAD
/// (test/http-body.test.js, in C#).
/// </summary>
public sealed class HttpBodyTests
{
    [Test]
    public async Task A_body_turned_down_alike_by_every_route_that_reads_one()
    {
        await using var s = await Session.Started();
        var big = "[" + string.Concat(Enumerable.Repeat("1,", 1100000)) + "1]";
        // [body (null: the big one in chunks, no length), content type, status, error]
        var bodies = new (string? Body, string Type, int Status, string Error)[]
        {
            ("{not json", "application/json", 400, "Bad JSON"),
            ("\"a string\"", "application/json; charset=utf-8", 400, "Bad JSON"),
            ("{}", "application/json; charset=latin1", 415, "unsupported charset \"LATIN1\""),
            (big, "application/json", 413, "request entity too large"),
            (null, "application/json", 413, "request entity too large")
        };
        // Each way a route read one: the settings' and playback's (Auth.Body), the library's (JsBody), the
        // services' and a device's (put back for a route after them), and no route's (Pages.NotThere).
        var routes = new[] { ("POST", "/api/settings/display"), ("POST", "/api/control"), ("POST", "/api/share/encode"),
            ("POST", "/api/library/cleanup"), ("PATCH", "/api/audio-devices/nobody"), ("POST", "/api/nothing") };
        foreach (var (method, p) in routes)
        {
            foreach (var (body, type, status, error) in bodies)
            {
                HttpContent content = body != null
                    ? new ByteArrayContent(Encoding.UTF8.GetBytes(body))
                    : new StreamContent(new MemoryStream(Encoding.UTF8.GetBytes(big))); // no length: sent in chunks
                content.Headers.ContentType = MediaTypeHeaderValue.Parse(type);
                if (body == null) content.Headers.ContentLength = null;
                var r = await Http.Send(new HttpMethod(method), s.Base + p, content, s.H);
                var what = body == null ? "2 MB in chunks" : body[..Math.Min(12, body.Length)];
                Assert.Equal($"{method} {p} {what} {status} C# {error}", $"{method} {p} {what} {r.Status} {r.Header("x-mandarin-answered")} {r.J.Str("error")}");
                Assert.Single(r.J.AsObject());
            }
        }
    }

    [Test]
    public async Task Every_JSON_answer_as_res_json_sent_it_its_tag_not_modified_while_current_no_body_to_a_HEAD()
    {
        await using var s = await Session.Started();
        // Sign-in's, playback's, the library's, a download's and no route's, each once with its own writer.
        foreach (var (p, status) in new[] { ("/api/auth/devices", 200), ("/api/zones", 200), ("/api/settings/display", 200), ("/api/download/t987654", 404), ("/api/nothing", 404) })
        {
            var r = await Http.Get(s.Base + p, s.H);
            Assert.True(r.Status == status, p + " " + r.Text);
            Assert.Matches("^application/json; charset=utf-8$", r.Header("content-type"));
            var tag = r.Header("etag");
            Assert.True(tag != null && Regex.IsMatch(tag, "^W/\"[0-9a-f]+-[A-Za-z0-9+/]{27}\"$"), p + ": the etag package's weak tag: " + tag);
            var again = await Http.Get(s.Base + p, new Dictionary<string, string>(s.H) { ["If-None-Match"] = tag! });
            Assert.True(again.Status == (status == 200 ? 304 : status), p + ": a copy still current");
            if (status != 200) continue;
            var head = await Http.Send(HttpMethod.Head, s.Base + p, null, s.H);
            Assert.Equal((200, tag, ""), (head.Status, head.Header("etag"), head.Text));
        }
    }
}
