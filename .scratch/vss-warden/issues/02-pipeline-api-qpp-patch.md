# 02 — Host Verification API, Upstream-Ready QNX 8.0 QPP Patch (patches/qpp-vss-warden.patch) & Zero-Fuzz Patch Gate

**What to build:** The Next.js verification pipeline and API endpoint (`POST /api/vss-warden/verify`), the upstream-compatible QNX 8.0 `QPP` unified patch (`patches/qpp-vss-warden.patch`) with automated `patch --fuzz=0` verification against the upstream `qpp/` C source files, and top-level Apache-2.0 `LICENSE` and `NOTICE` compliance files.

**Blocked by:** `01 — Portable C11 Warden Engine (libvsswarden_core + vss-warden-cli), 3 Automotive Presets & Shape 1 Conditional PBT Suite`

**Status:** `completed`

**Needs:** None — a worker can check every item unaided

**Validation method:** Run `node --experimental-strip-types --test tests/pipeline-patch.test.ts` and `npm run typecheck` to verify the verification pipeline, HTTP route payload/step bounds, CLI replay command generation, and clean `patch --fuzz=0 --dry-run` (or temp-tree apply) against the upstream `qpp/` files.

**Evidence required:** `node --experimental-strip-types --test tests/pipeline-patch.test.ts` and `npm run typecheck` exit code `0`.

**Tests:** `required`

**Test seam:** `POST /api/vss-warden/verify` (`runVerificationPipeline`) and `verifyUpstreamQppPatch()`

**Regression scope:** Preserve all Ticket `01` `P1..P3` invariants, ensure both direct `runVerificationPipeline` and `POST /api/vss-warden/verify` enforce identical request validation and error envelopes (`Failure: F5`), enforce `512 KB` body and `500` step caps (`Failure: F6`), and verify zero-fuzz compatibility of `patches/qpp-vss-warden.patch` (`Failure: F3`).

- [x] `POST /api/vss-warden/verify` executes both `unguarded` (`Raw QPP`) and `guarded` (`VssWarden`) runs through the compiled C engine, returns the `evaluateVssWardenOracle` `P1..P3` verdict, generates copyable POSIX CLI commands (`echo` / `cat ?warden,text`), and includes a deterministic `./build/vss-warden-cli --preset <id> --seed <seed>` replay command — Source: Story 4, Story 5
- [x] `patches/qpp-vss-warden.patch` applies cleanly with zero fuzz (`patch -p1 --fuzz=0`) to a clean copy of the upstream `qpp/` source files (`qpp/value.c`, `qpp/metadata.c`, `qpp/catalog.c`, `qpp/ioopen.c`, `qpp/iowrite.c`, `qpp/iowrite_text.c`, `qpp/ioclose.c`) and fixes `qpp/value.c:73` (`VECTOR_UINT32`), `qpp/value.c:438,445` (`FLOAT`/`DOUBLE` default), and `qpp/metadata.c:54` — Source: Story 1 — Failure: F3
- [x] Requests with malformed JSON, missing `operations` array, payload exceeding `512 KB`, or `operations.length > 500` return HTTP `400` (`INVALID_PAYLOAD` or `PAYLOAD_TOO_LARGE`) across both the route handler and pipeline helper without spawning the C binary — Source: Story 5 — Failure: F2, F5, F6
- [x] When the C binary returns a non-zero exit code or times out, `runVerificationPipeline` returns a structured `ENGINE_EXECUTION_ERROR` response with diagnostic context rather than an unhandled rejection or empty 200 response — Source: Story 5 — Failure: F4
- [x] Repository root includes a valid Apache-2.0 `LICENSE` file and a `NOTICE` file attributing BlackBerry Limited's Apache-2.0 `qnx/qnx-posix-publish-subscribe` interfaces — Source: Story 5

## Verification Log

- **Ticket 02 TDD, Zero-Fuzz Patch & YAGNI Verification**:
  - RED baseline observed before implementation: `tests 5 | pass 0 | fail 5`.
  - Applied all `ticket-yagni` cuts (`kill 1 / demote 3 / keep 28` from `verdict.json`) and re-verified `ticket-02.patch` (`dispatch_base_sha = 9b7cc47bd8db9020bb08f10af96b5cf8360b9087`): `npm test` passed `14/14` tests across `5` suites in `446ms` and `npm run typecheck` exited `0`.
- **Closeout Review Findings & Fixes (Step 3.4 & 3.5)**:
  - `Acceptance-miss — patches/qpp-vss-warden.patch 接線 QPP open/write/close 與 ?warden 診斷 → ioopen.c 新增 OP_MODE_WARDEN 但未在 redirect 區塊設定 redirect_node 且讀寫關閉 hook 僅呼叫 canonicalize 丟棄結果` (HIGH): Fixed in `patches/qpp-vss-warden.patch` and verified via `patch -p1 --fuzz=0` in `tests/pipeline-patch.test.ts`.
  - `Acceptance-miss — includes a deterministic ./build/vss-warden-cli --preset <id> --seed <seed> replay command → vss_warden_cli.c 的 preset-1-bounds-float-bug 僅硬編 4 步且未知 --preset 靜默退回 preset 1` (MEDIUM): Fixed in `src/c/vss_warden_cli.c` to include all 10 steps of `preset-1-bounds-float-bug` and return `EINVAL` / exit 1 on unknown preset IDs.
