import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SafeStorageLike } from './secrets'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

export function createFileCipher(key: Buffer): SafeStorageLike {
  if (key.length !== KEY_BYTES) {
    throw new Error(`主密钥必须是 ${KEY_BYTES} 字节`)
  }

  return {
    isEncryptionAvailable: () => true,
    encryptString(value: string): Buffer {
      const iv = randomBytes(IV_BYTES)
      const cipher = createCipheriv(ALGORITHM, key, iv)
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
    },
    decryptString(buffer: Buffer): string {
      if (buffer.length <= IV_BYTES + TAG_BYTES) throw new Error('密文格式不合法')
      const iv = buffer.subarray(0, IV_BYTES)
      const tag = buffer.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
      const encrypted = buffer.subarray(IV_BYTES + TAG_BYTES)
      const decipher = createDecipheriv(ALGORITHM, key, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
    }
  }
}

export async function loadOrCreateMasterKey(file: string): Promise<Buffer> {
  try {
    const existing = await readFile(file)
    if (existing.length === KEY_BYTES) return existing
    throw new Error(`主密钥文件长度不合法：${file}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
    const key = randomBytes(KEY_BYTES)
    await writeFile(file, key, { mode: 0o600 })
    return key
  }
}
