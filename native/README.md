# Native clipboard helper

Chrome and Edge cannot put a video file on the system clipboard through the web Clipboard API.
This optional helper runs as a Native Messaging host, receives a downloaded MP4 path, and places
the file on the OS clipboard the same way Explorer, Finder, or a Linux file manager does.

The extension uses one host name, `com.pindownloader.clipboard`. Chrome and Edge look in their own
manifest locations, and each OS uses its own helper implementation, so the extension itself does
not need browser-specific or OS-specific code.

## Requirements

- Google Chrome or Microsoft Edge.
- A local copy of this repository, or a release package.
- The extension ID from `chrome://extensions` or `edge://extensions`.
- Windows: Windows 10/11. Release builds are self-contained; the source installer can also use
  the built-in .NET Framework compiler.
- macOS: macOS 11 or newer for release builds. Building from source needs Xcode Command Line
  Tools.
- Linux: `wl-copy` from `wl-clipboard` on Wayland, or `xclip` on X11.

The helper binaries are built by CI for release packages. Prebuilt binaries are not committed to
the repository.

## Browser registration

| Browser | Windows registry | macOS manifest directory | Linux manifest directory |
| --- | --- | --- | --- |
| Chrome | `HKCU\Software\Google\Chrome\NativeMessagingHosts` | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts` | `~/.config/google-chrome/NativeMessagingHosts` |
| Edge | `HKCU\Software\Microsoft\Edge\NativeMessagingHosts` | `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts` | `~/.config/microsoft-edge/NativeMessagingHosts` |

All installers accept `--browser chrome`, `--browser edge`, or `--browser both`. The Windows
installer uses `-Browser`. If the browser is omitted, the installer prompts when interactive.

If both browsers load the same unpacked extension folder, they normally use the same extension ID.
If the IDs differ, pass both:

```bash
./install-linux.sh --browser both \
  --chrome-id CHROME_ID \
  --edge-id EDGE_ID
```

## How copying works

1. Click **Copy** / **Копировать** below a Pinterest video.
2. The extension downloads the MP4 to the normal Downloads folder under `Pinterest/`.
3. Once the download completes, Chrome or Edge launches the native helper with the absolute file
   path.
4. The helper places a file reference on the clipboard:
   - Windows: `CF_HDROP`
   - macOS: `public.file-url`
   - Linux: `text/uri-list`

The path is placed on the clipboard, not the video bytes. Keep the downloaded file in place until
you paste it. This is the same model Explorer and Finder use when copying a file.

The UI reports `Downloading video…` with progress, then `Copying to clipboard…`, then success or a
localized error.

## Windows install

From a release package, open PowerShell next to `PinDownloaderClipboard.exe`:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Browser chrome -ExtensionId YOUR_EXTENSION_ID
```

For both browsers:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Browser both `
  -ChromeExtensionId YOUR_CHROME_ID `
  -EdgeExtensionId YOUR_EDGE_ID
```

The script copies the helper to `%LOCALAPPDATA%\PinDownloader\native`, writes the native messaging
manifest, and registers the selected browser.

From the repository, build first and pass the executable:

```powershell
.\native\windows\build-windows.ps1 -Architecture x64
powershell -ExecutionPolicy Bypass -File .\native\windows\install-windows.ps1 `
  -Browser chrome `
  -ExtensionId YOUR_EXTENSION_ID `
  -HelperPath .\dist\windows-x64\PinDownloaderClipboard.exe
```

Uninstall:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Browser both -Uninstall
```

## macOS install

From a release package:

```bash
chmod +x ./install-macos.sh
./install-macos.sh --browser chrome --id YOUR_EXTENSION_ID
```

For both browsers:

```bash
./install-macos.sh --browser both \
  --chrome-id YOUR_CHROME_ID \
  --edge-id YOUR_EDGE_ID
```

The installer copies the helper to `~/Library/Application Support/PinDownloader/native` and writes
the manifest into each selected browser's directory.

From the repository:

```bash
./native/macos/build-macos.sh arm64
./native/macos/install-macos.sh --browser chrome --id YOUR_EXTENSION_ID \
  --helper ./dist/macos-arm64/PinDownloaderClipboard
```

Uninstall:

```bash
./install-macos.sh --browser both --uninstall
```

## Linux install

Install a clipboard tool:

```bash
# Wayland
sudo apt install wl-clipboard

# X11
sudo apt install xclip
```

From a release package:

```bash
chmod +x ./install-linux.sh ./PinDownloaderClipboard
./install-linux.sh --browser chrome --id YOUR_EXTENSION_ID
```

From the repository:

```bash
./native/linux/build-linux.sh x64
./native/linux/install-linux.sh --browser chrome --id YOUR_EXTENSION_ID \
  --helper ./dist/linux-x64/PinDownloaderClipboard
```

The helper is installed under `${XDG_DATA_HOME:-$HOME/.local/share}/PinDownloader/native`.
Uninstall with:

```bash
./install-linux.sh --browser both --uninstall
```

Linux Copy uses `text/uri-list`. Some applications do not accept file-list clipboard data; try
pasting into a file manager or an application that accepts dropped files.

## Finding the extension ID

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Find PinDownloader and copy its 32-character ID.
4. If the extension is reloaded from a different folder, its unpacked ID may change; rerun the
   installer with the new ID.

## Builds

CI builds these native targets:

| Target | Architecture | Default tag release |
| --- | --- | --- |
| macOS | arm64 | Yes |
| macOS | x64 | All-platform workflow |
| Windows | x64 | Yes |
| Windows | arm64 | All-platform workflow |
| Linux | x64 | All-platform workflow |
| Linux | arm64 | All-platform workflow |

Windows release builds use self-contained .NET 8 single-file executables. macOS builds use Swift
and AppKit. Linux builds are static C binaries; arm64 cross-compilation needs
`gcc-aarch64-linux-gnu`.

## Troubleshooting

**“Clipboard helper is not installed” / “Помощник буфера обмена не установлен”**

- Confirm the extension ID used by the installer matches the one in the selected browser.
- Restart the browser completely, then reload the extension.
- Confirm the manifest exists in the selected browser's registration directory.
- On Windows, confirm the registry value points to the manifest.
- On macOS and Linux, confirm the manifest `path` points to an executable file.

**The copy finishes but paste does nothing**

- The file may have been moved or deleted. Copy it again.
- Some applications do not accept file-list clipboard data. Try a file manager or an app that
  accepts dropped files.
- On Linux, install `wl-clipboard` or `xclip`.

**Windows helper does not start**

- Use the release build for your architecture, or build with
  `native\windows\build-windows.ps1`.
- Unsigned local builds may trigger SmartScreen. Code signing is not currently configured.

**macOS blocks the helper**

- Use a locally built helper or a release package from this repository.
- Release signing and notarization are not currently configured.

**Linux helper reports a clipboard error**

- Wayland: install `wl-clipboard` and ensure `WAYLAND_DISPLAY` is available to the browser.
- X11: install `xclip` and ensure `DISPLAY` is available.
- Flatpak/Snap browser sandboxes may block native messaging or clipboard access.

## Protocol

Messages use Chrome's native messaging framing: a 4-byte little-endian length followed by UTF-8
JSON.

Ping:

```json
{"action":"ping"}
```

Response:

```json
{"ok":true,"platform":"linux","version":"1.0.0"}
```

Copy:

```json
{"action":"copyFile","path":"/home/user/Downloads/Pinterest/video.mp4"}
```

The helper accepts only absolute paths to existing, non-empty `.mp4` files. It does not execute
shell commands or access the network.
