/**
 * Разбор ссылок Spotify.
 *
 * Ссылку приносят в том виде, в каком её дало приложение: из
 * «Поделиться», из адресной строки, а иногда как URI. Проверять
 * существование записи запросом нельзя — открытого ответа у
 * Spotify нет, — поэтому вся защита от опечатки здесь.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSpotify, embedUrl, listenUrl } from '../src/services/spotify.js'

const ID = '4cOdK2wGLETKBW3PvgPWqT'

test('идентификатор достаётся из любой формы ссылки', () => {
  const same = { kind: 'track', id: ID }

  assert.deepEqual(parseSpotify(`https://open.spotify.com/track/${ID}`), same)
  assert.deepEqual(parseSpotify(`https://open.spotify.com/track/${ID}?si=abc123`), same,
    'метка перехода в адресе не мешает')
  assert.deepEqual(parseSpotify(`open.spotify.com/track/${ID}`), same, 'без протокола')
  assert.deepEqual(parseSpotify(`  https://open.spotify.com/track/${ID}  `), same, 'с пробелами по краям')
  assert.deepEqual(parseSpotify(`spotify:track:${ID}`), same, 'URI из «Copy Spotify URI»')

  /* Приложение отдаёт ссылку с языковым префиксом. Он не часть
     адреса записи, и спотыкаться об него разбор не должен. */
  assert.deepEqual(parseSpotify(`https://open.spotify.com/intl-sr/track/${ID}`), same)
})

test('альбом и плейлист разбираются, вид записи сохраняется', () => {
  assert.deepEqual(parseSpotify(`https://open.spotify.com/album/${ID}`), { kind: 'album', id: ID })
  assert.deepEqual(parseSpotify(`https://open.spotify.com/playlist/${ID}`), { kind: 'playlist', id: ID })
})

test('чужая ссылка и мусор отвергаются', () => {
  for (const bad of [
    '', null, undefined, 'не ссылка',
    'https://music.apple.com/track/123',
    `https://open.spotify.com/user/${ID}`,
    'https://open.spotify.com/track/',
    'spotify:track:',
    `https://evil.example/open.spotify.com/track/${ID}`
  ]) {
    assert.equal(parseSpotify(bad), null, `«${bad}» не должно разбираться`)
  }
})

/* Домен плеера отдельный: на него уходит iframe, и подменить его
   на обычную страницу — значит показать внутри рамки весь Spotify
   целиком вместо одного трека. */
test('адрес плеера и адрес страницы — разные', () => {
  assert.equal(embedUrl(`https://open.spotify.com/track/${ID}`),
    `https://open.spotify.com/embed/track/${ID}?theme=0`,
    'тёмный вид: по умолчанию Spotify красит рамку под обложку, и на чёрной странице это синее пятно')
  assert.equal(listenUrl(`spotify:album:${ID}`),
    `https://open.spotify.com/album/${ID}`)

  assert.equal(embedUrl('мусор'), null)
  assert.equal(listenUrl('мусор'), null)
})
