// 使用者看得到的文字（狀態列、toast、紀錄、指令回覆、面板）：繁體中文與英文各一份。
// 不放這裡：給模型的提示、經驗檔的格式與標記（NOTE_TAG、標題、做法／理由／根據、規則行）、store 的鍵——那些是資料，改了會讀不了舊檔。
// 有參數的訊息寫成函式；zh-TW 是原文，en 的型別跟著它，少一條就編譯不過。

export type Lang = 'en' | 'zh-TW'

let current: Lang = 'en'
export const setLang = (lang: Lang) => { current = lang }
export const getLang = () => current
export const t = (): Messages => MSG[current]

// 設定值或語系字串是不是中文（zh、zh_TW.UTF-8、繁體中文、Traditional Chinese…）
export const isChinese = (s: string) => /^zh|chinese|中文|繁體|繁体|台灣|taiwan/i.test(s.trim())

// 選介面語言：Claude Code 的 language 設定（使用者明確選的）優先，沒設就看系統語系。
// 系統語系在 Linux／macOS 跟著 LANG，在 Windows 是作業系統的顯示語言；Git Bash 的 LANG 常是 en_US，不能拿來判斷
export const pickLang = (setting: unknown, systemLocale: string | undefined): Lang => {
  if (typeof setting === 'string' && setting.trim()) return isChinese(setting) ? 'zh-TW' : 'en'
  return systemLocale && isChinese(systemLocale) ? 'zh-TW' : 'en'
}

const s = (n: number) => (n === 1 ? '' : 's')

const zh = {
  // 共用的小零件
  ind: '　',
  bullet: '・',
  list: '、',
  slashList: ' ／ ',
  fieldLabel: (line: string) => line,
  guardMatch: (tool: string, match: string, unless?: string) => `${tool} 符合 /${match}/${unless ? ` 且不符合 /${unless}/` : ''}`,

  // 用量一行
  usage: (input: string, read: string, ratio: string, write: string, plain: string, output: string, sec: string) =>
    `輸入 ${input}（快取讀 ${read} = ${ratio}%，寫入 ${write}，未快取 ${plain}）・輸出 ${output}・${sec}s`,

  // fork／整理的失敗原因
  fork: {
    timeout: 'timeout：fork 超過時限沒有回應，已放棄等待',
    nothingToFork: 'nothing-to-fork：這個 session 剛重新啟動或剛 /clear，還沒有可以接的請求；先送一則訊息，等它回應後再執行一次',
  },

  // 產生交接
  handoff: {
    failedLog: (why: string) => `handoff 產生失敗：${why}`,
    failedToast: 'handoff 產生失敗',
    failGenerate: (why: string) => `產生失敗：${why}`,
    savedLog: (kind: string, usage: string) => `handoff（${kind}）${usage}`,
    dropped: (reason: string) => `被丟棄：${reason}`,
    reasonClear: (r: string) => `clear 失敗：${r}`,
    reasonSubmit: (r: string) => `送出失敗：${r}`,
    reasonException: (r: string) => `例外：${r}`,
    reasonStage: (stage: string, r: string) => `${stage} 失敗：${r}`,
    resubmitFailed: (r: string) => `重新送出交接期間的訊息失敗：${r}`,
    clearFailedLog: (r: string) => `/clear 失敗：${r}`,
    submitFailedLog: (r: string) => `送出失敗：${r}`,
    submitFailedToast: 'handoff 已產生但送出失敗，/handoff resend 重送',
    failedAll: (r: string) => `交接失敗：${r}`,
    failedCleanup: (r: string) => `交接失敗後的處理也失敗：${r}`,
    whyManual: '手動執行 /handoff now',
    whyTokens: (tokens: number) => `context 達 ${tokens} tokens`,
    // 送進新對話的第一則：誰、為什麼、請 AI 做什麼
    intro: (why: string) =>
      `上一段對話因${why}，已自動 /clear。以下是 handoff：請讀完後用幾行回報你理解的現況與下一步，然後等使用者指示，不要直接動手。`,
    introHeld: (why: string) =>
      `上一段對話因${why}，已自動 /clear。以下是 handoff 和交接期間使用者送出的訊息：請依 handoff 的脈絡回應最後附上的使用者訊息。`,
    note: (note: string) => `（${note}）`,
    heldHead: '---\n交接期間收到的使用者訊息：',
  },

  // 背景整理
  distill: {
    why: {
      idle: '閒置刷新',
      away: '離席',
      before: '交接前',
      manual: '手動',
      every: (n: number) => `每 ${n} 則`,
    },
    failLog: (why: string, reason: string) => `背景整理失敗（${why}）：${reason}`,
    timeout: (min: number) => `timeout：整理超過 ${min} 分鐘沒有回應，已放棄`,
    edited: (file: string) => `整理期間經驗檔被修改，這次略過：${file}`,
    skipLog: (why: string, reason: string) => `背景整理（${why}）${reason}`,
    doneLog: (why: string, changes: number, rejected: number, file: string) =>
      `背景整理（${why}）：${changes} 項變動${rejected ? `，丟棄 ${rejected} 行無效輸出` : ''}${changes ? `；寫入 ${file}` : ''}`,
    queued: (n: number) => `${n} 項變動排入下一則訊息`,
    toast: (n: number, queued: boolean, file: string) => `經驗已更新 ${n} 項${queued ? '，會跟著你下一則訊息帶入' : ''}：${file}`,
    writeFailed: (err: string) => `寫檔失敗：${err}`,
  },

  // 狀態列
  status: {
    running: '正在整理筆記…',
    left: (n: number) => `再 ${n} 則整理筆記`,
    short: '對話還短，先不整理筆記',
    next: '下一則後整理筆記',
    deferred: (parts: string) => `handoff 延後：${parts}`,
  },

  // /handoff 的整理狀態區塊
  distillStatus: {
    head: (on: string, every: number) => `背景整理 ${on}（閒置刷新、離席、交接前、每 ${every} 則）`,
    next: (left: number, idleMin: number) => `下次：再 ${left} 則，或閒置 ${idleMin} 分、交接前`,
    last: (at: string, why: string, n: number) => `上次：${at}・${why}・${n} 項變動`,
    lastNone: '上次：無',
    rejected: (n: number, samples: string) => `丟棄 ${n} 行無效輸出：${samples}`,
    failed: (at: string, why: string, reason: string) => `上次失敗：${at}・${why}・${reason}`,
    notes: (file: string, memory: number, rules: number, injected: number) =>
      `工作區經驗：${file}（記憶 ${memory} 條、規則 ${rules} 條，帶入新對話的規則 ${injected} 條）`,
    tiers: (full: number, titles: number, archived: number, days: number) =>
      `記憶帶入：偏好與修正 ${full} 條整條、事實與位置 ${titles} 條只帶標題、封存 ${archived} 條（超過 ${days} 天沒被證實，不帶入）`,
  },

  // 閒置刷新與離席
  idle: {
    refresh: (n: number, max: number, read: number, create: number) => `快取刷新 ${n}/${max} cache_read=${read} cache_creation=${create}`,
    refreshFailed: (n: number, max: number, reason: string) => `快取刷新 ${n}/${max} 失敗：${reason}`,
    awaySavedLog: (tokens: number) => `離席 handoff 已存好（${tokens} tokens），不會自動 /clear`,
    awaySavedToast: '離席 handoff 已存好',
    outdated: '對話已繼續，刪除過時的離席 handoff',
  },

  // 背景工作與延後
  stop: {
    tasks: (n: number) => `${n} 個背景工作`,
    oneShot: (n: number) => `${n} 個一次性排程`,
    agents: (n: number) => `${n} 個子代理`,
    deferral: (parts: string, cap: number) => `${parts}還在，等它們結束再 handoff（上限 ${cap} tokens）`,
    deferLog: (tokens: number, parts: string) => `context ${tokens} 已達門檻，但有${parts}，等它們結束再 handoff`,
    note: (parts: string, cap: number) => `交接時仍有${parts}在執行，context 已達上限 ${cap}`,
    capLog: (tokens: number, cap: number, parts: string) => `context ${tokens} 達上限 ${cap}，不再等${parts}，直接 handoff`,
    retryLog: (tokens: number) => `context ${tokens} 已達門檻，但上次 handoff 失敗不久，稍後再試`,
    stopFailed: (err: string) => `Stop 判斷失敗：${err}`,
  },

  // session 啟動
  start: {
    description: 'ctx-handoff: 狀態；now／dry／distill／resume／continue／resend／refresh on|off／distill on|off',
    taken: (err: string) => `/handoff 已被佔用（${err}），改用 /ctx-handoff`,
    registerFailed: (err: string) => `指令註冊失敗：${err}`,
    toolFailed: (err: string) => `「放進專案」工具註冊失敗：${err}`,
    resumeFailed: (err: string) => `接回閒置計時失敗：${err}`,
    pruneFailed: (err: string) => `啟動時整理 store 失敗：${err}`,
  },

  // 送出訊息時的提示
  submit: {
    wait: (sec: number, max: number) => `已進行 ${sec} 秒，通常 1 分鐘內完成，最長約 ${max} 分鐘`,
    attach: '圖片等附件無法暫存，交接完成後請重新貼上。',
    busy: (wait: string, attach: string) => `正在交接（${wait}）。${attach}`,
    dup: (wait: string, attach: string) => `正在交接（${wait}）。這則訊息先前已暫存，不會重複送出。${attach}`,
    held: (wait: string, attach: string) => `正在交接（${wait}），這則訊息已暫存，會在新對話一併送出。${attach}`,
    pendingToast: '有一份 handoff 沒送達，/handoff resend 重送',
    awayAttach: '有一份離席 handoff，舊對話的快取已過期。圖片等附件無法暫存：請先 /handoff resume（開新對話）或 /handoff continue（留在舊對話），再重新貼上。',
    awayHeld: (hasAttach: boolean) =>
      '有一份離席 handoff，舊對話的快取已過期。/handoff resume：開新對話接續，並帶上這則訊息；/handoff continue：在舊對話送出這則訊息（或直接再送一次）。' +
      (hasAttach ? '只暫存了文字，圖片等附件請在選擇後重新貼上。' : ''),
  },

  // 守門
  guard: {
    state: { proposed: '草稿', on: '啟用', off: '停用' },
    mode: { deny: '擋下', remind: '提醒' },
    checkFailed: (err: string) => `守門比對失敗，放行：${err}`,
    head: (id: number, rule: string, message: string) => `守門 #${id}（${rule}）：${message}`,
    denyToast: (id: number, tool: string, rule: string) => `守門 #${id} 擋下 ${tool}：${rule}`,
    denyHint: (id: number) => `使用者確定要照原樣執行時，請使用者先執行 /handoff guard off ${id}。`,
    noCandidates: (min: number) => `沒有出現 ${min} 次以上、還沒有守門的規則`,
    suggestFailed: (reason: string) => `守門建議失敗：${reason}`,
    suggested: (rules: number, drafts: number) => `看了 ${rules} 條規則，提出 ${drafts} 個守門草稿（還沒生效，/handoff guard on N 核准）`,
    droppedLines: (n: number, list: string) => `丟棄 ${n} 行：${list}`,
    none: (min: number) => `守門：無（/handoff guard suggest 從出現 ${min} 次以上的規則提出草稿）`,
    listHead: '守門：',
    entry: (id: number, state: string, mode: string, rule: string, hits: number) => `#${id} [${state}・${mode}] ${rule}（已觸發 ${hits} 次）`,
    example: (bad: string, good: string) => `範例：擋「${bad}」，放行「${good}」`,
    replay: (calls: number, hits: number) => `提案時試比對這段對話：${calls} 次工具呼叫中會命中 ${hits} 次`,
    usage: '用法 /handoff guard [suggest | on N | off N | mode N deny|remind | drop N]',
    missing: (id: string) => `沒有守門 #${id}`,
    changed: (id: number, dropped: boolean) => `守門 #${id} 已${dropped ? '刪除' : '更新'}`,
    summary: (on: number, draft: number, off: number) => `守門：啟用 ${on}、草稿 ${draft}、停用 ${off}`,
    summaryMore: (n: number, min: number) => `；有 ${n} 條規則出現 ${min} 次以上還沒有守門（/handoff guard suggest）`,
    panelDone: (id: number, action: 'on' | 'off' | 'drop') => `守門 #${id} 已${action === 'on' ? '核准' : action === 'off' ? '停用' : '刪除'}`,
    parse: {
      noMarker: '找不到 ACTIONS 標記',
      notCandidate: 'rule 不是候選規則',
      badTool: 'tool 格式不對',
      missingFields: '缺 match／message／mode',
      tooLong: 'regex 太長',
      missingExamples: '缺 bad／good 範例',
      badNotBlocked: '違規範例沒有被擋',
      goodBlocked: '正確範例也會被擋',
      duplicate: '同一條規則重複',
      wrap: (line: string, why: string) => `${line}（${why}）`,
    },
  },

  // 面板的指令與動作回覆
  panelCmd: {
    opened: '面板已開在輸入框上方：直接點按鈕，或按 ctrl+x tab 用鍵盤操作；再打一次 /handoff panel 關閉',
    closed: '面板已關閉',
    readFailed: (err: string) => `面板資料讀取失敗：${err}`,
    failed: (err: string) => `失敗：${err}`,
    busyKeep: '背景整理進行中，稍後再試',
    busyDrop: '背景整理進行中，稍後再刪',
    notFound: '找不到這一條，經驗檔可能剛被改過',
    kept: (title: string) => `已留下：${title}（恢復帶入新對話）`,
    deleted: (isMemory: boolean, name: string, dir: string) =>
      `已刪除${isMemory ? '記憶' : `規則「${name}」`}（原檔已備份到 ${dir}/.ctx-handoff-backup/）`,
  },

  // 整理的變動（寫進紀錄、toast、面板，也會跟著下一則訊息帶入）
  change: {
    addMemory: (head: string) => `新增記憶：${head}`,
    updateMemory: (head: string) => `更新記憶：${head}`,
    confirmMemory: (head: string) => `記憶確認：${head}`,
    deleteMemory: (head: string) => `刪除記憶：${head}`,
    addRule: (name: string, rule: string) => `新規則：${name}（出現 1 次）：${rule}`,
    confirmRule: (name: string, count: number) => `規則確認：${name} → 出現 ${count} 次`,
    updateRule: (name: string) => `更新規則：${name}`,
    deleteRule: (name: string) => `刪除規則：${name}`,
  },

  // 整理輸出被丟棄的原因（記進樣本，/handoff 看得到）
  reject: {
    over: (k: string, max: number) => `${k} 超過 ${max} 字`,
    overJoin: '、',
    idNot: (kind: string) => `id 不是 ${kind}#`,
    noId: (id: string) => `沒有編號 ${id}`,
    badType: (type: string) => `type 無效（${type}）`,
    missing: (names: string) => `缺少 ${names}`,
    quoteNotFound: 'quote 不在使用者訊息裡',
    quoteMissing: (type: string) => `${type} 類缺少使用者原話 quote`,
    badOp: (op: string) => `不認得的 op（${op}）`,
    noMarker: (marker: string) => `找不到 ${marker} 標記`,
    badJson: (msg: string) => `JSON 格式錯誤（${msg}）`,
    notObject: '不是 JSON 物件',
    secret: '疑似金鑰',
    noRecord: '（內容不記錄）',
    sample: (why: string, line: string) => `${why}：${line}`,
  },

  // /handoff 指令的回覆
  cmd: {
    unknown: (sub: string) => `不認得「${sub}」`,
    usageHead: '用法：',
    usageLines: [
      '　/handoff                  狀態',
      '　/handoff now              立刻產生 handoff 並 /clear',
      '　/handoff dry              試產一份 handoff，不 /clear',
      '　/handoff distill          立刻整理這個工作區的經驗',
      '　/handoff resume           用離席 handoff 開新對話接續（會 /clear）',
      '　/handoff continue         放棄離席 handoff，在舊對話送出被攔下的訊息',
      '　/handoff resend           重新送出沒送達的 handoff（不 /clear）',
      '　/handoff refresh on|off   開關閒置時的快取刷新',
      '　/handoff distill on|off   開關背景整理',
      '　/handoff panel            開關輸入框上方的面板：最近整理的變動、刪掉記錯的筆記、核准守門',
      '　/handoff guard           守門清單；suggest 從常犯規則提草稿；on|off|drop N；mode N deny|remind',
    ],
    context: (tokens: string, threshold: number, window: number) => `context ${tokens} / 門檻 ${threshold}（視窗 ${window}）`,
    refresh: (on: string, n: number, max: number, timer: boolean) =>
      `快取刷新 ${on}，本次閒置已刷新 ${n}/${max}，計時器${timer ? '等待中' : '未啟動'}`,
    away: (state: 'none' | 'yes' | 'held') => `離席 handoff：${state === 'none' ? '無' : state === 'yes' ? '有' : '有（已攔下一則訊息）'}`,
    latest: (last: { at: string; kind: string; tokens: string } | undefined) =>
      `最近一份 handoff：${last ? `${last.at} ${last.kind}，context ${last.tokens}` : '無'}`,
    latestFailure: (at: string, kind: string, reason: string) => `最近失敗：${at} ${kind}，${reason}`,
    undelivered: '未送達的 handoff：有（/handoff resend 重送）',
    deferred: (deferral: string) => `handoff 延後：${deferral}`,
    background: (tasks: number, oneShot: number, recurring: number) => `背景（上次 Stop）：工作 ${tasks}、一次性排程 ${oneShot}、循環排程 ${recurring}`,
    busy: '正在處理另一個 handoff',
    nowStarted: '正在產生 handoff，接著 /clear 再送出',
    dryFailed: '試產失敗，原因見上方記錄',
    dryDone: (tokens: string) => `試產完成（沒有 /clear），context ${tokens}`,
    distillSet: (arg: string) => `背景整理已設為 ${arg}`,
    distillUsage: '用法 /handoff distill（立刻整理）或 /handoff distill on|off',
    distilling: '正在整理中',
    distillNone: '沒有整理：上次整理之後沒有新訊息，或整理失敗',
    distillDone: '整理完成',
    refreshNow: (on: string) => `目前 ${on}；用法 /handoff refresh on|off`,
    refreshSet: (arg: string, minutes: number) => `快取刷新已設為 ${arg}${arg === 'off' ? `（閒置 ${minutes} 分鐘就直接產生離席 handoff）` : ''}`,
    configLocked: (reason: string) => `沒有改到設定：${reason}`,
    noAway: '沒有離席 handoff',
    resumeIntro: '上一段對話閒置後產生了 handoff，已開新對話接續。請讀完後用幾行回報你理解的現況與下一步，然後等使用者指示。',
    resumeIntroHeld: '上一段對話閒置後產生了 handoff，已開新對話接續。請依 handoff 的脈絡回應最後附上的使用者訊息。',
    resumeHeld: '---\n使用者回來後的第一則訊息：',
    resumeFailedLog: (r: string) => `/clear 或送出失敗：${r}`,
    resumeClearFailed: '/clear 失敗，離席 handoff 已保留，可以再 /handoff resume',
    resuming: '即將 /clear 並送出離席 handoff',
    resendIntro: '重新送出上一份 handoff。請讀完後用幾行回報你理解的現況與下一步，然後等使用者指示，不要直接動手。',
    nothingToResend: '這個 session 沒有可以重送的 handoff',
    resendFailed: (err: string) => `重送失敗：${err}`,
    resending: '正在重新送出 handoff（不 /clear）',
    discarded: '已捨棄離席 handoff，繼續舊對話',
    discardedSend: '已捨棄離席 handoff，在舊對話送出剛才的訊息',
    sendHeldFailed: (err: string) => `送出被攔下的訊息失敗：${err}`,
  },

  // 面板畫面
  panel: {
    title: '・專案筆記與守門',
    close: '關閉',
    more: '展開',
    less: '收合',
    del: '刪除',
    confirmDel: '確定刪除',
    cancel: '取消',
    keep: '留下',
    off: '停用',
    approve: '核准',
    draftBtn: '提草稿',
    // 一列右側按鈕佔的寬度（格）：展開＋確定刪除＋取消
    buttonsCells: 28,
    tabGuard: (n: number) => `守門 ${n}`,
    tabMemory: (n: number) => `記憶 ${n}`,
    tabRules: (n: number) => `規則 ${n}`,
    tabDistill: '最近整理',
    noGuards: '還沒有守門。規則出現 3 次以上時可以請模型提草稿。',
    guardMeta: (id: number, mode: string, hits: number) => `#${id}・${mode}・觸發 ${hits} 次`,
    blockLabel: '擋　',
    allowLabel: '放行',
    replay: (calls: number, hits: number) => `試比對這段對話：${calls} 次工具呼叫中命中 ${hits} 次`,
    suggesting: '正在請模型提草稿…',
    candidates: (n: number) => `有 ${n} 條規則出現 3 次以上還沒有守門 `,
    memoryHint: (shown: number, total: number) => `最新 ${shown} 條（共 ${total} 條）・偏好與修正整條帶入新對話，事實與位置只帶標題`,
    archived: (n: number, days: number) => `封存 ${n} 條：超過 ${days} 天沒被證實，不帶入新對話`,
    noRules: '還沒有規則',
    ruleCount: (n: number) => `${n} 次`,
    inProject: (project: string) => (project.startsWith('已在 ') ? `已在 ${project.slice(3)}` : '不放進專案'),
    distillLine: (at: string, why: string, n: number) => `${at}・${why}・${n} 項變動`,
    noDistill: '還沒有整理紀錄',
    footer: (file: string) => `ctrl+x tab 後按 1–4 切分頁・${file}`,
    typeLabel: { user: '偏好', feedback: '修正', project: '事實', reference: '位置' } as Record<string, string>,
  },
}

export type Messages = typeof zh

const en: Messages = {
  ind: '  ',
  bullet: '- ',
  list: ', ',
  slashList: ' / ',
  // 面板展開時，經驗檔裡的欄位標籤（做法／理由／根據）顯示成英文；檔案本身不變
  fieldLabel: line => line.replace(/^做法：/, 'How: ').replace(/^理由：/, 'Why: ').replace(/^根據：/, 'Evidence: '),
  guardMatch: (tool, match, unless) => `${tool} matches /${match}/${unless ? ` and not /${unless}/` : ''}`,

  usage: (input, read, ratio, write, plain, output, sec) =>
    `input ${input} (cache read ${read} = ${ratio}%, written ${write}, uncached ${plain}) · output ${output} · ${sec}s`,

  fork: {
    timeout: 'timeout: the fork did not answer in time, gave up waiting',
    nothingToFork: 'nothing-to-fork: this session was just restarted or cleared, so there is nothing to build on yet. Send a message, wait for the reply, then try again',
  },

  handoff: {
    failedLog: why => `handoff failed: ${why}`,
    failedToast: 'Handoff failed',
    failGenerate: why => `generation failed: ${why}`,
    savedLog: (kind, usage) => `handoff (${kind}) ${usage}`,
    dropped: reason => `dropped: ${reason}`,
    reasonClear: r => `clear failed: ${r}`,
    reasonSubmit: r => `submit failed: ${r}`,
    reasonException: r => `exception: ${r}`,
    reasonStage: (stage, r) => `${stage} failed: ${r}`,
    resubmitFailed: r => `could not resend the messages received during handoff: ${r}`,
    clearFailedLog: r => `/clear failed: ${r}`,
    submitFailedLog: r => `submit failed: ${r}`,
    submitFailedToast: 'Handoff created but not sent. Run /handoff resend to send it again',
    failedAll: r => `handoff failed: ${r}`,
    failedCleanup: r => `cleanup after the failed handoff also failed: ${r}`,
    whyManual: 'the user ran /handoff now',
    whyTokens: tokens => `context reached ${tokens} tokens`,
    intro: why =>
      `The previous conversation was cleared automatically because ${why}. Here is the handoff: read it, tell me in a few lines the current state and next step as you understand them, then wait for the user's instructions. Do not start working yet.`,
    introHeld: why =>
      `The previous conversation was cleared automatically because ${why}. Here is the handoff and the messages the user sent during the handoff: respond to the user's last message below, using the handoff as context.`,
    note: note => ` (${note})`,
    heldHead: '---\nMessages the user sent during the handoff:',
  },

  distill: {
    why: {
      idle: 'idle refresh',
      away: 'away',
      before: 'before handoff',
      manual: 'manual',
      every: n => `every ${n} messages`,
    },
    failLog: (why, reason) => `notes update failed (${why}): ${reason}`,
    timeout: min => `timeout: no answer after ${min} minutes, gave up`,
    edited: file => `the notes file was edited during the update, skipped this time: ${file}`,
    skipLog: (why, reason) => `notes update (${why}): ${reason}`,
    doneLog: (why, changes, rejected, file) =>
      `notes update (${why}): ${changes} change${s(changes)}${rejected ? `, dropped ${rejected} invalid line${s(rejected)}` : ''}${changes ? `; wrote ${file}` : ''}`,
    queued: n => `${n} change${s(n)} queued for your next message`,
    toast: (n, queued, file) => `Notes updated: ${n} change${s(n)}${queued ? ', sent along with your next message' : ''}: ${file}`,
    writeFailed: err => `could not write the file: ${err}`,
  },

  status: {
    running: 'Updating notes…',
    left: n => `${n} more message${s(n)} until notes update`,
    short: 'Conversation is short, notes not updated yet',
    next: 'Notes update after the next message',
    deferred: parts => `Handoff delayed: ${parts}`,
  },

  distillStatus: {
    head: (on, every) => `Background notes ${on} (idle refresh, away, before handoff, every ${every} messages)`,
    next: (left, idleMin) => `Next: in ${left} message${s(left)}, after ${idleMin} min idle, or before a handoff`,
    last: (at, why, n) => `Last: ${at} · ${why} · ${n} change${s(n)}`,
    lastNone: 'Last: none',
    rejected: (n, samples) => `Dropped ${n} invalid line${s(n)}: ${samples}`,
    failed: (at, why, reason) => `Last failure: ${at} · ${why} · ${reason}`,
    notes: (file, memory, rules, injected) =>
      `Workspace notes: ${file} (${memory} memor${memory === 1 ? 'y' : 'ies'}, ${rules} rule${s(rules)}, ${injected} rule${s(injected)} carried into new conversations)`,
    tiers: (full, titles, archived, days) =>
      `Memories carried in: ${full} preference${s(full)} and correction${s(full)} in full, ${titles} fact${s(titles)} and location${s(titles)} as titles only, ${archived} archived (not confirmed for over ${days} days, not carried in)`,
  },

  idle: {
    refresh: (n, max, read, create) => `cache refresh ${n}/${max} cache_read=${read} cache_creation=${create}`,
    refreshFailed: (n, max, reason) => `cache refresh ${n}/${max} failed: ${reason}`,
    awaySavedLog: tokens => `away handoff saved (${tokens} tokens), will not /clear automatically`,
    awaySavedToast: 'Away handoff saved',
    outdated: 'the conversation went on, deleted the outdated away handoff',
  },

  stop: {
    tasks: n => `${n} background task${s(n)}`,
    oneShot: n => `${n} one-off schedule${s(n)}`,
    agents: n => `${n} subagent${s(n)}`,
    deferral: (parts, cap) => `${parts} still running, waiting for them to finish before handoff (limit ${cap} tokens)`,
    deferLog: (tokens, parts) => `context ${tokens} reached the threshold, but ${parts} still running; waiting for them to finish before handoff`,
    note: (parts, cap) => `${parts} still running at handoff; context reached the limit of ${cap}`,
    capLog: (tokens, cap, parts) => `context ${tokens} reached the limit of ${cap}; not waiting for ${parts} any longer, handing off now`,
    retryLog: tokens => `context ${tokens} reached the threshold, but the last handoff failed recently; will try again later`,
    stopFailed: err => `Stop check failed: ${err}`,
  },

  start: {
    description: 'ctx-handoff: status; now / dry / distill / resume / continue / resend / refresh on|off / distill on|off',
    taken: err => `/handoff is already taken (${err}), using /ctx-handoff instead`,
    registerFailed: err => `could not register the command: ${err}`,
    toolFailed: err => `could not register the move-to-project tool: ${err}`,
    resumeFailed: err => `could not restore the idle timer: ${err}`,
    pruneFailed: err => `could not tidy the store at startup: ${err}`,
  },

  submit: {
    wait: (sec, max) => `${sec}s so far, usually done within a minute, up to about ${max} minutes`,
    attach: 'Images and other attachments cannot be held. Paste them again after the handoff.',
    busy: (wait, attach) => `Handoff in progress (${wait}).${attach ? ` ${attach}` : ''}`,
    dup: (wait, attach) => `Handoff in progress (${wait}). This message is already held and will not be sent twice.${attach ? ` ${attach}` : ''}`,
    held: (wait, attach) => `Handoff in progress (${wait}). This message is held and will be sent in the new conversation.${attach ? ` ${attach}` : ''}`,
    pendingToast: 'A handoff was not delivered. Run /handoff resend to send it again',
    awayAttach: 'There is an away handoff and the old conversation\'s cache has expired. Attachments cannot be held: run /handoff resume (new conversation) or /handoff continue (stay in the old one) first, then paste again.',
    awayHeld: hasAttach =>
      'There is an away handoff and the old conversation\'s cache has expired. /handoff resume: continue in a new conversation and include this message; /handoff continue: send this message in the old conversation (or just send it again).' +
      (hasAttach ? ' Only the text was held. Paste images and other attachments again after you choose.' : ''),
  },

  guard: {
    state: { proposed: 'draft', on: 'on', off: 'off' },
    mode: { deny: 'block', remind: 'remind' },
    checkFailed: err => `guard check failed, letting the call through: ${err}`,
    head: (id, rule, message) => `Guard #${id} (${rule}): ${message}`,
    denyToast: (id, tool, rule) => `Guard #${id} blocked ${tool}: ${rule}`,
    denyHint: id => `If the user really wants this to run as is, ask them to run /handoff guard off ${id} first.`,
    noCandidates: min => `No rule has appeared ${min}+ times without a guard`,
    suggestFailed: reason => `Guard suggestion failed: ${reason}`,
    suggested: (rules, drafts) => `Looked at ${rules} rule${s(rules)} and drafted ${drafts} guard${s(drafts)} (not active yet; approve with /handoff guard on N)`,
    droppedLines: (n, list) => `Dropped ${n} line${s(n)}: ${list}`,
    none: min => `Guards: none (/handoff guard suggest drafts them from rules that appeared ${min}+ times)`,
    listHead: 'Guards:',
    entry: (id, state, mode, rule, hits) => `#${id} [${state} · ${mode}] ${rule} (triggered ${hits} time${s(hits)})`,
    example: (bad, good) => `Example: blocks "${bad}", allows "${good}"`,
    replay: (calls, hits) => `Trial match on this conversation when drafted: ${hits} of ${calls} tool call${s(calls)}`,
    usage: 'Usage: /handoff guard [suggest | on N | off N | mode N deny|remind | drop N]',
    missing: id => `No guard #${id}`,
    changed: (id, dropped) => `Guard #${id} ${dropped ? 'deleted' : 'updated'}`,
    summary: (on, draft, off) => `Guards: ${on} on, ${draft} draft, ${off} off`,
    summaryMore: (n, min) => `; ${n} rule${s(n)} appeared ${min}+ times without a guard (/handoff guard suggest)`,
    panelDone: (id, action) => `Guard #${id} ${action === 'on' ? 'approved' : action === 'off' ? 'turned off' : 'deleted'}`,
    parse: {
      noMarker: 'ACTIONS marker not found',
      notCandidate: 'rule is not a candidate',
      badTool: 'bad tool format',
      missingFields: 'missing match / message / mode',
      tooLong: 'regex too long',
      missingExamples: 'missing bad / good examples',
      badNotBlocked: 'the bad example is not blocked',
      goodBlocked: 'the good example would be blocked too',
      duplicate: 'same rule repeated',
      wrap: (line, why) => `${line} (${why})`,
    },
  },

  panelCmd: {
    opened: 'Panel opened above the input. Click the buttons, or press ctrl+x tab to use the keyboard. Run /handoff panel again to close it',
    closed: 'Panel closed',
    readFailed: err => `Could not read panel data: ${err}`,
    failed: err => `Failed: ${err}`,
    busyKeep: 'Notes are being updated, try again in a moment',
    busyDrop: 'Notes are being updated, try deleting again in a moment',
    notFound: 'Could not find this entry. The notes file may have just been edited',
    kept: title => `Kept: ${title} (carried into new conversations again)`,
    deleted: (isMemory, name, dir) =>
      `Deleted ${isMemory ? 'the memory' : `the rule "${name}"`} (original backed up to ${dir}/.ctx-handoff-backup/)`,
  },

  change: {
    addMemory: head => `Added memory: ${head}`,
    updateMemory: head => `Updated memory: ${head}`,
    confirmMemory: head => `Memory confirmed: ${head}`,
    deleteMemory: head => `Deleted memory: ${head}`,
    addRule: (name, rule) => `New rule: ${name} (seen 1 time): ${rule}`,
    confirmRule: (name, count) => `Rule confirmed: ${name} → seen ${count} times`,
    updateRule: name => `Updated rule: ${name}`,
    deleteRule: name => `Deleted rule: ${name}`,
  },

  reject: {
    over: (k, max) => `${k} over ${max} characters`,
    overJoin: ', ',
    idNot: kind => `id is not ${kind}#`,
    noId: id => `no such id ${id}`,
    badType: type => `invalid type (${type})`,
    missing: names => `missing ${names}`,
    quoteNotFound: 'quote is not in the user\'s messages',
    quoteMissing: type => `${type} entries need a quote from the user`,
    badOp: op => `unknown op (${op})`,
    noMarker: marker => `${marker} marker not found`,
    badJson: msg => `invalid JSON (${msg})`,
    notObject: 'not a JSON object',
    secret: 'looks like a secret',
    noRecord: '(content not recorded)',
    sample: (why, line) => `${why}: ${line}`,
  },

  cmd: {
    unknown: sub => `Unknown subcommand "${sub}"`,
    usageHead: 'Usage:',
    usageLines: [
      '  /handoff                  status',
      '  /handoff now              create a handoff and /clear now',
      '  /handoff dry              trial handoff, no /clear',
      '  /handoff distill          update this workspace\'s notes now',
      '  /handoff resume           continue from the away handoff in a new conversation (does /clear)',
      '  /handoff continue         drop the away handoff and send the held message in the old conversation',
      '  /handoff resend           resend a handoff that did not arrive (no /clear)',
      '  /handoff refresh on|off   turn the idle cache refresh on or off',
      '  /handoff distill on|off   turn background notes on or off',
      '  /handoff panel            toggle the panel above the input: latest notes changes, delete wrong notes, approve guards',
      '  /handoff guard           list guards; suggest drafts them from repeated rules; on|off|drop N; mode N deny|remind',
    ],
    context: (tokens, threshold, window) => `context ${tokens} / threshold ${threshold} (window ${window})`,
    refresh: (on, n, max, timer) => `Cache refresh ${on}, refreshed ${n}/${max} this idle period, timer ${timer ? 'waiting' : 'not started'}`,
    away: state => `Away handoff: ${state === 'none' ? 'none' : state === 'yes' ? 'yes' : 'yes (one message held)'}`,
    latest: last => `Latest handoff: ${last ? `${last.at} ${last.kind}, context ${last.tokens}` : 'none'}`,
    latestFailure: (at, kind, reason) => `Latest failure: ${at} ${kind}, ${reason}`,
    undelivered: 'Undelivered handoff: yes (/handoff resend to send it again)',
    deferred: deferral => `Handoff delayed: ${deferral}`,
    background: (tasks, oneShot, recurring) => `Background (last Stop): ${tasks} task${s(tasks)}, ${oneShot} one-off schedule${s(oneShot)}, ${recurring} recurring schedule${s(recurring)}`,
    busy: 'Another handoff is in progress',
    nowStarted: 'Creating the handoff, then /clear and send it',
    dryFailed: 'Trial run failed, see the log above for the reason',
    dryDone: tokens => `Trial run done (no /clear), context ${tokens}`,
    distillSet: arg => `Background notes set to ${arg}`,
    distillUsage: 'Usage: /handoff distill (update now) or /handoff distill on|off',
    distilling: 'Already updating notes',
    distillNone: 'Notes not updated: no new messages since the last update, or it failed',
    distillDone: 'Notes updated',
    refreshNow: on => `Currently ${on}. Usage: /handoff refresh on|off`,
    refreshSet: (arg, minutes) => `Cache refresh set to ${arg}${arg === 'off' ? ` (an away handoff is created after ${minutes} idle minutes)` : ''}`,
    configLocked: reason => `Setting not changed: ${reason}`,
    noAway: 'No away handoff',
    resumeIntro: 'The previous conversation went idle and a handoff was created, so this is a new conversation to continue it. Read the handoff, tell me in a few lines the current state and next step as you understand them, then wait for the user\'s instructions.',
    resumeIntroHeld: 'The previous conversation went idle and a handoff was created, so this is a new conversation to continue it. Respond to the user\'s message at the end, using the handoff as context.',
    resumeHeld: '---\nThe user\'s first message after coming back:',
    resumeFailedLog: r => `/clear or submit failed: ${r}`,
    resumeClearFailed: '/clear failed. The away handoff is kept, you can run /handoff resume again',
    resuming: 'About to /clear and send the away handoff',
    resendIntro: 'Resending the previous handoff. Read it, tell me in a few lines the current state and next step as you understand them, then wait for the user\'s instructions. Do not start working yet.',
    nothingToResend: 'No handoff to resend in this session',
    resendFailed: err => `resend failed: ${err}`,
    resending: 'Resending the handoff (no /clear)',
    discarded: 'Away handoff discarded, staying in the old conversation',
    discardedSend: 'Away handoff discarded, sending your last message in the old conversation',
    sendHeldFailed: err => `could not send the held message: ${err}`,
  },

  panel: {
    title: ' · Project notes and guards',
    close: 'Close',
    more: 'More',
    less: 'Less',
    del: 'Delete',
    confirmDel: 'Confirm',
    cancel: 'Cancel',
    keep: 'Keep',
    off: 'Turn off',
    approve: 'Approve',
    draftBtn: 'Draft guards',
    buttonsCells: 32,
    tabGuard: n => `Guards ${n}`,
    tabMemory: n => `Memory ${n}`,
    tabRules: n => `Rules ${n}`,
    tabDistill: 'Last update',
    noGuards: 'No guards yet. Once a rule appears 3+ times you can ask the model to draft one.',
    guardMeta: (id, mode, hits) => `#${id} · ${mode} · ${hits} hit${s(hits)}`,
    blockLabel: 'Blocks ',
    allowLabel: 'Allows ',
    replay: (calls, hits) => `Trial match on this conversation: ${hits} of ${calls} tool call${s(calls)}`,
    suggesting: 'Asking the model for drafts…',
    candidates: n => `${n} rule${s(n)} appeared 3+ times without a guard `,
    memoryHint: (shown, total) => `Latest ${shown} of ${total} · preferences and corrections go into new conversations in full, facts and locations as titles only`,
    archived: (n, days) => `${n} archived: not confirmed for over ${days} days, not carried into new conversations`,
    noRules: 'No rules yet',
    ruleCount: n => `${n}x`,
    inProject: project => (project.startsWith('已在 ') ? `in ${project.slice(3)}` : 'kept out of the repo'),
    distillLine: (at, why, n) => `${at} · ${why} · ${n} change${s(n)}`,
    noDistill: 'No notes updates yet',
    footer: file => `After ctrl+x tab, press 1–4 to switch tabs · ${file}`,
    typeLabel: { user: 'Preference', feedback: 'Correction', project: 'Fact', reference: 'Location' },
  },
}

const MSG: Record<Lang, Messages> = { 'zh-TW': zh, en }
