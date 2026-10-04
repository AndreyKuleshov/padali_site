import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LAYOUT } from '../src/services/renderer.js'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'css')
const CSS = join(PUBLIC, 'site.css')

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

/**
 * Рядом с `repeat(auto-fit, …)` грамматика сетки допускает только
 * дорожки с определённой шириной. Поставленное там `auto` делает
 * недействительным всё объявление целиком — браузер молча роняет
 * его и раскладывает сетку в одну колонку.
 *
 * Так и случилось со строкой повторителя: поля вставали столбиком,
 * а выглядело это как «так задумано».
 */
test('auto-fit не соседствует с недопустимой дорожкой', async () => {
  for (const file of ['site.css', 'admin.css']) {
    const css = await readFile(join(PUBLIC, file), 'utf8')

    for (const [, value] of css.matchAll(/grid-template-(?:columns|rows):([^;}]+)/g)) {
      if (!/repeat\(\s*auto-(?:fit|fill)/.test(value)) continue

      // Убираем сам repeat() вместе со вложенными скобками.
      const rest = value.replace(/repeat\(\s*auto-(?:fit|fill)[^()]*(?:\([^()]*\)[^()]*)*\)/g, ' ')
      const bad = rest.split(/\s+/).filter((track) => (
        track === 'auto' || track === 'min-content' || track === 'max-content'
      ))

      assert.deepEqual(bad, [], `${file}: «${bad[0]}» рядом с auto-fit отменяет правило «${value.trim()}»`)
    }
  }
})
