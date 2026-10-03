/* PADALI — поведение публичного сайта: обратный отсчёт и просмотр фотографий. */
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

  /* ── Полноэкранный просмотр с листанием ───────────────────
     Снимки листаются внутри своей группы: у каждой галереи она
     своя, поэтому два альбома на странице не перемешиваются.
     Одиночная картинка (обложка, афиша) группы не имеет — тогда
     стрелки и счётчик не показываются. */
  function initLightbox () {
    var lightbox = document.getElementById('lightbox')
    var image = document.getElementById('lightboxImg')
    var caption = document.getElementById('lightboxCaption')
    var counter = document.getElementById('lightboxCounter')
    var closeButton = document.getElementById('lightboxClose')
    var prevButton = document.getElementById('lightboxPrev')
    var nextButton = document.getElementById('lightboxNext')
    if (!lightbox || !image) return

    var items = []
    var index = 0
    var lastFocused = null

    function sourceOf (node) {
      return node.getAttribute('data-lightbox') || node.currentSrc || node.src
    }

    function captionOf (node) {
      var figure = node.closest('figure')
      var text = figure && figure.querySelector('figcaption')
      return text ? text.textContent.trim() : ''
    }

    /** Соседние кадры подгружаем заранее: листание без мигания. */
    function preloadNeighbours () {
      if (items.length < 2) return
      ;[index - 1, index + 1].forEach(function (position) {
        var node = items[(position + items.length) % items.length]
        if (node) new Image().src = sourceOf(node)
      })
    }

    function show (position) {
      index = (position + items.length) % items.length
      var node = items[index]

      image.src = sourceOf(node)
      image.alt = node.alt || ''
      if (caption) caption.textContent = captionOf(node)

      var many = items.length > 1
      if (prevButton) prevButton.hidden = !many
      if (nextButton) nextButton.hidden = !many
      if (counter) {
        counter.hidden = !many
        counter.textContent = many ? (index + 1) + ' / ' + items.length : ''
      }

      preloadNeighbours()
    }

    function collect (trigger) {
      var group = trigger.closest('[data-lightbox-group]')
      if (!group) return [trigger]
      var nodes = group.querySelectorAll('img[data-lightbox]')
      return nodes.length > 0 ? Array.prototype.slice.call(nodes) : [trigger]
    }

    function open (trigger) {
      lastFocused = document.activeElement
      items = collect(trigger)
      var start = items.indexOf(trigger)
      show(start === -1 ? 0 : start)

      lightbox.hidden = false
      document.body.style.overflow = 'hidden'
      if (closeButton) closeButton.focus()
    }

    function close () {
      lightbox.hidden = true
      image.src = ''
      items = []
      document.body.style.overflow = ''
      if (lastFocused && lastFocused.focus) lastFocused.focus()
    }

    function step (delta) {
      if (items.length > 1) show(index + delta)
    }

    document.addEventListener('click', function (event) {
      var trigger = event.target.closest('img[data-lightbox]')
      if (trigger) { open(trigger); return }
      if (lightbox.hidden) return

      if (event.target.closest('#lightboxPrev')) { step(-1); return }
      if (event.target.closest('#lightboxNext')) { step(1); return }
      if (event.target.closest('#lightboxClose')) { close(); return }

      // Клик по подложке закрывает, по самой фотографии — нет.
      if (event.target.closest('#lightbox') && !event.target.closest('.lightbox-figure img')) {
        close()
      }
    })

    document.addEventListener('keydown', function (event) {
      if (lightbox.hidden) return

      if (event.key === 'Escape') { close(); return }
      if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); return }
      if (event.key === 'ArrowRight') { event.preventDefault(); step(1); return }
      if (event.key === 'Home') { event.preventDefault(); show(0); return }
      if (event.key === 'End') { event.preventDefault(); show(items.length - 1); return }

      // Фокус не должен уходить на страницу под просмотром.
      if (event.key === 'Tab') {
        var focusable = [prevButton, nextButton, closeButton].filter(function (node) {
          return node && !node.hidden
        })
        if (focusable.length === 0) return
        var position = focusable.indexOf(document.activeElement)
        var next = event.shiftKey ? position - 1 : position + 1
        event.preventDefault()
        focusable[(next + focusable.length) % focusable.length].focus()
      }
    })

    /* Свайп на телефоне. Вертикальное движение не перехватываем —
       это обычная прокрутка или закрытие жестом браузера. */
    var touchStartX = 0
    var touchStartY = 0

    lightbox.addEventListener('touchstart', function (event) {
      touchStartX = event.changedTouches[0].clientX
      touchStartY = event.changedTouches[0].clientY
    }, { passive: true })

    lightbox.addEventListener('touchend', function (event) {
      var deltaX = event.changedTouches[0].clientX - touchStartX
      var deltaY = event.changedTouches[0].clientY - touchStartY
      if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
        step(deltaX < 0 ? 1 : -1)
      }
    }, { passive: true })
  }

  initCountdowns()
  initLightbox()
})()
