#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TOPIC = 'arqqbot-plugin'
const PER_PAGE = 100
const MAX_PAGES = 10
const OUTPUT_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../plugins/index.json'
)
const TOKEN = process.env.GITHUB_TOKEN?.trim() ?? ''
const USER_AGENT = 'ArQQbot-plugin-index'

if (!TOKEN) {
  console.warn('[plugin-index] 未设置 GITHUB_TOKEN，将使用未认证请求，可能触发速率限制')
}

function apiHeaders(accept = 'application/vnd.github+json') {
  const headers = {
    Accept: accept,
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': '2022-11-28'
  }
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`
  return headers
}

async function fetchWithRetry(url, headers) {
  let lastError
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { headers })
      if (response.ok) return response
      const body = (await response.text()).slice(0, 200)
      const error = new Error(`HTTP ${response.status} ${response.statusText}: ${body}`)
      error.status = response.status
      if (response.status < 500 && response.status !== 429) throw error
      lastError = error
    } catch (error) {
      lastError = error
      if (error.status && error.status < 500 && error.status !== 429) throw error
    }
    if (attempt === 1) break
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw lastError
}

async function fetchJson(url) {
  const response = await fetchWithRetry(url, apiHeaders())
  return response.json()
}

async function fetchText(url) {
  const response = await fetchWithRetry(url)
  return response.text()
}

function buildSearchUrl(page) {
  const query = encodeURIComponent(`topic:${TOPIC}`)
  return `https://api.github.com/search/repositories?q=${query}&per_page=${PER_PAGE}&page=${page}`
}

function validateManifest(pkg, repo) {
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    return 'package.json 不是对象'
  }
  if (typeof pkg.name !== 'string' || !pkg.name.trim()) return '缺少合法的 name'
  if (typeof pkg.version !== 'string' || !pkg.version.trim()) return '缺少合法的 version'
  if (!pkg.arqqbot || typeof pkg.arqqbot !== 'object' || Array.isArray(pkg.arqqbot)) {
    return '缺少 arqqbot manifest'
  }
  const id = pkg.arqqbot.id
  if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) return 'arqqbot.id 不合法'
  const displayName = pkg.arqqbot.displayName
  if (typeof displayName !== 'string' || !displayName.trim()) {
    return 'arqqbot.displayName 不合法'
  }
  if (
    pkg.arqqbot.schema !== undefined &&
    (!pkg.arqqbot.schema ||
      typeof pkg.arqqbot.schema !== 'object' ||
      pkg.arqqbot.schema.type !== 'object')
  ) {
    return 'arqqbot.schema 顶层必须是 object'
  }
  if (
    pkg.arqqbot.defaultConfig !== undefined &&
    (!pkg.arqqbot.defaultConfig ||
      typeof pkg.arqqbot.defaultConfig !== 'object' ||
      Array.isArray(pkg.arqqbot.defaultConfig))
  ) {
    return 'arqqbot.defaultConfig 必须是对象'
  }
  if (!repo.html_url) return '缺少仓库地址'
  return null
}

async function resolveCommit(fullName, branch) {
  try {
    const data = await fetchJson(
      `https://api.github.com/repos/${fullName}/branches/${encodeURIComponent(branch)}`
    )
    const sha = data?.commit?.sha
    if (typeof sha === 'string' && sha) return sha
  } catch (error) {
    console.warn(
      `[plugin-index] 读取提交失败，退回分支引用：${fullName}@${branch}（${error.message}）`
    )
  }
  return `refs/heads/${branch}`
}

async function buildEntry(repo) {
  const fullName = repo.full_name
  const branch = repo.default_branch || 'HEAD'
  if (!fullName) return { skipReason: '缺少 full_name' }

  let pkg
  try {
    const rawUrl = `https://raw.githubusercontent.com/${fullName}/${branch}/package.json`
    pkg = JSON.parse(await fetchText(rawUrl))
  } catch (error) {
    return { skipReason: `读取 package.json 失败：${error.message}` }
  }

  const invalid = validateManifest(pkg, repo)
  if (invalid) return { skipReason: invalid }

  const commitRef = await resolveCommit(fullName, branch)
  const downloadUrl = `https://codeload.github.com/${fullName}/tar.gz/${commitRef}`

  const entry = {
    id: pkg.arqqbot.id,
    packageName: pkg.name,
    displayName: pkg.arqqbot.displayName,
    description:
      typeof pkg.arqqbot.description === 'string' ? pkg.arqqbot.description : '',
    version: pkg.version,
    repo: repo.html_url,
    commit: commitRef,
    downloadUrl,
    tags: [TOPIC],
    sha256: null
  }
  const homepage = pkg.homepage || repo.homepage
  if (typeof homepage === 'string' && homepage) entry.homepage = homepage
  return { entry }
}

async function collectRepos() {
  const repos = []
  let total = 0
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const data = await fetchJson(buildSearchUrl(page))
    const items = Array.isArray(data?.items) ? data.items : []
    total = typeof data?.total_count === 'number' ? data.total_count : total
    console.log(`[plugin-index] 搜索第 ${page} 页：${items.length} 个仓库（总计 ${total}）`)
    if (items.length === 0) break
    repos.push(...items)
    if (repos.length >= total) break
  }
  return repos
}

async function main() {
  console.log(`[plugin-index] 开始构建索引：topic:${TOPIC}`)
  const repos = await collectRepos()
  console.log(`[plugin-index] 发现 ${repos.length} 个候选仓库`)

  const plugins = []
  let skipped = 0
  for (const repo of repos) {
    try {
      const result = await buildEntry(repo)
      if (result.entry) {
        plugins.push(result.entry)
      } else {
        skipped += 1
        console.warn(
          `[plugin-index] 跳过 ${repo.full_name ?? '(未知仓库)'}：${result.skipReason}`
        )
      }
    } catch (error) {
      skipped += 1
      console.warn(
        `[plugin-index] 跳过 ${repo.full_name ?? '(未知仓库)'}：${error.message}`
      )
    }
  }

  plugins.sort((a, b) => a.id.localeCompare(b.id))

  const index = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: `github-topic:${TOPIC}`,
    plugins
  }

  await mkdir(path.dirname(OUTPUT_FILE), { recursive: true })
  await writeFile(OUTPUT_FILE, `${JSON.stringify(index, null, 2)}\n`, 'utf8')

  console.log(
    `[plugin-index] 完成：收录 ${plugins.length} 个，跳过 ${skipped} 个，写入 ${OUTPUT_FILE}`
  )
}

main().catch((error) => {
  console.error('[plugin-index] 构建失败', error)
  process.exitCode = 1
})
