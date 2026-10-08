// Node 直接載入 mod 的 TypeScript 時用：mod 的 import 不寫副檔名（plugin 載入器會補），這裡補上 .ts。
// 用法：import { register } from 'node:module'; register('./ts-resolve.mjs', import.meta.url)
export async function resolve(specifier, context, next) {
  if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    try { return await next(`${specifier}.ts`, context) } catch {}
  }
  return next(specifier, context)
}
