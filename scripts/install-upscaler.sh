#!/usr/bin/env bash
#
# install-upscaler.sh — fetch the Real-ESRGAN ncnn-vulkan binary + models
# into aquarium/TOOLS/realesrgan/ so SquidMind can do true GPU super-resolution
# upscaling (no Python, no CUDA toolkit — uses Vulkan).
#
# Usage:  npm run install-upscaler   (or: bash scripts/install-upscaler.sh)
#
set -euo pipefail

# Resolve aquarium/TOOLS/realesrgan relative to the repo root
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$REPO_ROOT/aquarium/TOOLS/realesrgan"
BIN="$DEST/realesrgan-ncnn-vulkan"

if [[ -x "$BIN" ]]; then
  echo "✓ Real-ESRGAN already installed at $BIN"
  exit 0
fi

# Pick the release asset for this OS
UNAME="$(uname -s)"
case "$UNAME" in
  Linux)  ASSET="realesrgan-ncnn-vulkan-20220424-ubuntu.zip" ;;
  Darwin) ASSET="realesrgan-ncnn-vulkan-20220424-macos.zip"  ;;
  *)      echo "Unsupported OS: $UNAME. Download manually from the releases page." ; exit 1 ;;
esac

URL="https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan/releases/download/v0.2.0/$ASSET"

echo "Downloading Real-ESRGAN ($ASSET)…"
mkdir -p "$DEST"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if command -v curl >/dev/null 2>&1; then
  curl -fL "$URL" -o "$TMP/realesrgan.zip"
elif command -v wget >/dev/null 2>&1; then
  wget -q "$URL" -O "$TMP/realesrgan.zip"
else
  echo "Need curl or wget to download. Install one, or fetch manually:"
  echo "  $URL"
  exit 1
fi

echo "Unzipping into $DEST…"
if command -v unzip >/dev/null 2>&1; then
  unzip -o -q "$TMP/realesrgan.zip" -d "$DEST"
else
  echo "unzip not found. Install it (sudo apt install unzip) or extract manually into $DEST"
  exit 1
fi

# The zip sometimes nests everything one folder deep — flatten if needed
if [[ ! -f "$BIN" ]]; then
  INNER="$(find "$DEST" -maxdepth 2 -name 'realesrgan-ncnn-vulkan' -type f | head -n1 || true)"
  if [[ -n "$INNER" ]]; then
    INNER_DIR="$(dirname "$INNER")"
    cp -r "$INNER_DIR"/* "$DEST"/ 2>/dev/null || true
  fi
fi

chmod +x "$BIN" 2>/dev/null || true

if [[ -x "$BIN" ]]; then
  echo "✓ Installed Real-ESRGAN at $BIN"
  echo "  Models: $(ls "$DEST/models" 2>/dev/null | tr '\n' ' ' || echo '(check models/ folder)')"
  echo "  Restart SquidMind — upscale will now use true super-resolution."
else
  echo "✗ Binary not found after extraction. Check $DEST manually."
  exit 1
fi
