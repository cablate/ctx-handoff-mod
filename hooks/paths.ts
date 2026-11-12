// 路徑小工具：全部是純函式，不碰磁碟
export const slash = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

function fnv1aHex(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}

// 非 ASCII 路徑（如中文資料夾名）光換成 `-` 會讓同字數資料夾撞進同一份經驗檔；加上穩定雜湊尾碼區隔，純英數路徑維持原樣。
export const encodeProject = (p: string) => {
  const s = slash(p)
  const base = s.replace(/[^A-Za-z0-9]/g, '-')
  return /[\u0080-￿]/.test(s) ? `${base}-${fnv1aHex(s)}` : base
}

export const isAbs = (p: string) => /^[A-Za-z]:\//.test(p) || p.startsWith('/')

// 去掉路徑裡的 . 和 ..（不碰磁碟代號或開頭的 /）
export function resolveDots(p: string) {
  const parts: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '.') continue
    if (seg === '..') { if (parts.length > 1) parts.pop(); continue }
    parts.push(seg)
  }
  return parts.join('/')
}
