import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
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
/* Граница узкого экрана жила числом в четырёх шаблонах и в
   браузерном коде: сдвинув её в стилях, остальные молча остались
   бы на старой и отдавали бы версию снимка не той ширины. */
test('граница узкого экрана берётся из одного места', async () => {
  const views = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'views')
  const files = await readdir(join(views, 'blocks'))

  for (const file of files) {
    const body = await readFile(join(views, 'blocks', file), 'utf8')
    const sizes = [...body.matchAll(/sizes[^\n]*max-width: (\d+)px/g)].map((m) => m[1])
    assert.deepEqual(sizes, [], `${file}: граница в sizes написана числом ${sizes[0]}`)
  }

  const layout = await readFile(join(views, 'layout.eta'), 'utf8')
  assert.match(layout, /data-narrow="<%= it\.h\.layout\.narrow %>"/,
    'браузерный код получает границу разметкой')
})

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

/**
 * Два правила одинаковой силы — побеждает то, что ниже в файле, а
 * не то, чей медиазапрос «уже». Общее правило, стоящее ПОСЛЕ блока
 * узкого экрана, молча отменяет мобильное, и в коде это выглядит
 * правильно: в запросе написано одно, работает другое. Наступали
 * трижды: .contact-row--send, .contact-form button[type="submit"],
 * .album-card.
 *
 * Сравниваем по паре «селектор + свойство»: тот же селектор ниже,
 * но про другое свойство, — обычное дело и не спор.
 */
/** Комментарии выкидываем до разбора: иначе они приклеиваются к
    следующему селектору и два одинаковых правила перестают быть
    одинаковыми. */
function withoutComments (css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ')
}

function rules (css) {
  const out = []
  for (const [, selector, body] of withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const name = selector.trim().replace(/\s+/g, ' ')
    if (name.startsWith('@') || name === '') continue
    const props = [...body.matchAll(/(^|;)\s*([a-z-]+)\s*:/g)].map(([, , prop]) => prop)
    for (const part of name.split(',')) out.push([part.trim(), props])
  }
  return out
}

test('мобильное правило не перебивается более поздним общим', async () => {
  for (const file of ['site.css', 'admin.css']) {
    const css = await readFile(join(PUBLIC, file), 'utf8')

    const start = css.search(/@media \(max-width:/)
    if (start === -1) continue

    // Конец блока запроса — его парная скобка.
    let depth = 0
    let end = css.length
    for (let i = css.indexOf('{', start); i < css.length; i += 1) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') {
        depth -= 1
        if (depth === 0) { end = i; break }
      }
    }

    const narrow = new Map()
    for (const [selector, props] of rules(css.slice(start, end))) {
      for (const prop of props) narrow.set(selector + ' | ' + prop, true)
    }

    // Ниже смотрим только безусловные правила: вложенные запросы
    // спорят между собой по своим границам, а не с этим блоком.
    const below = css.slice(end).replace(/@[\w-]+[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ' ')

    const clash = []
    for (const [selector, props] of rules(below)) {
      for (const prop of props) {
        if (narrow.has(selector + ' | ' + prop)) clash.push(selector + ' { ' + prop + ' }')
      }
    }

    assert.deepEqual(clash, [],
      `${file}: ${clash[0]} задан и в узком экране, и безусловно ниже — узкое правило не сработает`)
  }
})

/**
 * Одно и то же правило, написанное дважды, — в лучшем случае
 * мёртвые строки, в худшем молчаливая подмена: побеждает нижнее.
 * Так класс `.media-grid` для картинок блока достался сетке
 * медиатеки, объявленной ниже по файлу, и колонки вышли чужие.
 *
 * Сравниваем по ПОЛНОМУ тексту селектора: «.a img, .b img» выше и
 * «.b img» ниже — обычное переопределение частного после общего, а
 * не спор.
 */
test('одно и то же правило не написано дважды', async () => {
  for (const file of ['site.css', 'admin.css']) {
    const css = await readFile(join(PUBLIC, file), 'utf8')
    // Условные правила спорят по своим границам, их не считаем.
    const flat = withoutComments(css).replace(/@[\w-]+[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ' ')

    const seen = new Set()
    const twice = []
    for (const match of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1].trim().replace(/\s+/g, ' ')
      if (selector === '' || selector.startsWith('@')) continue
      for (const [, , prop] of match[2].matchAll(/(^|;)\s*([a-z-]+)\s*:/g)) {
        const key = selector + ' { ' + prop + ' }'
        if (seen.has(key)) twice.push(key)
        else seen.add(key)
      }
    }

    assert.deepEqual(twice, [], `${file}: ${twice[0]} написано дважды — работает нижнее`)
  }
})
