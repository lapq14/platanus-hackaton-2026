// Run with Deno:  deno test supabase/functions/_shared/rif.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { computeRifCheckDigit, normalizeRif, validateRif } from './rif.ts'

Deno.test('normalizeRif handles separators, case and spacing', () => {
  assertEquals(normalizeRif('J-07013380-5'), 'J-07013380-5')
  assertEquals(normalizeRif('j070133805'), 'J-07013380-5')
  assertEquals(normalizeRif(' J 07013380 5 '), 'J-07013380-5')
  assertEquals(normalizeRif('J.07013380.5'), 'J-07013380-5')
  assertEquals(normalizeRif('X-07013380-5'), null)
  assertEquals(normalizeRif('J-0701338-5'), null)
  assertEquals(normalizeRif('J-070133805-5'), null)
  assertEquals(normalizeRif(''), null)
})

Deno.test('computeRifCheckDigit matches a known RIF (Banesco J-07013380-5)', () => {
  assertEquals(computeRifCheckDigit('J', '07013380'), 5)
})

Deno.test('validateRif accepts valid RIFs in both spellings', () => {
  for (const raw of ['J-07013380-5', 'J070133805', 'j-07013380-5']) {
    const r = validateRif(raw)
    assert(r.ok, raw)
    if (r.ok) {
      assertEquals(r.rif, 'J-07013380-5')
      assertEquals(r.type, 'J')
    }
  }
})

Deno.test('every type letter round-trips through computeRifCheckDigit', () => {
  for (const t of ['J', 'G', 'V', 'E', 'P', 'C'] as const) {
    const dv = computeRifCheckDigit(t, '12345678')
    const r = validateRif(`${t}-12345678-${dv}`)
    assert(r.ok, t)
  }
})

Deno.test('a check digit result above 9 maps to 0', () => {
  // Search a body whose raw (11 - sum % 11) is 10 or 11 and make sure the digit is 0 and validates.
  let seen = 0
  for (let n = 0; n < 2000 && seen < 3; n++) {
    const body = String(n).padStart(8, '0')
    const dv = computeRifCheckDigit('J', body)
    if (dv === 0) {
      assert(validateRif(`J-${body}-0`).ok)
      seen++
    }
  }
  assert(seen > 0)
})

Deno.test('validateRif rejects wrong check digit, missing digit, bad letter, bad length, empty', () => {
  const bad = validateRif('J-07013380-4')
  assert(!bad.ok && bad.code === 'invalid_check_digit')
  const missing = validateRif('J-07013380')
  assert(!missing.ok && missing.code === 'missing_check_digit')
  const letter = validateRif('Z-07013380-5')
  assert(!letter.ok && letter.code === 'invalid_format')
  const short = validateRif('J-123456-5')
  assert(!short.ok && short.code === 'invalid_format')
  const long = validateRif('J-1234567890-5')
  assert(!long.ok && long.code === 'invalid_format')
  const empty = validateRif('   ')
  assert(!empty.ok && empty.code === 'empty')
  const notString = validateRif(undefined)
  assert(!notString.ok && notString.code === 'empty')
})
