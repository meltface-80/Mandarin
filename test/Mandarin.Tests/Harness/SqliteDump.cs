using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Mandarin.Tests;

/// <summary>
/// Everything a database is, as the recordings hold it (test/golden): its tables and indexes as written,
/// their columns, its version and journal, every row, and each table's foreign keys — in the shape
/// better-sqlite3 gave them (a row an object of its columns, a BLOB as base64), so the C# server's file
/// is compared with the Node server's as it was recorded.
/// </summary>
public static class SqliteDump
{
    /// <summary>A connection to <paramref name="file"/>, read only, not pooled.</summary>
    public static SqliteConnection Open(string file, bool readOnly = true)
    {
        var c = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = file, Mode = readOnly ? SqliteOpenMode.ReadOnly : SqliteOpenMode.ReadWriteCreate, Pooling = false }.ToString());
        c.Open();
        return c;
    }

    /// <summary>The rows of <paramref name="sql"/>, each an object of its columns as better-sqlite3 read them.</summary>
    public static JsonArray All(SqliteConnection db, string sql)
    {
        using var q = db.CreateCommand();
        q.CommandText = sql;
        using var r = q.ExecuteReader();
        var rows = new JsonArray();
        while (r.Read())
        {
            var o = new JsonObject();
            for (int i = 0; i < r.FieldCount; i++) o[r.GetName(i)] = Value(r.IsDBNull(i) ? null : r.GetValue(i));
            rows.Add(o);
        }
        return rows;
    }

    // A value as better-sqlite3 gave it, then JSON (a Buffer as base64, as the recordings' replacer wrote it).
    private static JsonNode? Value(object? v) => v switch
    {
        null => null,
        long l => JsonValue.Create(l),
        double d => JsonValue.Create(d),
        string s => JsonValue.Create(s),
        byte[] b => JsonValue.Create(Convert.ToBase64String(b)),
        _ => JsonValue.Create(Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture))
    };

    private static JsonNode? Scalar(SqliteConnection db, string sql)
    {
        using var q = db.CreateCommand();
        q.CommandText = sql;
        return Value(q.ExecuteScalar());
    }

    /// <summary>Everything <paramref name="file"/> is, as dump() in the Node suite gave it.</summary>
    public static JsonObject Dump(string file)
    {
        using var db = Open(file);
        var master = All(db, "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name");
        var tables = master.Where(m => m.Str("type") == "table").Select(m => m.Str("name")!).ToList();
        var columns = new JsonObject();
        var rows = new JsonObject();
        foreach (var name in tables)
        {
            columns[name] = All(db, $"PRAGMA table_info({name})");
            rows[name] = new JsonArray([.. All(db, $"SELECT * FROM {name} ORDER BY rowid").Select(r => (JsonNode?)JsonValue.Create(JsJson.Stringify(r)))]);
        }
        return new JsonObject
        {
            ["master"] = master,
            ["columns"] = columns,
            ["rows"] = rows,
            ["version"] = Scalar(db, "PRAGMA user_version"),
            ["journal"] = Scalar(db, "PRAGMA journal_mode"),
            // Only what a write in the file itself says: WAL is the file's header.
            ["foreignKeyList"] = new JsonArray([.. tables.Select(t => (JsonNode?)new JsonArray(t, All(db, $"PRAGMA foreign_key_list({t})")))])
        };
    }

    /// <summary>Statements run on a database file made for a test.</summary>
    public static void Exec(string file, string sql)
    {
        using var db = Open(file, readOnly: false);
        using var q = db.CreateCommand();
        q.CommandText = sql;
        q.ExecuteNonQuery();
    }
}
