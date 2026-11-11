#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
upstream="${1:?Usage: apply-qpp-patch.sh <upstream-checkout-or-new-directory>}"
if [[ ! -e "$upstream" ]]; then
  bash "$repo_root/scripts/fetch-qpp.sh" "$upstream"
fi
base="$(git -C "$upstream" rev-parse HEAD)"
if [[ "$base" != b5ca892f37464bea4ff88db3fdbbb2cc651da6a8 ]]; then
  printf '%s\n' 'Expected upstream QPP commit b5ca892f37464bea4ff88db3fdbbb2cc651da6a8' >&2
  exit 1
fi
git -C "$upstream" apply --check "$repo_root/patches/qpp-vss-warden.patch"
patch -p1 --fuzz=0 -d "$upstream" -i "$repo_root/patches/qpp-vss-warden.patch"
cp "$repo_root"/src/c/vss_warden_core.{c,h} "$repo_root"/src/c/qpp_warden.{c,h} "$upstream/qpp/"
printf '%s\n' 'Applied QPP integration and copied C core + adapter sources.'
