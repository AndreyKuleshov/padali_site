import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { VIEWS_DIR, eta } from '../src/services/renderer.js'

function walk (dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (path.endsWith('.eta')) out.push(path)
  }
  return out
}

const TEMPLATES = walk(VIEWS_DIR)

test('шаблоны есть и все компилируются', () => {
  assert.ok(TEMPLATES.length > 10)
  for (const path of TEMPLATES) {
    const source = readFileSync(path, 'utf8')
    assert.doesNotThrow(() => eta.compile(source), `не компилируется: ${path}`)
  }
})

/**
 * Eta склеивает вывод строк конкатенацией без точек с запятой.
 * Блок кода, начинающийся с «(» или «[», прилипает к предыдущей
 * строке и превращается в вызов или индексацию — шаблон падает
 * уже в рантайме. Дважды наступали на это, поэтому проверяем.
 */
test('блоки кода не начинаются с символа, который прилипнет к строке выше', () => {
  const hazard = /<%\s*[[(`+\-/]/
  const offenders = []

  for (const path of TEMPLATES) {
    readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
      // `<% ;(` — безопасный вариант: точка с запятой разрывает связь.
      if (hazard.test(line) && !/<%\s*;/.test(line)) {
        offenders.push(`${path.replace(VIEWS_DIR, '')}:${index + 1}`)
      }
    })
  }

  assert.deepEqual(offenders, [], 'добавьте «;» сразу после <%')
})

/**
 * Атрибут нельзя печатать куском: `<%=` экранирует кавычки, и в
 * браузер приезжает `class=&quot;active&quot;` — значение из двух
 * символов вместо класса. Выглядит это правильно, а не работает, и
 * заметить можно только глазами в браузере.
 *
 * Наступали пять раз: data-album-id, title у выключенной кнопки,
 * data-pinned, class="active" у текущего языка (в двух копиях
 * разметки) и class="active" у текущего раздела меню админки.
 * Поэтому проверка статическая: она видит и те шаблоны, которые ни
 * один тест не рисует.
 *
 * Писать надо условием: `<% if (cond) { %> class="active"<% } %>`.
 */
test('атрибуты не печатаются куском через <%=', () => {
  const bad = []

  for (const path of TEMPLATES) {
    const source = readFileSync(path, 'utf8')
    for (const [, printed] of source.matchAll(/<%=([\s\S]*?)%>/g)) {
      /* Опасна пара «имя=кавычка» ВНУТРИ строкового литерала: эта
         кавычка и станет &quot;. А «'min=' + value» безопасно —
         там кавычка закрывает литерал, и значение уходит без неё,
         как и положено числовому атрибуту. */
      for (const [, body] of printed.matchAll(/'([^']*)'|"([^"]*)"/g).map((m) => [m[0], m[1] ?? m[2]])) {
        const attr = /([a-zA-Z-]+)=["']/.exec(body ?? '')
        if (attr) bad.push(`${path.split('/views/')[1]}: ${attr[1]}`)
      }
    }
  }

  assert.deepEqual(bad, [], bad.length ? `атрибут куском: ${bad.join(', ')}` : '')
})

/* Площадка в выпадайке без иконки не падает и не ругается — на
   сайте просто выходит пустой кружок, и заметно это не сразу.
   Список площадок и набор иконок живут в разных файлах, так что
   разойтись им легко. */
test('у каждой площадки в списке есть иконка', async () => {
  const { ICON_NAMES } = await import('../src/services/icons.js')
  const { listBlockTypes, getBlockType } = await import('../src/blocks/index.js')

  const known = new Set(ICON_NAMES)
  for (const { type } of listBlockTypes([])) {
    const platforms = getBlockType(type).settings
      ?.find((field) => field.key === 'platforms')
      ?.fields?.find((sub) => sub.key === 'icon')?.options
    if (!platforms) continue

    for (const name of platforms) {
      assert.ok(known.has(name), `блок «${type}»: у площадки «${name}» нет иконки в icons.js`)
    }
  }
})

/* Поле ссылки объявлено type="text" с собственной проверкой, а не
   type="url": тот требует адрес целиком и отклонял «/pocetak» со
   словами «Please enter a URL». Свою же страницу правильно писать
   путём — домен у этого сайта уже менялся.

   Проверку браузера и проверку сервера держим в согласии: что
   пропускает одна, то пропускает и другая. */
test('поле ссылки принимает и полный адрес, и путь на этом сайте', async () => {
  const { readFile } = await import('node:fs/promises')
  const { asUrl } = await import('../src/services/block-form.js')

  const template = await readFile('src/views/admin/fields/input.eta', 'utf8')
  assert.doesNotMatch(template, /<input type="url"/, 'type="url" путь не пропускает')

  const pattern = /pattern="([^"]+)"/.exec(template)
  assert.ok(pattern, 'своя проверка объявлена')
  /* Браузер якорит pattern сам и компилирует с флагом «v» —
     собираем так же. Без флага недействительное выражение
     компилируется как ни в чём не бывало, тест зеленеет, а
     браузер проверку молча не применяет и пропускает всё. */
  const browser = new RegExp(`^(?:${pattern[1]})$`, 'v')

  for (const good of ['/pocetak', '/sr/pocetak', 'https://padali.band/x', 'http://x.test', 'mailto:a@b.test', 'tel:+381600000000']) {
    assert.ok(browser.test(good), `браузер должен пропустить «${good}»`)
    assert.equal(asUrl(good), good, `и сервер тоже: «${good}»`)
  }

  for (const bad of ['pocetak', '//evil.test/x', 'javascript:alert(1)', 'ftp://x.test/a']) {
    assert.ok(!browser.test(bad), `браузер не должен пропустить «${bad}»`)
    assert.equal(asUrl(bad), '', `и сервер тоже: «${bad}»`)
  }
})
