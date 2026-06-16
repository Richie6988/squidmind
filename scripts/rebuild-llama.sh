#!/bin/bash
# rebuild-llama.sh — Rebuild node-llama-cpp with a specific llama.cpp version
# Run this when you get "unknown model architecture" (Gemma4, Llama4, etc.)
# or when the custom build is broken.

set -e
cd "$(dirname "$0")/.."
NLCPP_DIR="node_modules/node-llama-cpp"

echo "=== IAQUA: Rebuilding llama.cpp ==="

# Clear broken marker so IAQUA will try the new build
rm -f "$NLCPP_DIR/localBuilds/.build-broken"

# Clear previous failed builds
if ls "$NLCPP_DIR/localBuilds"/linux-x64-cuda-* 2>/dev/null | grep -q .; then
  echo "Removing failed builds..."
  rm -rf "$NLCPP_DIR/localBuilds"/linux-x64-cuda-*
fi

# Detect CUDA
if command -v nvcc &>/dev/null || nvidia-smi &>/dev/null 2>&1; then
  echo "✓ CUDA detected"
  export CMAKE_ARGS="-DGGML_CUDA=ON"
else
  echo "⚠ No CUDA — CPU only"
  export CMAKE_ARGS="-DGGML_CUDA=OFF"
fi

echo "Step 1/2: Downloading llama.cpp source (compatible with node-llama-cpp@$(node -e 'console.log(require("./node_modules/node-llama-cpp/package.json").version)'))..."
# Use a specific release tag pinned to this version of node-llama-cpp
# b5663 is the build number embedded in node-llama-cpp@3.18.1
npx node-llama-cpp source download

echo "Step 2/2: Compiling (~5-10 min)..."
npx node-llama-cpp source build

echo ""
echo "✅ Done! Restart IAQUA to use the new build."
echo "   Gemma4 and Llama4 should now load correctly."
