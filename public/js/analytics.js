/* PADALI — сбор посещаемости. Без кук и без внешних сервисов.
   Отправляется путь страницы и координаты кликов; всё остальное
   остаётся в браузере. Уважается настройка «не отслеживать». */
(function () {
  'use strict'

  if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return
  // Страница открыта во фрейме админки — это не визит посетителя.
  if (window.top !== window.self) return

  var ENDPOINT = '/_a'
  var path = location.pathname
  var clicks = []
  var sent = false

  function viewport () {
    return window.innerWidth || document.documentElement.clientWidth || 0
  }

  /** Короткая подпись цели клика: по ней видно, куда жмут. */
  function describe (element) {
    var link = element.closest('a[href]')
    if (link) {
      var href = link.getAttribute('href')
      var text = (link.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)
      return (text ? text + ' ' : '') + '→ ' + href
    }
    var button = element.closest('button')
    if (button) {
      return 'кнопка: ' + ((button.getAttribute('aria-label') ||
        (button.textContent || '').trim()).replace(/\s+/g, ' ').slice(0, 60) || '—')
    }
    var image = element.closest('img')
    if (image) return 'фото: ' + (image.alt || '—').slice(0, 60)
    var section = element.closest('section[id]')
    return section ? 'раздел: ' + section.id : null
  }

  function send (payload, beacon) {
    var body = JSON.stringify(payload)
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))
      return
    }
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      keepalive: true
    }).catch(function () {})
  }

  send({
    type: 'view',
    path: path,
    locale: document.documentElement.lang || null,
    referrer: document.referrer || null,
    w: viewport()
  }, false)

  document.addEventListener('click', function (event) {
    if (clicks.length >= 80) return
    var width = viewport()
    if (width === 0) return

    clicks.push({
      // Доля ширины и пиксели от верха документа: точки сопоставимы
      // между экранами, а вертикаль не плывёт при прокрутке.
      x: Math.round((event.clientX / width) * 1000) / 1000,
      y: Math.round(event.clientY + window.scrollY),
      w: width,
      t: describe(event.target)
    })
  }, { passive: true, capture: true })

  function flush () {
    if (sent || clicks.length === 0) return
    sent = true
    send({ type: 'clicks', path: path, clicks: clicks }, true)
  }

  // pagehide надёжнее unload, visibilitychange ловит уход на вкладку.
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush()
  })
})()
