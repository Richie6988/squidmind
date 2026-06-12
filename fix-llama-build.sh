#!/bin/bash
# Fix: build node-llama-cpp from source with latest llama.cpp
# Required for: Gemma 4, Llama 4, or any model with "unknown model architecture" error
# Requirements: cmake, build-essential (sudo apt install cmake build-essential)

set -e
echo "=== Downloading latest llama.cpp source ==="
npx node-llama-cpp source download

echo ""
echo "=== Building with CUDA GPU support ==="
npx node-llama-cpp source build --gpu cuda

echo ""
echo "=== Done! Restart the server ==="
echo "npm start"
