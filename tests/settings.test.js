import test, { beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { resetDatabase, closePool } from './helpers.js'
import { getAllSettings, getSetting, setSetting } from '../src/repositories/settings.js'

beforeEach(async () => { await resetDatabase() })
after(async () => { await closePool() })

/**
 * Значения настроек проходят через колонку jsonb. Драйвер разбирает её
 * сам, и лишний JSON.parse портил строки: «padali.band» корректным
 * JSON не является и превращался в null.
 */
test('значения всех типов переживают запись и чтение', async () => {
  const cases = {
    строка: 'padali.band · 2026',
    'строка с кавычками': 'SKC NS „Fabrika“',
    число: 42,
    ноль: 0,
    истина: true,
    ложь: false,
    массив: [{ icon: 'instagram', url: 'https://instagram.com/padali.band' }],
    объект: { nested: { depth: 2 } },
    пусто: null
  }

  for (const [key, value] of Object.entries(cases)) {
    await setSetting(key, value)
  }

  for (const [key, value] of Object.entries(cases)) {
    assert.deepEqual(await getSetting(key), value, `настройка «${key}»`)
  }

  const all = await getAllSettings()
  for (const [key, value] of Object.entries(cases)) {
    assert.deepEqual(all[key], value, `настройка «${key}» в общем чтении`)
  }
})

test('повторная запись заменяет значение, а не создаёт вторую строку', async () => {
  await setSetting('footer_note', 'было')
  await setSetting('footer_note', 'стало')

  assert.equal(await getSetting('footer_note'), 'стало')
  assert.equal(Object.keys(await getAllSettings()).length, 1)
})

test('у незаданной настройки берётся значение по умолчанию', async () => {
  assert.equal(await getSetting('нет-такой', 'запасное'), 'запасное')
  assert.equal(await getSetting('нет-такой'), null)
})
