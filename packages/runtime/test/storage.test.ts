import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import { StorageService } from '../src/services/storage'

describe('StorageService', () => {
  it('读写与删除 JSON 数据', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'arqqbot-storage-'))
    const ctx = new Context()
    await ctx.plugin(StorageService, { dir })

    await ctx.storage.set('session/group-1', { messages: ['hi'] })
    expect(await ctx.storage.get<{ messages: string[] }>('session/group-1')).toEqual({ messages: ['hi'] })

    await ctx.storage.delete('session/group-1')
    expect(await ctx.storage.get('session/group-1')).toBeUndefined()
  })
})
