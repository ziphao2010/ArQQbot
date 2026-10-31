import type { JsonSchema } from '@arqqbot/shared'

interface SchemaFormProps {
  schema: JsonSchema
  value: Record<string, unknown>
  onChange(value: Record<string, unknown>): void
}

export function SchemaForm({ schema, value, onChange }: SchemaFormProps) {
  if (schema.type !== 'object') return <></>

  const properties = schema.properties ?? {}
  const required = new Set(schema.required ?? [])

  function setField(key: string, fieldValue: unknown): void {
    onChange({ ...value, [key]: fieldValue })
  }

  return (
    <div className="space-y-4">
      {Object.entries(properties).map(([key, field]) => {
        const title = field.title ?? key
        const current = value[key] ?? field.default
        const label = (
          <span className="text-sm font-medium text-neutral-800">
            {title}
            {required.has(key) ? ' *' : ''}
          </span>
        )
        const description = field.description ? (
          <span className="mt-1 block text-xs text-neutral-500">{field.description}</span>
        ) : null

        if (field.type === 'object') {
          return (
            <div key={key} className="rounded-2xl border border-black/5 bg-white/60 p-4">
              <p className="mb-3 text-sm font-medium text-neutral-800">{title}</p>
              <SchemaForm
                schema={field}
                value={(current ?? {}) as Record<string, unknown>}
                onChange={(next) => setField(key, next)}
              />
              {description}
            </div>
          )
        }

        if (field.enum) {
          return (
            <label key={key} className="block">
              {label}
              <select
                className="mt-1 w-full"
                value={String(current ?? '')}
                onChange={(event) => {
                  const option = field.enum?.find((item) => String(item) === event.target.value)
                  setField(key, option ?? event.target.value)
                }}
              >
                {field.enum.map((option) => (
                  <option key={String(option)} value={String(option)}>
                    {String(option)}
                  </option>
                ))}
              </select>
              {description}
            </label>
          )
        }

        if (field.type === 'boolean') {
          return (
            <label key={key} className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={Boolean(current)}
                onChange={(event) => setField(key, event.target.checked)}
              />
              {label}
              {description}
            </label>
          )
        }

        if (field.type === 'number') {
          return (
            <label key={key} className="block">
              {label}
              <input
                type="number"
                className="mt-1 w-full"
                min={field.minimum}
                max={field.maximum}
                value={current === undefined ? '' : Number(current)}
                onChange={(event) =>
                  setField(key, event.target.value === '' ? undefined : Number(event.target.value))
                }
              />
              {description}
            </label>
          )
        }

        if (field.type === 'array') {
          return (
            <label key={key} className="block">
              {label}
              <textarea
                className="mt-1 w-full font-mono text-xs"
                rows={4}
                value={JSON.stringify(current ?? [], null, 2)}
                onChange={(event) => {
                  try {
                    setField(key, JSON.parse(event.target.value))
                  } catch {
                    // 输入未完成时保持原值，合法 JSON 后立即写回
                  }
                }}
              />
              {description}
            </label>
          )
        }

        const isTextarea = field.format === 'textarea'
        return (
          <label key={key} className="block">
            {label}
            {isTextarea ? (
              <textarea
                className="mt-1 w-full"
                rows={4}
                value={String(current ?? '')}
                onChange={(event) => setField(key, event.target.value)}
              />
            ) : (
              <input
                type={field.format === 'password' ? 'password' : 'text'}
                className="mt-1 w-full"
                value={String(current ?? '')}
                onChange={(event) => setField(key, event.target.value)}
              />
            )}
            {description}
          </label>
        )
      })}
    </div>
  )
}
