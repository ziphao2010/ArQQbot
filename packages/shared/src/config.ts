import Ajv from 'ajv'
import type { ErrorObject, ValidateFunction } from 'ajv'
import type { JsonSchema, PluginManifest } from './types'

export interface ConfigIssue {
  path: string
  message: string
}

export type ConfigValidationResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: ConfigIssue[] }

const ajv = new Ajv({ allErrors: true, useDefaults: true, strict: false })

function toAjvSchema(schema: JsonSchema): Record<string, unknown> {
  const result: Record<string, unknown> = { type: schema.type }
  if (schema.default !== undefined) result.default = schema.default
  if (schema.enum) result.enum = schema.enum
  if (schema.minimum !== undefined) result.minimum = schema.minimum
  if (schema.maximum !== undefined) result.maximum = schema.maximum
  if (schema.required) result.required = schema.required
  if (schema.items) result.items = toAjvSchema(schema.items)
  if (schema.properties) {
    const properties: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(schema.properties)) {
      properties[key] = toAjvSchema(child)
    }
    result.properties = properties
  }
  result.additionalProperties = false
  return result
}

const validators = new WeakMap<PluginManifest, ValidateFunction>()

function compile(manifest: PluginManifest): ValidateFunction {
  const cached = validators.get(manifest)
  if (cached) return cached
  const validator = ajv.compile(toAjvSchema(manifest.schema))
  validators.set(manifest, validator)
  return validator
}

function toIssue(error: ErrorObject): ConfigIssue {
  if (error.keyword === 'required') {
    const missing = (error.params as { missingProperty?: string }).missingProperty
    if (missing) {
      return { path: `${error.instancePath}/${missing}`, message: error.message ?? '配置不合法' }
    }
  }
  return {
    path: error.instancePath || '/',
    message: error.message ?? '配置不合法'
  }
}

export function validatePluginConfig(
  manifest: PluginManifest,
  input: Record<string, unknown>
): ConfigValidationResult {
  const value = structuredClone(input)
  const validate = compile(manifest)
  if (validate(value)) {
    return { ok: true, value: value as Record<string, unknown> }
  }
  return { ok: false, errors: (validate.errors ?? []).map(toIssue) }
}
