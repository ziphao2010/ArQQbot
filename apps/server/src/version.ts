import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

/** 打包后 dist/index.js 与 package.json 同级；开发时取其上一级的包目录。 */
export function packageVersion(): string {
  for (const candidate of [
    path.resolve(moduleDir, '../package.json'),
    path.resolve(moduleDir, 'package.json')
  ]) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: string }
      if (pkg.version) return pkg.version
    } catch {
      // 继续尝试下一个位置
    }
  }
  return '0.0.0'
}
