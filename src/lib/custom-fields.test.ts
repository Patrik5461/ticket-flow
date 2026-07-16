import { describe, it, expect } from 'vitest'
import {
  parseCustomFields,
  validateAnswers
  
} from './custom-fields'
import type {CustomField} from './custom-fields';

describe('parseCustomFields', () => {
  it('keeps valid fields and drops malformed ones', () => {
    const fields = parseCustomFields([
      {
        key: 'size',
        label: 'Veľkosť',
        type: 'select',
        required: true,
        options: ['S', 'M', 'L'],
      },
      { key: 'note', label: 'Poznámka' }, // type defaults to text
      { label: 'no key' }, // dropped
      'garbage', // dropped
    ])
    expect(fields).toEqual([
      {
        key: 'size',
        label: 'Veľkosť',
        type: 'select',
        required: true,
        options: ['S', 'M', 'L'],
      },
      { key: 'note', label: 'Poznámka', type: 'text', required: false },
    ])
  })

  it('returns [] for non-array input', () => {
    expect(parseCustomFields(null)).toEqual([])
    expect(parseCustomFields({})).toEqual([])
  })
})

describe('validateAnswers', () => {
  const fields: CustomField[] = [
    { key: 'name', label: 'Meno', type: 'text', required: true },
    {
      key: 'size',
      label: 'Veľkosť',
      type: 'select',
      required: true,
      options: ['S', 'M'],
    },
    { key: 'gdpr', label: 'Súhlas', type: 'checkbox', required: true },
    { key: 'note', label: 'Poznámka', type: 'text', required: false },
  ]

  it('passes when all required answers are valid', () => {
    expect(
      validateAnswers(fields, { name: 'Jana', size: 'M', gdpr: 'true' }),
    ).toBeNull()
  })

  it('rejects a missing required text field', () => {
    expect(
      validateAnswers(fields, { name: '  ', size: 'M', gdpr: 'true' })?.key,
    ).toBe('name')
  })

  it('rejects an unchecked required checkbox', () => {
    expect(
      validateAnswers(fields, { name: 'J', size: 'M', gdpr: 'false' })?.key,
    ).toBe('gdpr')
  })

  it('rejects a select value outside the options', () => {
    expect(
      validateAnswers(fields, { name: 'J', size: 'XL', gdpr: 'true' })?.key,
    ).toBe('size')
  })

  it('ignores empty optional fields', () => {
    expect(
      validateAnswers(fields, { name: 'J', size: 'S', gdpr: 'true', note: '' }),
    ).toBeNull()
  })
})
