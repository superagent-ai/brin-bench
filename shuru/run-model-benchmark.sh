#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"

cd "$PROJECT_ROOT"
exec node scripts/run-model-benchmark.js "$@"
