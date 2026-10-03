/* PADALI — поведение публичного сайта: обратный отсчёт и лайтбокс. */
(function () {
  'use strict'

  /* ── Обратный отсчёт ──────────────────────────────────────
     Дата и подпись приходят из блока в data-атрибутах, поэтому
     скрипт ничего не знает ни о релизе, ни о языке страницы. */
  function initCountdowns () {
    var nodes = document.querySelectorAll('[data-countdown]')
    if (nodes.length === 0) return

    function update () {
      var now = Date.now()
      Array.prototype.forEach.call(nodes, function (node) {
        var target = Date.parse(node.getAttribute('data-countdown') + 'T00:00:00Z')
        if (isNaN(target)) { node.textContent = ''; return }

        var days = Math.ceil((target - now) / 86400000)
        if (days <= 0) { node.textContent = ''; return }

        var template = node.getAttribute('data-countdown-template') || '{days}'
        node.textContent = template.replace('{days}', String(days))
      })
    }

    update()
    setInterval(update, 3600000)
  }

  /* ── Лайтбокс ─────────────────────────────────────────────
     Один обработчик на документ: галереи могут появляться
     и исчезать, навешивать слушатель на каждую картинку незачем. */
  function initLightbox () {
    var lightbox = document.getElementById('lightbox')
    var image = document.getElementById('lightboxImg')
    var caption = document.getElementById('lightboxCaption')
    var closeButton = document.getElementById('lightboxClose')
    if (!lightbox || !image) return

    var lastFocused = null

    function open (trigger) {
      lastFocused = document.activeElement
      image.src = trigger.getAttribute('data-lightbox') || trigger.currentSrc || trigger.src
      image.alt = trigger.alt || ''

      var figure = trigger.closest('figure')
      var text = figure && figure.querySelector('figcaption')
      if (caption) caption.textContent = text ? text.textContent.trim() : ''

      lightbox.hidden = false
      document.body.style.overflow = 'hidden'
      if (closeButton) closeButton.focus()
    }

    function close () {
      lightbox.hidden = true
      image.src = ''
      document.body.style.overflow = ''
      if (lastFocused && lastFocused.focus) lastFocused.focus()
    }

    document.addEventListener('click', function (event) {
      var trigger = event.target.closest('img[data-lightbox]')
      if (trigger) { open(trigger); return }
      // Клик по подложке, но не по самой картинке.
      if (!lightbox.hidden && event.target.closest('#lightbox') && !event.target.closest('.lightbox-figure img')) {
        close()
      }
    })

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !lightbox.hidden) close()
    })
  }

  initCountdowns()
  initLightbox()
})()
