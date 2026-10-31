# PinDownloader — Implementation Plan

## Status

Implemented. The extension loads as an unpacked Manifest V3 extension in Chrome and Microsoft
Edge, injects Shadow DOM download and copy-file controls below the active pin video, extracts the
MP4 URL, and downloads a file with H.264 video and AAC audio. Browser flows and the native-messaging
protocol have been tested with a mock host. The Linux helper and installers are tested locally;
Windows and macOS native builds and clipboard paste still require CI/target-OS validation.

## Goal

A Chrome and Microsoft Edge Manifest V3 extension that adds **Download video** and **Copy**
controls below the video inside a Pinterest pin page. The download action saves the best available
progressive MP4, including audio. The copy action downloads that MP4 and uses a native helper to
put the file on the system clipboard.

**Scope:** only pin pages whose URL matches `https://www.pinterest.com/pin/<numeric-id>/...`.
No controls are added on search, home, or other multi-pin pages. On a pin page, the controls are
created even when the player is slow or not measurable; an action reports clearly if no video can
be resolved.

## Verified extraction path

Sample pin: <https://www.pinterest.com/pin/529524868708976544/>

The server-rendered page contains a relay script with a `v3GetPinQueryv2` payload. The payload
includes the current pin's video metadata:

```json
{
  "videos": {
    "videoList": {
      "v720P": {
        "url": "https://v1.pinimg.com/videos/iht/expMp4/.../..._720w.mp4",
        "width": 720,
        "height": 1280
      },
      "vHLSV4": {
        "url": "https://v1.pinimg.com/videos/iht/hls/.../....m3u8"
      }
    }
  }
}
```

The progressive `expMp4` URL was downloaded and inspected with `ffprobe`:

- Container: MP4
- Video: H.264, 720×1280
- Audio: AAC, stereo, 44.1 kHz
- Duration: 5.0 seconds
- Size: 861,130 bytes
- Direct download succeeds with and without a Pinterest `Referer`

This is the primary source the extension will use. HLS-only media is handled by a fallback that
derives the matching progressive `expMp4` URL from the HLS URL and resolution list.

## Architecture

```
pindownloader/
├── manifest.json
├── README.md
├── LICENSE
├── docs/
│   └── implementation_plan.md
├── icons/
├── _locales/
│   ├── en/messages.json     # extension name/description
│   └── ru/messages.json
├── native/
│   ├── windows/            # C# helper, project, PowerShell installer
│   ├── macos/              # Swift helper + shell installers
│   ├── linux/              # C helper + shell installers
│   └── README.md           # native setup and protocol
├── scripts/
│   └── check-version.mjs   # release tag/version validation
├── src/
│   ├── content/
│   │   ├── extractor.js    # pin data / video URL extraction
│   │   ├── ui.js           # Shadow DOM download + copy controls
│   │   └── content.js      # pin scoping, video detection, SPA lifecycle
│   ├── background/
│   │   ├── media-tracker.js # record MP4/HLS requests per tab
│   │   └── service-worker.js # download, HLS resolution, native messaging
│   └── shared/
│       ├── i18n.js          # English/Russian UI strings
│       └── utils.js
├── tests/
│   ├── unit.test.js
│   ├── native-linux.test.js
│   └── installers.test.js
└── .github/workflows/
    ├── ci.yml
    └── release.yml
```

### Permissions

- `downloads` — save the selected media file.
- `nativeMessaging` — pass the completed download path to the clipboard helper.
- `storage` — keep short-lived per-tab media state in `chrome.storage.session`.
- `webRequest` — observe `.mp4` / `.m3u8` requests made by the Pinterest player.
- Host access: `*://*.pinterest.com/*`, `*://*.pinimg.com/*`.

No remote server, analytics, or credentials are used.

## Extraction strategy

1. **Page data (primary):** read `__PWS_RELAY_REGISTER_COMPLETED_REQUEST__` scripts from the
   current DOM. Parse the second JSON argument, locate the current pin by numeric ID, and collect
   its `videoList` / `videoUrls`.
2. **Preferred URL:** highest-resolution progressive H.264 MP4 (`/expMp4/..._<width>w.mp4`).
   Avoid HEVC/H.265 variants for broad playback compatibility.
3. **DOM fallback:** use a direct HTTPS `video.currentSrc` / `<source>` when available (ignore
   `blob:` URLs created by MSE).
4. **Network fallback:** the service worker records recent pinimg MP4/HLS requests per tab.
   For HLS, parse the master playlist, choose the highest resolution, derive the matching
   progressive MP4 URL, and validate it before returning it.
5. **Fresh-page fallback:** if no data is available after SPA navigation, fetch the current pin
   URL in the content script and parse the returned HTML.
6. **No silent corruption:** if only an unmergeable HLS stream is available, report an error
   instead of downloading video without audio.

## UI behavior

- Content script is injected on Pinterest, but navigation/rendering is gated to `/pin/<id>`.
- Find the active `<video>`, walk up to the smallest wrapper that tightly contains the player,
  and insert a Shadow DOM host immediately after it.
- Button states: `Download video` → `Preparing…` → `Downloading…` → success/error message.
- The **Copy** / **Копировать** control downloads the MP4 and asks the native helper to place
  that file on the system clipboard. Chrome and Edge cannot write MP4 binary data to the
  clipboard themselves.
- Copy status reports `Preparing video…`, `Downloading video… N%`, `Copying to clipboard…`, then
  `Video copied to clipboard.` or a localized error. Progress is sent from the service worker to
  the content script.
- If the native helper is not installed, the copy action reports it before starting a download.
- Re-run on Pinterest SPA navigation via `MutationObserver`, `popstate`, and a URL watcher.
- Re-attach if Pinterest re-renders and removes the host.
- Once attached, the button remains after playback ends, even if Pinterest hides or replaces the
  video element. It is removed only when leaving the pin URL.
- On full-screen/story pins, or when the player is not measurable, the controls are fixed near
  the bottom edge and centered to the video width so they stay visible. Standard pins keep the
  controls below the video.
- A periodic layout sync repositions a control created before the video became measurable and
  keeps it constrained to the viewport.
- If the browser exposes only a `blob:` video URL or the `<video>` element is unmeasurable, a matched
  page video or the presence of any `<video>` still creates the fixed button. As a final fallback,
  every pin URL gets a fixed button even if no player or page video can be detected.
- The UI is localized in English and Russian. Russian is selected when the browser UI/system
  language or the browser locale starts with `ru`.
- The two controls sit side by side in a wrapping-safe row; the download control flexes and the
  copy control keeps its short label visible on narrow mobile players.

## Download pipeline

1. Content script extracts `{url, quality, title, pinId}`.
2. Service worker validates the URL is HTTPS and hosted on `*.pinimg.com`.
3. Download with `chrome.downloads.download()` to a sanitized path such as
   `Pinterest/<title>_<pinId>_<quality>.mp4` using `conflictAction: "uniquify"`.
4. Report download errors back to the content script for display.
5. For **Copy**, first ping `com.pindownloader.clipboard`, then resolve HLS to the matching
   progressive MP4 URL, download it to `Pinterest/`, wait for completion, and send the absolute
   file path to the native helper. The helper writes a Windows file list (`CF_HDROP`), a macOS
   file URL pasteboard item, or a Linux `text/uri-list`. The downloaded file remains on disk.
   The extension always sends to the single host name `com.pindownloader.clipboard`; each
   installer registers the selected Chrome/Edge manifest in the correct OS location, so the same
   extension works with either browser automatically.
6. Native messaging uses a 4-byte little-endian length prefix and UTF-8 JSON. The helper accepts
   only absolute paths to existing, non-empty `.mp4` files.

## Milestones

1. **Scaffold:** manifest, service worker, content scripts, placeholder button.
2. **Extraction:** parse relay payload for the sample pin and other pin types.
3. **UI:** correct button placement, Shadow DOM styling, SPA lifecycle.
4. **Download:** service worker download, filename sanitization, status feedback.
5. **Fallbacks:** network tracking, HLS-to-MP4 resolution, fresh-page fetch.
6. **Native copy:** optional Windows/macOS/Linux helpers, progress reporting, setup installers.
7. **Browser support:** Chrome and Edge native-host registration with interactive selection.
8. **Test and package:** unit tests, Linux helper protocol test, installer tests, browser smoke
   test, install guide.
9. **CI and releases:** build all supported architectures, tag-triggered GitHub Releases.

## Test plan

- Unit tests:
  - Parse relay page data and select the 720p progressive MP4.
  - Keep HLS only when no progressive MP4 is available.
  - Do not associate another pin's video with the current pin.
  - Sanitize titles, validate URLs, and reject non-pin URLs/media hosts.
- Browser smoke test:
  - Pin page shows the button below the video.
  - Button is absent on a non-pin page.
  - Clicking downloads a playable file with audio (verified via `ffprobe`).
  - HLS-only page data resolves to a progressive MP4 and downloads with audio.
  - Navigating between pin/search URLs via SPA updates/removes the button correctly.
- Native helper protocol (Linux): ping, MP4 file copy, URI encoding, and invalid paths tested
  with a fake clipboard command.
- Installer behavior: Chrome/Edge selection, separate IDs, shared manifest origins, and
  per-browser uninstall tested for the Linux and macOS installers.
- Native builds: macOS arm64/x64, Windows x64/arm64, and Linux x64/arm64 built in CI.
- Manual edge cases: slow loading, re-render, long/unicode titles, refresh, multiple tabs.

## Verification results

Completed through 2026-10-31:

- `npm test` — 10/10 unit tests passed, including story-pin extraction and Russian language selection.
- Playwright E2E, direct MP4 path — button appeared below the player, Chrome download completed,
  `ffprobe` reported H.264 720×1280 video and 44.1 kHz stereo AAC audio.
- Playwright E2E, HLS-only path — HLS master playlist resolved to the 720p `expMp4` URL;
  downloaded file again contained H.264 video and stereo AAC audio.
- Playwright E2E, live Pinterest pin (`529524868708976544`) — the button rendered inside
  `CloseupMainPin` below the real video and the downloaded file passed the same `ffprobe` checks.
- Pin-only gating — button was removed on a search URL and returned after SPA navigation back to
  the pin.
- Filename generation — unit-tested to produce `Pinterest/<title>_<pinId>_<quality>.mp4` with
  filesystem-unsafe characters removed.
- End-of-video behavior — button stayed visible after the video was hidden, after the host was
  removed by a simulated React re-render, and after its media wrapper was replaced.
- Russian UI — button label `Скачать видео`, Russian aria-label, and `Загрузка началась.` status
  were verified in Chromium with a Russian locale; the download still completed successfully.
- Story pin (`1040753795155689812`) — button appeared with a desktop-style `blob:` video URL, and
  the page-data fallback resolved HLS to a 720p MP4 with AAC audio.
- Live story pin (`1040753795155689812`) — the button was visible inside a 390×844 viewport and
  downloaded the 720p MP4 with audio.
- No-player story pin fixture — the button appeared from page data alone and downloaded the same
  720p MP4 with audio.
- Missing player and missing inline page data — fetching the pin HTML created the visible fixed
  button, which downloaded the 720p MP4 with audio.
- Missing player, page data, and inline video — the unconditional pin-page fallback still created
  a visible, centered fixed button.
- Media type — the story pin is a 13.16s H.264/AAC MP4, not a GIF.
- Delayed video measurement — the control first appeared as a fixed fallback, then moved below
  the 420×630 player after the periodic sync observed its dimensions.
- Native copy (English) — with a mock Native Messaging host, **Copy** downloaded the 861,130-byte
  MP4, pinged and invoked the helper, and the helper received the exact completed download path.
  The status progressed through `Downloading video… 0%` to `Video copied to clipboard.`
- Native copy on the HLS/story pin (`1040753795155689812`) — **Copy** resolved HLS, downloaded
  the 1,603,608-byte 720p MP4, and passed its exact path to the helper.
- Native copy progress — a synthetic 42% progress message updated the UI to
  `Downloading video… 42%`.
- Native copy (Russian) — labels `Копировать` / `Скопировать видео в буфер обмена` and status
  `Видео скопировано в буфер обмена.` were verified, with the downloaded file path received by
  the helper.
- Native helper missing — **Copy** showed `Clipboard helper is not installed. See native/README.md.`
  and did not start a download.
- Busy-state guard — both controls are disabled while a download or copy is in progress; late
  download-progress events are ignored once the copying stage starts.
- Linux native helper — static x64 build handled ping, copied an MP4 as a `file://` URI through a
  fake `wl-copy`, and rejected missing paths.
- Native installers — Linux and macOS installers registered Chrome and Edge manifests with separate
  extension IDs, and per-browser uninstall removed only the selected browser registration.
- Version check — `node scripts/check-version.mjs v1.2.0` accepted the current package/manifest
  version.
- Windows and macOS helper compilers are not available in this Linux environment. Their source,
  build scripts, installers, and protocol are provided; CI builds and target-OS clipboard paste
  remain to be verified.

Note: live testing used Pinterest's mobile layout because the logged-out desktop page is gated by
a login modal. Desktop-style injection was verified with a browser fixture using a 420×630 player.

## Acceptance criteria

- Controls appear only on `/pin/<numeric-id>` pages; downloads are attempted only when a video
  can be resolved.
- Download is an MP4 with both video and audio.
- Copy places a real local MP4 file reference on the system clipboard through the installed
  native helper; the source file remains on disk.
- Best available quality is selected.
- SPA navigation does not leave stale buttons or download the wrong pin.
- No server-side component and no unnecessary permissions.

## Install

For release installs, download the extension ZIP and native package for the platform from the
GitHub Releases page. The default release contains the extension, macOS arm64, and Windows x64;
manual all-platform releases add macOS x64, Windows arm64, and Linux x64/arm64.

1. Extract the extension ZIP.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the extracted extension folder containing `manifest.json`.
5. Run the native installer for the same browser and pass the extension ID shown on the
   extensions page. The installer prompts for Chrome/Edge when no browser flag is supplied.
6. Open a Pinterest pin URL such as `https://www.pinterest.com/pin/529524868708976544/` and scroll
   to the video.
7. Click **Download video** to save the MP4, or **Copy** to download it and place the file on the
   system clipboard.

The MP4 is saved under the browser's Downloads directory in a `Pinterest/` folder. Linux copy
requires `wl-copy` on Wayland or `xclip` on X11.

For development, load the repository folder directly and reload the extension from the extensions
page after changing files. The button is intentionally not shown on search, home, or other
multi-pin pages.

## Risks and limitations

- Pinterest DOM/JSON structure is not public and may change; multiple fallbacks reduce breakage.
- Some videos may not expose a progressive MP4; those cannot be saved with audio without an
  ffmpeg-based merge and are reported as unsupported rather than saved without audio.
- Browsers do not support writing MP4 binary data to the clipboard. The **Copy** action requires
  the separately installed native helper; without it, use **Download video**.
- The clipboard stores a file reference, not a byte copy. If the downloaded MP4 is moved or
  deleted before pasting, the paste will fail.
- The native helper is provided for Windows, macOS, and Linux. Linux copy requires `wl-copy` or
  `xclip`; the helper reports a clear error when neither is installed.
- Release binaries are not code-signed. Windows SmartScreen and macOS Gatekeeper may warn, and
  macOS users may need to allow the helper in Privacy & Security.
- Chrome and Edge cannot silently install the extension or register a native host. Users must
  load/approve the extension and run the installer once.
- Downloading content may be restricted by copyright and Pinterest's terms. Use for content you
  have rights to.
