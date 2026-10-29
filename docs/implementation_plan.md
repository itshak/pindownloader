# PinDownloader — Implementation Plan

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
├── src/
│   ├── content/
│   │   ├── extractor.js    # pin data / video URL extraction
│   │   ├── ui.js           # Shadow DOM download button
│   │   └── content.js      # pin scoping, video detection, SPA lifecycle
│   ├── background/
│   │   ├── media-tracker.js # record MP4/HLS requests per tab
│   │   └── service-worker.js # download + HLS resolution
│   └── shared/
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
- Button is hidden/removed when leaving a pin page or when the page has no video.

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
  - Parse the saved sample HTML and select the 720p progressive MP4.
  - Sanitize titles and reject invalid/non-pinimg URLs.
  - Derive a progressive MP4 URL from the sample HLS master playlist.
- Browser smoke test:
  - Pin page shows the button below the video.
  - Button is absent on a non-pin page.
  - Clicking downloads a playable file with audio (verified via `ffprobe`).
  - Navigating between pins via SPA updates/removes the button correctly.
- Manual edge cases: slow loading, HLS-only media, re-render, long/unicode titles, refresh,
  multiple Pinterest tabs.

## Acceptance criteria

- Button appears only on `/pin/<numeric-id>` pages containing a video.
- Download is an MP4 with both video and audio.
- Best available quality is selected.
- SPA navigation does not leave stale buttons or download the wrong pin.
- No server-side component and no unnecessary permissions.

## Install (development)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this `pindownloader` folder.
4. Open a Pinterest pin with a video and use **Download video** below the player.

## Risks and limitations

- Pinterest DOM/JSON structure is not public and may change; multiple fallbacks reduce breakage.
- Some videos may be HLS-only with separate audio; these require an ffmpeg-based merge and are
  intentionally reported as unsupported in v1 rather than saved without audio.
- Downloading content may be restricted by copyright and Pinterest's terms. Use for content you
  have rights to.
