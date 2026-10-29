#!/usr/bin/env bash
set -euo pipefail

# Official release, pinned independently of the downloaded archive.
ACTIONLINT_VERSION=1.7.12
ACTIONLINT_SHA256=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8
ACTIONLINT_DIR="$(mktemp -d)"
trap 'rm -rf "$ACTIONLINT_DIR"' EXIT
curl --fail --location --retry 3 --output "$ACTIONLINT_DIR/actionlint.tar.gz" \
  "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz"
printf '%s  %s\n' "$ACTIONLINT_SHA256" "$ACTIONLINT_DIR/actionlint.tar.gz" | sha256sum --check --status
tar -xzf "$ACTIONLINT_DIR/actionlint.tar.gz" -C "$ACTIONLINT_DIR" actionlint
ACTIONLINT_ARGS=()
if ! shellcheck --version >/dev/null 2>&1; then ACTIONLINT_ARGS+=('-shellcheck='); fi
# GitHub supports queued publishers, but this pinned actionlint release predates that key.
# https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
ACTIONLINT_ARGS+=('-ignore' 'unexpected key "queue" for "concurrency" section')
"$ACTIONLINT_DIR/actionlint" -color "${ACTIONLINT_ARGS[@]}"
