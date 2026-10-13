// Accounts.cs — signing in to Qobuz and Tidal, and out again (v0.8.47, stage
// 4.4 of docs/specs/csharp-migration.md), from lib/qobuz/index.js,
// lib/tidal/index.js and lib/services/streaming.js, rule for rule:
//
//   - Qobuz: a username and a password, asked of Qobuz once (user/login, as
//     the Lyrion plugin asks it); the token kept, and what the page and the
//     play reports need of the user, never the password;
//   - Tidal: OAuth's device flow. Tidal gives a link and a code; the person
//     opens the link on any device and signs in there; Tidal is asked every
//     few seconds whether that has happened, until it has, the code expires,
//     or the sign-in is let go. Then the tokens, the user and the
//     subscription are kept;
//   - signing out: a Qobuz play under way reported over, the account let go.
//
// Each is written as the Node server wrote it (the setting <service>), and the
// Node server told, as each service's afterChange did (Rows.cs Changed). A
// sign-in under way lives here, in memory, as it did there. From here on the
// account is this server's alone: Tidal's token is refreshed here only
// (TidalApi.cs), the Node server never asked.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Services;

using static ServiceHttp;
using Js = Mandarin.Server.Tags.Js;

internal abstract partial class Catalogue
{
    /* The answers kept, forgotten (a sign-in or a sign-out: another account's). */
    protected abstract void ForgetAnswers();

    /*
     * The account let go (streaming.js signOut): what was playing reported
     * over first (whatever that says), the setting null, the answers kept
     * forgotten, the Node server told. The state, as the page reads it.
     */
    public virtual async Task<JsObj> SignOut()
    {
        try { await Stop(); } catch (Exception) { /* as .catch(() => {}) */ }
        Extras.Labels.SetSetting(Id, null);
        ForgetAnswers();
        Server.Log($"[{Id}] signed out");
        await Changed();
        return Status();
    }
}

internal sealed partial class QobuzCatalogue
{
    protected override void ForgetAnswers() => Api.Cache.Clear();

    /* A stable id for this server, as Qobuz's "device" in the reports (index.js deviceId): made once, kept. */
    private object? DeviceId()
    {
        var id = Extras.Labels.Setting("qobuzDeviceId");
        if (!Js.Truthy(id))
        {
            id = Guid.NewGuid().ToString();
            Extras.Labels.SetSetting("qobuzDeviceId", id);
        }
        return id;
    }

    /*
     * Signed in with a username and a password (index.js signIn): Qobuz's
     * token and only what the reports and the page need of the user kept,
     * never the password. Refused in Qobuz's words; both needed first.
     */
    public async Task<JsObj> SignIn(object? username, object? password)
    {
        if (!Js.Truthy(username) || !Js.Truthy(password)) throw new ServiceError("Username and password needed", 400);
        var (token, user) = await Api.Login(Js.Str(username), Js.Str(password), Js.Str(DeviceId()));
        var sub = P(user, "subscription");
        var cred = P(user, "credential");
        var device = P(user, "device");
        var u = Obj(
            ("id", P(user, "id")), ("login", Or(Or(P(user, "login"), P(user, "email")), "")),
            ("display_name", Or(P(user, "display_name"), "")), ("firstname", Or(P(user, "firstname"), "")),
            ("subscription", Js.Truthy(sub) ? Obj(("offer", P(sub, "offer")), ("end_date", P(sub, "end_date"))) : null),
            ("credential", Js.Truthy(cred) ? Obj(("id", P(cred, "id")), ("label", P(cred, "label")), ("parameters", P(cred, "parameters"))) : null),
            ("device", Js.Truthy(device) ? Obj(("id", P(device, "id"))) : null));
        Extras.Labels.SetSetting(Id, Obj(("token", token), ("user", u), ("since", NowMs())));
        Api.Cache.Clear();
        var offer = AndP(u["subscription"], "offer");
        Server.Log($"[qobuz] signed in as {Js.Str(u["login"])}{(Js.Truthy(offer) ? " (" + Js.Str(offer) + ")" : "")}");
        await Changed();
        return Status();
    }
}

internal sealed partial class TidalCatalogue
{
    protected override void ForgetAnswers() => Api.Cache.Clear();

    /* A sign-in under way (index.js pending): the device's code, the link and the code shown, when it expires, how often Tidal is asked, what went wrong. */
    private sealed class SignInUnderWay
    {
        public object? DeviceCode;
        public string Url = "";
        public object? Code;
        public double Expires;
        public double Interval;
        public Timer? Timer;
        public object? Error;
    }

    private readonly object signInGate = new();
    private SignInUnderWay? pending;

    /* A sign-in under way, on the state while signed out (index.js status). */
    protected override void StatusMore(JsObj o)
    {
        SignInUnderWay? p;
        lock (signInGate) p = pending;
        if (p != null && !Js.Truthy(o["connected"]))
            o["pending"] = Obj(("url", p.Url), ("code", p.Code), ("expires_at", p.Expires), ("error", Or(p.Error, null)));
    }

    /*
     * A sign-in begins (index.js beginSignIn): Tidal gives a link and a code,
     * and is asked every few seconds whether the person has signed in with
     * them. Signed in already, or one under way that hasn't failed or
     * expired: the state as it is.
     */
    public async Task<JsObj> BeginSignIn()
    {
        if (Connected()) return Status();
        lock (signInGate)
        {
            if (pending is { } p && !Js.Truthy(p.Error) && NowMs() < p.Expires) return Status();
        }
        CancelSignIn();
        var d = await Api.DeviceAuthorization();
        var next = new SignInUnderWay { DeviceCode = d.DeviceCode, Url = d.Url, Code = d.UserCode, Expires = NowMs() + d.ExpiresIn * 1000, Interval = Math.Max(1, d.Interval) };
        lock (signInGate) pending = next;
        SchedulePoll(next, next.Interval);
        Server.Log($"[tidal] sign in at {d.Url}");
        return Status();
    }

    /* Tidal asked again in [seconds] (index.js schedulePoll); what goes wrong kept on the sign-in, for the page. */
    private void SchedulePoll(SignInUnderWay p, double seconds)
    {
        lock (signInGate)
        {
            if (pending != p) return;
            p.Timer?.Dispose();
            p.Timer = new Timer(_ => _ = PollNow(p), null, TimeSpan.FromMilliseconds(seconds * 1000), Timeout.InfiniteTimeSpan);
        }
    }

    private async Task PollNow(SignInUnderWay p)
    {
        try { await Poll(p); }
        catch (Exception e)
        {
            lock (signInGate)
            {
                if (pending != p) return;
                p.Error = Said(e);
            }
            Server.Log($"[tidal] sign-in: {Said(e)}");
        }
    }

    /* One ask (index.js poll): expired here, said so; not yet, asked again; done, the account kept. */
    private async Task Poll(SignInUnderWay p)
    {
        lock (signInGate)
        {
            if (pending != p) return;
            if (NowMs() > p.Expires) { p.Error = "The sign-in link expired — ask for a new one"; return; }
        }
        var r = await Api.PollDevice(p.DeviceCode);
        lock (signInGate) if (pending != p) return;
        if (r == null) { SchedulePoll(p, p.Interval); return; }
        await FinishSignIn(r);
    }

    /* The sign-in let go (index.js cancelSignIn): no more asking, the link and code forgotten. */
    public void CancelSignIn()
    {
        lock (signInGate)
        {
            pending?.Timer?.Dispose();
            pending = null;
        }
    }

    /*
     * The tokens and the user, kept (index.js finishSignIn); what the page
     * shows (the user's names, the subscription) asked of Tidal once, side by
     * side, and kept too when it answers. Signed in with the import on, the
     * import made, as api-service.js's watch on the sign-in made it.
     */
    private async Task<JsObj> FinishSignIn(JsObj t)
    {
        var tu = t["user"];
        var userId = Or(t["userId"], Js.Truthy(tu) ? Or(P(tu, "userId"), P(tu, "id")) : tu);
        if (!Js.Truthy(t["access"]) || !Js.Truthy(userId)) throw new ServiceError("Tidal gave no account back", 502);
        var u0 = Or(tu, new JsObj());
        var user = Obj(("id", userId), ("username", Or(P(u0, "username"), "")), ("email", Or(P(u0, "email"), "")), ("countryCode", Or(P(u0, "countryCode"), "US")),
            ("firstName", Or(P(u0, "firstName"), "")), ("nickname", Or(P(u0, "nickname"), "")));
        Extras.Labels.SetSetting(Id, Obj(("token", Obj(("access", t["access"]), ("refresh", t["refresh"]), ("expires", t["expires"]))),
            ("userId", userId), ("user", user), ("subscription", null), ("since", NowMs())));
        CancelSignIn();
        HiresDenied = false;
        try
        {
            async Task<object?> Or0(Task<object?> ask) { try { return await ask; } catch (Exception) { return null; } }
            var fullAsked = Or0(Api.User(userId));
            var subAsked = Or0(Api.Subscription(userId));
            var (full, sub) = (await fullAsked, await subAsked);
            var a = Account();
            if (Js.Truthy(full))
            {
                var au = P(a, "user");
                foreach (var k in new[] { "username", "email", "countryCode", "firstName", "nickname" })
                    if (au is JsObj o) o[k] = Or(P(full, k), P(au, k));
                    else _ = P(au, k);
            }
            if (Js.Truthy(sub))
                (a as JsObj ?? throw new JsError("Cannot set properties of " + Js.Str(a) + " (setting 'subscription')"))["subscription"] = Obj(("type", Or(Or(AndP(P(sub, "subscription"), "type"), P(sub, "type")), "")),
                    ("highestSoundQuality", Or(P(sub, "highestSoundQuality"), "")), ("validUntil", Or(P(sub, "validUntil"), null)));
            Extras.Labels.SetSetting(Id, a);
        }
        catch (Exception) { /* the page shows less */ }
        Api.Cache.Clear();
        Server.Log($"[tidal] signed in as {Js.Str(Or(Or(user["email"], user["username"]), userId))}");
        await Changed();
        if (Settings().Import && Jobs.Holds("import")) Import.Later(this);
        return Status();
    }

    /* Signed out (index.js signOut): a sign-in under way let go first. */
    public override Task<JsObj> SignOut()
    {
        CancelSignIn();
        return base.SignOut();
    }
}
