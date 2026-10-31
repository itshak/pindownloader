#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="com.pindownloader.clipboard"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -d "$SCRIPT_DIR/../../src" ]]; then
  ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
else
  ROOT="$SCRIPT_DIR"
fi
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
INSTALL_DIR="$DATA_HOME/PinDownloader/native"
MANIFEST_PATH="$INSTALL_DIR/$HOST_NAME.json"
CHROME_HOST_DIR="$CONFIG_HOME/google-chrome/NativeMessagingHosts"
EDGE_HOST_DIR="$CONFIG_HOME/microsoft-edge/NativeMessagingHosts"

BROWSER=""
CHROME_ID=""
EDGE_ID=""
COMMON_ID=""
HELPER=""
UNINSTALL=0

usage() {
  cat <<'EOF'
Usage:
  install-linux.sh --browser chrome|edge|both [options]

Options:
  --browser NAME       Browser to register: chrome, edge, or both.
  --chrome-id ID       Chrome extension ID (32 characters).
  --edge-id ID         Edge extension ID (32 characters).
  --id ID              Use one ID for every selected browser.
  --helper PATH        Use a specific PinDownloaderClipboard binary.
  --uninstall          Remove the selected browser registration.
  -h, --help           Show this help.

Copying requires wl-copy (Wayland) or xclip (X11).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --browser) BROWSER="${2:-}"; shift 2 ;;
    --chrome-id) CHROME_ID="${2:-}"; shift 2 ;;
    --edge-id) EDGE_ID="${2:-}"; shift 2 ;;
    --id) COMMON_ID="${2:-}"; shift 2 ;;
    --helper) HELPER="${2:-}"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

select_browser() {
  local choice
  echo "Where should the clipboard helper be registered?"
  echo "  1) Chrome"
  echo "  2) Edge"
  echo "  3) Both"
  read -r -p "Choice [1]: " choice
  case "${choice:-1}" in
    1|chrome|Chrome) BROWSER="chrome" ;;
    2|edge|Edge) BROWSER="edge" ;;
    3|both|Both) BROWSER="both" ;;
    *) echo "Invalid choice." >&2; exit 1 ;;
  esac
}

normalize_id() {
  local value="$1"
  value="$(printf '%s' "$value" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
  if [[ ! "$value" =~ ^[a-p]{32}$ ]]; then
    return 1
  fi
  printf '%s' "$value"
}

ask_id() {
  local label="$1"
  local value=""
  if [[ -t 0 ]]; then
    read -r -p "Paste the 32-character $label extension ID: " value
  fi
  normalize_id "$value"
}

if [[ -z "$BROWSER" ]]; then
  if [[ "$UNINSTALL" -eq 1 ]]; then
    BROWSER="both"
  elif [[ -t 0 ]]; then
    select_browser
  else
    echo "--browser is required when not running interactively." >&2
    usage >&2
    exit 1
  fi
fi

case "$BROWSER" in
  chrome|edge|both) ;;
  *) echo "Invalid browser: $BROWSER" >&2; exit 1 ;;
esac

BROWSERS=()
[[ "$BROWSER" == "chrome" || "$BROWSER" == "both" ]] && BROWSERS+=("chrome")
[[ "$BROWSER" == "edge" || "$BROWSER" == "both" ]] && BROWSERS+=("edge")

host_dir_for() {
  case "$1" in
    chrome) printf '%s' "$CHROME_HOST_DIR" ;;
    edge) printf '%s' "$EDGE_HOST_DIR" ;;
  esac
}

if [[ "$UNINSTALL" -eq 1 ]]; then
  for browser in "${BROWSERS[@]}"; do
    rm -f "$(host_dir_for "$browser")/$HOST_NAME.json"
    echo "Removed $browser native messaging registration."
  done
  if [[ ! -f "$CHROME_HOST_DIR/$HOST_NAME.json" && ! -f "$EDGE_HOST_DIR/$HOST_NAME.json" ]]; then
    rm -rf "$INSTALL_DIR"
    echo "Removed $INSTALL_DIR"
  fi
  exit 0
fi

if [[ -n "$COMMON_ID" ]]; then
  COMMON_ID="$(normalize_id "$COMMON_ID")" || {
    echo "The extension ID must contain 32 characters from a-p." >&2
    exit 1
  }
fi

if [[ -n "$CHROME_ID" ]]; then
  CHROME_ID="$(normalize_id "$CHROME_ID")" || {
    echo "The Chrome extension ID must contain 32 characters from a-p." >&2
    exit 1
  }
fi
if [[ -n "$EDGE_ID" ]]; then
  EDGE_ID="$(normalize_id "$EDGE_ID")" || {
    echo "The Edge extension ID must contain 32 characters from a-p." >&2
    exit 1
  }
fi

for browser in "${BROWSERS[@]}"; do
  if [[ "$browser" == "chrome" && -z "$CHROME_ID" ]]; then
    CHROME_ID="$COMMON_ID"
    if [[ -z "$CHROME_ID" ]]; then
      CHROME_ID="$(ask_id "Chrome")" || {
        echo "A Chrome extension ID is required." >&2
        exit 1
      }
    fi
  fi
  if [[ "$browser" == "edge" && -z "$EDGE_ID" ]]; then
    EDGE_ID="$COMMON_ID"
    if [[ -z "$EDGE_ID" ]]; then
      EDGE_ID="$(ask_id "Edge")" || {
        echo "An Edge extension ID is required." >&2
        exit 1
      }
    fi
  fi
done

if [[ -z "$HELPER" ]]; then
  if [[ -x "$SCRIPT_DIR/PinDownloaderClipboard" ]]; then
    HELPER="$SCRIPT_DIR/PinDownloaderClipboard"
  else
    case "$(uname -m)" in
      arm64|aarch64) HOST_ARCH="arm64" ;;
      x86_64|amd64) HOST_ARCH="x64" ;;
      *) HOST_ARCH="" ;;
    esac
    if [[ -n "$HOST_ARCH" && -x "$ROOT/dist/linux-$HOST_ARCH/PinDownloaderClipboard" ]]; then
      HELPER="$ROOT/dist/linux-$HOST_ARCH/PinDownloaderClipboard"
    elif [[ -x "$ROOT/native/linux/build-linux.sh" ]]; then
      "$ROOT/native/linux/build-linux.sh" "${HOST_ARCH:-x64}"
      HELPER="$ROOT/dist/linux-${HOST_ARCH:-x64}/PinDownloaderClipboard"
    fi
  fi
fi

if [[ -z "$HELPER" || ! -x "$HELPER" ]]; then
  echo "Clipboard helper not found. Use --helper PATH or build it first." >&2
  exit 1
fi

if ! command -v wl-copy >/dev/null 2>&1 && ! command -v xclip >/dev/null 2>&1; then
  echo "Warning: install wl-clipboard (Wayland) or xclip (X11) to enable Copy." >&2
fi

mkdir -p "$INSTALL_DIR" "$CHROME_HOST_DIR" "$EDGE_HOST_DIR"
BINARY_PATH="$INSTALL_DIR/PinDownloaderClipboard"
cp "$HELPER" "$BINARY_PATH"
chmod 755 "$BINARY_PATH"

ORIGIN_LINES=""
add_origin() {
  local origin="    \"chrome-extension://$1/\""
  if [[ -z "$ORIGIN_LINES" ]]; then
    ORIGIN_LINES="$origin"
  elif [[ "$ORIGIN_LINES" != *"$origin"* ]]; then
    ORIGIN_LINES="$ORIGIN_LINES,
$origin"
  fi
}
[[ -n "$CHROME_ID" ]] && add_origin "$CHROME_ID"
[[ -n "$EDGE_ID" ]] && add_origin "$EDGE_ID"

cat > "$MANIFEST_PATH" <<EOF
{
  "name": "$HOST_NAME",
  "description": "PinDownloader clipboard helper",
  "path": "$BINARY_PATH",
  "type": "stdio",
  "allowed_origins": [
$ORIGIN_LINES
  ]
}
EOF
chmod 644 "$MANIFEST_PATH"

for browser in "${BROWSERS[@]}"; do
  browser_dir="$(host_dir_for "$browser")"
  mkdir -p "$browser_dir"
  cp "$MANIFEST_PATH" "$browser_dir/$HOST_NAME.json"
  chmod 644 "$browser_dir/$HOST_NAME.json"
  echo "Registered $browser native messaging host."
done

echo "Installed PinDownloader clipboard helper: $BINARY_PATH"
echo "Restart the selected browser, then reload PinDownloader."
echo "Load the extension from chrome://extensions or edge://extensions (Developer mode)."
