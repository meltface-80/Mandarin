// Schema.Added.cs — the columns added after Schema.cs reached its length (it
// only shrinks): its AddedFirst and these, added to a database as it opens,
// and what one just added asks for.
//
//   - devices.joined (bug list item 172): a device made without a password,
//     while the sign-in was off (Auth.Open.cs). It is good on the home network
//     and the tailnet only; a device made by signing in is good everywhere.
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static partial class Schema
{
    private static readonly (string Table, string Column, string Type)[] AddedLater =
    [
        ("devices", "joined", "INTEGER NOT NULL DEFAULT 0"),
    ];

    // Every column added after its table first shipped.
    private static IEnumerable<(string Table, string Column, string Type)> Added => AddedFirst.Concat(AddedLater);

    /* `table` in `schema` (an attached database: a backup's, say) given the columns added since it was made. */
    public static void AddMissing(SqliteConnection c, string schema, string table)
    {
        var have = Columns(c, table, schema);
        if (have.Count == 0) return;
        foreach (var (t, col, type) in Added)
            if (t == table && !have.Contains(col)) Exec(c, $"ALTER TABLE {schema}.{table} ADD COLUMN {col} {type}");
    }

    private static void JustAdded(SqliteConnection c, string table, string col)
    {
        // The classical fields (item 48): every track read once more for them at the next scan.
        if (table == "tracks" && col == "composer") Exec(c, "UPDATE tracks SET tags_v = 1 WHERE tags_v > 1");
        // With no account, no device was made by signing in: every one there is was made without a password (item 161).
        if (table == "devices" && col == "joined" && Scalar(c, "SELECT 1 FROM account") == null) Exec(c, "UPDATE devices SET joined = 1");
    }
}
