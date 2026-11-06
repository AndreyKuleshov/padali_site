import test from 'node:test'
import assert from 'node:assert/strict'
import { readEnv } from '../src/config.js'

const REQUIRED = {
  DB_HOST: 'localhost', DB_NAME: 'padali', DB_USER: 'padali', DB_PASSWORD: 'secret',
  SESSION_SECRET: 'x'.repeat(32)
}

/**
 * Переменная окружения — всегда строка, и пустая строка значит «не
 * задано»: ровно так её отдают docker-compose и Coolify, где
 * переменную легко завести, забыв вписать значение.
 *
 * `??` ловит только `undefined`, и пустая строка шла дальше как
 * настоящее значение: `Number('')` — это ноль, то есть порт 0 и
 * таймаут 0 с мгновенным обрывом запроса, а `resolve('')` — корень
 * проекта вместо папки загрузок. Пустой артист Bandsintown выключал
 * синхронизацию, и админка при этом писала, что пуст ключ, хотя
 * ключ был на месте.
 */
test('пустая переменная окружения — это «не задано», а не значение', () => {
  const config = readEnv({
    ...REQUIRED,
    PORT: '',
    DB_SCHEMA: '',
    UPLOAD_DIR: '',
    BANDSINTOWN_ARTIST_ID: '',
    BANDSINTOWN_TIMEOUT_MS: '',
    OPENAI_MODEL: ''
  })

  assert.equal(config.port, 3000)
  assert.equal(config.db.schema, 'padali')
  assert.equal(config.bandsintown.artistId, '15671864')
  assert.equal(config.bandsintown.timeoutMs, 8000)
  assert.equal(config.openai.model, 'gpt-4.1-mini')
  assert.notEqual(config.uploadDir, process.cwd())
})

/* Заданное значение остаётся заданным — в том числе ноль, который
   пишут осознанно: «хранить статистику ноль дней». */
test('заданное значение доходит до настроек как есть', () => {
  const config = readEnv({
    ...REQUIRED, PORT: '4000', BANDSINTOWN_ARTIST_ID: '777', ANALYTICS_RETENTION_DAYS: '0'
  })

  assert.equal(config.port, 4000)
  assert.equal(config.bandsintown.artistId, '777')
  assert.equal(config.analyticsRetentionDays, 0)
})
