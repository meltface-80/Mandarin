using Microsoft.Data.Sqlite;

namespace Mandarin.Tests;

/// <summary>
/// Settings → Backup &amp; restore on the page with the copies of the database (bug list item 410;
/// public/app/settings-backup.js, backup-copies.js): a copy kept before a restore listed among the backups with
/// what came after it, the database alone said, Restore… and Delete and no Download; Restore… → Restore now puts it
/// back, and what the restore said of the music folders (the copy's not on this computer, this one's kept) is on the
/// screen Mandarin restarts behind. In a browser at a phone's size.
/// </summary>
public sealed class BackupCopiesPageTests
{
    private const string Look = """
        (async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
          await until(() => document.querySelector("#home-view .album"));
          document.querySelector('.settings-nav-item[data-pane="backup"]').click();
          const card = () => document.querySelector('#backup-list .backup-item[data-where="copy"]');
          await until(card);
          const c = card();
          const out = {
            title: c.querySelector('[data-parity="settings-backup.item-title"]').textContent,
            parts: c.querySelector('[data-parity="settings-backup.item-parts"]').textContent,
            buttons: [...c.querySelectorAll(".backup-item-actions [data-parity]")].map(b => b.textContent),
            others: [...document.querySelectorAll("#backup-list .backup-item")].map(i => i.dataset.where),
          };
          window.__confirmDialog = q => { out.asked = q; return Promise.resolve(true); };
          window.__serverAwayScreen = (t, m) => { out.away = [t, m]; };
          c.querySelector('[data-act="restore"]').click();
          await until(() => c.querySelector('[data-act="go"]'));
          out.ticks = [...c.querySelectorAll(".backup-restore input[data-part]")].map(i => i.dataset.part);
          c.querySelector('[data-act="go"]').click();
          await until(() => out.away);
          return out;
        })()
        """;

    [Test]
    public async Task A_copy_kept_before_a_restore_is_listed_restored_from_the_page_and_the_music_folders_kept_said()
    {
        Needs.Server(); Needs.Ffmpeg(); Browser.Need();
        var lib = Fixtures.MakeLibrary();
        await using var s = await Session.Started(lib: lib);
        var backups = Path.Combine(s.Server.DataDir, "backups");
        Directory.CreateDirectory(backups);
        var copy = Path.Combine(backups, "before-restore-2026-11-14-003225.db");
        using (var dst = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = copy, Pooling = false }.ToString()))
        {
            dst.Open();
            s.Server.Db.BackupDatabase(dst);
            // Made on another computer: its music folder isn't here.
            using var cmd = dst.CreateCommand();
            cmd.CommandText = "INSERT OR REPLACE INTO settings(key, value) VALUES('music_folders', '[\"/music/1tb/Music\"]')";
            cmd.ExecuteNonQuery();
        }
        s.Server.CloseDb();
        await using var b = await Browser.Launch(390, 844);
        var page = await b.Page(s.Base + "/", [new { name = "musicd_session", value = s.Token, url = s.Base }], touch: true);
        var r = (await page.Eval(Look))!;

        Assert.StartsWith("Before the restore of ", (string?)r["title"]);
        Assert.EndsWith(" · on the server", (string?)r["title"]);
        Assert.Equal("The whole database only: no settings", (string?)r["parts"]);
        Assert.Equal(["Restore…", "Delete"], r["buttons"]!.AsArray().Select(x => (string?)x).OfType<string>().ToArray());
        Assert.Equal(["database"], r["ticks"]!.AsArray().Select(x => (string?)x).OfType<string>().ToArray());
        Assert.Contains("The whole database replaces everything Mandarin knows", (string?)r["asked"]);
        Assert.Equal("Restoring…", (string?)r["away"]![0]);
        Assert.Equal("Mandarin is restarting with the restored settings. This page reloads when it's back. The backup's music folders (/music/1tb/Music) aren't on this computer: " +
            $"this one's ({lib.Music}) kept. Its albums are matched to the same files here by the next scan.", (string?)r["away"]![1]);
        Assert.Empty(page.Errors);
    }
}
