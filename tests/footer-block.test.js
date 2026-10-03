import test, { beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { resetDatabase, closePool } from './helpers.js'
import { createPage } from '../src/repositories/pages.js'
import { createBlock, listBlocks, deleteBlock, getBlockTexts } from '../src/repositories/blocks.js'
import { getSetting, setSetting } from '../src/repositories/settings.js'
import { defaultSettings } from '../src/blocks/index.js'
import { ensureFooterBlock } from '../src/services/seed.js'

const silent = { info () {}, warn () {} }

beforeEach(async () => { await resetDatabase() })
after(async () => { await closePool() })

async function footers (pageId) {
  return (await listBlocks(pageId)).filter((block) => block.type === 'footer')
}

test('подвал заводится сам, если его нет', async () => {
  const pageId = await createPage({ slug: 'home' })

  assert.equal(await ensureFooterBlock({ logger: silent }), true)
  assert.equal((await footers(pageId)).length, 1)
  assert.equal(await getSetting('footer_block_created'), true)
})

test('второй раз не создаётся', async () => {
  const pageId = await createPage({ slug: 'home' })
  await ensureFooterBlock({ logger: silent })

  assert.equal(await ensureFooterBlock({ logger: silent }), false)
  assert.equal((await footers(pageId)).length, 1)
})

/** Редактор удалил подвал — значит так и хотел, воскрешать нельзя. */
test('удалённый подвал не возвращается', async () => {
  const pageId = await createPage({ slug: 'home' })
  await ensureFooterBlock({ logger: silent })
  const [footer] = await footers(pageId)

  await deleteBlock(footer.id)
  await ensureFooterBlock({ logger: silent })

  assert.equal((await footers(pageId)).length, 0)
})

test('уже созданный вручную подвал не дублируется', async () => {
  const pageId = await createPage({ slug: 'home' })
  await createBlock({ pageId, type: 'footer', settings: defaultSettings('footer') })

  assert.equal(await ensureFooterBlock({ logger: silent }), false)
  assert.equal((await footers(pageId)).length, 1)
  assert.equal(await getSetting('footer_block_created'), true, 'пометка всё равно ставится')
})

test('строка из настроек переезжает в блок', async () => {
  const pageId = await createPage({ slug: 'home' })
  await setSetting('footer_note', 'padali.band · 2026')

  await ensureFooterBlock({ logger: silent })
  const [footer] = await footers(pageId)
  const texts = await getBlockTexts(footer.id)

  assert.equal(texts.en.note, 'padali.band · 2026')
  assert.equal(texts.sr.note, 'padali.band · 2026', 'во всех языках сайта')
})

test('без страницы ничего не делает', async () => {
  assert.equal(await ensureFooterBlock({ logger: silent }), false)
})
