#!/bin/bash
# rebuild-llama.sh — Patch + rebuild node-llama-cpp for new model architectures
# Fixes: Gemma4, Llama4, cpu_get_num_math → common_cpu_get_num_math mismatch

set -e
cd "$(dirname "$0")/.."
NLCPP="node_modules/node-llama-cpp"
ADDON="$NLCPP/llama/addon/AddonContext.cpp"

echo "=== IAQUA: Patching + rebuilding llama.cpp ==="

# ── 1. Patch AddonContext.cpp if needed ───────────────────────────────────────
if [ -f "$ADDON" ] && grep -q 'cpu_get_num_math()' "$ADDON" 2>/dev/null; then
  echo "Patching AddonContext.cpp: cpu_get_num_math → common_cpu_get_num_math"
  sed -i 's/cpu_get_num_math()/common_cpu_get_num_math()/g' "$ADDON"
  echo "✓ Patch applied"
else
  echo "✓ AddonContext.cpp already up to date (no patch needed)"
fi

# ── 2. Clear broken marker ────────────────────────────────────────────────────
rm -f "$NLCPP/localBuilds/.build-broken"

# ── 3. Detect CUDA ────────────────────────────────────────────────────────────
if command -v nvcc &>/dev/null || nvidia-smi &>/dev/null 2>&1; then
  echo "✓ CUDA detected — building with GPU support"
  export CMAKE_ARGS="-DGGML_CUDA=ON"
else
  echo "⚠ No CUDA — CPU only"
  export CMAKE_ARGS="-DGGML_CUDA=OFF"
fi

# ── 4. Download source if not already present ─────────────────────────────────
if [ ! -d "$NLCPP/llama/localBuilds" ] && [ ! -f "$NLCPP/llama/CMakeLists.txt" ]; then
  echo "Step 1/2: Downloading llama.cpp source..."
  npx node-llama-cpp source download
else
  echo "Source already present — skipping download"
fi

# ── 5. Build ──────────────────────────────────────────────────────────────────
echo "Step 2/2: Compiling (~5-10 min)..."
npx node-llama-cpp source build

echo ""
echo "✅ Done! Restart IAQUA to use the new build."
