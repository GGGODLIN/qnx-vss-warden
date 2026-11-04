# Review Brainstorm Report — `VssWarden` (QNX 8.0 `QPP` Value-Bounds Gatekeeper & Mixed-Criticality Actuator Arbiter)

> 審查日期：2026-11-04
> 目標賽事：[QNX Global Hackathon](https://qnx.devpost.com/)（US$50,000，2026-12-15 截止）
> 對照上游基底：[`qnx/qnx-posix-publish-subscribe` (`QPP`)](https://github.com/qnx/qnx-posix-publish-subscribe)（Apache-2.0）

---

## 1. Anchored Hypothesis（補齊背景與精確行號後的構想假設）

- **觀察到的真實痛點與上游缺陷**：
  1. **VSS 值域限制未強制執行（`qpp/README.md:187-199`）**：官方 `QPP` 雖在 `signal_catalog.json`（共 9,706 行、1,348 個節點）中包含 153 處 `"min"`、119 處 `"max"`、60 處 `"allowed"` 與 495 個 `"actuator"`，但啟動載入（`qpp/catalog.c:242-305`）與寫入路徑（`qpp/iowrite.c:78-90`、`qpp/iowrite_text.c:112-124`）完全未驗證 `min`/`max`/`allowed`。
  2. **上游 `qpp/value.c` 與 `qpp/metadata.c` 存在 3 個原生實作缺陷**：
     - `qpp/value.c:434-447`：`value_set_from_json_simple()` 解析 `FLOAT`/`DOUBLE` 的 JSON `default` 值時讀入 `json_d`，卻將未初始化的整數 `json_l`（恆為 `0`）寫入記憶體，導致所有浮點數訊號預設值靜默變成 `0.0`。
     - `qpp/value.c:73`：`s_int_range_info[VECTOR_UINT32]` 誤將上限寫為 `UINT16_MAX`（`65535`）與 `sizeof(uint16_t)`。
     - `qpp/metadata.c:54-59`：`get_metadata_value()` 硬編碼 `json_decoder_get_string()`，查詢數值型 `?metadata=min` 或陣列型 `?metadata=allowed` 時直接回傳 `EINVAL`。
  3. **`.control` 致動器無條件覆寫與無租約保護（`qpp/README.md:224`、`qpp/iowrite.c:78-90`）**：多個不同關鍵度（如 `ADAS P0` vs `IVI P3`）的程序寫入同一 `.control` 檔時採無條件 Last-Write-Wins，低優先權程序可瞬間覆蓋高優先權安全指令。
- **修正後的構想假設**：
  - 建立 **`VssWarden`**：以零 QNX 專有標頭依賴的可攜式 C11 核心函式庫（`libvsswarden_core.{c,h}`）實作 VSS `min`/`max`/`allowed` 預編譯邊界驗證、基於呼叫端優先權與單調時鐘租約（Monotonic TTL + `io_close_ocb` 斷線清理）的 `.control` 致動器仲裁、以及 `?warden` 即時結構化診斷收據。
  - 同一份 `libvsswarden_core` C 原始碼對上提供 **Upstream-Ready `QPP` 擴充補丁（`patches/qpp-vss-warden.patch`）**，對下在 macOS/Linux Host 原生編譯為 C 驗證器與 Node/WASM 橋接模組，驅動 **Host 端對抗驗證工作台（Next.js + `fast-check` 條件式 PBT Oracle `P1..P3` + 互動式 `<google-codelab>` 教學頁）**。

---

## 2. 6-Lens Reviewer Status

| 席次 | 審查視角 | 狀態 | 最高 Severity | 核心發現摘要 |
|---|---|---|---|---|
| **Seat 1** | Contrarian / YAGNI & Codebase Reuse | `completed` | `Blocker` | 廢除外掛 `vss-wardend` daemon 與假的多訊號快照 `P3`；重用 `qpp/` 內建 `ioopen.c`/`value.c`/`ioclose.c` 與 `playback-tool` JSONL 格式，並修復 `value.c` 兩處上游 bug。 |
| **Seat 2** | Cost, Quota & Token Economics | `completed` | `Blocker` | 獨立代理 daemon 會造成 3 倍 IPC 放大；M5 Pro 實測 `fork/exec` 每次 `2.02 ms`（10 倍 PBT 達 `303s+`），必須以單一常駐 C 引擎或 FFI/WASM 在記憶體內跑 PBT，且 100% 零 API Key 運作。 |
| **Seat 3** | UX & Developer Ergonomics | `completed` | `Blocker` | 保持 100% 純 POSIX `echo`/`cat` 與 `?` 修飾符體驗；拆分 `ERANGE`/`EINVAL`/`EBUSY`/`EPERM` 並提供 `?warden` 診斷檔；自動剝除 `signal_catalog.json:1-57` 的 C 註解並內建 3 個零設定車載預設情境。 |
| **Seat 4** | Migration, Compatibility & Rollback Safety | `completed` | `Blocker` | `qpp/` 硬綁定 `<sys/iofunc.h>` 與 `<sys/json.h>`，須拆出純 C11 `libvsswarden_core`；實作 Session OCB + Monotonic Lease TTL + Crash 自動回退安全值；以全新 `git init` repo 搭配 Apache-2.0 `LICENSE` + `NOTICE` 避開 Fork 淘汰紅線。 |
| **Seat 5** | Observability & 3 AM Debuggability | `completed` | `Blocker` | `QPP` 預設隱藏 `QLOG_WRN` 且攔截不觸發 `POLLIN`；須提供 `?warden` 結構化收據（含 `compiled_rules`、`winning_owner`、`last_rejection`）與單行可重現 C CLI 指令（輸出含 IEEE-754 hex dump 之 JSONL 收據）。 |
| **Seat 6** | Long-Term Tech Debt & Coupling | `completed` | `Blocker` | 禁止在 TypeScript 重寫第二套模擬器造成雙實作分裂（Split-Brain）；`fast-check` Oracle 必須直接測試編譯出的 C 核心，且以 `signal_catalog.json` 為 Schema 唯一真相來源（SSOT）。 |

---

## 3. Existing Reuse Candidates（Seat 1 找到的現成可重用方案）

1. **重用 `qpp/ioopen.c:88-172`（`parse_path` 路徑修飾符解析器）**：
   - 上游已支援 `?text`、`?control`、`?metadata=<key>`、`?datatype=<type>` 逗號分隔修飾符；直接擴充支援 `?priority=<N>,lease=<ms>,as=<role>` 與 `?warden` 診斷修飾符，零新 API 即可從標準 CLI `echo` / `cat` 操作。
2. **重用 `qpp/ioclose.c:41-60`（`io_close_ocb`）與 `qpp/ocb.h:22-30`（`rm_ocb_t`）**：
   - 上游在每次 `open()` 建立獨立 `rm_ocb_t` 並在 `close()` 或 Client crash 時由微核心自動呼叫 `io_close_ocb()`，可直接綁定高優先權持有者並在斷線時自動釋放控制鎖。
3. **重用 `signal-framework/signal-service/etc/signal_catalog.json`（1,348 節點）與 `playback-tool` JSONL 格式（`sample-playback.jsonl`）**：
   - 官方 `signal_catalog.json` 已內建 495 個 `actuator`、153 個 `min`、119 個 `max` 與 60 個 `allowed`（如 `Vehicle.Body.Mirrors.Left.Pan` `[-100, 100]`、`Vehicle.Body.Windshield.Front.Wiping.Mode` 枚舉），且 `playback-connector/signal_writer.c:271-285` 已原生支援轉發路徑中的 `?` 修飾符。

---

## 4. Prioritized Objections & Contested Trade-offs

### A. 已收斂之必改架構護欄（Unanimous Fixes）
1. **[Blocker] 廢除外掛 `vss-wardend` Proxy Daemon，改為「純 C11 可攜式核心 `libvsswarden_core` ＋ 上游 `QPP` 嵌入式 Patch」**（Seats 1, 2, 3, 4, 6）：
   - 避免 3 倍 IPC 往返與 `ctp->info` 呼叫端身分遺失，同時讓同一份 C11 原始碼在 Apple Silicon macOS 上用 `/usr/bin/clang` 原生編譯執行，並產出乾淨的 `patches/qpp-vss-warden.patch` 供 QNX 8.0 `qpp` 套用。
2. **[Blocker] 消滅 C 與 TypeScript 雙實作分裂（Split-Brain）與子程序 Spawn 瓶頸**（Seats 2, 5, 6）：
   - Host 端不寫第二套 TS 模擬器；`fast-check` 與 Next.js 直接呼叫由 `libvsswarden_core.c` 編譯出的原生模組／常駐批次程序，將 `1,000+` 組屬性測試壓在 `< 1 秒` 完成，並在前端每個圖表附上單行 C CLI 重現指令（`./build/vss-warden-cli --seed <S>`，輸出含 IEEE-754 binary hex 與 `CLOCK_MONOTONIC` 的 JSONL 收據）。
3. **[Blocker] 100% 純 POSIX 介面與 `?warden` 可觀測診斷節點**（Seats 3, 5）：
   - 寫入攔截嚴格區分 `ERANGE`（超上下限）、`EINVAL`（非 `allowed` 枚舉）、`EBUSY`（低於現有持有者優先權）、`EPERM`（角色無權限）；查詢 `?warden` 即回傳生效規則、當前鎖定者與最後一次被拒原因。
4. **[Blocker] 全新 Clean Repo + Apache-2.0 `LICENSE` & `NOTICE` 合規**（Seat 4）：
   - 以 `git init` 建立全新儲存庫（不含上游 commit 歷史、非 GitHub fork），附 `LICENSE`（Apache-2.0）與 `NOTICE` 聲明，完全符合 `qnx-rules.md:78, 86, 128`。

### B. 席次對撞與方向取捨（`[contested]`）
- **`[contested: Seat 1 vs Seats 2/4/5]` 第 3 條核心不變量（`P3`）的選擇**：
  - **Seat 1（反方減法席）**指出：在 `QPP` 單檔獨立 `write()` 架構下，Publisher 本身是一次寫一個檔案，因此單靠讀取端同時鎖多個節點無法阻止寫入中途的跨檔不一致，建議**砍掉「跨訊號批次快照讀取」，將 `P3` 改為與 `P2` 緊密咬合的「高優先權持有者 Crash（`io_close_ocb`）或租約到期（Monotonic TTL）時的自動釋放與安全值回退（`P3_DEAD_OWNER_LEASE_RECOVERY`）」**（同時解決 Seat 4 的 Blocker #2 死鎖問題）。
  - **Seats 2/4/5** 則提出若保留多訊號快照，需新增虛擬路徑 `/dev/signal/.snapshot` 與全域 `tx_epoch`。

---

## 5. Key Decisions Needed Before `/to-spec`

1. **拍板 `P1..P3` 三大守門契約與 `P3` 聚焦方向**：是否採納 Seat 1 + Seat 4 的收斂建議，砍掉多訊號快照，將三條鐵律定為：
   - `P1_VSS_BOUNDS_AND_UPSTREAM_FIX`（強制 `min`/`max`/`allowed` 邊界並修復上游 `qpp/value.c` 浮點數 default 與 `VECTOR_UINT32` 兩個真實 Bug）
   - `P2_PRIORITY_ARBITRATION_PREEMPTION`（高優先權搶佔、同優先權 FIFO、低優先權攔截 `EBUSY`）
   - `P3_DEAD_OWNER_LEASE_RECOVERY`（持有者 `close`/Crash 或 TTL 到期時自動釋放並回退至次高優先權或 VSS `default` 安全值）？
2. **拍板主要參賽類別（Primary Category）**：要報競爭者為 0 的 **`2. Automotive & Mobility`**（以車載 ADAS vs IVI 致動器防衛為主軸），還是 **`4. Developer Tooling & Host Tools`**（或 **`5. Open-Source Contribution & Ports`**）？
