// Library.Labels.cs — the labels' groups (out of Library.cs, which only shrinks): each label's albums under its key,
// merged labels under the one they were merged into, and the name most of its own albums use.
namespace Mandarin.Server;

internal static partial class Library
{
    private static Dictionary<string, LabelGroup> BuildLabelGroups(Snapshot s)
    {
        var m = new Dictionary<string, LabelGroup>();
        var order = new List<LabelGroup>();
        foreach (var al in s.Albums)
        {
            if (string.IsNullOrEmpty(al.LabelKey) || !Listed(al)) continue;   // a version the lists don't show (item 345)
            var key = s.MergedKey(al.LabelKey);
            if (!m.TryGetValue(key, out var g)) { m[key] = g = new LabelGroup { Key = key }; order.Add(g); }
            g.Albums.Add(al);
            Bump(g.Names, al.LabelName!);
            if (key == al.LabelKey) Bump(g.OwnNames, al.LabelName!);
        }
        foreach (var (src, mg) in s.LabelMerges)
            if (m.TryGetValue(mg.Target, out var g)) g.MergedFrom.Add((src, mg.SourceName));
        // The name most of its own albums use; the shorter one when tied.
        static string Pick(Dictionary<string, int> names) =>
            Sorted(names.ToList(), (a, b) => b.Value != a.Value ? b.Value.CompareTo(a.Value) : a.Key.Length.CompareTo(b.Key.Length))[0].Key;
        foreach (var g in order)
        {
            g.Title = g.OwnNames.Count > 0 ? Pick(g.OwnNames) : Pick(g.Names);
            g.Albums = Sorted(g.Albums, (a, b) => Or(Kc(a.SortTitleKey, b.SortTitleKey), () => Kc(a.NArtistKey, b.NArtistKey)));
            g.MergedFrom = Sorted(g.MergedFrom, (a, b) => Lc(a.Display, b.Display));
        }
        // Kept in the order first seen, as a Map is.
        var ordered = new Dictionary<string, LabelGroup>();
        foreach (var g in order) ordered[g.Key] = g;
        return ordered;
    }
    private static void Bump(Dictionary<string, int> m, string k) => m[k] = m.TryGetValue(k, out var n) ? n + 1 : 1;
    private static int Or(int a, Func<int> b) => a != 0 ? a : b();
}
