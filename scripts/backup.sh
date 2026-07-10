#!/usr/bin/env bash
#
# backup.sh — snapshot the aquarium STATE (registries, memories, souls,
# projects, tasks, channels config) into BACKUPS/aquarium-<timestamp>.tar.gz.
#
# Deliberately EXCLUDED (huge and re-downloadable):
#   - MODELS/  (multi-GB GGUF files)
#   - TOOLS/   (Real-ESRGAN and other binaries)
#
# Keeps the last 10 snapshots, deletes older ones.
#
# Usage:  npm run backup      (or bash scripts/backup.sh)
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AQUA="$REPO_ROOT/aquarium"
DEST="$REPO_ROOT/BACKUPS"

if [[ ! -d "$AQUA" ]]; then
  echo "✗ No aquarium/ directory at $AQUA — nothing to back up."
  exit 1
fi

mkdir -p "$DEST"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$DEST/aquarium-$STAMP.tar.gz"

tar -czf "$OUT" \
  -C "$REPO_ROOT" \
  --exclude='aquarium/MODELS' \
  --exclude='aquarium/TOOLS' \
  --exclude='*.gguf' \
  aquarium

SIZE="$(du -h "$OUT" | cut -f1)"
echo "✓ Backup written: $OUT ($SIZE)"

# Rotation — keep the 10 most recent
ls -1t "$DEST"/aquarium-*.tar.gz 2>/dev/null | tail -n +11 | while read -r old; do
  rm -f "$old" && echo "  rotated out: $(basename "$old")"
done

echo
echo "Restore with:  tar -xzf $OUT -C $REPO_ROOT   (stop the server first)"
