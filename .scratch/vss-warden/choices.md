# 實作決定帳本（Choices Ledger）— `VssWarden`

## Pass 1 — `feat/vss-warden` (`78d8c4e..HEAD`, 2026-11-05)

### 八類掃描總覽（R1）

1. **資料形狀與格式**：有（見決定 C1：`?warden` 診斷 payload 的欄位集合與 IEEE-754 hex 表示法）
2. **存放位置與命名**：有（見決定 C2：上游 `QPP` 9 個受修補基準檔的本地快照目錄 `vendor/qpp-upstream/qpp/`）
3. **API 契約與錯誤行為**：有（見決定 C3：重開已開啟且持有租約之 `fd` 時自動釋放舊訊號鎖；決定 C4：C11 與 TypeScript 路徑解析遇到非數值 `?priority=abc` 時忽略該修飾符並退回 `op.priority`）
4. **新增的相依套件，連同它帶進來的預設行為與上限**：無（僅使用既定 `next@16.3.6`、`react@19.2.8` 與 `fast-check@^4.1.1`，未新增額外第三方套件）
5. **並行與效能取捨：快取、容量上限、逾時、重試**：有（見決定 C5：C11 引擎固定容量上限 `MAX_SIGNALS=64`、`MAX_OCBS=128` 與 `execFileSync` 預設 `timeoutMs=5000`、`maxBuffer=4MB`）
6. **範圍解讀：套用範圍比規格寬或窄**：有（見決定 C6：`ticket-yagni` 修剪後移除 Ticket 01 未強制要求的 `EPERM` 角色白名單與 `boolean` 型別分支，聚焦於 `int8`、`float`、`string` 與 `uint32[]` 四種驗收型別）
7. **測試設定改動：timeout、skip、mock、放寬斷言**：無（全套 20 項測試無 `skip`、未放寬斷言，僅在單一逾時錯誤邊界測試傳入 `timeoutMs: 1` 搭配 `/bin/cat` 觸發真實子程序逾時）
8. **之後的程式會照抄的模式**：有（見決定 C7：Studio UI 初始狀態不預存硬編碼軌跡，而是在首次載入或點擊預設按鈕時透過 `POST /api/vss-warden/verify` 取得真實 C 引擎輸出）

> 內部函式／變數命名與純視覺配色選擇（深色車載儀表板主題與 SVG 線條顏色）共 9 處合併計數，不逐條展開。

---

### 逐條決定明細

#### C1 — `?warden` 診斷收據精簡為 5 個核心欄位與大端序 IEEE-754 Hex 字串
- **何時**：Ticket `01` YAGNI 修剪與コミット `9b7cc47`
- **決定**：精簡 `?warden` JSON 診斷收據與 `committedHex` 格式。
  - **觸發事件**：當使用者或測試透過 `READ_WARDEN`（如 `cat /dev/signal/.../Pan?warden,text`）查詢訊號守門狀態，或檢查每步 `WardenStepReceipt` 的二進位記憶體表徵時。
  - **現在怎麼做**：在 `src/c/vss_warden_core.c:949-988` 與 `lib/types.ts:69-81` 中，將 `wardenPayload` 固定為 `{ path, datatype, committedControlValue, activeHolder, lastRejection }` 五個核心欄位，`lastRejection` 固定為 `{ errnoCode, ruleId, reason }`；`committedHex` 則將 `int8` 轉為 1-byte hex（如 `-35` → `0xdd`）、`float` 轉為 IEEE-754 32-bit hex（如 `22.5` → `0x41b40000`）、`uint32[]` 轉為以底線連接的 32-bit hex。
  - **沒選的做法會怎樣**：若保留冗餘的完整規格複製欄位或未定義 `float` 記憶體位元組序，會被 `ticket-yagni` 判為超出票定契約，或在不同平台比對 `committedHex` 時出現格式不一致。
- **規格缺口**：`spec.md` 要求輸出 `?warden` JSON 收據與 IEEE-754 hex，但未釘死 `wardenPayload` 的精確子欄位集合與陣列 hex 分隔符。
- **影響範圍**：影響 `src/c/vss_warden_core.c`、`lib/oracle.ts` 與前端 `?warden` 診斷面板的顯示結構。
- **判定**：`sound` — 五個欄位已完整涵蓋當前持有者、寫入值與最後一次攔截原因，且與 `evaluateVssWardenOracle` 完全對齊。
- **把握度**：高
- **出處**：`src/c/vss_warden_core.c:865-895,949-988`、`lib/types.ts:62-81`、`lib/oracle.ts:207-255`

#### C2 — 於 `vendor/qpp-upstream/qpp/` 內建上游 `QPP` 9 個受修補 C/H 原始檔快照供離線 `--fuzz=0` 驗證
- **何時**：基礎建設コミット `78d8c4e` 與 Ticket `02` コミット `1b5cfc9`
- **決定**：在 repo 內保存上游 `qnx/qnx-posix-publish-subscribe` 中受補丁影響的 9 個原始檔（`catalog.c`、`ioclose.c`、`ioopen.c`、`iowrite.c`、`iowrite_text.c`、`metadata.c`、`ocb.h`、`value.c`、`value.h`）。
  - **觸發事件**：當執行 `verifyUpstreamQppPatch()`（`lib/pipeline.ts:259-361`）進行 `patch -p1 --fuzz=0` 零容忍補丁套用測試時。
  - **現在怎麼做**：從 `vendor/qpp-upstream/qpp/` 複製這 9 個乾淨原始檔到系統暫存目錄，當場執行 `patch -p1 --fuzz=0 -i patches/qpp-vss-warden.patch` 並驗證套用成功與三處上游 bug 修補內容，結束後於 `finally` 刪除暫存目錄；同時在 `NOTICE` 與 `README.md:85-90` 載明完整 QNX SDP `meson` 建置應先 `git clone` 上游儲存庫。
  - **沒選的做法會怎樣**：若不內建這 9 個基準檔，測試在無網路環境就無法驗證 `patch --fuzz=0`；反之若把上游整包百餘個檔案與 commit 歷史複製進來，又會違反賽事「禁止直接交 upstream fork」的規定。
- **規格缺口**：`spec.md` 規定禁止包含上游 commit 歷史且須驗證 `--fuzz=0`，但未指定離線測試時上游基準檔的存放路徑。
- **影響範圍**：影響 `lib/pipeline.ts`、`NOTICE` 與 `README.md` 的建置說明。
- **判定**：`sound` — 兼顧離線 100% 可重現 `--fuzz=0` 測試與競賽 Clean Repo 規定。
- **把握度**：高
- **出處**：`vendor/qpp-upstream/qpp/`、`lib/pipeline.ts:259-361`、`README.md:85-90`

#### C3 — 重複 `OPEN` 已開啟且持有租約的 `fd` 時，先釋放其原本持有的訊號鎖再重新綁定
- **何時**：收尾審查修補（對應 `code-reviewer` HIGH finding）
- **決定**：在 `GUARDED` 模式下，當 `OPEN` 指令傳入一個已經處於 `is_open` 狀態的 `fd` 時，若該 `fd` 正持有舊訊號的 `active_holder` 租約，先對舊訊號執行 `release_and_recover_signal` 釋放鎖並回退，再將該 `fd` 綁定至新訊號。
  - **觸發事件**：當隨機產生的操作序列或呼叫端在未先呼叫 `CLOSE(fd)` 的情況下，以同一個 `fd` 編號再次執行 `OPEN` 切換至另一個訊號路徑或變更優先權時。
  - **現在怎麼做**：在 `src/c/vss_warden_core.c:1171-1176` 與 `lib/oracle.ts:401-407` 中，覆寫既有 `ocb` 前檢查 `ocb->is_open && prev_sig->active_holder.fd == fd`，成立時立即呼叫 `release_and_recover_signal`。
  - **沒選的做法會怎樣**：若直接 `memset` 覆寫 `ocb->signal_idx`，舊訊號上的 `active_holder.fd` 將失去對應 OCB，後續呼叫 `CLOSE(fd)` 時永遠無法釋放舊訊號的鎖，違反 `P3_DEAD_OWNER_LEASE_RECOVERY`。
- **規格缺口**：`spec.md` 定義了 `OPEN` 與 `CLOSE` 的正常生命週期，但未明定同一 `fd` 未關閉即重複 `OPEN` 時的隱式關閉語意。
- **影響範圍**：影響 `src/c/vss_warden_core.c` 與 `lib/oracle.ts` 的 `OPEN` 狀態轉移。
- **判定**：`sound` — 對齊 POSIX `dup2`（重用既有 fd 前先隱式關閉舊描述子）的標準語意，消除孤兒鎖漏洞。
- **把握度**：高
- **出處**：`src/c/vss_warden_core.c:1171-1176`、`lib/oracle.ts:401-407`、`tests/warden-core-pbt.test.ts:820-840`

#### C4 — 路徑修飾符 `?priority=` 與 `?lease=` 遇到非整數值時忽略該修飾符並退回 `OPEN` 操作的數值欄位
- **何時**：收尾審查修補（對應 `code-reviewer` MEDIUM finding）
- **決定**：C11 與 TypeScript 的路徑正規化器在解析 `?priority=<val>` 與 `?lease=<val>` 時，僅當 `<val>` 為完整十進位整數時才覆寫優先權／租約時間，否則忽略該修飾符並沿用 `OPEN` 結構上的 `priority` / `leaseMs` 欄位。
  - **觸發事件**：當路徑字串帶有格式異常的修飾符（例如 `Vehicle/SigA?priority=abc`）時。
  - **現在怎麼做**：在 `src/c/vss_warden_core.c:469-482` 使用 `strtol(tok + 9, &endptr, 10)` 並驗證 `endptr != tok + 9 && *endptr == '\0'`，與 `lib/warden-core.ts:163-173` 的 `/^-?\d+$/` 檢查保持 100% 一致，且兩端皆先 trim 路徑前後空白。
  - **沒選的做法會怎樣**：若 C 端不檢查 `endptr` 直接把 `abc` 轉成 `0`，而 TS 端退回 `op.priority`，兩端在面對異常修飾符時會出現優先權分歧。
- **規格缺口**：`spec.md` 定義了 `?priority=<N>,lease=<ms>` 語法，未規定 `<N>` 非數字時的退回行為。
- **影響範圍**：影響 `src/c/vss_warden_core.c` 與 `lib/warden-core.ts` 的路徑解析一致性。
- **判定**：`sound` — 確保跨語言雙入口對邊界字串的行為完全一致。
- **把握度**：高
- **出處**：`src/c/vss_warden_core.c:428-485`、`lib/warden-core.ts:135-180`

#### C5 — C11 引擎固定靜態陣列上限（64 訊號／128 OCB）與子程序 5 秒逾時上限
- **何時**：Ticket `01` コミット `9b7cc47` 與 Ticket `02` コミット `1b5cfc9`
- **決定**：在 `src/c/vss_warden_core.h:10-16` 將單次批次執行的最大訊號數定為 `64`、最大開啟描述子（OCB）數定為 `128`、字串枚舉與陣列元素上限設為 `16`；在 `lib/warden-core.ts:239,249` 將 `execFileSync` 預設逾時設為 `5000 ms`、最大輸出緩衝設為 `4 MB`。
  - **觸發事件**：當執行 `vss-warden-cli` 處理批次測試序列或 API 請求時。
  - **現在怎麼做**：使用固定上限的確定性結構避免無界動態記憶體擴張，並在超過 64 訊號或 128 OCB 時回傳 `EINVAL`。
  - **沒選的做法會怎樣**：若無上限配置記憶體，惡意或超大規模輸入可能耗盡行程記憶體；若逾時過長則會在子程序異常時卡住 API 回應。
- **規格缺口**：`spec.md` 定了 HTTP body `512 KB` 與 `500` 步上限，但未明定 C 結構內部槽位上限與子程序逾時毫秒數。
- **影響範圍**：若未來單一測試批次需同時載入超過 64 個致動器訊號，需調高 `VSS_WARDEN_MAX_SIGNALS` 常數重編。
- **判定**：`sound` — 在嵌入式／RTOS C11 程式碼中使用有界靜態容量是標準安全實踐，且遠大於 3 個車載預設與 PBT 測試所需容量。
- **把握度**：高
- **出處**：`src/c/vss_warden_core.h:10-16`、`lib/warden-core.ts:238-251`

#### C6 — 依 `ticket-yagni` 結論將支援的 VSS 資料型別聚焦於 `int8`、`float`、`string` 與 `uint32[]` 四種驗收型別
- **何時**：Ticket `01` YAGNI 修剪（コミット `9b7cc47`）
- **決定**：僅實作並匯出 `spec.md` Testing Decisions 與 Ticket 01 驗收明確列出的四種 VSS 資料型別（`int8`、`float`、`string`、`uint32[]`），移除最初多寫但無票文驗收依據的 `boolean`、其他整數寬度與 `EPERM` 角色白名單欄位。
  - **觸發事件**：當 `ticket-yagni` 審查員檢查 Ticket `01` diff 是否包含超出票定驗收清單的型別分支時。
  - **現在怎麼做**：在 `lib/types.ts:6` 與 `src/c/vss_warden_core.c` 中將 `VssDatatype` 鎖定為 `"int8" | "float" | "string" | "uint32[]"`，精準覆蓋後視鏡角度（`int8`）、HVAC 溫度與上游浮點預設值 Bug（`float`）、雨刷模式枚舉（`string`）與 OBD 故障碼陣列與上游 `VECTOR_UINT32` Bug（`uint32[]`）。
  - **沒選的做法會怎樣**：若保留票文未驗收的額外型別分支，不僅違反 `ticket-yagni` 最小實作原則，也會留下未被 PBT 覆蓋的分支。
- **規格缺口**：`spec.md` User Story 2 曾順帶提及 `EPERM`，但 Ticket `01`～`03` 的具體驗收項與 PBT 規格僅驗收 `ERANGE`、`EINVAL`、`EBUSY`、`EBADF`、`ENOENT` 與上述四種資料型別。
- **影響範圍**：若未來要載入含 `boolean` 或 `double` 訊號的完整 9,706 行 `signal_catalog.json`，需在 `VssDatatype` 與 `vss_warden_core.c` 補回對應分支。
- **判定**：`sound` — 嚴格遵守 Ticket 驗收範圍與 YAGNI 修剪紀律。
- **把握度**：中（若使用者希望 Studio 額外展示 `EPERM` 角色拒絕，可在 `VssSignalSpec` 補回 `allowedRoles` 欄位）
- **出處**：`lib/types.ts:1-25`、`src/c/vss_warden_core.c:558-640`

#### C7 — Studio UI 初始狀態不硬編碼預存軌跡，透過 `POST /api/vss-warden/verify` 即時呼叫 C 引擎取得驗證結果
- **何時**：Ticket `03` YAGNI 修剪（コミット `107f9b0`）
- **決定**：移除 `lib/studio-model.ts` 中手寫的 `PRECOMPUTED_TRACES` 預存軌跡表，`createInitialStudioState(initialResponse = null)` 預設 `lastResponse` 為 `null`，使用者在畫面上點擊預設情境或「Run C11 + PBT Verification」按鈕時直接打 `/api/vss-warden/verify` 取得真實 C 引擎輸出。
  - **觸發事件**：當使用者開啟 Studio 頁面或切換 3 個車載預設情境時。
  - **現在怎麼做**：`app/page.tsx:313-331` 在點擊預設情境或執行按鈕時發送 `fetch("/api/vss-warden/verify")` 並透過 `studioReducer` 的 `activeRequestId` 更新 `state.lastResponse`；尚未執行前顯示引導提示按鈕，絕不在前端塞硬編碼假數據。
  - **沒選的做法會怎樣**：若在 `lib/studio-model.ts` 保留一份手寫的預存軌跡表，既違反 `ticket-yagni` 也違反 Seat 5/Seat 6「禁止前端雙份數據漂移」的原則。
- **規格缺口**：`spec.md` 提到避免在 `useEffect` 內發 `fetch`，但未明定初次渲染尚未按下按鈕時 `lastResponse` 應為 `null` 還是由 Server Component 預灌。
- **影響範圍**：影響 `lib/studio-model.ts:78-90` 與 `app/page.tsx` 的初始畫面狀態。
- **判定**：`sound` — 100% 杜絕前端硬編碼假軌跡，且符合 `react-doctor` 不在 `useEffect` 內 `fetch` 的規範。
- **把握度**：中（若希望首屏免按按鈕即顯示第一組預設結果，可將 `app/page.tsx` 外層改為 Server Component 先跑一次 `runVerificationPipeline` 傳入 `initialResponse`，只需改 5 行即可撤回切換）
- **出處**：`lib/studio-model.ts:78-155`、`app/page.tsx:308-355`
