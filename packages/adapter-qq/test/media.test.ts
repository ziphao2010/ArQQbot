import { describe, expect, it, vi } from 'vitest'
import { QQCapabilityRegistry } from '../src/core/capability-registry'
import { QQHttpClient } from '../src/core/http-client'
import { QQMediaModule } from '../src/modules/media'
import { TokenManager } from '../src/token'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function makeMedia(fetchImpl: ReturnType<typeof vi.fn>): QQMediaModule {
  const token = new TokenManager({
    appId: 'app',
    appSecret: 'secret',
    fetchImpl: vi.fn(async () =>
      jsonResponse({ access_token: 'token-1', expires_in: 7200 })
    ) as unknown as typeof fetch
  })
  const http = new QQHttpClient({
    token,
    baseUrls: ['https://api.test'],
    fetchImpl: fetchImpl as unknown as typeof fetch
  })
  const capabilities = new QQCapabilityRegistry({
    env: 'production',
    intents: 1 << 25
  })
  return new QQMediaModule({
    http,
    capabilities,
    fetchImpl: fetchImpl as unknown as typeof fetch
  })
}

describe('QQMediaModule', () => {
  it('直传群聊富媒体并返回 file_info', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ file_info: 'file-1', file_uuid: 'uuid-1', ttl: 3600 })
    )
    const media = makeMedia(fetchImpl)

    const result = await media.upload({
      scene: 'group',
      targetId: 'group-1',
      fileType: 1,
      url: 'https://img.test/a.png'
    })

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.test/v2/groups/group-1/files')
    const body = JSON.parse(String((fetchImpl.mock.calls[0]?.[1] as RequestInit).body))
    expect(body).toEqual({ file_type: 1, url: 'https://img.test/a.png' })
    expect(result).toMatchObject({ fileInfo: 'file-1', fileUuid: 'uuid-1', ttl: 3600 })
  })

  it('预上传返回 upload_id 与分片地址', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        upload_id: 'upload-1',
        block_size: '10485760',
        parts: [
          { index: 0, presigned_url: 'https://upload.test/0', block_size: '3' },
          { index: 1, presigned_url: 'https://upload.test/1', block_size: '3' }
        ],
        upload_config: { concurrency: 1 }
      })
    )
    const media = makeMedia(fetchImpl)

    const session = await media.prepareUpload({
      scene: 'group',
      targetId: 'group-1',
      fileType: 4,
      fileName: 'a.bin',
      fileSize: 6,
      md5: 'md5-value',
      sha1: 'sha1-value',
      md5_10m: 'md5-10m'
    })

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://api.test/v2/groups/group-1/upload_prepare'
    )
    const body = JSON.parse(String((fetchImpl.mock.calls[0]?.[1] as RequestInit).body))
    expect(body).toEqual({
      file_type: 4,
      file_size: '6',
      file_name: 'a.bin',
      md5: 'md5-value',
      sha1: 'sha1-value',
      md5_10m: 'md5-10m'
    })
    expect(session.uploadId).toBe('upload-1')
    expect(session.blockSize).toBe(10485760)
    expect(session.parts).toEqual([
      { index: 0, presignedUrl: 'https://upload.test/0', blockSize: 3 },
      { index: 1, presignedUrl: 'https://upload.test/1', blockSize: 3 }
    ])
  })

  it('分片编排：预上传、PUT 分片、分片完成、合并', async () => {
    const fetchImpl = vi.fn(async (url: unknown) => {
      const href = String(url)
      if (href.includes('upload_prepare')) {
        return jsonResponse({
          upload_id: 'upload-1',
          block_size: '3',
          parts: [
            { index: 0, presigned_url: 'https://upload.test/0', block_size: '3' },
            { index: 1, presigned_url: 'https://upload.test/1', block_size: '3' }
          ]
        })
      }
      if (href.startsWith('https://upload.test/')) return new Response('', { status: 200 })
      if (href.includes('upload_part_finish')) return jsonResponse({})
      if (href.includes('/files')) {
        return jsonResponse({ file_info: 'file-1', file_uuid: 'uuid-1', ttl: 0 })
      }
      throw new Error(`unexpected request: ${href}`)
    })
    const media = makeMedia(fetchImpl)

    const result = await media.uploadChunked({
      scene: 'group',
      targetId: 'group-1',
      fileType: 4,
      fileName: 'a.bin',
      fileSize: 6,
      md5: 'md5-value',
      sha1: 'sha1-value',
      md5_10m: 'md5-10m',
      chunks: [
        { data: new Uint8Array([1, 2, 3]), md5: 'part-0' },
        { data: new Uint8Array([4, 5, 6]), md5: 'part-1' }
      ]
    })

    const finishPartCalls = fetchImpl.mock.calls.filter((call) =>
      String(call[0]).includes('upload_part_finish')
    )
    expect(finishPartCalls).toHaveLength(2)
    const finishBodies = finishPartCalls.map((call) =>
      JSON.parse(String((call[1] as RequestInit).body))
    )
    expect(finishBodies).toEqual([
      { upload_id: 'upload-1', part_index: 0, block_size: '3', md5: 'part-0' },
      { upload_id: 'upload-1', part_index: 1, block_size: '3', md5: 'part-1' }
    ])

    const mergeCall = fetchImpl.mock.calls.find((call) =>
      String(call[0]).endsWith('/v2/groups/group-1/files')
    )
    expect(mergeCall).toBeTruthy()
    const mergeBody = JSON.parse(String((mergeCall?.[1] as RequestInit).body))
    expect(mergeBody).toEqual({ file_type: 4, upload_id: 'upload-1' })
    expect(result.fileInfo).toBe('file-1')
  })

  it('intents 不足时抛出 CAPABILITY_UNAVAILABLE', async () => {
    const token = new TokenManager({
      appId: 'app',
      appSecret: 'secret',
      fetchImpl: vi.fn(async () =>
        jsonResponse({ access_token: 'token-1', expires_in: 7200 })
      ) as unknown as typeof fetch
    })
    const http = new QQHttpClient({
      token,
      baseUrls: ['https://api.test'],
      fetchImpl: vi.fn() as unknown as typeof fetch
    })
    const capabilities = new QQCapabilityRegistry({ env: 'production', intents: 0 })
    const media = new QQMediaModule({ http, capabilities, fetchImpl: vi.fn() as unknown as typeof fetch })

    await expect(
      media.upload({
        scene: 'group',
        targetId: 'group-1',
        fileType: 1,
        url: 'https://img.test/a.png'
      })
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
  })
})
