// /handoff panel：專案筆記、守門與設定的面板（輸入框上方）。只負責畫面，資料與動作由 register.ts 傳入
import type { EngineInterface } from 'claude-code'
import type { PanelData, PanelTab, PanelUi } from '../types'
import { t } from './i18n'

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
  setting: (key: string, dir: 1 | -1) => void
  resetSetting: (key: string) => void
  close: () => void
}

const ACCENT = 'cyan'
const STATE_COLOR = { proposed: 'yellow', on: 'green', off: 'gray' } as const
const TYPE_COLOR: Record<string, string> = { user: 'magenta', feedback: 'blue', project: 'cyan', reference: 'gray' }
// 外框兩格、左右內距各一格
const FRAME_CELLS = 4
const oneLine = (s: string) => s.replace(/\s+/g, ' ').replace(/^- /, '').trim()
// 終端機格數：中日韓與全形字算兩格
const cells = (ch: string) => ((ch.codePointAt(0) ?? 0) >= 0x1100 ? 2 : 1)

// 設定值給人看的樣子：大數字寫成 600k、分鐘加單位、開關寫開／關
export function showSetting(key: string, v: number | boolean | string) {
  const m = t().panel
  if (typeof v === 'boolean') return v ? m.on : m.offValue
  if (typeof v === 'string') return v
  if (key === 'idle_minutes') return m.minutes(v)
  return v >= 1000 ? `${v / 1000}k` : String(v)
}

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
  const m = t().panel
  const inner = Math.max(24, v.columns - FRAME_CELLS)
  // 一列右側按鈕佔的寬度（格數依語言，在字串表裡）：展開＋確定刪除＋取消，留一點餘裕
  const short = Math.max(20, inner - m.buttonsCells)
  const isOpen = (key: string) => v.expanded.includes(key)
  const toggle = (key: string) => (
    <Button key={`t:${key}`} label={isOpen(key) ? m.less : m.more} dimColor onPress={() => act.toggle(key)} />
  )
  // 刪除要按兩次：第一次只標記，第二次才寫檔
  const dropButtons = (key: string) =>
    v.confirming === key
      ? [
          <Button key={`yes:${key}`} label={m.confirmDel} variant="primary" onPress={() => act.drop(key)} />,
          <Button key={`no:${key}`} label={m.cancel} onPress={() => act.ask(undefined)} />,
        ]
      : [<Button key={`del:${key}`} label={m.del} dimColor onPress={() => act.ask(key)} />]
  const badge = (label: string, color: string) => <Text color={color} bold>{label}</Text>
  const empty = (text: string) => <Text dimColor>{text}</Text>

  // 熱鍵 1–4：面板拿到鍵盤（ctrl+x tab 或點一下）時按數字切分頁
  const tabs: { id: PanelTab; label: string }[] = [
    { id: 'guard', label: m.tabGuard(v.guards.length) },
    { id: 'memory', label: m.tabMemory(v.memoryTotal) },
    { id: 'rules', label: m.tabRules(v.rules.length) },
    { id: 'distill', label: m.tabDistill },
    { id: 'settings', label: m.tabSettings },
  ]

  const guardTab = (
    <Box flexDirection="column">
      {v.guards.length === 0 ? empty(m.noGuards) : null}
      {v.guards.map(g => {
        const label = t().guard.state[g.state]
        const color = STATE_COLOR[g.state]
        const detail = t().guardMatch(g.tool, g.match, g.unless)
        return (
          <Box key={`g${g.id}`} flexDirection="column" marginBottom={1}>
            <Box>
              <Box flexGrow={1}>
                <Text>
                  {badge(`● ${label}`, color)} <Text dimColor>{m.guardMeta(g.id, t().guard.mode[g.mode], g.hits)}</Text>{' '}
                  {fit(g.rule, short - 24)}{g.project ? <Text dimColor> · {m.inProject(g.project)}</Text> : null}
                </Text>
              </Box>
              {g.state === 'on'
                ? <Button key={`off${g.id}`} label={m.off} onPress={() => act.guard(g.id, 'off')} />
                : <Button key={`on${g.id}`} label={m.approve} variant="primary" onPress={() => act.guard(g.id, 'on')} />}
              <Button key={`drop${g.id}`} label={m.del} dimColor onPress={() => act.guard(g.id, 'drop')} />
              {toggle(`g${g.id}`)}
            </Box>
            <Box paddingLeft={2} flexDirection="column">
              <Text>→ {isOpen(`g${g.id}`) ? oneLine(g.message) : fit(g.message, inner - 4)}</Text>
              {isOpen(`g${g.id}`)
                ? (
                  <Box flexDirection="column">
                    <Text dimColor>{detail}</Text>
                    {g.bad ? <Text dimColor><Text color="red">{m.blockLabel}</Text>{oneLine(g.bad)}</Text> : null}
                    {g.good ? <Text dimColor><Text color="green">{m.allowLabel}</Text>{oneLine(g.good)}</Text> : null}
                  </Box>
                )
                : null}
              {g.replay
                ? <Text dimColor>{m.replay(g.replay.calls, g.replay.hits)}</Text>
                : null}
            </Box>
          </Box>
        )
      })}
      {v.suggesting
        ? <Text color="yellow">{m.suggesting}</Text>
        : v.candidates > 0
          ? (
            <Box>
              <Text>{m.candidates(v.candidates)}</Text>
              <Button key="suggest" label={m.draftBtn} variant="primary" onPress={act.suggest} />
            </Box>
          )
          : null}
    </Box>
  )

  const memoryRow = (head: string, detail: string[], archived: boolean) => {
    const { type, title } = splitHead(head)
    const key = `m:${head}`
    const label = m.typeLabel[type] ?? (type || '－')
    const cut = fit(title, short - 6)
    const canExpand = archived ? false : detail.length > 0 || cut !== oneLine(title)
    return (
      <Box key={archived ? `a:${head}` : key} flexDirection="column">
        <Box>
          <Box flexGrow={1}>
            <Text dimColor={archived}>{badge(label, archived ? 'gray' : TYPE_COLOR[type] ?? 'white')} {cut}</Text>
          </Box>
          {archived ? <Button key={`keep:${head}`} label={m.keep} onPress={() => act.keep(head)} /> : null}
          {canExpand ? toggle(key) : null}
          {dropButtons(key)}
        </Box>
        {isOpen(key) && !archived
          ? (
            <Box flexDirection="column" paddingLeft={5}>
              {cut !== oneLine(title) ? <Text>{oneLine(title)}</Text> : null}
              {detail.map((d, i) => <Text key={`d${i}`} dimColor={d.startsWith('根據：')}>{t().fieldLabel(d)}</Text>)}
            </Box>
          )
          : null}
      </Box>
    )
  }

  const memoryTab = (
    <Box flexDirection="column">
      <Text dimColor>{m.memoryHint(v.memory.length, v.memoryTotal)}</Text>
      {v.memory.map(m => memoryRow(m.head, m.detail, false))}
      {v.archived.length
        ? (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>{m.archived(v.archived.length, v.staleDays)}</Text>
            {v.archived.map(head => memoryRow(head, [], true))}
          </Box>
        )
        : null}
    </Box>
  )

  // 規則與流程同一種列：次數、名稱、已在哪；流程接在規則下面
  const countRow = (prefix: 'r' | 'p', r: { name: string; count: number; project?: string }) => (
    <Box key={`${prefix}:${r.name}`}>
      <Box flexGrow={1}>
        <Text>{badge(m.ruleCount(r.count).padStart(4), r.count >= 3 ? 'green' : r.count >= 2 ? ACCENT : 'gray')} {fit(r.name, short - 6 - (r.project ? m.inProject(r.project).length + 3 : 0))}{r.project ? <Text dimColor> · {m.inProject(r.project)}</Text> : null}</Text>
      </Box>
      {dropButtons(`${prefix}:${r.name}`)}
    </Box>
  )

  const rulesTab = (
    <Box flexDirection="column">
      {v.rules.length === 0 ? empty(m.noRules) : null}
      {v.rules.map(r => countRow('r', r))}
      {v.procedures.length
        ? (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>{fit(m.proceduresHint(v.procedures.length), inner)}</Text>
            {v.procedures.map(p => countRow('p', p))}
          </Box>
        )
        : null}
    </Box>
  )

  const distillTab = v.lastDistill
    ? (
      <Box flexDirection="column">
        <Box>
          <Box flexGrow={1}>
            <Text dimColor>{m.distillLine(v.lastDistill.at, v.lastDistill.why, v.lastDistill.changes.length)}</Text>
          </Box>
          {v.lastDistill.changes.length ? toggle('changes') : null}
        </Box>
        {v.lastDistill.changes.map((c, i) =>
          <Text key={`c${i}`}>{t().bullet}{isOpen('changes') ? oneLine(c) : fit(c, inner - 2)}</Text>)}
      </Box>
    )
    : empty(m.noDistill)

  // 設定：名稱、值（auto 附解析結果）、來源；數字用 −／＋，開關與選項按一下換下一個；面板改過的可以還原
  const settingRow = (s: PanelView['settings'][number]) => {
    const key = `s:${s.key}`
    const value = showSetting(s.key, s.value) + (s.shown ? ` → ${s.shown}` : '')
    return (
      <Box key={key} flexDirection="column">
        <Box>
          <Box flexGrow={1}>
            <Text>
              {fit(m.settingName[s.key] ?? s.key, 22)}{' '}
              <Text color={s.source === 'panel' ? ACCENT : undefined} bold>{value}</Text>{' '}
              <Text dimColor>{m.source[s.source]}</Text>
            </Text>
          </Box>
          {s.kind === 'num'
            ? [
                <Button key={`dec:${s.key}`} label="−" onPress={() => act.setting(s.key, -1)} />,
                <Button key={`inc:${s.key}`} label="＋" onPress={() => act.setting(s.key, 1)} />,
              ]
            : <Button key={`set:${s.key}`} label={m.toggleBtn} onPress={() => act.setting(s.key, 1)} />}
          {s.source === 'panel' ? <Button key={`reset:${s.key}`} label={m.resetBtn} dimColor onPress={() => act.resetSetting(s.key)} /> : null}
          {toggle(key)}
        </Box>
        {isOpen(key) ? <Box paddingLeft={2}><Text dimColor>{m.settingHelp[s.key] ?? ''}</Text></Box> : null}
      </Box>
    )
  }

  const settingsTab = (
    <Box flexDirection="column">
      <Text dimColor>{fit(m.settingsHint, inner)}</Text>
      {v.settings.map(settingRow)}
    </Box>
  )

  const body = { guard: guardTab, memory: memoryTab, rules: rulesTab, distill: distillTab, settings: settingsTab }[v.tab]

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1}>
      <Box>
        <Box flexGrow={1}>
          <Text color={ACCENT} bold>ctx-handoff</Text>
          <Text dimColor>{m.title}</Text>
        </Box>
        <Button key="close" label={m.close} role="dismiss" dimColor onPress={act.close} />
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
        <Text dimColor>{fit(m.footer(v.file), inner)}</Text>
      </Box>
    </Box>
  )
}
