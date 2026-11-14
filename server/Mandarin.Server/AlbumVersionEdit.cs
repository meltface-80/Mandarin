// AlbumVersionEdit.cs — an album's version details in Edit album (item 420): its version name (what its row on the
// Versions tab and its label among versions say), label, catalogue number, barcode, country, this pressing's year and
// format. Each is, before you touch it, what the match applied says (the release chosen: its edition words, its label
// and catalogue number, …), else what its files say (its title's version words, its tags' label, catalogue number,
// barcode and country), else nothing. Saved in Edit album, a field you changed from that is yours: kept as an overlay
// in album_edits.version (JSON, by field), never written to the files, kept through rescans and in backups, gone with
// Undo all edits. A match applied or another edition switched to later gives every field you left alone the new
// release's word, and never touches one of yours (yours are kept apart from the match, so nothing of the match's has
// to be told from yours). Your words never reach the identification: what you call a version teaches no kind of
// edition (item 414b), nor is a barcode you write looked up.
using System.Globalization;
using System.Text.Json.Nodes;
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

using TJs = Mandarin.Server.Tags.Js;

internal sealed partial class Album
{
    /* The version details written over it by hand (item 420), by field ("name", "label", …); null where there are none. */
    public Dictionary<string, string>? VersionOwn;
}

internal static partial class Library
{
    /* The version's fields, in Edit album's order, and the key of each in a match's candidate (MusicBrainz.CandidateOf). */
    public static readonly (string Field, string Candidate)[] VersionFields =
        [("name", "edition"), ("label", "label"), ("catno", "catno"), ("barcode", "barcode"), ("country", "country"), ("year", "release_year"), ("format", "format")];

    private const int VersionLongest = 200;

    /* A field's words as kept: trimmed, a number as JavaScript writes it, at most 200 characters; null when none. */
    private static string? VersionText(object? v)
    {
        if (v is null or Undef) return null;
        var t = v switch
        {
            double d => d.ToString(CultureInfo.InvariantCulture),
            long l => l.ToString(CultureInfo.InvariantCulture),
            JsonValue jv when jv.TryGetValue<double>(out var d) => d.ToString(CultureInfo.InvariantCulture),
            JsonValue jv when jv.TryGetValue<string>(out var s) => s,
            _ => TJs.Str(v)
        };
        t = t.Trim();
        return t.Length == 0 ? null : t.Length > VersionLongest ? t[..VersionLongest] : t;
    }

    /* The fields kept in album_edits.version, as written there; null when it holds none. */
    private static Dictionary<string, string>? VersionOwnOf(object? stored)
    {
        if (stored is not string s || s.Length == 0) return null;
        try
        {
            if (JsonNode.Parse(s) is not JsonObject o) return null;
            var own = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var (f, _) in VersionFields) if (VersionText(o[f]) is { } t) own[f] = t;
            return own.Count > 0 ? own : null;
        }
        catch (System.Text.Json.JsonException) { return null; }
    }

    /*
     * Each field as it is without your hand: the match applied's word ("match"), else the files' ("files"), else none.
     * The version name from the files is their title's version words ("Kind of Blue (Mono)": Mono).
     */
    private static Dictionary<string, (string? Value, string? From)> VersionBase(SqliteConnection c, Album al)
    {
        JsObj? cand = null;
        var row = Rows(c, "SELECT candidate FROM album_matches WHERE key = $1 AND status = 'applied'", al.Key).FirstOrDefault();
        try { cand = row?[0] is string json ? Scan.JsJson.Parse(json) as JsObj : null; } catch (Exception) { /* none */ }
        var tags = Rows(c, "SELECT label, catno, barcode, country FROM albums WHERE id = $1", al.Id).FirstOrDefault() ?? new object?[4];
        var files = new Dictionary<string, string?>(StringComparer.Ordinal)
        {
            ["name"] = ShelfFacts.SplitVersion(al.Title)?.Version, ["label"] = Text(tags[0]), ["catno"] = Text(tags[1]), ["barcode"] = Text(tags[2]), ["country"] = Text(tags[3])
        };
        var o = new Dictionary<string, (string?, string?)>(StringComparer.Ordinal);
        foreach (var (f, k) in VersionFields)
        {
            var m = cand != null ? VersionText(cand[k]) : null;
            var t = VersionText(files.GetValueOrDefault(f));
            o[f] = m != null ? (m, "match") : t != null ? (t, "files") : (null, null);
        }
        return o;
    }

    /*
     * album_edits.version once [sent] is saved over what is kept ([stored]): each field sent is yours where it differs
     * from what the match or the files give it, and goes back to theirs where it doesn't, or is empty; a field not sent
     * stays as it was. Null when nothing of yours is left.
     */
    private static string? VersionMerged(SqliteConnection c, Album al, object? stored, JsObj? sent)
    {
        var own = VersionOwnOf(stored) ?? new Dictionary<string, string>(StringComparer.Ordinal);
        if (sent != null)
        {
            var bases = VersionBase(c, al);
            foreach (var (f, _) in VersionFields)
            {
                if (!sent.Has(f)) continue;
                var t = VersionText(sent[f]);
                if (t == null || t == bases[f].Value) own.Remove(f); else own[f] = t;
            }
        }
        if (own.Count == 0) return null;
        var j = new JsonObject();
        foreach (var (f, _) in VersionFields) if (own.TryGetValue(f, out var t)) j[f] = t;
        return j.ToJsonString();
    }

    /* Why the version sent can't be saved (null: it can): this pressing's year is four digits, or none. */
    private static string? VersionRefused(JsObj? sent)
    {
        if (sent == null || VersionText(sent["year"]) is not { } y) return null;
        return int.TryParse(y, NumberStyles.None, CultureInfo.InvariantCulture, out var n) && y.Length == 4 && n is >= 1000 and <= 2999
            ? null : "This pressing's year should be four digits, like 2008.";
    }

    /*
     * Edit album's "version": each field's words now ("value": yours, else the match's or the files'), what Put back
     * gives it ("was", from "match" or "files", or none), and whether it is yours ("edited").
     */
    private static JsonObject VersionJson(Album al)
    {
        var o = new JsonObject();
        Dictionary<string, (string? Value, string? From)> bases;
        try { using var c = Db.Open(); bases = VersionBase(c, al); }
        catch (SqliteException) { return o; }   // the version is a help to the editor, not a need
        foreach (var (f, _) in VersionFields)
        {
            var (was, from) = bases[f];
            string? mine = al.VersionOwn?.GetValueOrDefault(f);
            o[f] = new JsonObject { ["value"] = mine ?? was, ["was"] = was, ["from"] = from, ["edited"] = mine != null };
        }
        return o;
    }

    /* Each album's version details written over it by hand (the snapshot's step, before its versions are told apart). */
    private static void VersionEdits(SqliteConnection c, Snapshot s)
    {
        var kept = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
        try
        {
            foreach (var r in Rows(c, "SELECT key, version FROM album_edits WHERE version IS NOT NULL"))
                if (r[0] is string k && VersionOwnOf(r[1]) is { } own) kept[k] = own;
        }
        catch (SqliteException) { /* a database from before the column */ }
        foreach (var al in s.Albums)
        {
            al.VersionOwn = kept.GetValueOrDefault(al.Key);
            if (al.VersionOwn != null) al.Edited = true;   // Undo all edits takes them too
        }
    }
}
