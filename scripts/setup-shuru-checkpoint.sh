#!/usr/bin/env bash
set -euo pipefail

CHECKPOINT_NAME="${1:-brin-bench}"
NODE_MAJOR="${NODE_MAJOR:-20}"

echo "Creating Shuru checkpoint '${CHECKPOINT_NAME}' with Node.js ${NODE_MAJOR}.x ..."

# Use an empty config so the project's shuru.json (which restricts network to
# allowlisted hosts only) does not block apt/nodesource DNS during setup.
EMPTY_CONFIG="$(mktemp)"
echo '{}' > "$EMPTY_CONFIG"
trap 'rm -f "$EMPTY_CONFIG"' EXIT

shuru checkpoint create "$CHECKPOINT_NAME" --allow-net --config "$EMPTY_CONFIG" -- sh -c "
  apt-get update -qq &&
  apt-get install -y -qq ca-certificates curl gnupg > /dev/null 2>&1 &&
  mkdir -p /etc/apt/keyrings &&
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg &&
  echo 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main' \
    > /etc/apt/sources.list.d/nodesource.list &&
  apt-get update -qq &&
  apt-get install -y -qq nodejs > /dev/null 2>&1 &&
  node --version &&
  npm --version &&
  echo 'Installing Cursor CLI (Linux arm64)...' &&
  curl https://cursor.com/install -fsS | bash &&
  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> /etc/profile.d/cursor.sh &&
  export PATH=\"\$HOME/.local/bin:\$PATH\" &&
  agent --version
"

echo "Checkpoint '${CHECKPOINT_NAME}' ready."
echo "Verify with: shuru run --from ${CHECKPOINT_NAME} -- node --version"
