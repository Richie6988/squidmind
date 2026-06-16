#!/bin/bash
# rebuild-llama.sh — Update + rebuild node-llama-cpp with latest llama.cpp
# Fixes "unknown model architecture" errors for new models (Gemma4, Llama4, etc.)

set -e
cd "$(dirname "$0")/.."

echo "=== IAQUA: Updating llama.cpp for new model support ==="
echo ""

if command -v nvcc &> /dev/null || nvidia-smi &> /dev/null 2>&1; then
  echo "✓ CUDA detected — building with GPU support"
  export CMAKE_ARGS="-DGGML_CUDA=ON"
else
  echo "⚠ No CUDA detected — building CPU-only"
  export CMAKE_ARGS="-DGGML_CUDA=OFF"
fi

echo "Step 1/2: Downloading latest llama.cpp source..."
npx node-llama-cpp source download --release latest

echo "Step 2/2: Compiling (5-10 min)..."
npx node-llama-cpp source build

echo ""
echo "✅ Done! Restart IAQUA to use the new llama.cpp."
echo "   Gemma4, Llama4, and other new architectures should now load correctly."
