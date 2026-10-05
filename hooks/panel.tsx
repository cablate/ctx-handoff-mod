// /handoff panel：專案筆記與守門的面板。只負責畫面，資料與動作由 register.ts 傳入
import type { EngineInterface } from 'claude-code'

type Elements = ReturnType<EngineInterface['ui']['resolve']>

export type PanelGuard = {
  id: number; rule: string; tool: string; match: string; unless?: string; message: string
  mode: 'deny' | 'remind'; state: 'proposed' | 'on' | 'off'; hits: number
  replay?: { hits: number; calls: number }
}

export type PanelView = {
  file: string
  guards: PanelGuard[]
  candidates: number
  suggesting: boolean
  lastDistill?: { at: string; why: string; changes: string[] }
  // 最新的幾條記憶（原文）與總數
  memory: string[]
  memoryTotal: number
  rules: { name: string; count: number }[]
  // 等待確認刪除的項目（m:<記憶原文>／r:<規則名稱>）
  confirming?: string
  // 上一個動作的結果
  note?: string
}

export type PanelActions = {
  guard: (id: number, action: 'on' | 'off' | 'drop') => void
  suggest: () => void
  ask: (key: string | undefined) => void
  drop: (key: string) => void
  close: () => void
}

const STATE = { proposed: '草稿', on: '啟用', off: '停用' } as const
const oneLine = (s: string) => s.replace(/\s+/g, ' ').replace(/^- /, '')

export function panelTree(ui: Elements, v: PanelView, act: PanelActions) {
  const { Box, Text, Button } = ui
  // 刪除要按兩次：第一次只標記，第二次才寫檔
  const dropButtons = (key: string) =>
    v.confirming === key
      ? [
          <Button key={`yes:${key}`} label="確定刪除" variant="primary" onPress={() => act.drop(key)} />,
          <Button key={`no:${key}`} label="取消" onPress={() => act.ask(undefined)} />,
        ]
      : [<Button key={`del:${key}`} label="刪除" dimColor onPress={() => act.ask(key)} />]

  return (
    <Box flexDirection="column">
      {v.note ? <Text color="yellow">{v.note}</Text> : null}

      <Text bold>守門</Text>
      {v.guards.length === 0 ? <Text dimColor>　還沒有守門</Text> : null}
      {v.guards.map(g => (
        <Box key={`g${g.id}`} flexDirection="column">
          <Box>
            <Text>
              #{g.id} [{STATE[g.state]}・{g.mode === 'deny' ? '擋下' : '提醒'}] {g.rule}（觸發 {g.hits} 次）{' '}
            </Text>
            {g.state === 'on'
              ? <Button key={`off${g.id}`} label="停用" onPress={() => act.guard(g.id, 'off')} />
              : <Button key={`on${g.id}`} label="核准" variant="primary" onPress={() => act.guard(g.id, 'on')} />}
            <Button key={`drop${g.id}`} label="刪除" dimColor onPress={() => act.guard(g.id, 'drop')} />
          </Box>
          <Text dimColor wrap="truncate-end">
            　{g.tool} 符合 /{g.match}/{g.unless ? ` 且不符合 /${g.unless}/` : ''} → {g.message}
          </Text>
          {g.replay
            ? <Text dimColor>　試比對這段對話：{g.replay.calls} 次工具呼叫中命中 {g.replay.hits} 次</Text>
            : null}
        </Box>
      ))}
      {v.suggesting
        ? <Text dimColor>　正在請模型提草稿…</Text>
        : v.candidates > 0
          ? (
            <Box>
              <Text>　有 {v.candidates} 條規則出現 3 次以上還沒有守門 </Text>
              <Button key="suggest" label="提草稿" onPress={act.suggest} />
            </Box>
          )
          : null}

      <Text> </Text>
      <Text bold>最近一次整理</Text>
      {v.lastDistill
        ? (
          <Box flexDirection="column">
            <Text dimColor>　{v.lastDistill.at}・{v.lastDistill.why}・{v.lastDistill.changes.length} 項變動</Text>
            {v.lastDistill.changes.map((c, i) => <Text key={`c${i}`} wrap="truncate-end">　・{oneLine(c)}</Text>)}
          </Box>
        )
        : <Text dimColor>　還沒有整理紀錄</Text>}

      <Text> </Text>
      <Text bold>記憶（最新 {v.memory.length} 條，共 {v.memoryTotal} 條）</Text>
      {v.memory.map(m => (
        <Box key={`m:${m}`}>
          <Box flexGrow={1}><Text wrap="truncate-end">　{oneLine(m)}</Text></Box>
          {dropButtons(`m:${m}`)}
        </Box>
      ))}

      <Text> </Text>
      <Text bold>規則（{v.rules.length} 條）</Text>
      {v.rules.map(r => (
        <Box key={`r:${r.name}`}>
          <Box flexGrow={1}><Text wrap="truncate-end">　{r.name}（{r.count} 次）</Text></Box>
          {dropButtons(`r:${r.name}`)}
        </Box>
      ))}

      <Text> </Text>
      <Box>
        <Text dimColor wrap="truncate-middle">{v.file} </Text>
        <Button key="close" label="關閉" role="dismiss" onPress={act.close} />
      </Box>
    </Box>
  )
}
