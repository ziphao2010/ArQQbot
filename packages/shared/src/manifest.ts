import { z } from 'zod'
import type { JsonSchema, PluginManifest } from './types'

const jsonSchemaSchema: z.ZodType<JsonSchema> = z.lazy(() =>
  z
    .object({
      type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
      title: z.string().optional(),
      description: z.string().optional(),
      default: z.unknown().optional(),
      enum: z.array(z.union([z.string(), z.number()])).optional(),
      minimum: z.number().optional(),
      maximum: z.number().optional(),
      format: z.enum(['password', 'textarea', 'select']).optional(),
      secret: z.boolean().optional(),
      properties: z.record(z.string(), jsonSchemaSchema).optional(),
      required: z.array(z.string()).optional(),
      items: jsonSchemaSchema.optional()
    })
    .strict()
)

const arqqbotSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    displayName: z.string().min(1),
    description: z.string().default(''),
    schema: jsonSchemaSchema.refine((value) => value.type === 'object', {
      message: '配置 Schema 顶层必须是 object'
    }),
    defaultConfig: z.record(z.string(), z.unknown()).default({})
  })
  .strict()

const packageSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    arqqbot: arqqbotSchema
  })
  .passthrough()

export class ManifestError extends Error {
  readonly issues?: unknown

  constructor(message: string, issues?: unknown) {
    super(message)
    this.name = 'ManifestError'
    this.issues = issues
  }
}

export function parsePluginManifest(pkg: unknown): PluginManifest {
  const result = packageSchema.safeParse(pkg)
  if (!result.success) {
    throw new ManifestError('插件 manifest 不合法', result.error.issues)
  }
  return {
    id: result.data.arqqbot.id,
    name: result.data.name,
    version: result.data.version,
    displayName: result.data.arqqbot.displayName,
    description: result.data.arqqbot.description,
    schema: result.data.arqqbot.schema,
    defaultConfig: result.data.arqqbot.defaultConfig
  }
}
