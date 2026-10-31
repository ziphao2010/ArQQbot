import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { parsePluginManifest } from './manifest'
import type { PluginCatalogItem } from './types'

export interface CatalogRoot {
  path: string
  source: 'builtin' | 'external'
}

export interface CatalogWarning {
  path: string
  message: string
}

export interface CatalogResult {
  items: PluginCatalogItem[]
  warnings: CatalogWarning[]
}

export async function scanPluginCatalog(roots: CatalogRoot[]): Promise<CatalogResult> {
  const items: PluginCatalogItem[] = []
  const warnings: CatalogWarning[] = []
  const seen = new Set<string>()

  for (const root of roots) {
    let names: string[]
    try {
      names = await readdir(root.path)
    } catch {
      continue
    }

    for (const name of names) {
      const pluginDir = path.join(root.path, name)
      const pkgPath = path.join(pluginDir, 'package.json')

      try {
        const pkgStat = await stat(pkgPath)
        if (!pkgStat.isFile()) continue

        const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
          arqqbot?: unknown
          main?: string
        }
        if (!pkg.arqqbot) continue

        const manifest = parsePluginManifest(pkg)
        if (seen.has(manifest.id)) {
          warnings.push({ path: pluginDir, message: `插件 id 重复，已跳过：${manifest.id}` })
          continue
        }

        seen.add(manifest.id)
        items.push({
          manifest,
          entryPath: path.resolve(pluginDir, pkg.main ?? 'dist/index.js'),
          source: root.source
        })
      } catch (error) {
        warnings.push({
          path: pluginDir,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }

  return { items, warnings }
}
