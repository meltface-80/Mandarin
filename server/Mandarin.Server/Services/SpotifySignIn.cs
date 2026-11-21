// SpotifySignIn.cs — signing in to Spotify (bug list item 497): OAuth with PKCE, as Spotify asks of an app with no
// secret.
//
//   1. Begin: a state and a verifier made here and kept ten minutes; the page or the app is given Spotify's address.
//   2. The person approves Mandarin there. Spotify sends them back to http://127.0.0.1:43143/mandarin-spotify with a
//      code and the state: the Android app catches that address; a browser can't open it, and its address is pasted.
//   3. Finish: the address (or its code and state) handed here. The state must be one begun here and not yet used: a
//      code from any other sign-in is refused. The code is exchanged for the tokens with the verifier, the account
//      read (its id and name), and kept; with the import on, the import made.
//
// Finished twice (the app and a paste, or a tap that repeats): the second finds its state used and the account
// signed in already, and is answered with the state as it is, not an error. A sign-in begun again keeps the earlier
// one good until it expires, so the address in a tab opened first still works.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Services;

using static ServiceHttp;
using Js = Mandarin.Server.Tags.Js;

internal sealed partial class SpotifyCatalogue
{
    private const double SignInMs = 10 * 60_000;
    private sealed record Begun(string Verifier, double Expires);
    private readonly object signInGate = new();
    private readonly Dictionary<string, Begun> begun = new(StringComparer.Ordinal);
    private readonly HashSet<string> finishing = new(StringComparer.Ordinal);

    /* A sign-in begun: Spotify's address to approve Mandarin on, and the address it will send the person back to. */
    public JsObj BeginSignIn()
    {
        var (verifier, challenge) = SpotifyApi.Pkce();
        var state = SpotifyApi.Base64Url(System.Security.Cryptography.RandomNumberGenerator.GetBytes(18));
        lock (signInGate)
        {
            foreach (var k in begun.Where(x => x.Value.Expires < NowMs()).Select(x => x.Key).ToList()) begun.Remove(k);
            begun[state] = new Begun(verifier, NowMs() + SignInMs);
        }
        var o = Status();
        o["url"] = Api.AuthorizeUrl(state, challenge);
        o["redirect"] = SpotifyApi.RedirectUri;
        return o;
    }

    /* A sign-in under way, on the state while signed out: the page shows where to paste the address. */
    protected override void StatusMore(JsObj o)
    {
        lock (signInGate) o["pending"] = !Js.Truthy(o["connected"]) && begun.Values.Any(b => b.Expires > NowMs());
        o["redirect"] = SpotifyApi.RedirectUri;
    }

    /*
     * The address Spotify sent the person back to (or its code and state), finished: the account kept. Refused in
     * plain words: an address that isn't Spotify's answer, a sign-in turned down there, one begun elsewhere or expired.
     */
    public async Task<JsObj> FinishSignIn(string? address, string? code, string? state)
    {
        if (!string.IsNullOrWhiteSpace(address))
        {
            var q = QueryOf(address.Trim());
            if (q.TryGetValue("error", out var err))
                throw new ServiceError(err == "access_denied" ? "Spotify says you didn't allow Mandarin: sign in again and choose Agree" : "Spotify turned the sign-in down: " + err, 400);
            q.TryGetValue("code", out code);
            q.TryGetValue("state", out state);
        }
        if (string.IsNullOrEmpty(code) || string.IsNullOrEmpty(state))
            throw new ServiceError("That isn't the address Spotify sent you back to: copy the whole address from the page that didn't open", 400);
        Begun? b;
        lock (signInGate)
        {
            if (!begun.Remove(state, out b))
            {
                if (Connected() || finishing.Contains(state)) return Status();
                throw new ServiceError("That sign-in has expired or was begun elsewhere: sign in again", 400);
            }
            finishing.Add(state);
        }
        try
        {
            if (b.Expires < NowMs()) throw new ServiceError("That sign-in has expired: sign in again", 400);
            var token = await Api.Exchange(code, b.Verifier);
            // The account read with the new token, before anything is kept: kept only whole.
            Extras.SavedSettings.SetSetting(Id, Obj(("token", token), ("userId", null), ("user", null), ("since", NowMs())));
            object? me;
            try { me = await Api.Me(); }
            catch (Exception) { Extras.SavedSettings.SetSetting(Id, null); throw; }
            var userId = Js.Str(Or(P(me, "id"), ""));
            if (userId.Length == 0) { Extras.SavedSettings.SetSetting(Id, null); throw new ServiceError("Spotify gave no account back", 502); }
            var account = Account() as JsObj ?? new JsObj();
            account["userId"] = userId;
            account["user"] = Obj(("id", userId), ("display_name", Or(P(me, "display_name"), userId)));
            Extras.SavedSettings.SetSetting(Id, account);
            lock (signInGate) begun.Clear();
            ForgetAnswers();
            Server.Log($"[spotify] signed in as {new Personal(Js.Str(Or(P(me, "display_name"), userId)))}");
            await Changed();
            if (Settings().Import && Jobs.Holds("import")) Import.Later(this);
            return Status();
        }
        finally { lock (signInGate) finishing.Remove(state); }
    }

    /* The query of an address, decoded; a bare query ("code=…&state=…") taken as one. */
    private static Dictionary<string, string> QueryOf(string address)
    {
        var at = address.IndexOf('?');
        var query = at >= 0 ? address[(at + 1)..] : address;
        var hash = query.IndexOf('#');
        if (hash >= 0) query = query[..hash];
        var o = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var part in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var eq = part.IndexOf('=');
            if (eq <= 0) continue;
            o[Uri.UnescapeDataString(part[..eq].Replace('+', ' '))] = Uri.UnescapeDataString(part[(eq + 1)..].Replace('+', ' '));
        }
        return o;
    }

    /* Signed out: the sign-ins under way let go too. */
    public override Task<JsObj> SignOut()
    {
        lock (signInGate) begun.Clear();
        return base.SignOut();
    }
}
