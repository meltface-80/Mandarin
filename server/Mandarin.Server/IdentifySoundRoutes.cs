// IdentifySoundRoutes.cs — Edit album's Match by sound (bug list item 419, Identify/Identifier.SoundByHand.cs): POST
// starts it for one album, GET says where it is and, once done, what it found. One album at a time, the server's
// whole: asked for another while one is under way, it says which (409). A release it offers is applied by
// /api/identify/match with how "sound" (IdentifyRoutes.cs).
namespace Mandarin.Server;

internal static partial class Library
{
    /*
     * GET /api/identify/sound?offset= → { offset, title, state ("fingerprinting", "asking", "fetching", "done"), done,
     * of, answer, error, releases }; { state: "busy", title } while another album's is under way; { state: "none" }.
     */
    private static async Task<bool> IdentifySoundState(HttpContext ctx, Snapshot s, LibState st)
    {
        if (HeldIdentify is not { } id) return false;
        var al = s.Find(Num(Q(ctx, "offset")));
        if (al == null) return await JsError(ctx, 404, "No such album");
        return await SendJs(ctx, id.SoundState(al.Key));
    }

    /* POST /api/identify/sound { offset } → the job's state, as GET says it; 409 while another album's is under way. */
    private static async Task<bool> IdentifySoundStart(HttpContext ctx, Snapshot s, LibState st)
    {
        if (HeldIdentify is not { } id) return false;
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        var offset = JsNumber(b["offset"]);
        var al = s.Find(offset);
        if (al == null) return await JsError(ctx, 404, "No such album");
        if (al.Transient) return await JsError(ctx, 409, "Only an album in your library can be matched by sound");
        var job = id.SoundStart(al, offset, out var busy);
        if (job == null) return await JsError(ctx, 409, "Already matching “" + busy + "” by sound: one album at a time");
        return await SendJs(ctx, job);
    }
}
