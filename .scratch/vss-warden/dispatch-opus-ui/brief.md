# Worker brief：opus-vss-warden-ui / qnx-vss-warden

你是 `/Users/linhancheng/Desktop/projects/qnx-vss-warden/.claude/worktrees/opus-web-ui` 裡的完整 Claude Code session（模型：`opus[1m]`，effort：`max`，使用 `team-p` 流量），這個 repo 與全域 `~/.claude` 的 hook、skill 與 settings 對你生效。派工的是另一個 session（main）；使用者本人也可能直接在這個視窗打字。

## 任務

為 **QNX Global Hackathon** 參賽作品 **`VssWarden` — Mixed-Criticality COVESA VSS Safety Gatekeeper & Verification Studio for QNX 8.0 `QPP`** 重新設計並實作整套前端網頁 UI（`app/page.tsx`、`app/codelab/page.tsx`、`app/globals.css`、`app/layout.tsx`），徹底取代原本由 Argon 寫出的公版工程頁面，打造出具有**高階車載精密示波器／QNX Neutrino RTOS 8.0 Mission-Critical Cockpit Telemetry Studio** 質感的工業級視覺介面，並確保既有測試套件（`npm test` 20/20 全綠）、型別檢查（`npm run typecheck`）、正式建置（`npm run build`）與 `npx -y react-doctor@latest . --offline --verbose` 全部通過，最後在本 worktree 提交一顆乾淨的 Conventional Commit。

## 互動規則

- 直接動手閱讀現有檔案、重新設計並實作 `app/page.tsx`、`app/codelab/page.tsx`、`app/globals.css`、`app/layout.tsx`，跑完整驗證並啟動短暫的本機 preview server 用 Playwright 截圖自檢視覺效果（拍下首頁 `/` 與 `/codelab` 高解析度畫面存於 `/Users/linhancheng/Desktop/projects/qnx-vss-warden/.scratch/vss-warden/dispatch-opus-ui/receipts/`，確認完立即關掉自啟的 preview server 與 Chromium，注意 Next 16 `next dev` 若在根目錄生成 `AGENTS.md`/`CLAUDE.md` 要刪掉，或直接用 `npm run build && npx next start -p 3456` 避免汙染），不需中途停下問選擇題。
- 以 `[main]` 開頭的訊息是 main 轉達的；其中標「以下為使用者原話」的段落才是使用者裁決，其餘是 main 的判讀。沒有前綴的訊息是使用者本人打的。
- 任務全部做完、通過驗證並在 `feat/opus-web-ui` 提交 commit 後再回報一次。回報要含：
  1. 你的視覺設計方向與美學升級重點（字體搭配、車載硬派工藝精密配色、雙欄時間軸 SVG 示波器視覺、步驟時間軸與 `?warden` 記憶體位元組檢視器、`/codelab` 互動教學頁）
  2. Playwright 實拍截圖路徑與自我視覺審查結論
  3. `npm test`（20/20）、`npm run typecheck`、`npm run build` 與 `npx -y react-doctor@latest . --offline --verbose` 的實測輸出
  4. 本 worktree 的 commit SHA 與變更檔案清單
  5. 沒做的部分（若無則明寫無）

## 邊界

- 只在本 worktree（`feat/opus-web-ui`）內 commit；不 push、不開 PR、不 rebase、不 amend。
- **嚴禁跑 `pkill -f chrom`、`killall Google Chrome` 等廣域殺程序指令**（會殺死使用者正在使用的日常 Chrome 與另一個正在算圖的 `t54` worker）；只准清自己啟動的 PID。
- **必須 100% 保留 `tests/studio-codelab.test.ts` 檢查的契約與字串**（不得弄壞任何一條既有測試）：
  1. `app/page.tsx` 原始碼必須包含字串：`"Raw QPP (Unguarded)"`、`"VssWarden (Guarded)"`、`"P1_VSS_BOUNDS_AND_UPSTREAM_FIX"`、`"P2_PRIORITY_ARBITRATION_PREEMPTION"`、`"P3_DEAD_OWNER_LEASE_RECOVERY"`、`"?warden"`、`"cliReplayCommand"`。
  2. `app/codelab/page.tsx` 原始碼必須包含字串：`"google-codelab"` 與 `"google-codelab-step"`（渲染 `<google-codelab>` 與 `<google-codelab-step>`）。
  3. 不要破壞 `lib/studio-model.ts`、`lib/presets.ts`、`lib/pipeline.ts`、`lib/oracle.ts`、`lib/warden-core.ts` 的公開函式簽章與測試行為。
  4. 遵守 `~/.claude/rules/typescript/react.md` 的 React 規範（Hook 順序固定、不以 array index 當 key、無 hydration mismatch、SVG 座標不超過 3 位小數、無 `console.log`）。

## 脈絡

- 現有檔案：
  - `/Users/linhancheng/Desktop/projects/qnx-vss-warden/.claude/worktrees/opus-web-ui/app/page.tsx`
  - `/Users/linhancheng/Desktop/projects/qnx-vss-warden/.claude/worktrees/opus-web-ui/app/codelab/page.tsx`
  - `/Users/linhancheng/Desktop/projects/qnx-vss-warden/.claude/worktrees/opus-web-ui/app/globals.css`
  - `/Users/linhancheng/Desktop/projects/qnx-vss-warden/.claude/worktrees/opus-web-ui/app/layout.tsx`
  - `/Users/linhancheng/Desktop/projects/qnx-vss-warden/.claude/worktrees/opus-web-ui/lib/studio-model.ts`
  - `/Users/linhancheng/Desktop/projects/qnx-vss-warden/.claude/worktrees/opus-web-ui/tests/studio-codelab.test.ts`
- 先前獲使用者讚賞的 Opus 5.5 Max 網頁 UI 作品可參考：
  - `/Users/linhancheng/Desktop/projects/kiroween-signal-box/src/app/page.tsx`
- 以下為使用者原話（逐字）：
  - `這場有網頁嗎？網頁也要用opus做，總之我不信任argon的美感`
- main 的判讀（不是裁決）：
  - 使用者非常重視前端頁面的工業設計質感、排版留白、字體對比（如 Google Fonts 的 `Space Grotesk` / `Instrument Serif` / `JetBrains Mono` / `Geist Mono`）、細膩的邊框光澤與資訊層次，極度反感平庸的 AI 模板感（千篇一律的圓角灰底卡片堆疊）。
  - 你可以將 `/` 打造成一座極具真實感的 **QNX Neutrino RTOS 8.0 SDV Safety & Actuator Arbitration Bench**（例如：精密的車規暗色碳鈦金屬面板或高對比實驗室儀表台、帶有真實微秒格線與雙軌步階波形的 SVG 示波器、互動式 Step Scrubber 讓評審能點擊任一步驟即時對照 `Raw QPP` 與 `VssWarden` 的 IEEE-754 Hex 位元組差異、高辨識度的 `P1`/`P2`/`P3` 安全不變量燈號、以及一鍵複製的 POSIX `/dev/signal` 與 C11 CLI 重播指令台），並將 `/codelab` 打造成質感一致的互動式技術教學工作坊。
