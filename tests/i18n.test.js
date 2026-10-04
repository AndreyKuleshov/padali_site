import test from 'node:test'
import assert from 'node:assert/strict'
import { DICTIONARY as ADMIN } from '../src/i18n/admin.js'
import { DICTIONARY as SITE } from '../src/i18n/site.js'

/**
 * Пропущенный перевод не ломается, а молча откатывается на
 * английский: сербская админка показывает английскую строку, и
 * заметить это можно только глазами. Поэтому сверяем наборы
 * ключей, а не полагаемся на внимательность.
 */
function missingKeys (dictionary, name) {
  const [reference, ...rest] = Object.keys(dictionary)
  const expected = Object.keys(dictionary[reference])

  for (const locale of rest) {
    const have = new Set(Object.keys(dictionary[locale]))
    const missing = expected.filter((key) => !have.has(key))
    assert.deepEqual(missing, [], `${name}: в «${locale}» нет ключей`)

    const extra = [...have].filter((key) => !expected.includes(key))
    assert.deepEqual(extra, [], `${name}: в «${locale}» лишние ключи, которых нет в «${reference}»`)
  }
}

test('словарь админки переведён целиком', () => {
  missingKeys(ADMIN, 'админка')
})

test('словарь сайта переведён целиком', () => {
  missingKeys(SITE, 'сайт')
})
