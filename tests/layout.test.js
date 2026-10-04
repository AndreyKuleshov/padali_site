import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LAYOUT } from '../src/services/renderer.js'

const CSS = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'css', 'site.css')

/**
 * Атрибут sizes шаблон считает по тем же числам, что задают
 * раскладку в стилях. Браузер выбирает версию снимка до того, как
 * применит CSS, поэтому разошедшиеся копии не проявятся ошибкой —
 * просто в колонку шириной 240 поедет версия 1280px.
 */
test('числа раскладки в шаблонах совпадают со стилями', async () => {
  const css = await readFile(CSS, 'utf8')

  const expected = [
    ['--wrap', LAYOUT.wrap, /--wrap:\s*(\d+)px/],
    ['--gutter', LAYOUT.gutter, /--gutter:\s*(\d+)px/],
    ['--gallery-gap', LAYOUT.galleryGap, /--gallery-gap:\s*(\d+)px/]
  ]

  for (const [name, value, pattern] of expected) {
    const found = pattern.exec(css)
    assert.ok(found, `${name} в стилях не найден`)
    assert.equal(Number(found[1]), value, `${name}: стили и LAYOUT разошлись`)
  }

  // Узкий экран: своя ширина поля и граница, с которой он начинается.
  const narrow = /@media \(max-width:\s*(\d+)px\)\s*\{\s*:root \{ --gutter:\s*(\d+)px; \}/.exec(css)
  assert.ok(narrow, 'правило узкого экрана не найдено')
  assert.equal(Number(narrow[1]), LAYOUT.narrow, 'граница узкого экрана разошлась')
  assert.equal(Number(narrow[2]), LAYOUT.gutterNarrow, 'поле на узком экране разошлось')

  // Лента: ширина кадра задана и в стилях, и в sizes.
  const strip = /\.gallery--strip \.gallery-item \{[^}]*flex:\s*0 0 min\((\d+)vw,\s*(\d+)px\)/.exec(css)
  assert.ok(strip, 'ширина кадра ленты не найдена')
  assert.equal(Number(strip[1]), LAYOUT.stripVw)
  assert.equal(Number(strip[2]), LAYOUT.stripMax)
})
