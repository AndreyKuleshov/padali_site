import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyTurnstile, VERIFY_URL } from '../src/services/turnstile.js'

const KEYS = { siteKey: 'site', secretKey: 'secret' }

/** Ответ Cloudflare, не выходя в сеть. */
function answer (payload, { ok = true } = {}) {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: Object.fromEntries(options.body) })
    return { ok, json: async () => payload }
  }
  return { fetchImpl, calls }
}

test('без ключей капчи нет и проверять нечего', async () => {
  const { fetchImpl, calls } = answer({ success: false })
  const result = await verifyTurnstile('', { fetchImpl, keys: { siteKey: '', secretKey: '' } })

  assert.deepEqual(result, { ok: true, reason: 'off' })
  assert.equal(calls.length, 0, 'в сеть не ходим, когда капча не заведена')
})

test('пустой токен отклоняется, не доходя до Cloudflare', async () => {
  const { fetchImpl, calls } = answer({ success: true })
  const result = await verifyTurnstile('   ', { fetchImpl, keys: KEYS })

  /* Это не «сеть моргнула», а запрос мимо формы: робот, который
     просто постучался в /send. Такое пропускать незачем. */
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'missing')
  assert.equal(calls.length, 0)
})

test('принятый токен проходит, отклонённый — нет', async () => {
  const good = await verifyTurnstile('tok', { ...answer({ success: true }), keys: KEYS })
  assert.equal(good.ok, true)

  const bad = await verifyTurnstile('tok', {
    ...answer({ success: false, 'error-codes': ['invalid-input-response'] }),
    keys: KEYS
  })
  assert.equal(bad.ok, false)
  assert.equal(bad.reason, 'invalid-input-response', 'код отказа виден в логе')
})

test('секрет и адрес уходят на проверку, но не на страницу', async () => {
  const { fetchImpl, calls } = answer({ success: true })
  await verifyTurnstile('tok', { fetchImpl, ip: '203.0.113.7', keys: KEYS })

  assert.equal(calls[0].url, VERIFY_URL)
  assert.equal(calls[0].body.secret, 'secret')
  assert.equal(calls[0].body.response, 'tok')
  assert.equal(calls[0].body.remoteip, '203.0.113.7')
})

/* Политика та же, что у проверки контактов, и по той же причине:
   потерять настоящее письмо из-за того, что чужая служба моргнула,
   хуже, чем пропустить одно роботское. Приманка и ограничение
   частоты в эту минуту работают. */
test('молчание Cloudflare не повод отказать', async () => {
  const brokenNetwork = await verifyTurnstile('tok', {
    fetchImpl: async () => { throw new Error('сеть недоступна') },
    keys: KEYS
  })
  assert.deepEqual(brokenNetwork, { ok: true, reason: 'unreachable' })

  const badStatus = await verifyTurnstile('tok', {
    ...answer({ success: false }, { ok: false }),
    keys: KEYS
  })
  assert.deepEqual(badStatus, { ok: true, reason: 'unreachable' })

  const brokenBody = await verifyTurnstile('tok', {
    fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('не JSON') } }),
    keys: KEYS
  })
  assert.deepEqual(brokenBody, { ok: true, reason: 'unreachable' })
})

test('у проверки есть срок ожидания', async () => {
  let signal
  await verifyTurnstile('tok', {
    fetchImpl: async (url, options) => { signal = options.signal; return { ok: true, json: async () => ({ success: true }) } },
    keys: KEYS
  })
  /* Без срока мёртвый Cloudflare держал бы посетителя у кнопки
     «отправить» столько, сколько ему вздумается. */
  assert.ok(signal instanceof AbortSignal, 'сигнал отмены передан')
})
