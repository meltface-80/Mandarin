// SpotifyAccounts.cs — signing in to Spotify (bug list item 143): your own Client ID (an app you make on Spotify for
// Developers, Development Mode), OAuth with PKCE, and the code sent back to the loopback address Spotify allows
// (SpotifyApi.RedirectUri), which the Android app catches by itself and a browser shows, to be pasted here.
//
//   Begin (Settings: the Client ID)      → the page to approve Mandarin on; the verifier stays here, ten minutes
//   Finish (the address Spotify sent to) → the code, checked against the state, for the tokens; who you are (/me)
//   Sign out                             → the tokens and who you are let go; Soloist's key, room and name kept
//
// The account shares the setting "spotify" with Soloist's (Spotify/SpotifyLive.cs): each writes only its own keys.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Services;

using static ServiceHttp;
using Js = Mandarin.Server.Tags.Js;

internal sealed partial class SpotifyCatalogue
{
    private const double PendingMs = 10 * 60_000;
    private sealed record Pending(string State, string Verifier, string ClientId, string Url, double At);
    private Pending? pending;
    private readonly object signGate = new();

    protected override void ForgetAnswers() => saved = null;

    /* What the status says beyond: a sign-in under way (its page), the Client ID given, where Spotify sends the code. */
    protected override void StatusMore(JsObj o)
    {
        Pending? p;
        lock (signGate) p = pending is { } x && NowMs() - x.At < PendingMs ? x : null;
        if (p != null) o["pending"] = Obj(("url", p.Url));
        o["client_id"] = Js.Str(Or(P(Or(Account(), new JsObj()), "clientId"), ""));
        o["redirect_uri"] = SpotifyApi.RedirectUri;
    }

    /* The account's setting as it is (Soloist's keys in it too), to be written back with this account's keys changed. */
    private JsObj Setting() => Account() is JsObj a ? a : new JsObj();

    /* A sign-in begun with [clientId]: the page to open. */
    public JsObj BeginSignIn(object? clientId)
    {
        var id = Js.Str(Or(clientId, "")).Trim();
        if (id.Length == 0) id = Js.Str(Or(P(Or(Account(), new JsObj()), "clientId"), ""));
        if (!System.Text.RegularExpressions.Regex.IsMatch(id, "^[0-9a-fA-F]{32}$"))
            throw new ServiceError("Your Spotify app's Client ID: 32 letters and digits, from developer.spotify.com/dashboard", 400);
        var (verifier, challenge) = SpotifyApi.Pkce();
        var state = SpotifyApi.Base64Url(System.Security.Cryptography.RandomNumberGenerator.GetBytes(16));
        var url = Api.AuthorizeUrl(id, state, challenge);
        lock (signGate) pending = new Pending(state, verifier, id, url, NowMs());
        var a = Setting();
        a["clientId"] = id;
        Extras.Labels.SetSetting(Id, a);
        Server.Log("[spotify] sign-in begun: waiting for Spotify's answer");
        return Status();
    }

    public void CancelSignIn() { lock (signGate) pending = null; }

    /*
     * The sign-in finished with the address Spotify sent the browser to (or its code alone): the state checked against
     * the sign-in under way, the code exchanged with the verifier kept here, the account kept, its import made when on.
     */
    public async Task<JsObj> FinishSignIn(object? given)
    {
        var text = Js.Str(Or(given, "")).Trim();
        var q = text.Contains('?', StringComparison.Ordinal) ? text[(text.IndexOf('?', StringComparison.Ordinal) + 1)..] : "code=" + text;
        var parts = q.Split('&', StringSplitOptions.RemoveEmptyEntries).Select(s => s.Split('=', 2))
            .ToDictionary(s => Uri.UnescapeDataString(s[0]), s => s.Length > 1 ? Uri.UnescapeDataString(s[1].Replace('+', ' ')) : "", StringComparer.Ordinal);
        if (parts.TryGetValue("error", out var refused)) throw new ServiceError("Spotify said: " + refused, 400);
        Pending p;
        lock (signGate)
        {
            if (pending is not { } x || NowMs() - x.At > PendingMs) throw new ServiceError("No Spotify sign-in is under way: begin it again", 400);
            if (parts.TryGetValue("state", out var st) && st != x.State) throw new ServiceError("That answer is from another sign-in: begin it again", 400);
            p = x;
        }
        if (!parts.TryGetValue("code", out var code) || code.Length == 0) throw new ServiceError("No code in that address: paste the whole address Spotify sent the browser to", 400);
        var token = await Api.Exchange(p.ClientId, code, p.Verifier);
        lock (signGate) pending = null;
        var a = Setting();
        a["clientId"] = p.ClientId;
        a["token"] = token;
        Extras.Labels.SetSetting(Id, a);
        var me = await Api.GetJson("me");
        var user = new JsObj();
        user["id"] = P(me, "id");
        user["display_name"] = P(me, "display_name");
        a = Setting();
        a["user"] = user;
        Extras.Labels.SetSetting(Id, a);
        ForgetAnswers();
        Server.Log("[spotify] signed in");
        await Changed();
        if (Settings().Import && Jobs.Holds("import")) Import.Later(this);
        return Status();
    }

    /* Signed out: the tokens and who you were let go; Soloist's key, room and name (the same setting) kept. */
    public override async Task<JsObj> SignOut()
    {
        CancelSignIn();
        var was = Setting();
        var a = new JsObj();
        foreach (var k in was.Keys.Where(k => k is not ("token" or "user"))) a[k] = was[k];
        Extras.Labels.SetSetting(Id, a);
        ForgetAnswers();
        Server.Log("[spotify] signed out");
        await Changed();
        return Status();
    }
}
