# The server's routes

Written by `node tools/api-map.js write` from the C# sources (`server/Mandarin.Server/`), and checked by
`npm run gates`: a route added, moved or gone fails it until this is written again. The method is blank
where the code decides it away from the address (the handler says). "…" ends an address the route takes
the rest of; a pattern is as the code writes it. What each answers is said beside its handler.

216 routes.

| Method | Address | Who may ask | Answered in |
|---|---|---|---|
| GET | `/` | signed in | `Pages.cs` |
|  | `/api/(qobuz\|tidal)/(lists\|new-releases\|featured\|search\|artist-albums\|album\|state)` | signed in | `ServiceRoutes.cs` |
|  | `/api/(qobuz\|tidal)/(open\|favorite\|unfavorite\|play)` | signed in | `ServiceRoutes.cs` |
| GET | `/api/album` | signed in | `LibraryRoutes.cs` |
| GET | `/api/album/art-search` | signed in | `LibraryRoutes.cs` |
| GET | `/api/album/booklets` | signed in | `LibraryRoutes.cs` |
| GET | `/api/album/credits` | signed in | `LibraryRoutes.cs` |
| GET | `/api/album/edit` | signed in | `LibraryRoutes.cs` |
| POST | `/api/album/edit` | signed in | `LibraryRoutes.cs` |
| POST | `/api/album/edit/reset` | signed in | `LibraryRoutes.cs` |
| GET | `/api/album/extras` | signed in | `LibraryRoutes.cs` |
| GET | `/api/album/now-playing` | signed in | `PlaybackRoutes.cs` |
| GET | `/api/artist` | signed in | `LibraryRoutes.cs` |
| GET | `/api/artist-albums` | signed in | `LibraryRoutes.cs` |
| GET | `/api/artist-bio` | signed in | `LibraryRoutes.cs` |
| GET | `/api/artist/similar` | signed in | `LibraryRoutes.cs` |
| GET | `/api/artist/similar-albums` | signed in | `LibraryRoutes.cs` |
| GET | `/api/artists` | signed in | `LibraryRoutes.cs` |
| POST | `/api/auth/challenge` | open | `Auth.cs` |
| GET | `/api/auth/devices` | open | `Auth.cs` |
| POST | `/api/auth/devices/revoke` | open | `Auth.cs` |
| POST | `/api/auth/join` | open | `Auth.Open.cs` |
| POST | `/api/auth/logout` | open | `Auth.cs` |
| POST | `/api/auth/open` | open | `Auth.Open.cs` |
| POST | `/api/auth/password` | open | `Auth.cs` |
| POST | `/api/auth/setup` | open | `Auth.cs` |
| GET | `/api/auth/status` | open | `Auth.Open.cs` |
| POST | `/api/auth/verify` | open | `Auth.cs` |
| GET | `/api/backup` | signed in | `AdminRoutes.cs` |
| GET | `/api/backup/download/…` | signed in | `AdminRoutes.cs` |
| POST | `/api/backup/file` | signed in | `AdminRoutes.cs` |
| POST | `/api/backup/restore` | signed in | `AdminRoutes.cs` |
| POST | `/api/backup/restore/…` | signed in | `AdminRoutes.cs` |
| POST | `/api/backup/save` | signed in | `AdminRoutes.cs` |
| GET | `/api/booklet/page` | signed in | `LibraryRoutes.cs` |
| POST | `/api/control` | signed in | `PlaybackRoutes.cs` |
| GET | `/api/cpu` | signed in | `PowerRoutes.cs` |
| GET | `/api/credits/status` | signed in | `LibraryRoutes.cs` |
| GET | `/api/diagnostics` | signed in | `DiagnosticsRoutes.cs` |
| POST | `/api/diagnostics` | signed in | `DiagnosticsRoutes.cs` |
| POST | `/api/diagnostics/clear` | signed in | `DiagnosticsRoutes.cs` |
| GET | `/api/diagnostics/log` | signed in | `DiagnosticsRoutes.cs` |
| GET | `/api/display/content` | signed in | `HousekeepingRoutes.cs` |
| GET | `/api/download/album` | signed in | `LibraryRoutes.cs` |
| POST | `/api/download/albums` | signed in | `LibraryRoutes.cs` |
| GET | `/api/download/auto` | signed in | `LibraryRoutes.cs` |
|  | `/api/download/t([0-9]+)` | signed in | `Downloads.cs` |
| GET | `/api/dsp/headphones` | signed in | `LibraryRoutes.cs` |
| POST | `/api/dsp/headphones/parse` | signed in | `LibraryRoutes.cs` |
| GET | `/api/dsp/headphones/profile` | signed in | `LibraryRoutes.cs` |
| GET | `/api/favourites` | signed in | `LibraryRoutes.cs` |
| POST | `/api/favourites` | signed in | `LibraryRoutes.cs` |
| GET | `/api/filters/decades` | signed in | `LibraryRoutes.cs` |
| GET | `/api/filters/genres` | signed in | `LibraryRoutes.cs` |
| GET | `/api/filters/labels` | signed in | `LibraryRoutes.cs` |
| GET | `/api/filters/tags` | signed in | `LibraryRoutes.cs` |
| POST | `/api/group-outputs` | signed in | `PlaybackRoutes.cs` |
| GET | `/api/health` | open | `LibraryRoutes.cs` |
| GET | `/api/home/album-of-the-day` | signed in | `LibraryRoutes.cs` |
| GET | `/api/home/genre-groups` | signed in | `LibraryRoutes.cs` |
| GET | `/api/home/history` | signed in | `LibraryRoutes.cs` |
| GET | `/api/home/label-of-the-week` | signed in | `LibraryRoutes.cs` |
| GET | `/api/home/unplayed` | signed in | `LibraryRoutes.cs` |
| GET | `/api/identify` | signed in | `LibraryRoutes.cs` |
| POST | `/api/identify/accept` | signed in | `LibraryRoutes.cs` |
| GET | `/api/identify/candidates` | signed in | `LibraryRoutes.cs` |
| POST | `/api/identify/match` | signed in | `LibraryRoutes.cs` |
| GET | `/api/identify/pack` | signed in | `LibraryRoutes.cs` |
| POST | `/api/identify/pack/download` | signed in | `LibraryRoutes.cs` |
| POST | `/api/identify/pack/folder` | signed in | `LibraryRoutes.cs` |
| POST | `/api/identify/pack/remove` | signed in | `LibraryRoutes.cs` |
| POST | `/api/identify/recheck` | signed in | `LibraryRoutes.cs` |
| POST | `/api/identify/recheck-all` | signed in | `LibraryRoutes.cs` |
| POST | `/api/identify/reject` | signed in | `LibraryRoutes.cs` |
| POST | `/api/identify/settings` | signed in | `LibraryRoutes.cs` |
| POST | `/api/identify/undo` | signed in | `LibraryRoutes.cs` |
| GET | `/api/image/…` | signed in, or a signed address | `Images.cs` |
| GET | `/api/label-albums` | signed in | `LibraryRoutes.cs` |
| GET | `/api/labels-scan-log` | signed in | `LibraryRoutes.cs` |
| GET | `/api/labels-scan-status` | signed in | `LibraryRoutes.cs` |
| DELETE | `/api/labels/logo` | signed in | `LibraryRoutes.cs` |
| POST | `/api/labels/logo` | signed in | `LibraryRoutes.cs` |
| GET | `/api/labels/logo-candidates` | signed in | `LibraryRoutes.cs` |
| POST | `/api/labels/merge` | signed in | `LibraryRoutes.cs` |
| POST | `/api/labels/rescan` | signed in | `LibraryRoutes.cs` |
| POST | `/api/labels/rescan-force` | signed in | `LibraryRoutes.cs` |
| GET | `/api/lastfm/similar-albums` | signed in | `LibraryRoutes.cs` |
| GET | `/api/lastfm/similar-artists` | signed in | `LibraryRoutes.cs` |
| GET | `/api/library-stats` | signed in | `LibraryRoutes.cs` |
| GET | `/api/library/albums` | signed in | `LibraryRoutes.cs` |
| GET | `/api/library/browse` | signed in | `ScanRoutes.cs` |
| GET | `/api/library/cleanup` | signed in | `HousekeepingRoutes.cs` |
| POST | `/api/library/cleanup` | signed in | `HousekeepingRoutes.cs` |
| GET | `/api/library/facets` | signed in | `LibraryRoutes.cs` |
| GET | `/api/library/folders` | signed in | `ScanRoutes.cs` |
| POST | `/api/library/folders` | signed in | `ScanRoutes.cs` |
| POST | `/api/library/forget-folder` | signed in | `ScanRoutes.cs` |
| GET | `/api/library/mark` | signed in | `LibraryRoutes.cs` |
| POST | `/api/library/rescan` | signed in | `ScanRoutes.cs` |
| GET | `/api/listen-later` | signed in | `LibraryRoutes.cs` |
| POST | `/api/listen-later` | signed in | `LibraryRoutes.cs` |
| GET | `/api/loudness` | signed in | `LibraryRoutes.cs` |
| POST | `/api/loudness` | signed in | `LibraryRoutes.cs` |
| GET | `/api/music-mount` | signed in | `ScanRoutes.cs` |
| POST | `/api/mute-all` | signed in | `PlaybackRoutes.cs` |
| POST | `/api/output/convenience-switch` | signed in | `PlaybackRoutes.cs` |
| POST | `/api/output/standby` | signed in | `PlaybackRoutes.cs` |
| GET | `/api/outputs` | signed in | `PlaybackRoutes.cs` |
| POST | `/api/pause-all` | signed in | `PlaybackRoutes.cs` |
| GET | `/api/phone/commands` | signed in | `PlaybackRoutes.cs` |
| POST | `/api/phone/hello` | signed in | `PlaybackRoutes.cs` |
| POST | `/api/phone/plays` | signed in | `LibraryRoutes.cs` |
| POST | `/api/phone/state` | signed in | `PlaybackRoutes.cs` |
| GET | `/api/pick-unheard` | signed in | `PlaybackRoutes.cs` |
| GET | `/api/ping` | open | `PingRoutes.cs` |
| GET | `/api/pitchfork/review` | signed in | `LibraryRoutes.cs` |
| GET | `/api/pitchfork/reviews` | signed in | `LibraryRoutes.cs` |
| POST | `/api/play` | signed in | `PlaybackRoutes.cs` |
| POST | `/api/play-from-here` | signed in | `PlaybackRoutes.cs` |
| POST | `/api/play-multi` | signed in | `PlaybackRoutes.cs` |
| POST | `/api/play-track` | signed in | `PlaybackRoutes.cs` |
| POST | `/api/play-unheard` | signed in | `PlaybackRoutes.cs` |
| GET | `/api/playlist` | signed in | `LibraryRoutes.cs` |
| GET | `/api/playlist/art` | signed in | `LibraryRoutes.cs` |
| POST | `/api/playlist/play` | signed in | `LibraryRoutes.cs` |
| POST | `/api/playlist/play-track` | signed in | `LibraryRoutes.cs` |
| GET | `/api/playlists` | signed in | `LibraryRoutes.cs` |
| GET | `/api/qobuz-link` | signed in | `LibraryRoutes.cs` |
| GET | `/api/queue` | signed in | `PlaybackRoutes.cs` |
| POST | `/api/queue/clear` | signed in | `PlaybackRoutes.cs` |
| POST | `/api/queue/history-multi` | signed in | `PlaybackRoutes.cs` |
| POST | `/api/queue/move` | signed in | `PlaybackRoutes.cs` |
| POST | `/api/queue/play-history-next` | signed in | `PlaybackRoutes.cs` |
| POST | `/api/queue/remove` | signed in | `PlaybackRoutes.cs` |
| GET | `/api/radio` | signed in | `PlaybackRoutes.cs` |
| POST | `/api/radio` | signed in | `PlaybackRoutes.cs` |
| GET | `/api/random-albums` | signed in | `LibraryRoutes.cs` |
| POST | `/api/reindex` | signed in | `ScanRoutes.cs` |
| GET | `/api/search` | signed in | `LibraryRoutes.cs` |
| GET | `/api/search-status` | signed in | `ScanRoutes.cs` |
| GET | `/api/search/external` | signed in | `LibraryRoutes.cs` |
| POST | `/api/seek` | signed in | `PlaybackRoutes.cs` |
|  | `/api/services/watch` | signed in | `ServiceRoutes.cs` |
|  | `/api/settings/(qobuz\|tidal)(/import\|/signin\|/signin/cancel\|/signout\|/disconnect)?` | signed in | `ServiceRoutes.cs` |
| GET | `/api/settings/discogs-token` | signed in | `LibraryRoutes.cs` |
| POST | `/api/settings/discogs-token` | signed in | `LibraryRoutes.cs` |
| GET | `/api/settings/display` | signed in | `LibraryRoutes.cs` |
| POST | `/api/settings/display` | signed in | `LibraryRoutes.cs` |
| GET | `/api/settings/fanart-key` | signed in | `LibraryRoutes.cs` |
| POST | `/api/settings/fanart-key` | signed in | `LibraryRoutes.cs` |
| GET | `/api/settings/home-rows` | signed in | `LibraryRoutes.cs` |
| POST | `/api/settings/home-rows` | signed in | `LibraryRoutes.cs` |
| GET | `/api/settings/label-folder-depth` | signed in | `LibraryRoutes.cs` |
| POST | `/api/settings/label-folder-depth` | signed in | `LibraryRoutes.cs` |
| GET | `/api/settings/labels` | signed in | `LibraryRoutes.cs` |
| POST | `/api/settings/labels` | signed in | `LibraryRoutes.cs` |
| GET | `/api/settings/lastfm-key` | signed in | `LibraryRoutes.cs` |
| POST | `/api/settings/lastfm-key` | signed in | `LibraryRoutes.cs` |
| GET | `/api/settings/share-links` | signed in | `LibraryRoutes.cs` |
| POST | `/api/settings/share-links` | signed in | `LibraryRoutes.cs` |
| GET | `/api/settings/shelf` | signed in | `LibraryRoutes.cs` |
| POST | `/api/settings/shelf` | signed in | `LibraryRoutes.cs` |
| GET | `/api/settings/smart-picks` | signed in | `LibraryRoutes.cs` |
| POST | `/api/settings/smart-picks` | signed in | `LibraryRoutes.cs` |
| GET | `/api/settings/waveform` | signed in | `LibraryRoutes.cs` |
| POST | `/api/settings/waveform` | signed in | `LibraryRoutes.cs` |
| POST | `/api/share/encode` | signed in | `LibraryRoutes.cs` |
| POST | `/api/share/import` | signed in | `LibraryRoutes.cs` |
| GET | `/api/shelf/albums` | signed in | `LibraryRoutes.cs` |
| GET | `/api/shortcut/play-random` | signed in | `PlaybackRoutes.cs` |
| GET | `/api/shortcut/play-unheard` | signed in | `PlaybackRoutes.cs` |
| GET | `/api/shortcut/zones` | signed in | `PlaybackRoutes.cs` |
| GET | `/api/similar` | signed in | `LibraryRoutes.cs` |
| GET | `/api/smart-picks` | signed in | `LibraryRoutes.cs` |
| POST | `/api/smart-picks/block` | signed in | `LibraryRoutes.cs` |
| POST | `/api/smart-picks/rebuild` | signed in | `LibraryRoutes.cs` |
| GET | `/api/smart-playlist` | signed in | `LibraryRoutes.cs` |
| GET | `/api/smart-playlist/albums` | signed in | `LibraryRoutes.cs` |
| GET | `/api/smart-playlists` | signed in | `LibraryRoutes.cs` |
| POST | `/api/smart-playlists` | signed in | `LibraryRoutes.cs` |
| POST | `/api/smart-playlists/delete` | signed in | `LibraryRoutes.cs` |
| GET | `/api/status` | signed in | `HousekeepingRoutes.cs` |
| GET | `/api/system/power` | signed in | `PowerRoutes.cs` |
| POST | `/api/system/restart` | signed in | `PowerRoutes.cs` |
| POST | `/api/system/shutdown` | signed in | `PowerRoutes.cs` |
| GET | `/api/tailscale` | signed in | `AdminRoutes.cs` |
| POST | `/api/tailscale/enable` | signed in | `AdminRoutes.cs` |
| POST | `/api/tailscale/login` | signed in | `AdminRoutes.cs` |
| POST | `/api/tailscale/logout` | signed in | `AdminRoutes.cs` |
| POST | `/api/transfer-zone` | signed in | `PlaybackRoutes.cs` |
| POST | `/api/ungroup-outputs` | signed in | `PlaybackRoutes.cs` |
|  | `/api/update/…` | signed in | `UpdateRoutes.cs` |
| POST | `/api/update/apply` | signed in | `UpdateRoutes.cs` |
| POST | `/api/update/check` | signed in | `UpdateRoutes.cs` |
| GET | `/api/update/status` | signed in | `UpdateRoutes.cs` |
| GET | `/api/user-playlist` | signed in | `LibraryRoutes.cs` |
| GET | `/api/user-playlists` | signed in | `LibraryRoutes.cs` |
| POST | `/api/user-playlists` | signed in | `LibraryRoutes.cs` |
| POST | `/api/user-playlists/add` | signed in | `LibraryRoutes.cs` |
| POST | `/api/user-playlists/add-albums` | signed in | `LibraryRoutes.cs` |
| POST | `/api/user-playlists/delete` | signed in | `LibraryRoutes.cs` |
| POST | `/api/volume` | signed in | `PlaybackRoutes.cs` |
| GET | `/api/waveform` | signed in | `LibraryRoutes.cs` |
| POST | `/api/zone-settings` | signed in | `PlaybackRoutes.cs` |
| GET | `/api/zone-state` | signed in | `PlaybackRoutes.cs` |
| GET | `/api/zones` | signed in | `PlaybackRoutes.cs` |
| GET | `/display` | signed in | `Pages.cs` |
| GET | `/index.html` | signed in | `Pages.cs` |
|  | `/internal/jobs/after-scan` | the server's own key | `Jobs.Internal.cs` |
|  | `/internal/jobs/prune` | the server's own key | `Jobs.Internal.cs` |
|  | `/internal/jobs/watch` | the server's own key | `Jobs.Internal.cs` |
|  | `/internal/playback/revision` | the server's own key | `Jobs.Internal.cs` |
| GET | `/login` | open | `Pages.cs` |
| GET | `/server-info` | open | `Server.cs` |
| GET | `/shelf` | signed in | `Pages.cs` |
|  | `/stream/t([0-9]+)(?:\.(orig\|[0-9]+-[0-9]+))?\.([a-z0-9]+)` | signed in, or a signed address | `Streams.cs` |
