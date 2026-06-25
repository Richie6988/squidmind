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
for arg in "$@"; do
  case "$arg" in
    --yes|-y)         AUTO_YES=1 ;;
    --no-pull)        DO_PULL=0 ;;
    --no-wipe)        DO_WIPE=0 ;;
    --no-start)       DO_START=0 ;;
    --rebuild-llama)  DO_REBUILD_LLAMA=1 ;;
    --help|-h)
      sed -n '2,30p' "$0"; exit 0 ;;
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

# ── 8. Sanity check the boot ─────────────────────────────────────────────────
say "Pre-boot syntax check…"
node --check server/index.js && ok "server/index.js parses cleanly."

# ── 9. Start server ──────────────────────────────────────────────────────────
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
