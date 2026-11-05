# Worker brief：opus-vss-warden-film / qnx-vss-warden

你是 `/Users/linhancheng/Desktop/projects/qnx-vss-warden` 裡的完整 Claude Code session（模型：`opus[1m]`，effort：`max`，使用 `team-p` 流量），這個 repo 與全域 `~/.claude` 的 hook、skill 與 settings 對你生效。派工的是另一個 session（main）；使用者本人也可能直接在這個視窗打字。

## 任務

使用全域 `onetake` skill（`/Users/linhancheng/.claude/skills/onetake/SKILL.md`），為 **QNX Global Hackathon**（`2. Automotive & Mobility` 主賽道 ＋ `Best Use of QNX-specific Technologies` ＋ `Best Codelab / Tutorial`）參賽作品 **`VssWarden` — Mixed-Criticality COVESA VSS Safety Gatekeeper, Priority-Lease `.control` Arbiter & Upstream `QPP` Zero-Fuzz Patch** 重新設計並渲染一支高美感、電影感十足的 **40–45 秒 1080p30 產品演示短片**（Concept A：《一刀切開的雙時間軸（Split-Timeline Breach）》），工作目錄放在 `/Users/linhancheng/Desktop/projects/onetake-trial/films/qnx-vss-warden-opus/`，最終成品輸出並覆寫至 `/Users/linhancheng/Desktop/projects/qnx-vss-warden/docs/media/vss-warden-demo.mp4`，同時產出 `stills.png` 與 4 張 1920×1080 產品精選截圖覆寫至 `/Users/linhancheng/Desktop/projects/qnx-vss-warden/docs/media/`（`01-aeb-infotainment-collision-hook.png`、`02-split-timeline-priority-preemption.png`、`03-upstream-qpp-3-bugs-hex-probe.png`、`04-crash-lease-recovery-and-seal.png`）供 Devpost 畫廊上傳。

## 互動規則

- 使用者已經拍板選定「**Concept A：《一刀切開的雙時間軸（Split-Timeline Breach）》**」，不需要再問使用者選哪個概念；直接動手把視覺美感、構圖留白、字體排印、Kokoro 英文配音＋中英雙語字幕、機械／電子音效與運鏡節奏做到極致，並完成渲染與 `verify_promo.py` 8 項驗收。若遇到只有使用者能決定的重大範圍分歧，才把問題原文印出來、停下等答案。
- **重要提醒**：當你啟動 `render.py` 時，請以**前景（foreground，設定較長 timeout 如 600000ms）**執行，不要用 `run_in_background: true` 結束當前 turn——否則外部 watcher 會在你剛啟動背景渲染時誤以為你的 turn 已結束。
- 以 `[main]` 開頭的訊息是 main 轉達的；其中標「以下為使用者原話」的段落才是使用者裁決，其餘是 main 的判讀。沒有前綴的訊息是使用者本人打的。
- 任務全部做完並通過視覺自檢與 `verify_promo.py` 後再回報一次。回報要含：
  1. 你的核心視覺概念與關鍵設計決策（車載精密示波器配色、70% 大留白比例、字體層級、運鏡 Carry 銜接、Kokoro 旁白與音效平衡）
  2. `stills.png` 逐格視覺檢查結果與檔案路徑
  3. `verify_promo.py` 完整 8 項指標輸出（必須是 `VERDICT: PASS`）
  4. 最終影片 `/Users/linhancheng/Desktop/projects/qnx-vss-warden/docs/media/vss-warden-demo.mp4` 與 4 張截圖（`docs/media/01..04*.png`）的 `ffprobe` / `ls -lh` 實測數據
  5. 沒做的部分（若無則明寫無）

## 邊界

- 不 commit、不 push、不開 PR、不 rebase、不 amend（Git 提交與推送由 main 收工對帳後統一執行）。
- **嚴禁跑 `pkill -f chrom`、`killall Google Chrome` 等廣域殺程序指令**（會殺死使用者正在使用的日常 Chrome 與 LCU 連線）；只准清自己啟動的 PID。
- 驗證收據放 `/Users/linhancheng/Desktop/projects/qnx-vss-warden/.scratch/vss-warden/dispatch-opus-film/receipts/`，影片合成資產放 `/Users/linhancheng/Desktop/projects/onetake-trial/films/qnx-vss-warden-opus/`。
- 執行 `onetake` Python 腳本時使用 `/Users/linhancheng/Desktop/projects/onetake-trial/.venv/bin/python`（或 `uv run --with playwright --with numpy --with pillow --with scipy --with fonttools --with brotli --with matplotlib --with opencv-python python3`）；Kokoro 語音生成用 `uv run --with kokoro-onnx --with soundfile --with scipy --with numpy python3`，詞級對齊用 `uv run --with faster-whisper python3`。

## 脈絡

- 產品規格與實作檔案：
  - `/Users/linhancheng/Desktop/projects/qnx-vss-warden/.scratch/vss-warden/spec.md`
  - `/Users/linhancheng/Desktop/projects/qnx-vss-warden/README.md`
  - `/Users/linhancheng/Desktop/projects/qnx-vss-warden/src/c/vss_warden_core.c`
  - `/Users/linhancheng/Desktop/projects/qnx-vss-warden/patches/qpp-vss-warden.patch`
  - `/Users/linhancheng/Desktop/projects/qnx-vss-warden/app/page.tsx`
- 前兩隻 Opus 5.5 Max worker 做完、獲使用者高度肯定的滿分範本（可直接參考其電影級構圖留白、字體排印、Kokoro 旁白＋雙語字幕、混音平衡與運鏡手法，但配色與視覺母題必須為 QNX Neutrino 8.0 車載致動器安全守門員全新打造）：
  - `/Users/linhancheng/Desktop/projects/onetake-trial/films/kiroween-signal-box-opus/comp.html`
  - `/Users/linhancheng/Desktop/projects/onetake-trial/films/kiroween-signal-box-opus/score.py`
  - `/Users/linhancheng/Desktop/projects/onetake-trial/films/credit-roll-live-opus/comp.html`
  - `/Users/linhancheng/Desktop/projects/onetake-trial/films/credit-roll-live-opus/score.py`
- 以下為使用者原話（逐字）：
  - `A`（選定 Concept A：《一刀切開的雙時間軸（Split-Timeline Breach）》）
  - `影片又是你自己做？我不是有叫你用opus max做嗎`
- main 的判讀（不是裁決）：
  1. **動手前必讀 `onetake` 規範與前兩支 Opus 5.5 Max 滿分範本**：
     - 先讀 `/Users/linhancheng/.claude/skills/onetake/SKILL.md`、`/Users/linhancheng/.claude/memory/reference_onetake_launch_video_division_2026_10_05.md` 與 `/Users/linhancheng/Desktop/projects/onetake-trial/films/kiroween-signal-box-opus/comp.html`。
     - **視覺痛點警告**：不要塞滿密密麻麻的小字框或工程 log 表！遵守 `onetake`「70% 大留白、小而精緻的主角物件、極高對比字體層級、每一拍由同一個視覺主體（`CLOCK_MONOTONIC` 掃描刀鋒與致動器能量柱）Carry 到下一拍」的美學。
  2. **40–45 秒故事線建議（Concept A · Split-Timeline Breach）**：
     - **這支片要讓人看懂的一句話**：在 QNX 車載 `/dev/signal` 上，未加防護的 `Raw QPP` 讓低優先權娛樂系統一筆寫入就能覆寫緊急煞車並把浮點預設值歸零，而 `VssWarden` 在 Resource Manager 邊界用優先權租約與 COVESA VSS 規格守住每一道致動器指令。
     - **Beat 1 — The `.control` Collision Hook**：深邃車載碳黑與精密琥珀／電光紫留白舞台上，`P0 ADAS AEB` 鎖住煞車致動器 `Brake.Pedal = 95%`；此時 `P3 Infotainment` 送出一筆無權限的 `write("0")`，中央 `CLOCK_MONOTONIC` 垂直光刃一刀切開畫面為左右兩個平行時空。
     - **Beat 2 — Split-Timeline Divergence (`P2` Priority Preemption)**：左軌 `Raw QPP (Unguarded)` 的煞車柱瞬間崩塌歸零（`95% → 0% OVERWRITTEN`）；右軌 `VssWarden (Guarded)` 的優先權護盾將 `P3` 衝擊波彈開，烙下 `errno = EBUSY (16) · PRIORITY_PREEMPTED` 與 `?warden` 診斷收據，煞車穩守 `95%`。
     - **Beat 3 — Crushing 3 Real Upstream `QPP` Bugs (`P1` VSS Bounds & IEEE-754 Fix)**：鏡頭順著光刃推入位元組檢視器，三記俐落連擊（Staccato Burst）：(1) 修復 `qpp/value.c:438` 浮點預設值歸零 Bug（`0x00000000 (0.0°)` 翻轉為精準 `0x42160000 (37.5°)`）；(2) 解開 `qpp/value.c:73` 的 `UINT16_MAX` 截斷枷鎖直達 `UINT32_MAX`；(3) 攔截超界寫入 `125.0° (> max 45°)` 並回傳 `ERANGE (34)`。
     - **Beat 4 — Crash / TTL Lease Recovery (`P3`) & `fast-check` PBT Proof**：當 `P0 ADAS` 發生當機斷線（`io_close_ocb` / `CLOCK_MONOTONIC` 租約到期），左軌永遠卡死在舊值 `95%`，右軌 `VssWarden` 立即自動釋放孤兒鎖並平滑回退至 COVESA VSS 安全預設值 `0%`，同時點亮 `Shape 1 fast-check PBT (P1 · P2 · P3)` 與 `patch -p1 --fuzz=0` 驗證徽章。
     - **Beat 5 — Quiet Hold & End Lockup**：留出充足靜止留白（Dead-still hold），收斂為電影級字標：**`VSSWARDEN`** · `Runtime COVESA VSS Gatekeeper & Priority Arbiter for QNX 8.0 QPP`。
  3. **技術檢核要點**：
     - 用 Kokoro TTS 生成自然沉穩的英文旁白（注意縮寫不要加句點以免停頓過長），並在畫面底部加上優雅的中英雙語字幕，確保效果音在旁白下約 12–15 dB 且靜止段 gate 乾淨以通過 `verify_promo.py` 的 `audio` 腿。
     - 渲染時使用 `--gap 6 --samples-max 48` 確保快速運鏡具備平順 180° 快門動態模糊，通過 `verify_promo.py` 全部 8 項檢查（`VERDICT: PASS`）。
