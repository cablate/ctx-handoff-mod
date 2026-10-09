// 回覆語言提醒的純邏輯（不碰 $）：判斷一段回覆是不是目標語言、狀態怎麼走、提醒怎麼寫。
// 判斷只看「說明文字」：先去掉程式碼、網址、路徑、指令等，再數漢字、假名、韓文與英文單字。
// 寧可漏提醒也不要誤提醒：夾英文術語的中文、很短的句子、程式碼與專有名詞都不該觸發
import { tag } from './notes'

export type ReplyLang = 'zh-TW' | 'zh-CN' | 'en' | 'ja'
export type ReplyLangSetting = 'auto' | 'off' | ReplyLang
export const REPLY_LANG_SETTINGS: readonly ReplyLangSetting[] = ['auto', 'off', 'zh-TW', 'zh-CN', 'en', 'ja']
export const isReplyLangSetting = (v: unknown): v is ReplyLangSetting => REPLY_LANG_SETTINGS.includes(v as ReplyLangSetting)

// ---------- 設定 → 目標語言 ----------

const TW = /繁體|繁体|traditional|zh[-_ ]?(?:tw|hk|hant)|台灣|臺灣|taiwan/i
const CN = /简体|簡體|简體|simplified|zh[-_ ]?(?:cn|hans|sg)|大陆|大陸|mainland/i
const JA = /^ja\b|japanese|日本語|日本语|日语|日語|nihongo/i
const EN = /^en\b|english|英語|英语|英文/i

// Claude Code 的 language 設定（自由文字，例如「繁體中文」「English」「日本語」）對應到目標語言；
// 只寫「中文」或「Chinese」分不出繁簡，沒設或認不得都回 undefined（不提醒）
export function replyLangOfSetting(setting: unknown): ReplyLang | undefined {
  if (typeof setting !== 'string') return undefined
  const s = setting.trim()
  if (!s) return undefined
  if (TW.test(s)) return 'zh-TW'
  if (CN.test(s)) return 'zh-CN'
  if (JA.test(s)) return 'ja'
  if (EN.test(s)) return 'en'
  return undefined
}

// 設定值 + Claude Code 的 language → 這個對話要用的目標語言（undefined＝不提醒）
export function resolveReplyLang(setting: ReplyLangSetting, claudeLanguage: unknown): ReplyLang | undefined {
  if (setting === 'off') return undefined
  return setting === 'auto' ? replyLangOfSetting(claudeLanguage) : setting
}

// ---------- 簡繁專用字 ----------

// 一對一排好的「簡體字 繁體字」，只放簡繁寫法不同、而且簡體字不會出現在一般臺灣繁體文章裡的字。
// 刻意不放：理、后（皇后）、台、里、只、干、云、复、于、内、周、冲、并、听、异、党、厂（繁體也在用或另有用法）
export const PAIRS = [
  '这這', '们們', '说說', '时時', '会會', '为為', '对對', '发發', '经經', '过過', '还還', '进進', '没沒', '问問', '么麼', '样樣',
  '现現', '应應', '该該', '与與', '个個', '从從', '动動', '见見', '长長', '开開', '关關', '题題', '设設', '计計', '数數', '据據',
  '记記', '录錄', '处處', '验驗', '证證', '测測', '试試', '输輸', '错錯', '误誤', '实實', '际際', '项項', '档檔', '读讀', '写寫',
  '请請', '让讓', '给給', '变變', '将將', '节節', '点點', '单單', '简簡', '体體', '语語', '较較', '线線', '网網', '页頁', '务務',
  '产產', '业業', '东東', '门門', '间間', '机機', '软軟', '执執', '码碼', '类類', '调調', '结結', '构構', '创創', '删刪', '导導',
  '库庫', '态態', '状狀', '况況', '总總', '无無', '当當', '电電', '脑腦', '视視', '觉覺', '学學', '习習', '师師', '员員', '报報',
  '认認', '识識', '别別', '选選', '择擇', '参參', '协協', '议議', '储儲', '缓緩', '区區', '块塊', '边邊', '缘緣', '压壓', '缩縮',
  '传傳', '递遞', '载載', '术術', '编編', '译譯', '运運', '环環', '权權', '级級', '备備', '启啟', '终終', '显顯', '图圖', '标標',
  '击擊', '键鍵', '盘盤', '针針', '抛拋', '释釋', '虑慮', '担擔', '响響', '优優', '续續', '继繼', '断斷', '联聯', '络絡', '链鏈',
  '层層', '览覽', '话話', '讨討', '论論', '难難', '确確', '吗嗎', '谢謝', '帮幫', '买買', '卖賣', '钱錢', '费費', '购購', '账帳',
  '号號', '钥鑰', '书書', '条條', '规規', '则則', '围圍', '举舉', '两兩', '闻聞', '阅閱', '队隊', '阶階', '随隨', '义義', '乱亂',
  '头頭', '兴興', '亲親', '仅僅', '仓倉', '众眾', '伤傷', '侧側', '养養', '军軍', '农農', '减減', '刚剛', '剧劇', '办辦', '劳勞',
  '势勢', '双雙',
] as const
export const SIMPLIFIED_ONLY = new Set(PAIRS.map(p => p[0]))
export const TRADITIONAL_ONLY = new Set(PAIRS.map(p => p[1]))

// ---------- 判斷 ----------

// 太短的不判斷：漢字／假名／韓文少於 40 個、而且英文單字少於 16 個（一兩句英文旁白常見，不當成換了語言）
export const MIN_CJK = 40
export const MIN_LATIN = 16
// 某種文字占「單位」的比例超過這個才算主導。單位：英文 1 個單字、日韓中文 2 個字（平均詞長）
export const DOMINANT = 0.6
// 簡繁專用字至少 3 個、占漢字超過 6%，才算寫成另一種字形
export const MIX_MIN = 3
export const MIX_SHARE = 0.06
// 最多分析前面這麼多字，免得很長的回覆拖慢每個步驟
const MAX_TEXT = 20_000

export type Counts = { han: number; kana: number; hangul: number; latin: number; simp: number; trad: number }

// 去掉不算「說明」的部分：圍欄程式碼、引用行、行內程式碼、網址、路徑、@提及、斜線指令、檔名與 a.b 形式的識別字。
// 表格的豎線、標點與符號不是字母，數字時不用處理
export function proseOf(text: string): string {
  const kept: string[] = []
  let fence: string | undefined
  for (const line of text.split('\n')) {
    const head = line.trimStart()
    const mark = head.startsWith('```') ? '```' : head.startsWith('~~~') ? '~~~' : undefined
    if (fence !== undefined) {
      if (mark === fence) fence = undefined
      continue
    }
    if (mark !== undefined) { fence = mark; continue }
    if (head.startsWith('>')) continue
    kept.push(line)
  }
  return kept.join('\n')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ')
    .replace(/\b[A-Za-z]:[\\/][^\s"'`)\]>]*/g, ' ')
    .replace(/(?:\.{1,2}\/|~\/|\/)?(?:[\w.@~-]+\/)+[\w.@~-]*/g, ' ')
    .replace(/(?<!\w)@[\w./-]+/g, ' ')
    .replace(/(?<![\w/])\/[A-Za-z][\w:-]*/g, ' ')
    .replace(/\b[\w-]+(?:\.[\w-]+)+\b/g, ' ')
}

// 英文單字：2 個字母以上、全小寫或只有開頭大寫。全大寫縮寫（API、JSON）、駝峰、底線與夾數字的識別字都不算
const WORD = /^[A-Z]?[a-z]{2,}$/

export function countOf(prose: string): Counts {
  const c: Counts = { han: 0, kana: 0, hangul: 0, latin: 0, simp: 0, trad: 0 }
  for (const ch of prose) {
    if (/\p{Script=Han}/u.test(ch)) {
      c.han += 1
      if (SIMPLIFIED_ONLY.has(ch)) c.simp += 1
      else if (TRADITIONAL_ONLY.has(ch)) c.trad += 1
    } else if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch)) c.kana += 1
    else if (/\p{Script=Hangul}/u.test(ch)) c.hangul += 1
  }
  // I'll、don't 這類縮寫只看前半
  for (const w of prose.match(/[A-Za-z0-9_]+(?:'[A-Za-z]+)?/g) ?? []) if (WORD.test(w.replace(/'[A-Za-z]+$/, ''))) c.latin += 1
  return c
}

export type Verdict = 'on' | 'off' | 'short'

export function judge(text: string, target: ReplyLang): Verdict {
  const c = countOf(proseOf(text.slice(0, MAX_TEXT)))
  const cjk = c.han + c.kana + c.hangul
  if (cjk < MIN_CJK && c.latin < MIN_LATIN) return 'short'
  const cjkUnits = cjk / 2
  const total = cjkUnits + c.latin
  const latinShare = total > 0 ? c.latin / total : 0
  const mixed = (n: number) => n >= MIX_MIN && c.han > 0 && n / c.han > MIX_SHARE
  switch (target) {
    case 'en':
      return 1 - latinShare > DOMINANT ? 'off' : 'on'
    case 'ja':
      if (latinShare > DOMINANT) return 'off'
      if (c.hangul > c.han + c.kana) return 'off'
      // 日文一定有大量假名；有漢字卻幾乎沒有假名，是中文
      return c.han >= 30 && c.kana / (c.han + c.kana) < 0.1 ? 'off' : 'on'
    case 'zh-TW':
      if (latinShare > DOMINANT) return 'off'
      if (c.kana >= 10 && c.kana > c.han * 0.2) return 'off'
      return mixed(c.simp) ? 'off' : 'on'
    case 'zh-CN':
      if (latinShare > DOMINANT) return 'off'
      if (c.kana >= 10 && c.kana > c.han * 0.2) return 'off'
      return mixed(c.trad) ? 'off' : 'on'
  }
}

// ---------- 狀態與提醒文字 ----------

export const LANG_NAMES: Record<ReplyLang, string> = { 'zh-TW': '繁體中文', 'zh-CN': '简体中文', en: 'English', ja: '日本語' }

// 提醒用目標語言寫（模型讀起來自然）；程式碼、指令、路徑與專有名詞維持原文
export function reminderText(target: ReplyLang): string {
  switch (target) {
    case 'zh-TW': return `${tag} 你剛才那段說明不是繁體中文。之後的說明請用繁體中文（程式碼、指令、路徑與專有名詞維持原文）。使用者要你寫的其他語言內容（翻譯、英文文件等）照原本的要求寫。`
    case 'zh-CN': return `${tag} 你刚才那段说明不是简体中文。之后的说明请用简体中文（代码、命令、路径和专有名词保持原文）。用户要你写的其他语言内容（翻译、英文文档等）照原本的要求写。`
    case 'en': return `${tag} Your last explanation was not in English. Please write explanations in English from now on (keep code, commands, paths and proper nouns as they are). Content the user asked for in another language, such as a translation, stays as requested.`
    case 'ja': return `${tag} 先ほどの説明は日本語ではありませんでした。以降の説明は日本語で書いてください（コード、コマンド、パス、固有名詞は原文のままで構いません）。ユーザーが別の言語で頼んだ内容（翻訳、英語の文書など）はそのままで構いません。`
  }
}

// 提醒的進度：nudged＝這一段（連續不是目標語言的回覆）已經提醒過；
// pending＝等主對話下一個工具結果帶出去；next＝等使用者的下一則訊息帶出去
export type ReplyState = { nudged: boolean; pending: string | undefined; next: string | undefined }
export const freshReply = (): ReplyState => ({ nudged: false, pending: undefined, next: undefined })

// 記下主對話一個步驟的回覆。不是目標語言就排一次提醒（每段只提醒一次，之後有一步符合目標語言才重算）：
// 這步還要呼叫工具，提醒跟著下一個工具結果；沒有工具（最終回答）就跟著使用者的下一則訊息
export function noteStep(state: ReplyState, answer: string, hasToolUses: boolean, target: ReplyLang) {
  const verdict = judge(answer, target)
  if (verdict === 'on') state.nudged = false
  if (verdict !== 'off' || state.nudged) return
  state.nudged = true
  if (hasToolUses) state.pending = reminderText(target)
  else state.next = reminderText(target)
}

// 工具結果要附的提醒（附了就清掉）
export function takePending(state: ReplyState): string | undefined {
  const text = state.pending
  state.pending = undefined
  return text
}

// 使用者的下一則訊息要附的提醒：上一輪沒附出去的 pending 也一併帶上
export function peekNext(state: ReplyState): string[] {
  return [...new Set([state.pending, state.next].filter((s): s is string => s !== undefined))]
}
export function clearNext(state: ReplyState) {
  state.pending = undefined
  state.next = undefined
}
