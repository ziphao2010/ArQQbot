import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { InstanceStore } from '../src/main/instance-store'

describe('InstanceStore', () => {
  it('创建、更新、读写插件配置与删除实例', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'arqqbot-store-'))
    const store = new InstanceStore(root)
    await store.init()

    const created = await store.create({
      name: '测试实例',
      appId: '10001',
      secretRef: 'cipher',
      env: 'sandbox'
    })

    expect((await store.list()).map((item) => item.id)).toEqual([created.id])
    expect(await store.get(created.id)).toMatchObject({
      name: '测试实例',
      env: 'sandbox',
      intents: ['public_messages']
    })

    await store.update(created.id, { name: '改名后', intents: ['public_messages', 'interaction'] })
    expect((await store.get(created.id))?.name).toBe('改名后')
    expect((await store.get(created.id))?.intents).toEqual(['public_messages', 'interaction'])

    await store.writePlugins(created.id, [
      { id: 'echo', enabled: true, config: { prefix: '收到：' } }
    ])
    expect(await store.readPlugins(created.id)).toEqual([
      { id: 'echo', enabled: true, config: { prefix: '收到：' } }
    ])

    await store.remove(created.id)
    expect(await store.list()).toEqual([])
  })

  it('旧 instance.json 缺少 intents 时补默认值', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'arqqbot-intents-'))
    const store = new InstanceStore(root)
    await store.init()
    const created = await store.create({
      name: '旧实例',
      appId: '10003',
      secretRef: 'cipher',
      env: 'sandbox'
    })

    const file = path.join(root, 'instances', created.id, 'instance.json')
    const legacy = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    delete legacy.intents
    await writeFile(file, JSON.stringify(legacy), 'utf8')

    expect((await store.get(created.id))?.intents).toEqual(['public_messages'])
  })

  it('损坏的 instance.json 会备份为 .bak 并返回 undefined', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'arqqbot-corrupt-'))
    const store = new InstanceStore(root)
    await store.init()
    const created = await store.create({
      name: '损坏实例',
      appId: '10002',
      secretRef: 'cipher',
      env: 'production'
    })

    const file = path.join(root, 'instances', created.id, 'instance.json')
    await writeFile(file, '{ invalid json', 'utf8')

    expect(await store.get(created.id)).toBeUndefined()
    expect(await readFile(`${file}.bak`, 'utf8')).toBe('{ invalid json')
  })
})
