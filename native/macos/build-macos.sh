#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE="$ROOT/native/macos/PinDownloaderClipboard.swift"
ARCH="${1:-$(uname -m)}"
SWIFTC="${SWIFTC:-swiftc}"

case "$ARCH" in
  arm64|aarch64)
    ARCH="arm64"
    TARGET="arm64-apple-macos11"
    ;;
  x64|x86_64|amd64)
    ARCH="x64"
    TARGET="x86_64-apple-macos11"
    ;;
  *)
    echo "Usage: $0 [arm64|x64]" >&2
    exit 1
    ;;
esac

OUTPUT_DIR="$ROOT/dist/macos-$ARCH"
OUTPUT="$OUTPUT_DIR/PinDownloaderClipboard"

if ! command -v "$SWIFTC" >/dev/null 2>&1; then
  echo "swiftc was not found. Install Xcode Command Line Tools: xcode-select --install" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
"$SWIFTC" -O -target "$TARGET" -framework AppKit "$SOURCE" -o "$OUTPUT"
chmod 755 "$OUTPUT"
echo "Built $OUTPUT"
