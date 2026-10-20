# The screens contract: the Android app's native screens and the page, kept the same

Status: built (bug list item 25). It holds Now playing, its Queue tab and the yes-or-no sheet they ask with (items 26 to 29: none of them lacks anything of the page's now), the album page (items 30 and 32, whole since item 44), both out of preview and always the app's since item 47 (the switches in Settings went with it), the mini player (item 35: the page's bar, drawn at the foot of the native album page; whole from the start, so never in preview), the touch layout's row under it (item 38, `nav`, likewise), the Library wall (item 51, `library`; whole since item 52, with its Focus and Sort sheets, its name filter and albums selected), the walls Home links to (item 52, `wall`) and an artist's page (item 52, `artist`), Home (item 57, `home`, whole from the start), Smart Picks (`picks`) and the album Random Album chose (`random-pick`), the search (item 61, `search`, whole from the start; its services' and Pitchfork's sections held on the page by `test/native-search.test.js`, against fakes, as the page test has no services; the field emptied shows the greeting alone, where the page's shows Home's rows under it); your playlists and a playlist of yours (item 65, `playlists`, `playlist`; Import, Share and Add to playlist are the page's sheets over them), the Dynamic Playlists and one of them (item 66, `smart-playlists`, `smart-playlist`; New, Edit and Share are the page's sheets over them); the page's notices (the server's, the update offer) drawn at the head of the native Home, the page deciding what they say and doing what their buttons do (item 69, `home`'s `notice`, `update`); Play on's Group zones and Device power as the app's own sheets, and its question whether to move what's playing to the room chosen (item 68, `group`, `device-power`); the side menu over the native screens (item 67, `menu`; Playlists, Dynamic Playlists and Listen later open natively, the rest are the page's own items, tapped, Restart, Shut down and Shelf with the page in front); these out of preview and always the app's since item 64 (their switches in UI Settings gone, the native Home in front from the app's first frame, online; offline the page's Home and search stay until O1); and each screen made native after them. A sheet's items are `in` the control that opens it, and a sheet is closed by its own `<opener>-close` where it has one. A wall's root is the whole page, so the page's check takes the screens under the same root that are the contract's own (the mini player, the row; `shared` in `test/parity.test.js`) as held by their own checks.

The page stays for browsers, the iPhone, and every screen the app hasn't made native. A screen the app does draw natively is drawn twice, so it can drift: a button added to the page and not the app, a control the app has and the page hasn't, or one called something else. Nothing here relies on remembering. Three machines hold each native screen to one file, and a change that lets the two sides differ doesn't merge.

## The contract

`docs/specs/screens.json` lists, for each screen the app draws natively:

- **Items:** each control (`action`: it can be tapped or dragged) and each thing it shows (`shows`). Each is keyed `<screen>.<item>`.
- **Labels:** what each control is called, aloud as well, one per state (Play / Pause). `{…}` stands for content, as in `Open album: {album}`.
- **Where:** `in` marks an item shown once another is tapped (the Play on list), `when` one shown only sometimes, and `each` one per row.
- **The page's alone:** `only: "page"`, with its reason. One item is like that so far: a desktop's Reduce size.

## Who holds what

| | Held by | Fails when |
|---|---|---|
| The page | `test/parity.test.js` opens each screen in a browser at a phone's size. Every control and every visible text or picture must carry a `data-parity` key; every key of the contract must be there, where and when it says, called what it says. | A control, text or picture is added to the page without its key in the contract, a key is lost, or a label changes |
| The app | `npm run parity` (`tools/quality/parity.js`, `parity-kotlin.js`; in the gates, so it runs before every commit and in CI) reads each native screen's Compose source. Every control (a Material button, slider or tab, a `.clickable`) and every `Text`, `Image` or `Icon` carries `Modifier.parity("<key>")`; a control's label is `Contract.label("<key>")`, never written in the screen. | The app has an item the contract hasn't, a control where the page only shows, a label of its own, or lacks an item the page has |
| The labels | `Contract.kt` in `core` is written from the contract by `npm run parity -- write`, and the gate fails if it differs; `ContractTest` (JVM) checks it against the JSON and fills its `{…}`. | Contract.kt is edited by hand or left behind |
| The colours | `ShellTest`: each native colour is `style.css`'s dark palette token. | A palette token changes on one side |
| The data | `test/golden/android-api.json`: the server's answers as the app's client reads them (AndroidApiTests, LibraryTest). | The server's answer or the client's reading changes alone |
| The look | `node tools/quality/page-metrics.js` opens each screen (and its sheets and menus) in a browser at a phone's size and writes every keyed element's place, size, line boxes and computed style, with a screenshot each. A native screen is drawn to these numbers, not to a reading of the stylesheet; the type is laid out as the browser lays it (`Type.kt`: the page's line boxes, no letter-spacing unless the page has it) and a disc or ring is a filled or outlined button, drawn at its own size, never a plain button's background or border, which lie outside its 48 touch target. | By eye, against the page on the same phone: the app isn't drawn here (bug list item 54 is the first pass over every screen) |

So a change to a native screen goes through the contract, and from there into both sides in one change:
1. A control added to the page fails the page's test until it's in the contract.
2. Once it's in the contract, the gate fails until the app has it too.
3. One added to the app alone fails the gate.

One element can be two screens': Now playing's corner buttons and tabs are the Queue's too, and its Play on and volume menus are the mini player's, so they carry both keys, space-separated, on the page and in the app, and the file is listed under both screens. A composable of the screen's own (a queue row) is covered where every call of it in the file is keyed, the key passed in as its modifier.

Any Compose file in the app is a contract screen's, or listed under `shell` with its reason (the navigation and theme frame), so a native screen can't be built outside the contract.

## Preview, and the gaps list

A screen being built natively stays behind its switch in Settings (`preview: true`). What it lacks of the page's screen is on `tools/quality/parity-gaps.json`, which only shrinks:
- **Shrink-only:** against the commit before, and where the branch left `dev`, the gate refuses a gap that wasn't there. `npm run parity -- accept` takes built items off the list and never adds one, except for a screen new to the app, whose list it writes once.
- **Out of preview:** a screen leaves preview only with no gaps, and never goes back.
- **CI:** CI's gates job fetches the whole history to compare against `dev` (`PARITY_REQUIRE_BASE`).

So the app's native Now playing can be tried before it's whole, but it can't fall further behind while it's being finished. And once it's out of preview, it can't fall behind at all.

## Adding the next screen (N3, the album page, onward)

1. Write its items into the contract, and `data-parity` keys onto the page's elements. Add a way to open it on the page to `SCREENS` in `test/parity.test.js`.
2. Build the Compose screen with `Modifier.parity` on everything, list its file under `native`, and set `preview: true`.
3. Run `npm run parity -- write` (labels), then `npm run parity -- accept` (the new screen's gaps, once).
4. Build until the gaps list is empty, then take it out of preview.

The album page (stage N3) went into the contract before its native screen (item 30), and its native screen (item 32, in preview) is built to it, what it lacks yet on the gaps list: about sixty items, many shown only for some albums (a booklet, a review, Last.fm's suggestions, the app's own Download). What only shows sometimes the page test checks when it is on screen; every key, shown or not, the gate finds written in the page's source (`public/`), so one lost or misspelt fails either way.

From N3 the contract also takes a screen's measures where the design depends on them (the album page's 160px sleeve). The page's test reads them from the computed layout, and the screen from `Contract`.

## What the app's older versions do

Native screens change with an app update, not a server update. The server keeps answering older apps (the API only adds; `docs/specs/plan-android-native.md`). An app not yet updated can lack what a newer page has; the `test-android` pre-release and the version bump carry both together.
