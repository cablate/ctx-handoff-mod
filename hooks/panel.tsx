// /handoff panel：專案筆記與守門的面板（輸入框上方）。只負責畫面，資料與動作由 register.ts 傳入
import type { EngineInterface } from 'claude-code'
import type { PanelData, PanelTab, PanelUi } from '../types'

type Elements = ReturnType<EngineInterface['ui']['resolve']>

export type { PanelTab } from '../types'

// 畫面要的全部：資料快照、操作狀態、面板內文寬度（格數，長文字依它截成一行）
export type PanelView = PanelData & PanelUi & { columns: number }

export type PanelActions = {
  tab: (tab: PanelTab) => void
  guard: (id: number, action: 'on' | 'off' | 'drop') => void
  suggest: () => void
  toggle: (key: string) => void
  ask: (key: string | undefined) => void
  drop: (key: string) => void
  keep: (head: string) => void
  close: () => void
}

const ACCENT = 'cyan'
const STATE = {
  proposed: { label: '草稿', color: 'yellow' },
  on: { label: '啟用', color: 'green' },
  off: { label: '停用', color: 'gray' },
} as const
const TYPE_COLOR: Record<string, string> = { user: 'magenta', feedback: 'blue', project: 'cyan', reference: 'gray' }
const TYPE_LABEL: Record<string, string> = { user: '偏好', feedback: '修正', project: '事實', reference: '位置' }
// 外框兩格、左右內距各一格
const FRAME_CELLS = 4
// 一列右側按鈕佔的寬度：[ 展開 ] [ 刪除 ]，確認時 [ 確定刪除 ] [ 取消 ]，留一點餘裕
const BUTTONS_CELLS = 28
const oneLine = (s: string) => s.replace(/\s+/g, ' ').replace(/^- /, '').trim()
// 終端機格數：中日韓與全形字算兩格
const cells = (ch: string) => ((ch.codePointAt(0) ?? 0) >= 0x1100 ? 2 : 1)

export function fit(s: string, width: number) {
  const text = oneLine(s)
  let used = 0
  let out = ''
  for (const ch of text) {
    const w = cells(ch)
    if (used + w > width - 1) return `${out}…`
    used += w
    out += ch
  }
  return out
}

// [類型] 標題 → 類型與標題（舊格式沒有類型時 type 為空）
const splitHead = (head: string) => {
  const m = /^\[(\w+)\] (.*)$/.exec(head)
  return m ? { type: m[1] ?? '', title: m[2] ?? '' } : { type: '', title: head }
}

export function panelTree(ui: Elements, v: PanelView, act: PanelActions) {
  const { Box, Text, Button } = ui
  const inner = Math.max(24, v.columns - FRAME_CELLS)
  const short = Math.max(20, inner - BUTTONS_CELLS)
  const isOpen = (key: string) => v.expanded.includes(key)
  const toggle = (key: string) => (
    <Button key={`t:${key}`} label={isOpen(key) ? '收合' : '展開'} dimColor onPress={() => act.toggle(key)} />
  )
  // 刪除要按兩次：第一次只標記，第二次才寫檔
  const dropButtons = (key: string) =>
    v.confirming === key
      ? [
          <Button key={`yes:${key}`} label="確定刪除" variant="primary" onPress={() => act.drop(key)} />,
          <Button key={`no:${key}`} label="取消" onPress={() => act.ask(undefined)} />,
        ]
      : [<Button key={`del:${key}`} label="刪除" dimColor onPress={() => act.ask(key)} />]
  const badge = (label: string, color: string) => <Text color={color} bold>{label}</Text>
  const empty = (text: string) => <Text dimColor>{text}</Text>

  // 熱鍵 1–4：面板拿到鍵盤（ctrl+x tab 或點一下）時按數字切分頁
  const tabs: { id: PanelTab; label: string }[] = [
    { id: 'guard', label: `守門 ${v.guards.length}` },
    { id: 'memory', label: `記憶 ${v.memoryTotal}` },
    { id: 'rules', label: `規則 ${v.rules.length}` },
    { id: 'distill', label: '最近整理' },
  ]

  const guardTab = (
    <Box flexDirection="column">
      {v.guards.length === 0 ? empty('還沒有守門。規則出現 3 次以上時可以請模型提草稿。') : null}
      {v.guards.map(g => {
        const s = STATE[g.state]
        const detail = `${g.tool} 符合 /${g.match}/${g.unless ? ` 且不符合 /${g.unless}/` : ''}`
        return (
          <Box key={`g${g.id}`} flexDirection="column" marginBottom={1}>
            <Box>
              <Box flexGrow={1}>
                <Text>
                  {badge(`● ${s.label}`, s.color)} <Text dimColor>#{g.id}・{g.mode === 'deny' ? '擋下' : '提醒'}・觸發 {g.hits} 次</Text>{' '}
                  {fit(g.rule, short - 24)}
                </Text>
              </Box>
              {g.state === 'on'
                ? <Button key={`off${g.id}`} label="停用" onPress={() => act.guard(g.id, 'off')} />
                : <Button key={`on${g.id}`} label="核准" variant="primary" onPress={() => act.guard(g.id, 'on')} />}
              <Button key={`drop${g.id}`} label="刪除" dimColor onPress={() => act.guard(g.id, 'drop')} />
              {toggle(`g${g.id}`)}
            </Box>
            <Box paddingLeft={2} flexDirection="column">
              <Text>→ {isOpen(`g${g.id}`) ? oneLine(g.message) : fit(g.message, inner - 4)}</Text>
              {isOpen(`g${g.id}`)
                ? (
                  <Box flexDirection="column">
                    <Text dimColor>{detail}</Text>
                    {g.bad ? <Text dimColor><Text color="red">擋　</Text>{oneLine(g.bad)}</Text> : null}
                    {g.good ? <Text dimColor><Text color="green">放行</Text>{oneLine(g.good)}</Text> : null}
                  </Box>
                )
                : null}
              {g.replay
                ? <Text dimColor>試比對這段對話：{g.replay.calls} 次工具呼叫中命中 {g.replay.hits} 次</Text>
                : null}
            </Box>
          </Box>
        )
      })}
      {v.suggesting
        ? <Text color="yellow">正在請模型提草稿…</Text>
        : v.candidates > 0
          ? (
            <Box>
              <Text>有 {v.candidates} 條規則出現 3 次以上還沒有守門 </Text>
              <Button key="suggest" label="提草稿" variant="primary" onPress={act.suggest} />
            </Box>
          )
          : null}
    </Box>
  )

  const memoryRow = (head: string, detail: string[], archived: boolean) => {
    const { type, title } = splitHead(head)
    const key = `m:${head}`
    const label = TYPE_LABEL[type] ?? (type || '－')
    const cut = fit(title, short - 6)
    const canExpand = archived ? false : detail.length > 0 || cut !== oneLine(title)
    return (
      <Box key={archived ? `a:${head}` : key} flexDirection="column">
        <Box>
          <Box flexGrow={1}>
            <Text dimColor={archived}>{badge(label, archived ? 'gray' : TYPE_COLOR[type] ?? 'white')} {cut}</Text>
          </Box>
          {archived ? <Button key={`keep:${head}`} label="留下" onPress={() => act.keep(head)} /> : null}
          {canExpand ? toggle(key) : null}
          {dropButtons(key)}
        </Box>
        {isOpen(key) && !archived
          ? (
            <Box flexDirection="column" paddingLeft={5}>
              {cut !== oneLine(title) ? <Text>{oneLine(title)}</Text> : null}
              {detail.map((d, i) => <Text key={`d${i}`} dimColor={d.startsWith('根據：')}>{d}</Text>)}
            </Box>
          )
          : null}
      </Box>
    )
  }

  const memoryTab = (
    <Box flexDirection="column">
      <Text dimColor>最新 {v.memory.length} 條（共 {v.memoryTotal} 條）・偏好與修正整條帶入新對話，事實與位置只帶標題</Text>
      {v.memory.map(m => memoryRow(m.head, m.detail, false))}
      {v.archived.length
        ? (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>封存 {v.archived.length} 條：超過 {v.staleDays} 天沒被證實，不帶入新對話</Text>
            {v.archived.map(head => memoryRow(head, [], true))}
          </Box>
        )
        : null}
    </Box>
  )

  const rulesTab = (
    <Box flexDirection="column">
      {v.rules.length === 0 ? empty('還沒有規則') : null}
      {v.rules.map(r => (
        <Box key={`r:${r.name}`}>
          <Box flexGrow={1}>
            <Text>{badge(`${r.count} 次`.padStart(4), r.count >= 3 ? 'green' : r.count >= 2 ? ACCENT : 'gray')} {fit(r.name, short - 6)}</Text>
          </Box>
          {dropButtons(`r:${r.name}`)}
        </Box>
      ))}
    </Box>
  )

  const distillTab = v.lastDistill
    ? (
      <Box flexDirection="column">
        <Box>
          <Box flexGrow={1}>
            <Text dimColor>{v.lastDistill.at}・{v.lastDistill.why}・{v.lastDistill.changes.length} 項變動</Text>
          </Box>
          {v.lastDistill.changes.length ? toggle('changes') : null}
        </Box>
        {v.lastDistill.changes.map((c, i) =>
          <Text key={`c${i}`}>・{isOpen('changes') ? oneLine(c) : fit(c, inner - 2)}</Text>)}
      </Box>
    )
    : empty('還沒有整理紀錄')

  const body = { guard: guardTab, memory: memoryTab, rules: rulesTab, distill: distillTab }[v.tab]

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1}>
      <Box>
        <Box flexGrow={1}>
          <Text color={ACCENT} bold>ctx-handoff</Text>
          <Text dimColor>・專案筆記與守門</Text>
        </Box>
        <Button key="close" label="關閉" role="dismiss" dimColor onPress={act.close} />
      </Box>
      <Box marginBottom={1}>
        {tabs.map((t, i) => (
          <Button
            key={`tab:${t.id}`}
            label={t.label}
            hotkey={String(i + 1)}
            {...(t.id === v.tab ? { variant: 'primary' as const } : { dimColor: true })}
            onPress={() => act.tab(t.id)}
          />
        ))}
      </Box>
      {v.note ? <Box marginBottom={1}><Text color="yellow">{fit(v.note, inner)}</Text></Box> : null}
      {body}
      <Box marginTop={1}>
        <Text dimColor>{fit(`ctrl+x tab 後按 1–4 切分頁・${v.file}`, inner)}</Text>
      </Box>
    </Box>
  )
}
