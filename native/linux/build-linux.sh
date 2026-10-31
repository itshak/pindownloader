#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE="$ROOT/native/linux/PinDownloaderClipboard.c"
ARCH="${1:-$(uname -m)}"

case "$ARCH" in
  x64|x86_64|amd64)
    ARCH="x64"
    CC="${CC:-gcc}"
    ;;
  arm64|aarch64)
    ARCH="arm64"
    CC="${CC:-aarch64-linux-gnu-gcc}"
    ;;
  *)
    echo "Usage: $0 [x64|arm64]" >&2
    exit 1
    ;;
esac

OUTPUT_DIR="$ROOT/dist/linux-$ARCH"
OUTPUT="$OUTPUT_DIR/PinDownloaderClipboard"

if ! command -v "$CC" >/dev/null 2>&1; then
  echo "Compiler not found: $CC" >&2
  if [[ "$ARCH" == "arm64" ]]; then
    echo "Install gcc-aarch64-linux-gnu for cross-compilation." >&2
  fi
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
"$CC" -std=c11 -O2 -Wall -Wextra -Werror -static -s \
  -o "$OUTPUT" "$SOURCE"
chmod 755 "$OUTPUT"
echo "Built $OUTPUT"
