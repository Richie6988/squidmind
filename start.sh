#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  IAQUA / SquidMind — start.sh
# ═══════════════════════════════════════════════════════════════════════════
#  One command to launch everything. Designed to be seamless: it checks each
#  prerequisite, sets up what's missing when it safely can, and otherwise
#  prints a clear one-line hint and carries on. Nothing here is fatal except a
#  missing Node runtime — the app degrades gracefully (no Docker → no voice,
#  no Real-ESRGAN → bicubic upscale, etc.).
#
#  Usage:
#     ./start.sh                 # normal: setup checks + launch
#     ./start.sh --setup-gpu     # also install NVIDIA Container Toolkit (sudo)
#     ./start.sh --with-voice    # also auto-start the Speaches container
#     ./start.sh --with-upscaler # also download Real-ESRGAN if missing
#     ./start.sh --no-pull       # skip git pull
#     ./start.sh --no-install    # skip npm install
#     ./start.sh --all           # --setup-gpu --with-voice --with-upscaler
#
#  Everything optional is also attempted automatically IF the tooling is
#  already present (e.g. if Docker exists, voice is offered). The flags force
#  the heavier setup steps (downloads, apt installs) that need consent.
# ═══════════════════════════════════════════════════════════════════════════

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

# ── colours ─────────────────────────────────────────────────────────────────
G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; B=$'\e[34m'; D=$'\e[2m'; N=$'\e[0m'
ok()   { echo "${G}  ✓${N} $*"; }
warn() { echo "${Y}  !${N} $*"; }
err()  { echo "${R}  ✗${N} $*"; }
step() { echo "${B}▸${N} $*"; }

# ── args ────────────────────────────────────────────────────────────────────
SETUP_GPU=0; WITH_VOICE=0; WITH_UPSCALER=0; DO_PULL=1; DO_INSTALL=1
for a in "$@"; do
  case "$a" in
    --setup-gpu)     SETUP_GPU=1 ;;
    --with-voice)    WITH_VOICE=1 ;;
    --with-upscaler) WITH_UPSCALER=1 ;;
    --no-pull)       DO_PULL=0 ;;
    --no-install)    DO_INSTALL=0 ;;
    --all)           SETUP_GPU=1; WITH_VOICE=1; WITH_UPSCALER=1 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) warn "unknown flag: $a" ;;
  esac
done

echo
echo "═══ SquidMind startup ═══"
echo

# ── 1. Node check (the only hard requirement) ───────────────────────────────
step "Checking Node.js…"
if ! command -v node >/dev/null 2>&1; then
  err "Node.js not found. Install Node ≥ 22 from https://nodejs.org and re-run."
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  warn "Node $(node -v) detected; SquidMind wants ≥ 22. It may still work, continuing…"
else
  ok "Node $(node -v)"
fi

# ── 2. Pull latest ──────────────────────────────────────────────────────────
if [[ "$DO_PULL" == "1" ]] && [[ -d .git ]]; then
  step "Pulling latest from origin…"
  if git pull --ff-only 2>/dev/null; then ok "up to date"
  else warn "git pull skipped (local changes or offline) — continuing with current code"; fi
fi

# ── 3. Dependencies ─────────────────────────────────────────────────────────
if [[ "$DO_INSTALL" == "1" ]]; then
  step "Installing npm dependencies…"
  if npm install --no-audit --no-fund >/tmp/squidmind-npm.log 2>&1; then
    ok "dependencies ready"
  else
    warn "npm install had issues — see /tmp/squidmind-npm.log (continuing)"
  fi
fi

# ── 4. GPU (informational; toolkit install only with --setup-gpu) ───────────
step "Checking GPU…"
if command -v nvidia-smi >/dev/null 2>&1; then
  GPU="$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -n1)"
  ok "NVIDIA GPU: ${GPU:-detected}"
  # Is the container toolkit present (needed for GPU inside Docker)?
  if command -v nvidia-ctk >/dev/null 2>&1; then
    ok "NVIDIA Container Toolkit present (GPU available inside containers)"
  elif [[ "$SETUP_GPU" == "1" ]]; then
    step "Installing NVIDIA Container Toolkit (needs sudo)…"
    if curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
         | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg 2>/dev/null \
       && curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
         | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
         | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list >/dev/null 2>&1 \
       && sudo apt-get update -qq \
       && sudo apt-get install -y -qq nvidia-container-toolkit \
       && sudo nvidia-ctk runtime configure --runtime=docker \
       && sudo systemctl restart docker; then
      ok "NVIDIA Container Toolkit installed — voice can use the GPU"
    else
      warn "Toolkit install failed. Voice will run on CPU (fine for TTS/STT)."
    fi
  else
    warn "NVIDIA Container Toolkit not installed — containers run CPU-only."
    echo "${D}     Run ./start.sh --setup-gpu to enable GPU inside Docker (optional).${N}"
  fi
else
  warn "No NVIDIA GPU detected — CPU inference (slower but works)."
fi

# ── 5. Real-ESRGAN upscaler (optional) ──────────────────────────────────────
UPSCALER_BIN="$REPO_ROOT/aquarium/TOOLS/realesrgan/realesrgan-ncnn-vulkan"
if [[ -x "$UPSCALER_BIN" ]] || command -v realesrgan-ncnn-vulkan >/dev/null 2>&1; then
  ok "Real-ESRGAN present (true super-resolution upscaling)"
elif [[ "$WITH_UPSCALER" == "1" ]]; then
  step "Downloading Real-ESRGAN upscaler…"
  if bash scripts/install-upscaler.sh; then ok "upscaler installed"
  else warn "upscaler download failed — upscale falls back to bicubic"; fi
else
  warn "Real-ESRGAN not installed — upscale uses bicubic (adds pixels, no new detail)."
  echo "${D}     Run ./start.sh --with-upscaler for true super-resolution.${N}"
fi

# ── 6. Voice / Speaches (optional) ──────────────────────────────────────────
# Discover a container runtime the way the app does (login-shell PATH).
RUNTIME="$(bash -lc 'command -v docker || command -v podman' 2>/dev/null || true)"
if [[ -n "$RUNTIME" ]]; then
  # Is the user able to talk to the docker socket?
  if ! "$RUNTIME" ps >/dev/null 2>&1; then
    warn "Docker is installed but this user can't access it (socket permission)."
    echo "${D}     Fix once: sudo usermod -aG docker \$USER && newgrp docker${N}"
  else
    ok "Container runtime: $RUNTIME"
    if [[ "$WITH_VOICE" == "1" ]]; then
      SPEACHES_PORT="${SPEACHES_PORT:-8000}"
      if curl -fsS "http://127.0.0.1:${SPEACHES_PORT}/v1/models" >/dev/null 2>&1; then
        ok "Speaches already running on :${SPEACHES_PORT}"
      else
        step "Starting Speaches (voice) container…"
        "$RUNTIME" rm -f squidmind-speaches >/dev/null 2>&1 || true
        IMG="${SPEACHES_IMAGE:-ghcr.io/speaches-ai/speaches:latest-cuda}"
        # try GPU, fall back to CPU
        if ! "$RUNTIME" run -d --rm --name squidmind-speaches \
              -p "${SPEACHES_PORT}:8000" --gpus all "$IMG" >/dev/null 2>&1; then
          "$RUNTIME" run -d --rm --name squidmind-speaches \
              -p "${SPEACHES_PORT}:8000" "$IMG" >/dev/null 2>&1 \
            && warn "Speaches started CPU-only (no GPU in container)" \
            || warn "Speaches failed to start — check: $RUNTIME logs squidmind-speaches"
        else
          ok "Speaches started (GPU)"
        fi
        echo "${D}     First run downloads models — voice becomes ready in a minute or two.${N}"
      fi
    fi
  fi
else
  warn "No Docker/Podman — voice disabled."
  echo "${D}     Install Docker for voice, or set SPEACHES_URL to an external Speaches.${N}"
fi

# ── 7. Launch ───────────────────────────────────────────────────────────────
echo
step "Starting SquidMind server…"
echo "${D}  (Ctrl-C to stop)${N}"
echo
exec node server/index.js
