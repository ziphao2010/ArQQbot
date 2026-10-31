// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { JsonSchema } from '@arqqbot/shared'
import { SchemaForm } from '../src/renderer/src/components/SchemaForm'

const schema: JsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', title: '名称' },
    count: { type: 'number', title: '数量', minimum: 0, maximum: 10 },
    enabled: { type: 'boolean', title: '启用' }
  },
  required: ['name']
}

describe('SchemaForm', () => {
  it('根据 Schema 渲染字段并在输入时回调新配置', () => {
    const onChange = vi.fn()
    render(<SchemaForm schema={schema} value={{}} onChange={onChange} />)

    expect(screen.getByText('名称 *')).toBeTruthy()
    expect(screen.getByText('数量')).toBeTruthy()
    expect(screen.getByRole('checkbox')).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'echo' } })
    expect(onChange).toHaveBeenCalledWith({ name: 'echo' })

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3' } })
    expect(onChange).toHaveBeenCalledWith({ count: 3 })
  })
})
