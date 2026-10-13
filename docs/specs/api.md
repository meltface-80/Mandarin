# The server's routes

Written by `node tools/api-map.js write` from the C# sources (`server/Mandarin.Server/`), and checked by
`npm run gates`: a route added, moved or gone fails it until this is written again. The method is blank
where the code decides it away from the address (the handler says). "…" ends an address the route takes
the rest of; a pattern is as the code writes it. What each answers is said beside its handler.

202 routes.

| Method | Address | Who may ask | Answered in |
|---|---|---|---|
| GET | `/` | signed in | `Pages.cs:41` |
|  | `/api/(qobuz\|tidal)/(lists\|new-releases\|featured\|search\|artist-albums\|album\|state)` | signed in | `ServiceRoutes.cs:65` |
|  | `/api/(qobuz\|tidal)/(open\|favorite\|unfavorite\|play)` | signed in | `ServiceRoutes.cs:145` |
| GET | `/api/album` | signed in | `LibraryRoutes.cs:28` |
| GET | `/api/album/art-search` | signed in | `LibraryRoutes.cs:80` |
| GET | `/api/album/booklets` | signed in | `LibraryRoutes.cs:70` |
| GET | `/api/album/edit` | signed in | `LibraryRoutes.cs:79` |
| POST | `/api/album/edit` | signed in | `LibraryRoutes.cs:129` |
| POST | `/api/album/edit/reset` | signed in | `LibraryRoutes.cs:130` |
| GET | `/api/album/extras` | signed in | `LibraryRoutes.cs:69` |
| GET | `/api/album/now-playing` | signed in | `PlaybackRoutes.cs:20` |
| GET | `/api/artist-albums` | signed in | `LibraryRoutes.cs:31` |
| GET | `/api/artist-bio` | signed in | `LibraryRoutes.cs:72` |
| GET | `/api/artists` | signed in | `LibraryRoutes.cs:30` |
| POST | `/api/auth/challenge` | open | `Auth.cs:361` |
| GET | `/api/auth/devices` | open | `Auth.cs:419` |
| POST | `/api/auth/devices/revoke` | open | `Auth.cs:440` |
| POST | `/api/auth/logout` | open | `Auth.cs:410` |
| POST | `/api/auth/password` | open | `Auth.cs:454` |
| POST | `/api/auth/setup` | open | `Auth.cs:333` |
| GET | `/api/auth/status` | open | `Auth.cs:317` |
| POST | `/api/auth/verify` | open | `Auth.cs:381` |
| GET | `/api/backup` | signed in | `AdminRoutes.cs:50` |
| GET | `/api/backup/download/…` | signed in | `AdminRoutes.cs:53` |
| POST | `/api/backup/file` | signed in | `AdminRoutes.cs:51` |
| POST | `/api/backup/restore` | signed in | `AdminRoutes.cs:60` |
| POST | `/api/backup/restore/…` | signed in | `AdminRoutes.cs:61` |
| POST | `/api/backup/save` | signed in | `AdminRoutes.cs:52` |
| GET | `/api/booklet/page` | signed in | `LibraryRoutes.cs:71` |
| POST | `/api/control` | signed in | `PlaybackRoutes.cs:21` |
| GET | `/api/cpu` | signed in | `PowerRoutes.cs:72` |
| GET | `/api/display/content` | signed in | `HousekeepingRoutes.cs:43` |
| GET | `/api/download/album` | signed in | `LibraryRoutes.cs:86` |
| POST | `/api/download/albums` | signed in | `LibraryRoutes.cs:133` |
| GET | `/api/download/auto` | signed in | `LibraryRoutes.cs:87` |
|  | `/api/download/t([0-9]+)` | signed in | `Downloads.cs:216` |
| GET | `/api/dsp/headphones` | signed in | `LibraryRoutes.cs:84` |
| POST | `/api/dsp/headphones/parse` | signed in | `LibraryRoutes.cs:132` |
| GET | `/api/dsp/headphones/profile` | signed in | `LibraryRoutes.cs:85` |
| GET | `/api/favourites` | signed in | `LibraryRoutes.cs:34` |
| POST | `/api/favourites` | signed in | `LibraryRoutes.cs:100` |
| GET | `/api/filters/decades` | signed in | `LibraryRoutes.cs:33` |
| GET | `/api/filters/genres` | signed in | `LibraryRoutes.cs:32` |
| GET | `/api/filters/labels` | signed in | `LibraryRoutes.cs:58` |
| GET | `/api/filters/tags` | signed in | `LibraryRoutes.cs:78` |
| POST | `/api/group-outputs` | signed in | `PlaybackRoutes.cs:22` |
| GET | `/api/health` | open | `LibraryRoutes.cs:22` |
| GET | `/api/home/album-of-the-day` | signed in | `LibraryRoutes.cs:37` |
| GET | `/api/home/genre-groups` | signed in | `LibraryRoutes.cs:36` |
| GET | `/api/home/history` | signed in | `LibraryRoutes.cs:39` |
| GET | `/api/home/label-of-the-week` | signed in | `LibraryRoutes.cs:38` |
| GET | `/api/home/unplayed` | signed in | `LibraryRoutes.cs:40` |
| GET | `/api/identify` | signed in | `LibraryRoutes.cs:52` |
| POST | `/api/identify/accept` | signed in | `LibraryRoutes.cs:106` |
| GET | `/api/identify/candidates` | signed in | `LibraryRoutes.cs:53` |
| POST | `/api/identify/match` | signed in | `LibraryRoutes.cs:111` |
| GET | `/api/identify/pack` | signed in | `LibraryRoutes.cs:54` |
| POST | `/api/identify/pack/download` | signed in | `LibraryRoutes.cs:112` |
| POST | `/api/identify/pack/folder` | signed in | `LibraryRoutes.cs:114` |
| POST | `/api/identify/pack/remove` | signed in | `LibraryRoutes.cs:113` |
| POST | `/api/identify/recheck` | signed in | `LibraryRoutes.cs:109` |
| POST | `/api/identify/recheck-all` | signed in | `LibraryRoutes.cs:110` |
| POST | `/api/identify/reject` | signed in | `LibraryRoutes.cs:107` |
| POST | `/api/identify/settings` | signed in | `LibraryRoutes.cs:105` |
| POST | `/api/identify/undo` | signed in | `LibraryRoutes.cs:108` |
| GET | `/api/image/…` | signed in, or a signed address | `Images.cs:39` |
| GET | `/api/label-albums` | signed in | `LibraryRoutes.cs:59` |
| GET | `/api/labels-scan-log` | signed in | `LibraryRoutes.cs:61` |
| GET | `/api/labels-scan-status` | signed in | `LibraryRoutes.cs:60` |
| DELETE | `/api/labels/logo` | signed in | `LibraryRoutes.cs:138` |
| POST | `/api/labels/logo` | signed in | `LibraryRoutes.cs:119` |
| GET | `/api/labels/logo-candidates` | signed in | `LibraryRoutes.cs:62` |
| POST | `/api/labels/merge` | signed in | `LibraryRoutes.cs:102` |
| POST | `/api/labels/rescan` | signed in | `LibraryRoutes.cs:117` |
| POST | `/api/labels/rescan-force` | signed in | `LibraryRoutes.cs:118` |
| GET | `/api/lastfm/similar-albums` | signed in | `LibraryRoutes.cs:83` |
| GET | `/api/lastfm/similar-artists` | signed in | `LibraryRoutes.cs:82` |
| GET | `/api/library-stats` | signed in | `LibraryRoutes.cs:20` |
| GET | `/api/library/albums` | signed in | `LibraryRoutes.cs:23` |
| GET | `/api/library/browse` | signed in | `ScanRoutes.cs:44` |
| GET | `/api/library/cleanup` | signed in | `HousekeepingRoutes.cs:46` |
| POST | `/api/library/cleanup` | signed in | `HousekeepingRoutes.cs:47` |
| GET | `/api/library/facets` | signed in | `LibraryRoutes.cs:25` |
| GET | `/api/library/folders` | signed in | `ScanRoutes.cs:43` |
| POST | `/api/library/folders` | signed in | `ScanRoutes.cs:45` |
| POST | `/api/library/forget-folder` | signed in | `ScanRoutes.cs:48` |
| GET | `/api/library/mark` | signed in | `LibraryRoutes.cs:24` |
| POST | `/api/library/rescan` | signed in | `ScanRoutes.cs:46` |
| GET | `/api/listen-later` | signed in | `LibraryRoutes.cs:35` |
| POST | `/api/listen-later` | signed in | `LibraryRoutes.cs:101` |
| GET | `/api/loudness` | signed in | `LibraryRoutes.cs:55` |
| POST | `/api/loudness` | signed in | `LibraryRoutes.cs:115` |
| GET | `/api/music-mount` | signed in | `ScanRoutes.cs:41` |
| POST | `/api/mute-all` | signed in | `PlaybackRoutes.cs:21` |
| POST | `/api/output/convenience-switch` | signed in | `PlaybackRoutes.cs:24` |
| POST | `/api/output/standby` | signed in | `PlaybackRoutes.cs:24` |
| GET | `/api/outputs` | signed in | `PlaybackRoutes.cs:19` |
| POST | `/api/pause-all` | signed in | `PlaybackRoutes.cs:21` |
| GET | `/api/phone/commands` | signed in | `PlaybackRoutes.cs:47` |
| POST | `/api/phone/hello` | signed in | `PlaybackRoutes.cs:47` |
| POST | `/api/phone/plays` | signed in | `LibraryRoutes.cs:134` |
| POST | `/api/phone/state` | signed in | `PlaybackRoutes.cs:47` |
| GET | `/api/pick-unheard` | signed in | `PlaybackRoutes.cs:20` |
| GET | `/api/pitchfork/review` | signed in | `LibraryRoutes.cs:74` |
| GET | `/api/pitchfork/reviews` | signed in | `LibraryRoutes.cs:73` |
| POST | `/api/play` | signed in | `PlaybackRoutes.cs:22` |
| POST | `/api/play-from-here` | signed in | `PlaybackRoutes.cs:22` |
| POST | `/api/play-multi` | signed in | `PlaybackRoutes.cs:22` |
| POST | `/api/play-track` | signed in | `PlaybackRoutes.cs:22` |
| POST | `/api/play-unheard` | signed in | `PlaybackRoutes.cs:23` |
| GET | `/api/playlist` | signed in | `LibraryRoutes.cs:50` |
| GET | `/api/playlist/art` | signed in | `LibraryRoutes.cs:51` |
| POST | `/api/playlist/play` | signed in | `LibraryRoutes.cs:98` |
| POST | `/api/playlist/play-track` | signed in | `LibraryRoutes.cs:99` |
| GET | `/api/playlists` | signed in | `LibraryRoutes.cs:49` |
| GET | `/api/qobuz-link` | signed in | `LibraryRoutes.cs:76` |
| GET | `/api/queue` | signed in | `PlaybackRoutes.cs:19` |
| POST | `/api/queue/clear` | signed in | `PlaybackRoutes.cs:23` |
| POST | `/api/queue/history-multi` | signed in | `PlaybackRoutes.cs:23` |
| POST | `/api/queue/move` | signed in | `PlaybackRoutes.cs:23` |
| POST | `/api/queue/play-history-next` | signed in | `PlaybackRoutes.cs:23` |
| POST | `/api/queue/remove` | signed in | `PlaybackRoutes.cs:23` |
| GET | `/api/radio` | signed in | `PlaybackRoutes.cs:19` |
| POST | `/api/radio` | signed in | `PlaybackRoutes.cs:24` |
| GET | `/api/random-albums` | signed in | `LibraryRoutes.cs:27` |
| POST | `/api/reindex` | signed in | `ScanRoutes.cs:47` |
| GET | `/api/search` | signed in | `LibraryRoutes.cs:29` |
| GET | `/api/search-status` | signed in | `ScanRoutes.cs:42` |
| GET | `/api/search/external` | signed in | `LibraryRoutes.cs:77` |
| POST | `/api/seek` | signed in | `PlaybackRoutes.cs:21` |
|  | `/api/services/watch` | signed in | `ServiceRoutes.cs:307` |
|  | `/api/settings/(qobuz\|tidal)(/import\|/signin\|/signin/cancel\|/signout\|/disconnect)?` | signed in | `ServiceRoutes.cs:294` |
| GET | `/api/settings/discogs-token` | signed in | `LibraryRoutes.cs:66` |
| POST | `/api/settings/discogs-token` | signed in | `LibraryRoutes.cs:121` |
| GET | `/api/settings/display` | signed in | `LibraryRoutes.cs:41` |
| POST | `/api/settings/display` | signed in | `LibraryRoutes.cs:91` |
| GET | `/api/settings/fanart-key` | signed in | `LibraryRoutes.cs:65` |
| POST | `/api/settings/fanart-key` | signed in | `LibraryRoutes.cs:120` |
| GET | `/api/settings/home-rows` | signed in | `LibraryRoutes.cs:43` |
| POST | `/api/settings/home-rows` | signed in | `LibraryRoutes.cs:93` |
| GET | `/api/settings/label-folder-depth` | signed in | `LibraryRoutes.cs:64` |
| POST | `/api/settings/label-folder-depth` | signed in | `LibraryRoutes.cs:104` |
| GET | `/api/settings/labels` | signed in | `LibraryRoutes.cs:63` |
| POST | `/api/settings/labels` | signed in | `LibraryRoutes.cs:103` |
| GET | `/api/settings/lastfm-key` | signed in | `LibraryRoutes.cs:81` |
| POST | `/api/settings/lastfm-key` | signed in | `LibraryRoutes.cs:131` |
| GET | `/api/settings/share-links` | signed in | `LibraryRoutes.cs:75` |
| POST | `/api/settings/share-links` | signed in | `LibraryRoutes.cs:124` |
| GET | `/api/settings/smart-picks` | signed in | `LibraryRoutes.cs:42` |
| POST | `/api/settings/smart-picks` | signed in | `LibraryRoutes.cs:92` |
| GET | `/api/settings/waveform` | signed in | `LibraryRoutes.cs:57` |
| POST | `/api/settings/waveform` | signed in | `LibraryRoutes.cs:116` |
| POST | `/api/share/encode` | signed in | `LibraryRoutes.cs:125` |
| POST | `/api/share/import` | signed in | `LibraryRoutes.cs:126` |
| GET | `/api/shelf/albums` | signed in | `LibraryRoutes.cs:26` |
| GET | `/api/shortcut/play-random` | signed in | `PlaybackRoutes.cs:20` |
| GET | `/api/shortcut/play-unheard` | signed in | `PlaybackRoutes.cs:20` |
| GET | `/api/shortcut/zones` | signed in | `PlaybackRoutes.cs:19` |
| GET | `/api/similar` | signed in | `LibraryRoutes.cs:67` |
| GET | `/api/smart-picks` | signed in | `LibraryRoutes.cs:68` |
| POST | `/api/smart-picks/block` | signed in | `LibraryRoutes.cs:123` |
| POST | `/api/smart-picks/rebuild` | signed in | `LibraryRoutes.cs:122` |
| GET | `/api/smart-playlist` | signed in | `LibraryRoutes.cs:45` |
| GET | `/api/smart-playlist/albums` | signed in | `LibraryRoutes.cs:46` |
| GET | `/api/smart-playlists` | signed in | `LibraryRoutes.cs:44` |
| POST | `/api/smart-playlists` | signed in | `LibraryRoutes.cs:127` |
| POST | `/api/smart-playlists/delete` | signed in | `LibraryRoutes.cs:128` |
| GET | `/api/status` | signed in | `HousekeepingRoutes.cs:45` |
| GET | `/api/system/power` | signed in | `PowerRoutes.cs:71` |
| POST | `/api/system/restart` | signed in | `PowerRoutes.cs:73` |
| POST | `/api/system/shutdown` | signed in | `PowerRoutes.cs:74` |
| GET | `/api/tailscale` | signed in | `AdminRoutes.cs:62` |
| POST | `/api/tailscale/enable` | signed in | `AdminRoutes.cs:63` |
| POST | `/api/tailscale/login` | signed in | `AdminRoutes.cs:63` |
| POST | `/api/tailscale/logout` | signed in | `AdminRoutes.cs:63` |
| POST | `/api/transfer-zone` | signed in | `PlaybackRoutes.cs:22` |
| POST | `/api/ungroup-outputs` | signed in | `PlaybackRoutes.cs:22` |
|  | `/api/update/…` | signed in | `UpdateRoutes.cs:23` |
| POST | `/api/update/apply` | signed in | `UpdateRoutes.cs:34` |
| POST | `/api/update/check` | signed in | `UpdateRoutes.cs:29` |
| GET | `/api/update/status` | signed in | `UpdateRoutes.cs:28` |
| GET | `/api/user-playlist` | signed in | `LibraryRoutes.cs:48` |
| GET | `/api/user-playlists` | signed in | `LibraryRoutes.cs:47` |
| POST | `/api/user-playlists` | signed in | `LibraryRoutes.cs:94` |
| POST | `/api/user-playlists/add` | signed in | `LibraryRoutes.cs:96` |
| POST | `/api/user-playlists/add-albums` | signed in | `LibraryRoutes.cs:97` |
| POST | `/api/user-playlists/delete` | signed in | `LibraryRoutes.cs:95` |
| POST | `/api/volume` | signed in | `PlaybackRoutes.cs:21` |
| GET | `/api/waveform` | signed in | `LibraryRoutes.cs:56` |
| POST | `/api/zone-settings` | signed in | `PlaybackRoutes.cs:21` |
| GET | `/api/zone-state` | signed in | `PlaybackRoutes.cs:19` |
| GET | `/api/zones` | signed in | `PlaybackRoutes.cs:19` |
| GET | `/display` | signed in | `Pages.cs:49` |
| GET | `/index.html` | signed in | `Pages.cs:42` |
|  | `/internal/jobs/after-scan` | the server's own key | `Jobs.Internal.cs:48` |
|  | `/internal/jobs/prune` | the server's own key | `Jobs.Internal.cs:63` |
|  | `/internal/jobs/watch` | the server's own key | `Jobs.Internal.cs:54` |
|  | `/internal/playback/revision` | the server's own key | `Jobs.Internal.cs:36` |
| GET | `/login` | open | `Pages.cs:48` |
| GET | `/server-info` | open | `Server.cs:120` |
| GET | `/shelf` | signed in | `Pages.cs:46` |
|  | `/stream/t([0-9]+)(?:\.(orig\|[0-9]+-[0-9]+))?\.([a-z0-9]+)` | signed in, or a signed address | `Streams.cs:38` |
