#!/usr/bin/env bash
# Installs the age release that encrypts the site report. The SHA-256 is pinned independently of
# the download; it was recorded after verifying the release's Sigsum transparency-log proof
# (see docs/automation.md, "Updating the pinned age release").
set -euo pipefail

AGE_VERSION=v1.3.2
AGE_SHA256=cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10
DESTINATION="${1:?usage: install-age.sh <directory>}"

DOWNLOAD_DIR="$(mktemp -d)"
trap 'rm -rf "$DOWNLOAD_DIR"' EXIT
curl --fail --location --retry 3 --silent --show-error --output "$DOWNLOAD_DIR/age.tar.gz" \
  "https://github.com/FiloSottile/age/releases/download/${AGE_VERSION}/age-${AGE_VERSION}-linux-amd64.tar.gz"
printf '%s  %s\n' "$AGE_SHA256" "$DOWNLOAD_DIR/age.tar.gz" | sha256sum --check --status
mkdir -p "$DESTINATION"
tar -xzf "$DOWNLOAD_DIR/age.tar.gz" -C "$DESTINATION" --strip-components=1 age/age
"$DESTINATION/age" --version
