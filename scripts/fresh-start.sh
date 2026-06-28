#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  IAQUA fresh-start
# ─────────────────────────────────────────────────────────────────────────────
#  One-shot script to wipe local state and boot the server from a clean slate.
#
#  What it does (in order):
#    1. Sanity checks (Node ≥ 22, git repo, location)
#    2. Optional backup of current aquarium/ folder
#    3. Pull latest from origin/main
#    4. Wipe node_modules + package-lock.json
#    5. Wipe aquarium/ (will be reseeded automatically by server boot)
#    6. Wipe aquarium/.backups/ if present
#    7. npm install
#    8. (Optional) rebuild node-llama-cpp for your GPU
#    9. Start the server
#
#  Usage:
#    chmod +x scripts/fresh-start.sh
#    ./scripts/fresh-start.sh             # interactive, asks before each destructive step
#    ./scripts/fresh-start.sh --yes       # non-interactive, accepts all destructive steps
#    ./scripts/fresh-start.sh --no-wipe   # keep aquarium/ state, only refresh deps
#    ./scripts/fresh-start.sh --no-pull   # skip git pull
#    ./scripts/fresh-start.sh --no-start  # do everything except launch the server
#    ./scripts/fresh-start.sh --rebuild-llama   # also rebuild node-llama-cpp
#    ./scripts/fresh-start.sh --with-imagegen   # clone+build stable-diffusion.cpp
#                                                 + download Flux companion safetensors
#
#  Bail-out: hit Ctrl-C at any prompt.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Args ─────────────────────────────────────────────────────────────────────
AUTO_YES=0
DO_PULL=1
DO_WIPE=1
DO_START=1
DO_REBUILD_LLAMA=0
DO_IMAGEGEN=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y)           AUTO_YES=1 ;;
    --no-pull)          DO_PULL=0 ;;
    --no-wipe)          DO_WIPE=0 ;;
    --no-start)         DO_START=0 ;;
    --rebuild-llama)    DO_REBUILD_LLAMA=1 ;;
    --with-imagegen)    DO_IMAGEGEN=1 ;;
    --help|-h)
      sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $arg (use --help)"; exit 1 ;;
  esac
done

# ── Colors ───────────────────────────────────────────────────────────────────
C_RESET=$'\033[0m'
C_DIM=$'\033[2m'
C_RED=$'\033[31m'
C_GREEN=$'\033[32m'
C_YELLOW=$'\033[33m'
C_CYAN=$'\033[36m'
C_BOLD=$'\033[1m'

say() { printf '%s\n' "${C_CYAN}▸${C_RESET} $*"; }
ok()  { printf '%s\n' "${C_GREEN}✓${C_RESET} $*"; }
warn(){ printf '%s\n' "${C_YELLOW}⚠${C_RESET} $*"; }
die() { printf '%s\n' "${C_RED}✗ $*${C_RESET}"; exit 1; }

confirm() {
  # confirm "message" → returns 0 if yes
  [[ $AUTO_YES -eq 1 ]] && return 0
  read -r -p "  ${C_BOLD}$1${C_RESET} [y/N] " ans
  [[ "$ans" =~ ^[yY]$ ]]
}

# ── 1. Sanity checks ─────────────────────────────────────────────────────────
say "Checking environment…"

# Must be in a git repo
git rev-parse --is-inside-work-tree &>/dev/null || die "Not inside a git repo. cd into squidmind/ first."

# Must be inside squidmind repo (sanity)
REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"
[[ -f "server/index.js" && -f "server/aquarium.js" ]] || die "Not the squidmind repo (server/index.js missing)."

# Node version ≥ 22
if ! command -v node &>/dev/null; then die "node not found. Install Node 22+."; fi
NODE_MAJOR=$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')
if [[ $NODE_MAJOR -lt 22 ]]; then die "Node $NODE_MAJOR detected, need ≥ 22. Run: nvm install 22 && nvm use 22"; fi
ok "Node $(node -v) · git repo: $REPO_ROOT"

# ── 2. Backup current aquarium/ (optional) ───────────────────────────────────
if [[ -d aquarium && $DO_WIPE -eq 1 ]]; then
  if confirm "Backup current aquarium/ before wiping?"; then
    STAMP=$(date -u +"%Y-%m-%dT%H-%M-%SZ")
    BACKUP="aquarium.backup.$STAMP"
    say "Copying aquarium/ → $BACKUP …"
    cp -r aquarium "$BACKUP"
    ok "Backup created: $BACKUP"
  else
    warn "Skipping backup — aquarium/ contents will be lost."
  fi
fi

# ── 3. Pull latest ───────────────────────────────────────────────────────────
if [[ $DO_PULL -eq 1 ]]; then
  say "Pulling latest from origin/main…"
  # Only pull if we have a clean working tree (no uncommitted changes)
  if ! git diff-index --quiet HEAD --; then
    warn "Working tree has uncommitted changes — pull skipped."
    warn "Resolve them with: git status, then re-run with --no-pull or commit first."
  else
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    git fetch origin --quiet
    git pull origin "$CURRENT_BRANCH"
    ok "On branch $CURRENT_BRANCH @ $(git rev-parse --short HEAD)"
  fi
fi

# ── 4. Wipe node_modules + lockfile ──────────────────────────────────────────
if [[ -d node_modules ]]; then
  if confirm "Wipe node_modules/ and package-lock.json for clean install?"; then
    say "Removing node_modules/ and package-lock.json…"
    rm -rf node_modules package-lock.json
    ok "Dependencies cleared."
  fi
fi

# ── 5. Wipe aquarium/ ────────────────────────────────────────────────────────
if [[ $DO_WIPE -eq 1 && -d aquarium ]]; then
  if confirm "Wipe aquarium/ state directory? (server will reseed it on first boot)"; then
    say "Wiping aquarium/ …"
    rm -rf aquarium
    ok "State cleared."
  fi
fi

# Always wipe the rolling .backups/ folder if present (it's regenerated)
if [[ -d aquarium/.backups ]]; then
  say "Wiping aquarium/.backups/ (auto-regenerated by BackupService)…"
  rm -rf aquarium/.backups
fi

# ── 6. npm install ───────────────────────────────────────────────────────────
say "Installing dependencies (npm install)…"
npm install --silent --no-audit --no-fund || die "npm install failed."
ok "Dependencies installed."

# ── 7. Optional: rebuild node-llama-cpp ──────────────────────────────────────
if [[ $DO_REBUILD_LLAMA -eq 1 ]]; then
  if [[ -x scripts/rebuild-llama.sh ]]; then
    say "Rebuilding node-llama-cpp…"
    bash scripts/rebuild-llama.sh || warn "rebuild-llama failed — server may still boot if precompiled binary is usable."
  else
    warn "scripts/rebuild-llama.sh not found, skipping."
  fi
fi

# ── 8. Optional: image generation (stable-diffusion.cpp + Flux companions) ───
if [[ $DO_IMAGEGEN -eq 1 ]]; then
  SD_DIR="$HOME/stable-diffusion.cpp"
  SD_BIN="$SD_DIR/build/bin/sd"
  MODELS_DIR="${IAQUA_MODELS_DIR:-$HOME/models}"

  # ── 8a. stable-diffusion.cpp ────────────────────────────────────────────────
  if [[ -x "$SD_BIN" ]]; then
    ok "stable-diffusion.cpp already built at $SD_BIN"
  else
    if confirm "Clone + build stable-diffusion.cpp into $SD_DIR? (5-10 min)"; then
      say "Cloning stable-diffusion.cpp…"
      if [[ ! -d "$SD_DIR" ]]; then
        git clone --recursive https://github.com/leejet/stable-diffusion.cpp "$SD_DIR" || die "git clone failed."
      else
        (cd "$SD_DIR" && git pull --recurse-submodules) || warn "git pull skipped (uncommitted changes)"
      fi
      say "Building stable-diffusion.cpp (CUDA enabled if available)…"
      mkdir -p "$SD_DIR/build"
      (
        cd "$SD_DIR/build"
        # Try CUDA build first; fall back to CPU-only if nvcc missing
        if command -v nvcc >/dev/null 2>&1; then
          cmake -DSD_CUDA=ON .. || die "cmake (CUDA) failed."
        else
          warn "nvcc not found — building CPU-only sd-cpp (image gen will be slow)."
          cmake .. || die "cmake failed."
        fi
        cmake --build . --config Release -j"$(nproc)" || die "sd-cpp build failed."
      )
      if [[ -x "$SD_BIN" ]]; then
        ok "stable-diffusion.cpp built: $SD_BIN"
      else
        warn "Build finished but $SD_BIN is missing. Check $SD_DIR/build for errors."
      fi
    fi
  fi

  # Make sure ImageGenerationService finds it: link to ~/.local/bin
  if [[ -x "$SD_BIN" ]]; then
    mkdir -p "$HOME/.local/bin"
    ln -sf "$SD_BIN" "$HOME/.local/bin/sd-diffusion"
    ok "Linked $SD_BIN -> ~/.local/bin/sd-diffusion (auto-discovered by IAQUA)"
  fi

  # ── 8b. Flux companion safetensors ──────────────────────────────────────────
  mkdir -p "$MODELS_DIR"
  say "Checking Flux companion files in $MODELS_DIR…"
  # FLUX needs: ae.safetensors (VAE), clip_l.safetensors (CLIP), t5xxl encoder
  declare -A FLUX_FILES=(
    ["ae.safetensors"]="https://huggingface.co/black-forest-labs/FLUX.1-schnell/resolve/main/ae.safetensors"
    ["clip_l.safetensors"]="https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors"
    ["t5-v1_1-xxl-encoder-Q4_K_M.gguf"]="https://huggingface.co/city96/t5-v1_1-xxl-encoder-gguf/resolve/main/t5-v1_1-xxl-encoder-Q4_K_M.gguf"
  )
  MISSING_FLUX=()
  for f in "${!FLUX_FILES[@]}"; do
    if [[ -f "$MODELS_DIR/$f" ]]; then
      ok "Found $f"
    else
      MISSING_FLUX+=("$f")
    fi
  done

  if (( ${#MISSING_FLUX[@]} > 0 )); then
    echo
    warn "Missing Flux companions (${#MISSING_FLUX[@]}):"
    for f in "${MISSING_FLUX[@]}"; do echo "    - $f"; done
    # Combined download size: ~325 MB (ae) + 246 MB (clip_l) + ~2.3 GB (t5) = ~2.9 GB
    if confirm "Download missing files (~2.9 GB total) to $MODELS_DIR?"; then
      for f in "${MISSING_FLUX[@]}"; do
        say "Downloading $f…"
        if ! wget --progress=bar:force -O "$MODELS_DIR/$f.partial" "${FLUX_FILES[$f]}"; then
          warn "Download failed for $f — leaving .partial in place for retry."
          continue
        fi
        mv "$MODELS_DIR/$f.partial" "$MODELS_DIR/$f"
        ok "$f downloaded."
      done
    else
      warn "Skipped Flux companion downloads. Image gen with Flux will fail until present."
    fi
  fi
fi

# ── 9. Sanity check the boot ─────────────────────────────────────────────────
say "Pre-boot syntax check…"
node --check server/index.js && ok "server/index.js parses cleanly."

# ── 10. Start server ─────────────────────────────────────────────────────────
if [[ $DO_START -eq 1 ]]; then
  echo
  ok "${C_BOLD}Ready.${C_RESET} Starting server on http://localhost:${PORT:-3000} …"
  echo "  ${C_DIM}(Ctrl-C to stop. State will be persisted via graceful shutdown.)${C_RESET}"
  echo
  exec npm start
else
  echo
  ok "${C_BOLD}Fresh start complete.${C_RESET} Run ${C_CYAN}npm start${C_RESET} when you're ready."
fi
