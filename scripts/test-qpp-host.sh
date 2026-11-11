#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/qpp-host.XXXXXX")"
trap 'rm -rf "$temporary_root"' EXIT
bash "$repo_root/scripts/apply-qpp-patch.sh" "$temporary_root/upstream"
meson setup "$temporary_root/build" "$repo_root/tests/qpp-host" \
  -Dqpp_source="$temporary_root/upstream/qpp"
meson compile -C "$temporary_root/build"
meson test -C "$temporary_root/build" --print-errorlogs
