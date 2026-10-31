# PinDownloader

[![CI](https://github.com/itshak/pindownloader/actions/workflows/ci.yml/badge.svg)](https://github.com/itshak/pindownloader/actions/workflows/ci.yml)
[![Release](https://github.com/itshak/pindownloader/actions/workflows/release.yml/badge.svg)](https://github.com/itshak/pindownloader/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A Manifest V3 extension for **Chrome** and **Microsoft Edge** that adds **Download video** and
**Copy** controls to Pinterest pin pages.

- Downloads the best available progressive MP4 with video and audio.
- Copies the downloaded MP4 file to the system clipboard through an optional native helper.
- Supports Windows, macOS, and Linux native helpers.
- Works in English and Russian.
- No server, analytics, or account access.

The extension is intentionally limited to pin URLs matching
`https://www.pinterest.com/pin/<numeric-id>/...`.

## How it works

The content script finds the active Pinterest video, extracts the current pin's media metadata,
and asks the service worker to download the MP4. When **Copy** is used, the service worker waits
for the download to finish and sends the absolute file path to a small Native Messaging host.
The host places a file reference on the OS clipboard:

- Windows: `CF_HDROP`
- macOS: `public.file-url`
- Linux: `text/uri-list` through `wl-copy` (Wayland) or `xclip` (X11)

The clipboard contains a reference to the downloaded file, not the video bytes. Keep the file in
place until you paste it.

## Browser support

| Browser | Extension | Native copy |
| --- | --- | --- |
| Google Chrome | Yes | Yes |
| Microsoft Edge | Yes | Yes |

The same extension folder and ZIP work in both browsers. The native installer asks which browser
you use and registers the helper for Chrome, Edge, or both.

## Platform support

| Platform | Architectures | Default tag release | Notes |
| --- | --- | --- | --- |
| macOS | arm64, x64 | arm64 | Intel builds are available from the all-platform workflow. |
| Windows | x64, arm64 | x64 | The x64 build also runs on Windows 11 ARM64 through emulation. |
| Linux | x64, arm64 | not included | Requires `wl-clipboard` or `xclip` for Copy. |

Tag releases default to macOS arm64 and Windows x64. The `v1.2.0` release was additionally built
with all platforms, so it includes macOS x64, Windows arm64, and Linux x64/arm64 packages.

**Download video** does not need the native helper. **Copy** does.

## Install from a release

1. Open the [latest release](https://github.com/itshak/pindownloader/releases/latest).
2. Download the extension ZIP: `pindownloader-extension-vX.Y.Z.zip`.
3. Extract it to a permanent folder.
4. Load the extension:
   - Chrome: open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and
     select the extracted folder.
   - Edge: open `edge://extensions`, enable **Developer mode**, click **Load unpacked**, and select
     the extracted folder.
5. Copy the extension ID shown on the extensions page.
6. Download the native package for your OS and architecture.
7. Extract it and run the installer with your browser and extension ID.

### Windows

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Browser chrome -ExtensionId YOUR_EXTENSION_ID
```

For both browsers:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Browser both `
  -ChromeExtensionId YOUR_CHROME_ID `
  -EdgeExtensionId YOUR_EDGE_ID
```

If both browsers use the same unpacked folder, they usually share one ID and you can use
`-ExtensionId` instead.

### macOS

```bash
./install-macos.sh --browser chrome --id YOUR_EXTENSION_ID
```

For both browsers:

```bash
./install-macos.sh --browser both \
  --chrome-id YOUR_CHROME_ID \
  --edge-id YOUR_EDGE_ID
```

### Linux

Install a clipboard tool first:

```bash
# Wayland
sudo apt install wl-clipboard

# X11
sudo apt install xclip
```

Then register the helper:

```bash
./install-linux.sh --browser chrome --id YOUR_EXTENSION_ID
```

Use `--browser edge` or `--browser both` for Edge. If `--browser` is omitted, the installer
prompts interactively. Use `--uninstall` with the same browser selection to remove the helper
registration.

After installing the helper, fully restart the selected browser and reload the extension.

## Install from source

Load the repository root as an unpacked extension in Chrome or Edge. Then build and install the
native helper for your platform.

```bash
npm test
```

### Windows

```powershell
.\native\windows\build-windows.ps1 -Architecture x64
powershell -ExecutionPolicy Bypass -File .\native\windows\install-windows.ps1 `
  -Browser chrome `
  -ExtensionId YOUR_EXTENSION_ID `
  -HelperPath .\dist\windows-x64\PinDownloaderClipboard.exe
```

The installer also has a .NET Framework fallback that compiles `PinDownloaderClipboard.cs` when
no prebuilt executable is supplied.

### macOS

```bash
./native/macos/build-macos.sh arm64
./native/macos/install-macos.sh --browser chrome --id YOUR_EXTENSION_ID \
  --helper ./dist/macos-arm64/PinDownloaderClipboard
```

### Linux

```bash
./native/linux/build-linux.sh x64
./native/linux/install-linux.sh --browser chrome --id YOUR_EXTENSION_ID \
  --helper ./dist/linux-x64/PinDownloaderClipboard
```

## Native helper registration

| Browser | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Chrome | `HKCU\Software\Google\Chrome\NativeMessagingHosts` | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts` | `~/.config/google-chrome/NativeMessagingHosts` |
| Edge | `HKCU\Software\Microsoft\Edge\NativeMessagingHosts` | `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts` | `~/.config/microsoft-edge/NativeMessagingHosts` |

The host name is `com.pindownloader.clipboard`. The extension always sends to this name; each OS
and browser looks in its own manifest location, so the same extension works with either browser.

## Building and testing

```bash
npm test
node scripts/check-version.mjs v1.2.0
```

Native helper builds:

```bash
./native/macos/build-macos.sh arm64
./native/macos/build-macos.sh x64
./native/linux/build-linux.sh x64
./native/linux/build-linux.sh arm64
```

On Windows:

```powershell
.\native\windows\build-windows.ps1 -Architecture x64
.\native\windows\build-windows.ps1 -Architecture arm64
```

The Linux helper has a protocol test that uses a fake clipboard command:

```bash
./native/linux/build-linux.sh x64
npm run test:native:linux
npm run test:installers
```

Cross-compiling Linux arm64 requires `gcc-aarch64-linux-gnu`.

## Releases

A tag matching `vMAJOR.MINOR.PATCH` triggers `.github/workflows/release.yml`. The workflow:

1. runs the unit tests;
2. checks that the tag matches `package.json` and `manifest.json`;
3. builds the default release artifacts: macOS arm64, Windows x64, and the extension ZIP;
4. publishes a GitHub Release with those assets.

To build every supported architecture, manually run the release workflow with
`all_platforms=true`. That adds macOS x64, Windows arm64, Linux x64, and Linux arm64. The release
workflow can also add the full set to an existing tag release. The `v1.2.0` release was published
this way, so all supported architectures are available for that tag.

The CI workflow runs the unit tests and native builds on pushes and pull requests.

## Limitations

- Pinterest page structure is not public and may change.
- Some videos only expose HLS. The extension derives the matching progressive MP4 when possible;
  otherwise it reports that the video cannot be saved with audio.
- Chrome and Edge extensions cannot install or register a native host automatically. The helper
  installer must be run once, and the browser must be restarted.
- Release binaries are not code-signed; Windows SmartScreen and macOS Gatekeeper may warn.
- The clipboard stores a file reference. Moving or deleting the downloaded MP4 before pasting will
  break the paste.
- Some applications do not accept file-list clipboard data. Paste into a file manager or an app
  that accepts dropped files.
- Linux Copy depends on `wl-copy` or `xclip`; Flatpak/Snap browser sandboxes may block native
  messaging or clipboard access.
- Downloading content may be restricted by copyright and Pinterest's terms. Use it only for
  content you have the rights to.

## License

MIT. See [LICENSE](LICENSE).
