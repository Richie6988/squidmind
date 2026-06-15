#!/bin/bash
# rebuild-llama.sh — Rebuild node-llama-cpp with latest llama.cpp
# Run this when you get "unknown model architecture" errors for new models (Gemma4, Llama4, etc.)
# Takes 5-10 minutes. Requires CUDA toolkit for GPU build.

set -e
cd "$(dirname "$0")/.."

echo "=== IAQUA: Rebuilding llama.cpp for new model support ==="
echo "This adds support for Gemma4, Llama4, and other new architectures."
echo ""

# Check if CUDA is available
if command -v nvcc &> /dev/null; then
  echo "✓ CUDA detected — building with GPU support"
  export CMAKE_ARGS="-DGGML_CUDA=ON"
else
  echo "⚠ No CUDA detected — building CPU-only (GPU inference won't work)"
  export CMAKE_ARGS="-DGGML_CUDA=OFF"
fi

echo "Building... (this takes 5-10 minutes)"
npx node-llama-cpp source build

echo ""
echo "✅ Build complete! Restart IAQUA server to use the new llama.cpp."
