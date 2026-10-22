/**
 * Отбивка в Telegram о сообщении с сайта.
 *
 * Правило то же, что у почты и у проверки контактов: отказ чужой
 * службы не касается посетителя. Сообщение к этому моменту уже в
 * базе, и всё, что может сделать отбивка, — уйти или не уйти.
 *
 * В сеть тесты не ходят: fetchImpl приходит параметром.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { notifyTelegram, isTelegramConfigured, composeTelegram } from '../src/services/telegram.js'

const SETTINGS = { token: '123:ABC', chatId: '-100500', timeoutMs: 1000 }

/** Подделка fetch: запоминает запрос и отдаёт заданный ответ. */
function fakeFetch (reply) {
  const calls = []
  const impl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) })
    if (reply instanceof Error) throw reply
    return reply
  }
  impl.calls = calls
  return impl
}

const okReply = { ok: true, status: 200, json: async () => ({ ok: true }) }

test('без токена или чата отбивка молча выключена', async () => {
  const impl = fakeFetch(okReply)

  for (const settings of [
    { token: '', chatId: '-100500' },
    { token: '123:ABC', chatId: '' },
    {}
  ]) {
    assert.equal(isTelegramConfigured(settings), false)
    const result = await notifyTelegram({ kind: 'contact', body: 'привет' }, { fetchImpl: impl, settings })
    assert.equal(result.ok, true, 'выключенная отбивка не считается провалом')
  }

  assert.equal(impl.calls.length, 0, 'в сеть не ходили ни разу')
})

test('сообщение уходит на адрес бота, с чатом и текстом', async () => {
  const impl = fakeFetch(okReply)
  const result = await notifyTelegram(
    { kind: 'contact', contact: 'a@b.test', body: 'когда концерт?' },
    { fetchImpl: impl, settings: SETTINGS, siteUrl: 'https://padali.band' }
  )

  assert.equal(result.ok, true)
  assert.equal(impl.calls.length, 1)
  assert.match(impl.calls[0].url, /^https:\/\/api\.telegram\.org\/bot123:ABC\/sendMessage$/)
  assert.equal(impl.calls[0].body.chat_id, '-100500')
  assert.match(impl.calls[0].body.text, /когда концерт\?/)
  assert.match(impl.calls[0].body.text, /a@b\.test/)
  assert.match(impl.calls[0].body.text, /padali\.band\/admin\/messages/, 'отвечать всё равно идти в админку')
})

/* Разметку не включаем вовсе: в человеческом тексте бывают и
   звёздочки, и подчёркивания, и угловые скобки, а с parse_mode
   Telegram на таком отвечает отказом. Сломать отбивку мог бы любой
   посетитель, написав «*» в поле. */
test('разметка не включается, поэтому чужие символы её не ломают', async () => {
  const impl = fakeFetch(okReply)
  const hostile = 'цена *от* 2 000 _рублей_ <b>или</b> [так](x) `код`'

  await notifyTelegram({ kind: 'contact', body: hostile }, { fetchImpl: impl, settings: SETTINGS })

  const sent = impl.calls[0].body
  assert.equal(sent.parse_mode, undefined, 'parse_mode не передаётся')
  assert.ok(sent.text.includes(hostile), 'текст ушёл ровно таким, каким его написали')
})

test('заказ и вопрос различимы с первой строки', async () => {
  const order = composeTelegram({ kind: 'order', item: 'Футболка', city: 'Novi Sad' }, {})
  const contact = composeTelegram({ kind: 'contact', body: 'привет' }, {})

  assert.match(order.split('\n')[0], /Заказ/)
  assert.match(contact.split('\n')[0], /Сообщение/)
  assert.match(order, /Товар: Футболка/)
  assert.match(order, /Город: Novi Sad/)

  /* Пустые поля не печатаются: «Город:» с пустотой читается как
     недоделка, а у письма с сайта города и нет. */
  assert.doesNotMatch(contact, /Товар:|Город:/)
})

test('отказ Telegram не превращается в исключение', async () => {
  const refused = {
    ok: false,
    status: 403,
    json: async () => ({ ok: false, description: 'Forbidden: bot was blocked by the user' })
  }

  const result = await notifyTelegram({ kind: 'contact', body: 'x' }, { fetchImpl: fakeFetch(refused), settings: SETTINGS })
  assert.equal(result.ok, false)
  assert.match(result.error, /403/)
  assert.match(result.error, /blocked/, 'причина в отчёте: по ней видно, протух токен или выгнали бота')
})

test('молчащая сеть не роняет отправку', async () => {
  const result = await notifyTelegram(
    { kind: 'contact', body: 'x' },
    { fetchImpl: fakeFetch(new Error('timeout')), settings: SETTINGS }
  )
  assert.equal(result.ok, false)
  assert.match(result.error, /сеть/)
})
