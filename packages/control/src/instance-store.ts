import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { InstanceEnv, InstanceRecord, PluginRecord, QQIntentName } from '@arqqbot/shared'
import { QQ_DEFAULT_INTENTS } from '@arqqbot/shared'

interface IndexFile {
  instances: string[]
}

export class InstanceStore {
  constructor(private readonly rootDir: string) {}

  private indexFile(): string {
    return path.join(this.rootDir, 'instances.json')
  }

  private instanceDir(id: string): string {
    return path.join(this.rootDir, 'instances', id)
  }

  private instanceFile(id: string): string {
    return path.join(this.instanceDir(id), 'instance.json')
  }

  private pluginsFile(id: string): string {
    return path.join(this.instanceDir(id), 'plugins.json')
  }

  async init(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true })
    await mkdir(path.join(this.rootDir, 'instances'), { recursive: true })
    try {
      await readFile(this.indexFile(), 'utf8')
    } catch {
      await this.writeJson(this.indexFile(), { instances: [] } satisfies IndexFile)
    }
  }

  private async readJson<T>(file: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as T
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  private async writeJson(file: string, data: unknown): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
    await writeFile(temp, JSON.stringify(data, null, 2), 'utf8')
    await rename(temp, file)
  }

  private async readIndex(): Promise<IndexFile> {
    const index = await this.readJson<IndexFile>(this.indexFile())
    return index ?? { instances: [] }
  }

  async list(): Promise<InstanceRecord[]> {
    const index = await this.readIndex()
    const records: InstanceRecord[] = []
    for (const id of index.instances) {
      const record = await this.get(id)
      if (record) records.push(record)
    }
    return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async get(id: string): Promise<InstanceRecord | undefined> {
    const file = this.instanceFile(id)
    try {
      const record = await this.readJson<InstanceRecord>(file)
      if (!record) return undefined
      if (!Array.isArray(record.intents) || record.intents.length === 0) {
        record.intents = [...QQ_DEFAULT_INTENTS]
      }
      return record
    } catch {
      await rename(file, `${file}.bak`).catch(() => undefined)
      return undefined
    }
  }

  async create(input: {
    name: string
    appId: string
    secretRef: string
    env: InstanceEnv
    intents?: QQIntentName[]
  }): Promise<InstanceRecord> {
    const now = new Date().toISOString()
    const record: InstanceRecord = {
      id: randomUUID(),
      name: input.name,
      appId: input.appId,
      secretRef: input.secretRef,
      env: input.env,
      intents: input.intents?.length ? [...input.intents] : [...QQ_DEFAULT_INTENTS],
      createdAt: now,
      updatedAt: now
    }
    await this.writeJson(this.instanceFile(record.id), record)
    await this.writeJson(this.pluginsFile(record.id), [])
    const index = await this.readIndex()
    index.instances.push(record.id)
    await this.writeJson(this.indexFile(), index)
    return record
  }

  async update(
    id: string,
    patch: Partial<Pick<InstanceRecord, 'name' | 'appId' | 'secretRef' | 'env' | 'intents'>>
  ): Promise<InstanceRecord> {
    const record = await this.get(id)
    if (!record) throw new Error(`实例不存在：${id}`)
    Object.assign(record, patch, { updatedAt: new Date().toISOString() })
    await this.writeJson(this.instanceFile(id), record)
    return record
  }

  async remove(id: string): Promise<void> {
    const index = await this.readIndex()
    index.instances = index.instances.filter((item) => item !== id)
    await this.writeJson(this.indexFile(), index)
    await rm(this.instanceDir(id), { recursive: true, force: true })
  }

  async readPlugins(id: string): Promise<PluginRecord[]> {
    return (await this.readJson<PluginRecord[]>(this.pluginsFile(id))) ?? []
  }

  async writePlugins(id: string, records: PluginRecord[]): Promise<void> {
    await this.writeJson(this.pluginsFile(id), records)
  }
}
