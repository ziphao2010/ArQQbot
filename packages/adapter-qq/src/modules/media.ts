import type {
  QQChunkedUploadInput,
  QQMediaUploadInput,
  QQUploadFinishInput,
  QQUploadPrepareInput,
  QQUploadSession,
  QQUploadedMedia
} from '@arqqbot/shared'
import type { QQCapabilityGuard } from '../core/capability-registry'
import { findEndpoint } from '../core/endpoint-catalog'
import { QQApiError } from '../core/errors'
import type { QQHttpClient } from '../core/http-client'

export interface QQMediaModuleOptions {
  http: QQHttpClient
  capabilities?: QQCapabilityGuard
  fetchImpl?: typeof fetch
}

function openidParams(scene: 'c2c' | 'group', targetId: string): Record<string, string> {
  return scene === 'group' ? { group_openid: targetId } : { user_openid: targetId }
}

function idParams(scene: 'c2c' | 'group', targetId: string): Record<string, string> {
  return scene === 'group' ? { group_id: targetId } : { user_id: targetId }
}

function toUploadedMedia(data: Record<string, unknown>): QQUploadedMedia {
  const fileInfo = data.file_info
  if (typeof fileInfo !== 'string' || fileInfo.length === 0) {
    throw new QQApiError('SERVER_ERROR', '富媒体上传响应缺少 file_info')
  }

  const result: QQUploadedMedia = { fileInfo }
  if (typeof data.file_uuid === 'string') result.fileUuid = data.file_uuid
  if (Number.isFinite(Number(data.ttl))) result.ttl = Number(data.ttl)
  return result
}

export class QQMediaModule {
  private readonly capabilities?: QQCapabilityGuard
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: QQMediaModuleOptions) {
    this.capabilities = options.capabilities
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async upload(input: QQMediaUploadInput): Promise<QQUploadedMedia> {
    this.capabilities?.assert('media.upload')
    const endpoint = findEndpoint(
      input.scene === 'group' ? 'group.media.upload' : 'c2c.media.upload'
    )
    const body: Record<string, unknown> = {
      file_type: input.fileType,
      url: input.url
    }
    if (input.fileData) body.file_data = input.fileData

    const result = await this.options.http.request<Record<string, unknown>>(endpoint, {
      pathParams: openidParams(input.scene, input.targetId),
      body
    })
    return toUploadedMedia(result)
  }

  async prepareUpload(input: QQUploadPrepareInput): Promise<QQUploadSession> {
    this.capabilities?.assert('media.prepareUpload')
    const endpoint = findEndpoint(
      input.scene === 'group' ? 'group.media.prepare' : 'c2c.media.prepare'
    )
    const result = await this.options.http.request<Record<string, unknown>>(endpoint, {
      pathParams: idParams(input.scene, input.targetId),
      body: {
        file_type: input.fileType,
        file_size: String(input.fileSize),
        file_name: input.fileName,
        md5: input.md5,
        sha1: input.sha1,
        md5_10m: input.md5_10m
      }
    })

    const uploadId = result.upload_id
    if (typeof uploadId !== 'string' || uploadId.length === 0) {
      throw new QQApiError('SERVER_ERROR', '预上传响应缺少 upload_id')
    }

    const rawParts = Array.isArray(result.parts) ? result.parts : []
    const parts = rawParts.map((item) => {
      const part = item as Record<string, unknown>
      const presignedUrl = part.presigned_url
      if (typeof presignedUrl !== 'string' || presignedUrl.length === 0) {
        throw new QQApiError('SERVER_ERROR', '预上传响应缺少 presigned_url')
      }
      return {
        index: Number(part.index ?? 0),
        presignedUrl,
        blockSize: Number(part.block_size ?? 0)
      }
    })

    return {
      uploadId,
      blockSize: Number(result.block_size ?? 0),
      parts,
      raw: result
    }
  }

  async finishUpload(input: QQUploadFinishInput): Promise<QQUploadedMedia> {
    this.capabilities?.assert('media.upload')
    const endpoint = findEndpoint(
      input.scene === 'group' ? 'group.media.upload' : 'c2c.media.upload'
    )
    const result = await this.options.http.request<Record<string, unknown>>(endpoint, {
      pathParams: openidParams(input.scene, input.targetId),
      body: {
        file_type: input.fileType,
        upload_id: input.uploadId
      }
    })
    return toUploadedMedia(result)
  }

  async uploadChunked(input: QQChunkedUploadInput): Promise<QQUploadedMedia> {
    this.capabilities?.assert('media.prepareUpload')
    this.capabilities?.assert('media.uploadPart')
    this.capabilities?.assert('media.upload')

    const session = await this.prepareUpload(input)
    if (session.parts.length !== input.chunks.length) {
      throw new QQApiError(
        'BAD_REQUEST',
        `分片数量不匹配：服务端 ${session.parts.length}，本地 ${input.chunks.length}`
      )
    }

    const partFinishEndpoint = findEndpoint(
      input.scene === 'group' ? 'group.media.partFinish' : 'c2c.media.partFinish'
    )
    const pathParams = idParams(input.scene, input.targetId)

    for (const part of session.parts) {
      const chunk = input.chunks[part.index]
      if (!chunk) throw new QQApiError('BAD_REQUEST', `缺少分片 ${part.index}`)

      const response = await this.fetchImpl(part.presignedUrl, {
        method: 'PUT',
        body: chunk.data as BodyInit
      })
      if (!response.ok) {
        throw new QQApiError(
          'NETWORK_ERROR',
          `分片 ${part.index} 上传失败：HTTP ${response.status}`,
          { status: response.status, endpointId: 'media.presigned' }
        )
      }

      await this.options.http.request<unknown>(partFinishEndpoint, {
        pathParams,
        body: {
          upload_id: session.uploadId,
          part_index: part.index,
          block_size: String(chunk.data.byteLength),
          md5: chunk.md5
        }
      })
    }

    return this.finishUpload({
      scene: input.scene,
      targetId: input.targetId,
      fileType: input.fileType,
      uploadId: session.uploadId
    })
  }
}
