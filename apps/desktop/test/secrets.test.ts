import { describe, expect, it } from 'vitest'
import type { JsonSchema } from '@arqqbot/shared'
import {
  SECRET_MASK,
  createSecretCodec,
  decryptSecrets,
  encryptSecrets,
  maskSecrets,
  redact,
  mergeSecretInput
} from '@arqqbot/control'

const schema: JsonSchema = {
  type: 'object',
  properties: {
    apiKey: { type: 'string', secret: true },
    model: { type: 'string' }
  }
}

const codec = createSecretCodec({
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`enc:${value}`),
  decryptString: (buffer) => buffer.toString().replace('enc:', '')
})

describe('secrets', () => {
  it('加密后落盘、解密后还原', () => {
    const encrypted = encryptSecrets(schema, { apiKey: 'sk-test', model: 'gpt' }, codec)
    expect(encrypted.apiKey).toMatchObject({ $secret: expect.any(String) })
    expect(decryptSecrets(schema, encrypted, codec)).toEqual({ apiKey: 'sk-test', model: 'gpt' })
  })

  it('对 UI 返回掩码', () => {
    expect(maskSecrets(schema, { apiKey: 'sk-test', model: 'gpt' })).toEqual({
      apiKey: SECRET_MASK,
      model: 'gpt'
    })
  })

  it('输入为掩码时保留原密钥', () => {
    expect(
      mergeSecretInput(schema, { apiKey: SECRET_MASK, model: 'gpt-4o' }, { apiKey: 'sk-test', model: 'gpt' })
    ).toEqual({ apiKey: 'sk-test', model: 'gpt-4o' })
  })

  it('日志数据中的敏感字段被脱敏', () => {
    expect(
      redact({
        apiKey: 'sk-test',
        nested: { authorization: 'Bearer token', token: 'abc' },
        message: 'ok'
      })
    ).toEqual({
      apiKey: '[REDACTED]',
      nested: { authorization: '[REDACTED]', token: '[REDACTED]' },
      message: 'ok'
    })
  })
})
