import { describe, expect, it } from 'vitest'
import { QQApiError, mapHttpError } from '../src/core/errors'

describe('QQApiError', () => {
  it('保留错误码与元数据', () => {
    const error = new QQApiError('BAD_REQUEST', '参数错误', {
      status: 400,
      endpointId: 'group.message.send'
    })
    expect(error.name).toBe('QQApiError')
    expect(error.code).toBe('BAD_REQUEST')
    expect(error.meta).toEqual({ status: 400, endpointId: 'group.message.send' })
  })
})

describe('mapHttpError', () => {
  it('401 映射为 UNAUTHORIZED', () => {
    const error = mapHttpError(401, { err_code: 11251, message: 'token 无效' }, 'c2c.message.send')
    expect(error.code).toBe('UNAUTHORIZED')
    expect(error.meta.status).toBe(401)
    expect(error.meta.platformCode).toBe('11251')
    expect(error.message).toContain('token 无效')
  })

  it('403/404/429/5xx 映射到语义错误', () => {
    expect(mapHttpError(403, {}).code).toBe('PERMISSION_DENIED')
    expect(mapHttpError(404, {}).code).toBe('NOT_FOUND')
    expect(mapHttpError(429, {}).code).toBe('RATE_LIMITED')
    expect(mapHttpError(500, {}).code).toBe('SERVER_ERROR')
    expect(mapHttpError(400, {}).code).toBe('BAD_REQUEST')
  })

  it('平台错误码优先于 HTTP 状态', () => {
    expect(mapHttpError(400, { err_code: 22009, message: 'msg limit exceed' }).code).toBe(
      'QUOTA_EXCEEDED'
    )
    expect(mapHttpError(400, { err_code: 11282 }).code).toBe('PERMISSION_DENIED')
  })

  it('兼容 code 字段与空响应体', () => {
    expect(mapHttpError(400, { code: 22009 }).code).toBe('QUOTA_EXCEEDED')
    expect(mapHttpError(500, undefined).message).toContain('500')
  })
})
