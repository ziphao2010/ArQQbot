import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Service, type Context } from 'cordis'

export interface StorageOptions {
  dir: string
}

export class StorageService extends Service {
  private readonly dir: string

  constructor(ctx: Context, options: StorageOptions) {
    super(ctx, 'storage')
    this.dir = options.dir
  }

  private filePath(key: string): string {
    return path.join(this.dir, `${Buffer.from(key).toString('base64url')}.json`)
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const content = await readFile(this.filePath(key), 'utf8')
      return JSON.parse(content) as T
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const file = this.filePath(key)
    const temp = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
    await writeFile(temp, JSON.stringify(value), 'utf8')
    await rename(temp, file)
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.filePath(key))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
