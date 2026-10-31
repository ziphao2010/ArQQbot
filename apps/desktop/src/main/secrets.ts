import type { JsonSchema } from '@arqqbot/shared'

export interface SecretCodec {
  encrypt(value: string): string
  decrypt(value: string): string
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(buffer: Buffer): string
}

export const SECRET_MASK = '******'

interface SecretBox {
  $secret: string
}

export function createSecretCodec(engine: SafeStorageLike): SecretCodec {
  return {
    encrypt(value) {
      if (!engine.isEncryptionAvailable()) throw new Error('系统加密不可用')
      return engine.encryptString(value).toString('base64')
    },
    decrypt(value) {
      return engine.decryptString(Buffer.from(value, 'base64'))
    }
  }
}

function isSecretBox(value: unknown): value is SecretBox {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$secret' in value &&
    typeof (value as SecretBox).$secret === 'string'
  )
}

function walk(
  schema: JsonSchema,
  value: unknown,
  mode: 'mask' | 'encrypt' | 'decrypt',
  codec?: SecretCodec
): unknown {
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null) return value
    const input = value as Record<string, unknown>
    const output: Record<string, unknown> = {}
    const properties = schema.properties ?? {}

    for (const [key, childSchema] of Object.entries(properties)) {
      const child = input[key]
      if (childSchema.secret) {
        if (mode === 'mask') output[key] = SECRET_MASK
        else if (mode === 'encrypt') {
          output[key] = child === undefined || child === '' ? child : { $secret: codec!.encrypt(String(child)) }
        } else {
          output[key] = isSecretBox(child) ? codec!.decrypt(child.$secret) : child
        }
      } else {
        output[key] = walk(childSchema, child, mode, codec)
      }
    }

    for (const key of Object.keys(input)) {
      if (!properties[key]) output[key] = input[key]
    }
    return output
  }

  if (schema.type === 'array' && schema.items) {
    if (!Array.isArray(value)) return value
    return value.map((item) => walk(schema.items!, item, mode, codec))
  }

  return value
}

export function maskSecrets(schema: JsonSchema, config: Record<string, unknown>): Record<string, unknown> {
  return walk(schema, config, 'mask') as Record<string, unknown>
}

export function encryptSecrets(
  schema: JsonSchema,
  config: Record<string, unknown>,
  codec: SecretCodec
): Record<string, unknown> {
  return walk(schema, config, 'encrypt', codec) as Record<string, unknown>
}

export function decryptSecrets(
  schema: JsonSchema,
  config: Record<string, unknown>,
  codec: SecretCodec
): Record<string, unknown> {
  return walk(schema, config, 'decrypt', codec) as Record<string, unknown>
}

export function mergeSecretInput(
  schema: JsonSchema,
  incoming: Record<string, unknown>,
  existingDecrypted: Record<string, unknown>
): Record<string, unknown> {
  if (schema.type !== 'object') return incoming
  const output: Record<string, unknown> = { ...incoming }

  for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
    if (childSchema.secret) {
      const current = incoming[key]
      if (current === undefined || current === '' || current === SECRET_MASK) {
        output[key] = existingDecrypted[key]
      }
    } else if (childSchema.type === 'object') {
      output[key] = mergeSecretInput(
        childSchema,
        (incoming[key] ?? {}) as Record<string, unknown>,
        (existingDecrypted[key] ?? {}) as Record<string, unknown>
      )
    }
  }

  return output
}

const SENSITIVE_KEY = /api[-_]?key|secret|token|authorization|password/i

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item))
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(child)
    }
    return output
  }
  return value
}
