#!/usr/bin/env bash
set -euo pipefail
upstream="${1:?Usage: fetch-qpp.sh <new-checkout-directory>}"
base=b5ca892f37464bea4ff88db3fdbbb2cc651da6a8
if [[ -e "$upstream" ]]; then
  printf '%s\n' 'Refusing to overwrite an existing checkout directory.' >&2
  exit 1
fi
mkdir -p "$upstream"
cleanup_failed_fetch() {
  local status=$?
  if [[ $status -ne 0 ]]; then rm -rf "$upstream"; fi
}
trap cleanup_failed_fetch EXIT
git -C "$upstream" init --quiet
git -C "$upstream" remote add origin https://github.com/qnx/qnx-posix-publish-subscribe.git
git -C "$upstream" fetch --depth=1 origin "$base"
git -C "$upstream" checkout --quiet --detach FETCH_HEAD
if [[ "$(git -C "$upstream" rev-parse HEAD)" != "$base" ]]; then
  printf '%s\n' 'Fetched QPP revision does not match the pinned commit.' >&2
  exit 1
fi
printf 'Fetched official QPP %s\n' "$base"
