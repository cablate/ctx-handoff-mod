#!/usr/bin/env node
// 推送前一次跑完：plugin validate、plugin test、tsc、公開資訊掃描（檔案與 git 歷史）。只印每步一行摘要，失敗才印該步的尾端輸出。
// 用法：node tools/check.mjs [mod 資料夾，預設本 repo] [--skip-tsc]
// 公開資訊掃描另外讀 <git 共用目錄>/info/private-words（一行一個詞，不進版本控制），例如真名、私人網域。
import { spawnSync, execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = resolve(process.argv.slice(2).find(a => !a.startsWith('--')) ?? repo)
const win = process.platform === 'win32'
const env = { ...process.env }
// Windows：claude CLI 要知道 Git Bash 在哪；沒設就從 git 的安裝位置推出來
if (win && !env.CLAUDE_CODE_GIT_BASH_PATH) {
  try {
    const exec = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim()
    const bash = join(exec, '..', '..', '..', 'bin', 'bash.exe')
    if (existsSync(bash)) env.CLAUDE_CODE_GIT_BASH_PATH = bash
  } catch {}
}

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: dir, env, encoding: 'utf8', shell: win, maxBuffer: 64 * 1024 * 1024 })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}
const tail = (s, n = 25) => s.trim().split('\n').slice(-n).join('\n')
let failed = 0
const report = (name, ok, summary, out = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}：${summary}`)
  if (!ok) { failed += 1; if (out) console.log(tail(out)) }
}

{
  const r = run('claude', ['plugin', 'validate', '.'])
  report('validate', r.ok, r.ok ? (r.out.includes('warning') ? '通過（有警告）' : '通過') : '失敗', r.out)
}
{
  const r = run('claude', ['plugin', 'test', '.'])
  const pass = /(\d+) pass/.exec(r.out)?.[1] ?? '?'
  const fail = /(\d+) fail/.exec(r.out)?.[1] ?? '?'
  const fails = r.out.split('\n').filter(l => l.startsWith('(fail)')).join('\n')
  report('test', r.ok && fail === '0', `${pass} pass／${fail} fail`, fails || r.out)
}
{
  const tests = readdirSync(join(dir, 'tools')).filter(f => f.endsWith('.test.mjs')).map(f => join('tools', f))
  const r = spawnSync(process.execPath, ['--test', ...tests], { cwd: dir, encoding: 'utf8' })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  report('tools', r.status === 0, `${/# pass (\d+)/.exec(out)?.[1] ?? '?'} pass／${/# fail (\d+)/.exec(out)?.[1] ?? '?'} fail`, out)
}
if (process.argv.includes('--skip-tsc')) console.log('SKIP tsc')
else if (!existsSync(join(dir, '.claude-plugin', 'types'))) {
  report('tsc', false, '沒有 .claude-plugin/types：mod 載入過一次後才有；worktree 要從主資料夾複製（tools/wt.mjs new 會做）')
} else {
  const r = run('npx', ['-y', '-p', 'typescript', 'tsc', '-p', '.'])
  const n = (r.out.match(/error TS/g) ?? []).length
  report('tsc', r.ok, `${n} 個錯誤`, r.out)
}

// 公開資訊：追蹤中的文字檔與 git 歷史裡不該出現個人 Email、本機使用者路徑、private-words 裡的詞
{
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: dir, encoding: 'utf8' }).trim()
  const wordsFile = resolve(dir, common, 'info', 'private-words')
  const words = existsSync(wordsFile) ? readFileSync(wordsFile, 'utf8').split(/\r?\n/).map(w => w.trim()).filter(Boolean) : []
  const files = execFileSync('git', ['ls-files'], { cwd: dir, encoding: 'utf8' }).split('\n').filter(f => f && !/\.(gif|mp4|png|jpe?g)$/i.test(f))
  const email = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g
  const okEmail = /@(users\.noreply\.github\.com|anthropic\.com|example\.(com|org))$/i
  // 測試用的假使用者 `u` 與 `<user>` 這類占位不算
  const homePath = /[A-Za-z]:[\\/]+Users[\\/]+(?!u(?![\w.-])|<)[^\\/\s'"`]+/i
  const why = line => [
    ...(line.match(email) ?? []).filter(m => !okEmail.test(m)).map(m => `Email ${m}`),
    ...(homePath.test(line) ? ['本機使用者路徑'] : []),
    ...words.filter(w => line.toLowerCase().includes(w.toLowerCase())).map(w => `private-words「${w}」`),
  ]
  const hits = []
  for (const f of files) {
    const p = join(dir, f)
    if (!existsSync(p)) continue
    readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      const w = why(line)
      if (w.length) hits.push(`${f}:${i + 1} ${w.join('、')}`)
    })
  }
  report('public', hits.length === 0, hits.length ? `${hits.length} 處` : `${files.length} 個檔案乾淨（private-words ${words.length} 個）`, hits.join('\n'))

  // git 歷史（所有分支的 commit 訊息、作者與新增的行）推上去就改不回來，同樣的規則也要擋
  const log = execFileSync('git', ['log', '-p', '--all', '--no-color', '--format=@@commit %h %ae %ce%n%B'], { cwd: dir, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
  const old = new Set()
  let commit = ''
  let commits = 0
  for (const line of log.split('\n')) {
    if (line.startsWith('@@commit ')) {
      const [, h, ...mails] = line.split(' ')
      commit = h
      commits += 1
      for (const m of mails) if (!okEmail.test(m)) old.add(`${commit} 作者 ${m}`)
      continue
    }
    if (line.startsWith('-')) continue
    const w = why(line)
    if (w.length) old.add(`${commit} ${w.join('、')}`)
  }
  report('history', old.size === 0, old.size ? `${old.size} 處（已推送的要改寫歷史才能移除）` : `${commits} 個 commit 乾淨`, [...old].join('\n'))
}
process.exit(failed ? 1 : 0)
