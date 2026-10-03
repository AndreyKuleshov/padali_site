import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { assetUrl, PUBLIC_DIR } from '../src/services/assets.js'

/**
 * Без отпечатка браузер держит прежние стили и скрипты до истечения
 * max-age и после выкатки показывает старую версию сайта.
 */
test('адрес статики получает отпечаток содержимого', () => {
  const url = assetUrl('/js/site.js')
  const [path, query] = url.split('?')

  assert.equal(path, '/js/site.js')
  assert.match(query, /^v=[a-f0-9]{10}$/)

  const expected = createHash('sha1')
    .update(readFileSync(join(PUBLIC_DIR, 'js/site.js')))
    .digest('hex').slice(0, 10)
  assert.equal(query, `v=${expected}`, 'отпечаток считается по содержимому файла')
})

test('разные файлы получают разные отпечатки', () => {
  const site = assetUrl('/js/site.js').split('=')[1]
  const admin = assetUrl('/js/admin.js').split('=')[1]
  assert.notEqual(site, admin)
})

test('повторный вызов стабилен', () => {
  assert.equal(assetUrl('/css/site.css'), assetUrl('/css/site.css'))
})

test('отсутствующий файл не роняет страницу', () => {
  assert.equal(assetUrl('/css/нет-такого.css'), '/css/нет-такого.css')
})

test('выход за пределы public не допускается', () => {
  assert.equal(assetUrl('/../.env'), '/../.env', 'путь возвращается как есть, файл не читается')
})
