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
