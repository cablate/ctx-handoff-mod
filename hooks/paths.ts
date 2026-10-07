// 路徑小工具：全部是純函式，不碰磁碟
export const slash = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
export const encodeProject = (p: string) => slash(p).replace(/[^A-Za-z0-9]/g, '-')
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
