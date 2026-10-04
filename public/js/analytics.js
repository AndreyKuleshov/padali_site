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
  var pending = null

  function viewport () {
    return window.innerWidth || document.documentElement.clientWidth || 0
  }

  /* Короткая подпись цели клика: по ней видно, куда жмут. Подпись
     уходит в базу как есть и показывается в админке, поэтому она
     по-английски: админка знает английский и сербский, русского в
     ней нет. Записанное раньше так и останется русским. */
  function describe (element) {
    var link = element.closest('a[href]')
    if (link) {
      var href = link.getAttribute('href')
      var text = (link.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)
      return (text ? text + ' ' : '') + '→ ' + href
    }
    var button = element.closest('button')
    if (button) {
      return 'button: ' + ((button.getAttribute('aria-label') ||
        (button.textContent || '').trim()).replace(/\s+/g, ' ').slice(0, 60) || '—')
    }
    var image = element.closest('img')
    if (image) return 'photo: ' + (image.alt || '—').slice(0, 60)
    var section = element.closest('section[id]')
    return section ? 'section: ' + section.id : null
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
    var width = viewport()
    if (width === 0) return

    /* Координаты считаем от блока, в котором случился клик.
       По горизонтали — пиксели от его центра, а не доля ширины:
       блок тянется на всё окно, а колонка содержимого центрирована
       и ограничена, поэтому доля у разных окон указывала бы на
       разные места. Смещение от центра одинаково при любом окне. */
    var host = event.target.closest ? event.target.closest('[data-block]') : null
    if (!host) return

    var box = host.getBoundingClientRect()
    if (box.width === 0) return

    clicks.push({
      b: host.getAttribute('data-block'),
      x: Math.round(event.clientX - (box.left + box.width / 2)),
      y: Math.round(event.clientY - box.top),
      w: width,
      t: describe(event.target)
    })

    // Пачка набралась — отправляем сразу, не дожидаясь паузы.
    if (clicks.length >= 20) flush()
    else scheduleFlush()
  }, { passive: true, capture: true })

  /**
   * Отправка накопленного.
   *
   * Ждать ухода со страницы нельзя: если админка открыта во втором
   * окне рядом, вкладка сайта остаётся видимой, и ни pagehide, ни
   * visibilitychange не наступают — клики так и лежали бы в буфере.
   * Поэтому отправляем через паузу после последнего клика, а уход
   * со страницы лишь добивает остаток.
   */
  function flush (beacon) {
    if (clicks.length === 0) return
    var batch = clicks
    // Буфер освобождаем сразу: иначе повторный вызов отправил бы
    // те же клики второй раз и удвоил статистику.
    clicks = []
    clearTimeout(pending)
    send({ type: 'clicks', path: path, clicks: batch }, beacon === true)
  }

  function scheduleFlush () {
    clearTimeout(pending)
    pending = setTimeout(flush, 3000)
  }

  // pagehide надёжнее unload, visibilitychange ловит уход на вкладку.
  window.addEventListener('pagehide', function () { flush(true) })
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush(true)
  })
})()
