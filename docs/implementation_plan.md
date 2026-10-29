# PinDownloader — Implementation Plan

## Status

Implemented and tested. The extension loads as an unpacked Manifest V3 extension, injects a
Shadow DOM button below the active pin video, extracts the MP4 URL, and downloads a file with
H.264 video and AAC audio.

## Goal

A Chrome Manifest V3 extension that adds a **Download video** button below the video inside a
Pinterest pin page. Clicking it downloads the best available progressive MP4, including audio.

**Scope:** only pin pages whose URL matches `https://www.pinterest.com/pin/<numeric-id>/...`.
No button is added on search, home, or other multi-pin pages. The button only appears when a
pin page actually contains a video.

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
├── docs/
│   └── implementation_plan.md
├── icons/
├── _locales/
│   ├── en/messages.json     # extension name/description
│   └── ru/messages.json
├── src/
│   ├── content/
│   │   ├── extractor.js    # pin data / video URL extraction
│   │   ├── ui.js           # Shadow DOM download button
│   │   └── content.js      # pin scoping, video detection, SPA lifecycle
│   ├── background/
│   │   ├── media-tracker.js # record MP4/HLS requests per tab
│   │   └── service-worker.js # download + HLS resolution
│   └── shared/
│       ├── i18n.js          # English/Russian UI strings
│       └── utils.js
└── tests/
```

### Permissions

- `downloads` — save the selected media file.
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
- Re-run on Pinterest SPA navigation via `MutationObserver`, `popstate`, and a URL watcher.
- Re-attach if Pinterest re-renders and removes the host.
- Once attached, the button remains after playback ends, even if Pinterest hides or replaces the
  video element. It is removed only when leaving the pin URL.
- The UI is localized in English and Russian. Russian is selected when Chrome's UI/system
  language or the browser locale starts with `ru`.

## Download pipeline

1. Content script extracts `{url, quality, title, pinId}`.
2. Service worker validates the URL is HTTPS and hosted on `*.pinimg.com`.
3. Download with `chrome.downloads.download()` to a sanitized path such as
   `Pinterest/<title>_<pinId>_<quality>.mp4` using `conflictAction: "uniquify"`.
4. Report download errors back to the content script for display.

## Milestones

1. **Scaffold:** manifest, service worker, content scripts, placeholder button.
2. **Extraction:** parse relay payload for the sample pin and other pin types.
3. **UI:** correct button placement, Shadow DOM styling, SPA lifecycle.
4. **Download:** service worker download, filename sanitization, status feedback.
5. **Fallbacks:** network tracking, HLS-to-MP4 resolution, fresh-page fetch.
6. **Test and package:** unit tests for extraction/filenames, browser smoke test, install guide.

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
- Manual edge cases: slow loading, re-render, long/unicode titles, refresh, multiple tabs.

## Verification results

Completed on 2026-10-29:

- `npm test` — 9/9 unit tests passed, including Russian language selection.
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

Note: live testing used Pinterest's mobile layout because the logged-out desktop page is gated by
a login modal. Desktop-style injection was verified with a browser fixture using a 420×630 player.

## Acceptance criteria

- Button appears only on `/pin/<numeric-id>` pages containing a video.
- Download is an MP4 with both video and audio.
- Best available quality is selected.
- SPA navigation does not leave stale buttons or download the wrong pin.
- No server-side component and no unnecessary permissions.

## Install (development)

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and select the `pindownloader` folder containing `manifest.json`.
5. Open a Pinterest pin URL such as `https://www.pinterest.com/pin/529524868708976544/`
   and scroll to the video.
6. Click **Download video** directly below the player.
7. The MP4 is saved under the browser's Downloads directory in a `Pinterest/` folder.

After changing extension files, click the reload icon for PinDownloader on
`chrome://extensions`, then refresh the Pinterest tab. The button is intentionally not shown on
search, home, or other multi-pin pages.

## Risks and limitations

- Pinterest DOM/JSON structure is not public and may change; multiple fallbacks reduce breakage.
- Some videos may not expose a progressive MP4; those cannot be saved with audio without an
  ffmpeg-based merge and are reported as unsupported rather than saved without audio.
- Downloading content may be restricted by copyright and Pinterest's terms. Use for content you
  have rights to.
