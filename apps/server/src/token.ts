import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const MIN_TOKEN_LENGTH = 16

export interface AccessToken {
  token: string
  generated: boolean
  file: string
}

export async function resolveAccessToken(
  dataDir: string,
  explicit?: string
): Promise<AccessToken> {
  const file = path.join(dataDir, 'access-token')
  const fromEnv = process.env.ARQQBOT_TOKEN?.trim()
  const provided = explicit?.trim() || fromEnv
  if (provided) {
    if (provided.length < MIN_TOKEN_LENGTH) {
      throw new Error(`访问 token 至少需要 ${MIN_TOKEN_LENGTH} 个字符`)
    }
    return { token: provided, generated: false, file }
  }

  try {
    const existing = (await readFile(file, 'utf8')).trim()
    if (existing.length >= MIN_TOKEN_LENGTH) {
      return { token: existing, generated: false, file }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const token = randomBytes(32).toString('base64url')
  await writeFile(file, `${token}\n`, { mode: 0o600 })
  return { token, generated: true, file }
}

export async function readClientToken(
  dataDir: string | undefined,
  explicit?: string
): Promise<string> {
  const fromEnv = process.env.ARQQBOT_TOKEN?.trim()
  if (explicit?.trim()) return explicit.trim()
  if (fromEnv) return fromEnv
  if (dataDir) {
    const token = (await readFile(path.join(dataDir, 'access-token'), 'utf8')).trim()
    if (token) return token
  }
  throw new Error('缺少访问 token：请设置 ARQQBOT_TOKEN 或传入 --token')
}
