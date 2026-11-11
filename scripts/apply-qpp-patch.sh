#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
upstream="${1:?Usage: apply-qpp-patch.sh <upstream-checkout>}"
base="$(git -C "$upstream" rev-parse HEAD)"
case "$base" in
  b5ca892f*) ;;
  *) printf '%s\n' 'Expected upstream QPP commit b5ca892f' >&2; exit 1 ;;
esac
git -C "$upstream" apply --check "$repo_root/patches/qpp-vss-warden.patch"
patch -p1 --fuzz=0 -d "$upstream" -i "$repo_root/patches/qpp-vss-warden.patch"
cp "$repo_root"/src/c/vss_warden_core.{c,h} "$repo_root"/src/c/qpp_warden.{c,h} "$upstream/qpp/"
printf '%s\n' 'Applied QPP integration and copied C core + adapter sources.'
