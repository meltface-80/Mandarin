// Db.cs — the database, as this server opens it (out of Auth.cs).
//
// Connections are pooled: opening one was a new file handle, the WAL's
// shared memory mapped again and the pragmas set, for every request. Each is
// set as it is handed out, since a pooled connection keeps what the last one
// to borrow it set: a write waits its turn (five seconds at most), a commit
// is synced as WAL mode needs it (NORMAL, as Schema.cs sets its own), and
// foreign keys are off again where one borrower turned them on
// (Services/Rows.cs). Wherever the file is put aside or replaced (a backup
// put back, a restart), the pool lets go of it first (LetGo).
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static class Db
{
    public static string File = "";

    public static SqliteConnection Open()
    {
        var c = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = File, Mode = SqliteOpenMode.ReadWrite, Pooling = true, DefaultTimeout = 10
        }.ToString());
        c.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF;";
        cmd.ExecuteNonQuery();
        return c;
    }

    /* Every pooled connection closed: the file can be moved, replaced or opened anew. */
    public static void LetGo() => SqliteConnection.ClearAllPools();

    // A setting as the Node server kept it: JSON in settings.value.
    public static JsonNode? Setting(SqliteConnection c, string key)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT value FROM settings WHERE key = $k";
        cmd.Parameters.AddWithValue("$k", key);
        var v = cmd.ExecuteScalar() as string;
        if (v == null) return null;
        try { return JsonNode.Parse(v); } catch { return null; }
    }
}
