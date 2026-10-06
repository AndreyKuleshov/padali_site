/* PADALI — поведение публичного сайта: обратный отсчёт и просмотр фотографий. */
(function () {
  'use strict'

  /* ── Обратный отсчёт ──────────────────────────────────────
     Дата и подпись приходят из блока в data-атрибутах, поэтому
     скрипт ничего не знает ни о релизе, ни о языке страницы. */
  function initCountdowns () {
    var nodes = document.querySelectorAll('[data-countdown]')
    if (nodes.length === 0) return

    /* Считаем календарные дни в поясе зрителя, а не часы до
       полуночи UTC: у читателя восточнее Гринвича дата уже
       сменилась, и округление вверх показывало лишний день.
       Округление к ближайшему — из-за перехода на летнее время:
       сутки в пересчёте бывают 23 и 25 часов. */
    function daysUntil (value) {
      var parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '')
      if (!parts) return null

      var target = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
      var today = new Date()
      today.setHours(0, 0, 0, 0)
      return Math.round((target - today) / 86400000)
    }

    function update () {
      Array.prototype.forEach.call(nodes, function (node) {
        var days = daysUntil(node.getAttribute('data-countdown'))
        if (days === null || days <= 0) { node.textContent = ''; return }

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
  /**
   * Прячет страницу под открытым окном.
   *
   * `aria-modal` сам по себе ничего не закрывает: без этого Tab и
   * чтение экрана уходили на содержимое под просмотром и под
   * боковым меню. `inert` снимает и фокус, и доступность разом.
   */
  function shutOut (on) {
    var zones = document.querySelectorAll('header.topbar, main, .site-footer')
    for (var i = 0; i < zones.length; i += 1) {
      if (on) zones[i].setAttribute('inert', '')
      else zones[i].removeAttribute('inert')
    }
  }

  function initLightbox () {
    var lightbox = document.getElementById('lightbox')
    var track = document.getElementById('lightboxTrack')
    var counter = document.getElementById('lightboxCounter')
    var closeButton = document.getElementById('lightboxClose')
    var prevButton = document.getElementById('lightboxPrev')
    var nextButton = document.getElementById('lightboxNext')
    if (!lightbox || !track) return

    var GLIDE_MS = 260

    var count = 0
    var index = 0
    var lastFocused = null
    var settle = null
    var gliding = null

    function sourceOf (node) {
      return node.getAttribute('data-lightbox') || node.currentSrc || node.src
    }

    function captionOf (node) {
      var figure = node.closest('figure')
      var text = figure && figure.querySelector('figcaption')
      return text ? text.textContent.trim() : ''
    }

    /* Человек мог попросить систему не двигать ничего лишнего. */
    function stillness () {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    }

    function updateCounter () {
      if (!counter) return
      counter.textContent = count > 1 ? (index + 1) + ' / ' + count : ''
    }

    function stopGliding () {
      if (gliding === null) return
      cancelAnimationFrame(gliding)
      gliding = null
      track.style.scrollSnapType = ''
    }

    /**
     * Плавный переезд к кадру — своими руками, а не behavior:
     * 'smooth'.
     *
     * Программную плавную прокрутку в контейнере с примагничиванием
     * часть браузеров отменяет на полпути: об это уже спотыкались в
     * ленте галереи, и там от неё отказались. Свой переезд ведёт
     * себя одинаково везде. Примагничивание на время движения
     * снимаем, иначе оно тянет ленту назад к текущему кадру.
     */
    function glide (to) {
      stopGliding()
      var from = track.scrollLeft
      var distance = to - from
      if (distance === 0) return

      var started = 0
      track.style.scrollSnapType = 'none'

      gliding = requestAnimationFrame(function frame (now) {
        if (started === 0) started = now
        var passed = Math.min((now - started) / GLIDE_MS, 1)
        // Замедление к концу: ровная скорость с резкой остановкой
        // читается как тот же рывок, только длиннее.
        track.scrollLeft = from + distance * (1 - Math.pow(1 - passed, 3))

        if (passed < 1) { gliding = requestAnimationFrame(frame); return }
        gliding = null
        track.style.scrollSnapType = ''
      })
    }

    function goTo (position, animate) {
      index = Math.max(0, Math.min(position, count - 1))
      var left = index * track.clientWidth

      if (animate && !stillness()) glide(left)
      else { stopGliding(); track.scrollLeft = left }

      updateCounter()
    }

    /**
     * Кадры лежат в ленте все сразу, иначе соседний неоткуда взять
     * во время движения пальца. Качаются при этом не все: дальним
     * проставлен loading="lazy", и браузер берёт их по мере
     * приближения. Атрибут ставится до адреса — после него загрузка
     * уже началась бы, и альбом на сотню кадров потянул бы сотню
     * файлов разом.
     */
    function build (nodes, start) {
      var frame = document.createDocumentFragment()

      nodes.forEach(function (node, position) {
        var slide = document.createElement('figure')
        slide.className = 'lightbox-slide'

        var picture = document.createElement('img')
        picture.alt = node.alt || ''
        picture.loading = Math.abs(position - start) <= 1 ? 'eager' : 'lazy'
        picture.decoding = 'async'
        picture.src = sourceOf(node)
        slide.appendChild(picture)

        var text = captionOf(node)
        if (text) {
          var label = document.createElement('figcaption')
          label.textContent = text
          slide.appendChild(label)
        }

        frame.appendChild(slide)
      })

      track.replaceChildren(frame)
    }

    function collect (trigger) {
      var group = trigger.closest('[data-lightbox-group]')
      if (!group) return [trigger]
      var nodes = group.querySelectorAll('img[data-lightbox]')
      return nodes.length > 0 ? Array.prototype.slice.call(nodes) : [trigger]
    }

    function open (trigger) {
      lastFocused = document.activeElement
      var nodes = collect(trigger)
      var start = nodes.indexOf(trigger)
      if (start === -1) start = 0

      count = nodes.length
      build(nodes, start)

      var many = count > 1
      if (prevButton) prevButton.hidden = !many
      if (nextButton) nextButton.hidden = !many
      if (counter) counter.hidden = !many

      lightbox.hidden = false
      document.body.classList.add('no-scroll')
      shutOut(true)
      // Ширину ленты видно только после показа: у скрытого нуль.
      goTo(start, false)
      if (closeButton) closeButton.focus()
    }

    function close () {
      stopGliding()
      lightbox.hidden = true
      track.replaceChildren()
      count = 0
      index = 0
      document.body.classList.remove('no-scroll')
      shutOut(false)
      if (lastFocused && lastFocused.focus) lastFocused.focus()
    }

    /* На краях заворачиваем мгновенно: плавно пришлось бы проехать
       мимо всех кадров сразу, а это не листание, а поездка. */
    function step (delta) {
      if (count < 2) return
      var next = index + delta
      if (next < 0) goTo(count - 1, false)
      else if (next > count - 1) goTo(0, false)
      else goTo(next, true)
    }

    // Палец главнее начатого переезда: иначе они тянут ленту вдвоём.
    track.addEventListener('touchstart', stopGliding, { passive: true })

    // Человек листает сам — считаем кадр по положению ленты.
    track.addEventListener('scroll', function () {
      clearTimeout(settle)
      settle = setTimeout(function () {
        if (count === 0 || track.clientWidth === 0 || gliding !== null) return
        index = Math.round(track.scrollLeft / track.clientWidth)
        updateCounter()
      }, 90)
    }, { passive: true })

    // Повернули телефон — ширина кадра другая, лента уехала бы вбок.
    window.addEventListener('resize', function () {
      if (!lightbox.hidden) goTo(index, false)
    })

    // Клавиатура: у картинки роль кнопки, значит Enter и пробел.
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return
      var trigger = event.target.closest && event.target.closest('img[data-lightbox]')
      if (!trigger) return
      event.preventDefault()
      open(trigger)
    })

    document.addEventListener('click', function (event) {
      var trigger = event.target.closest('img[data-lightbox]')
      if (trigger) { open(trigger); return }
      if (lightbox.hidden) return

      if (event.target.closest('#lightboxPrev')) { step(-1); return }
      if (event.target.closest('#lightboxNext')) { step(1); return }
      if (event.target.closest('#lightboxClose')) { close(); return }

      // Клик по подложке закрывает, по самой фотографии — нет.
      if (event.target.closest('#lightbox') && !event.target.closest('.lightbox-slide img')) {
        close()
      }
    })

    document.addEventListener('keydown', function (event) {
      if (lightbox.hidden) return

      if (event.key === 'Escape') { close(); return }
      if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); return }
      if (event.key === 'ArrowRight') { event.preventDefault(); step(1); return }
      // К краям альбома переходим сразу: плавно это проезд насквозь.
      if (event.key === 'Home') { event.preventDefault(); goTo(0, false); return }
      if (event.key === 'End') { event.preventDefault(); goTo(count - 1, false); return }

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
  }

  /* ── Прокрутка галереи без открытия фотографии ────────────
     Сама прокрутка нативная: контейнер со scroll-snap листается
     свайпом на телефоне и колесом на трекпаде. Стрелки нужны мыши.

     Состояния «выключена» у стрелок нет — листание зациклено, как и
     в полноэкранном просмотре. Позицию не запоминаем и из scrollLeft
     не вычисляем: когда-то так было, и ломалось дважды — событие
     scroll после программной прокрутки приходит не всегда, кнопка
     залипала выключенной, а быстрые нажатия читали ещё не
     обновившуюся позицию. */
  function initGalleryScrollers () {
    document.querySelectorAll('.gallery-frame--scrollable').forEach(function (frame) {
      var scroller = frame.querySelector('[data-gallery-scroll]')
      var prev = frame.querySelector('.gallery-arrow--prev')
      var next = frame.querySelector('.gallery-arrow--next')
      if (!scroller) return

      function scrollable () {
        return scroller.scrollWidth - scroller.clientWidth > 2
      }

      function updateVisibility () {
        var show = scrollable()
        if (prev) prev.hidden = !show
        if (next) next.hidden = !show
      }

      /**
       * Шаг — ровно видимая ширина, в конце заворачиваем к началу.
       *
       * Раньше экраны были отдельными узлами и шаг считался по их
       * положению. Теперь экран складывает CSS из колонок: при
       * разной ширине экрана их число разное, и считать не по чему.
       * Промахнуться некуда — у ленты примагничивание, и браузер
       * сам доводит до ближайшей колонки.
       */
      function step (direction) {
        var limit = scroller.scrollWidth - scroller.clientWidth
        var at = scroller.scrollLeft
        var target = at + direction * scroller.clientWidth

        /* Заворачиваем, только если уже стоим у края. Раньше условие
           смотрело на следующий ЦЕЛЫЙ экран: когда последний экран
           неполный — семь снимков по три, — он выходил за край, и
           лента прыгала в начало, ни разу не доехав до края. Семь
           кадров при этом показывались как шесть: последний жил в
           полосе, куда очередь не доходила. */
        if (direction > 0) target = at >= limit - 2 ? 0 : Math.min(target, limit)
        else target = at <= 2 ? limit : Math.max(target, 0)

        scroller.scrollTo({ left: target })
      }

      if (prev) prev.addEventListener('click', function () { step(-1) })
      if (next) next.addEventListener('click', function () { step(1) })

      // Высота и ширина меняются, пока догружаются картинки и шрифты.
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(updateVisibility).observe(scroller)
      }
      window.addEventListener('resize', updateVisibility)
      updateVisibility()
    })
  }

  /* ── Плеер YouTube по клику ──────────────────────────────
     До клика на странице только обложка: iframe плеера тянет
     около мегабайта чужих скриптов, и платить за них при каждом
     открытии страницы незачем. */
  function initVideoFacades () {
    document.addEventListener('click', function (event) {
      var button = event.target.closest('.video-play')
      if (!button) return

      var frame = button.closest('.video-frame')
      var source = frame && frame.getAttribute('data-src')
      if (!source) return

      var player = document.createElement('iframe')
      player.src = source
      player.title = button.getAttribute('aria-label') || 'YouTube'
      player.allow = 'accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen'
      player.allowFullscreen = true
      player.loading = 'lazy'
      player.referrerPolicy = 'strict-origin-when-cross-origin'

      frame.replaceChildren(player)
    })
  }

  /* ── Формы: связь и заказ мерча ──────────────────────────
     Отправляем из скрипта, чтобы остаться на странице: перезагрузка
     ради одной строки «спасибо» уводит человека из того места, где
     он читал. */
  /* Одно окно на все формы страницы: вторая копия разметки уже
     однажды разъехалась с первой. */
  function alertBox (text) {
    var box = document.getElementById('formAlert')
    if (!box || !box.showModal) { window.alert(text); return }

    box.querySelector('.form-alert-text').textContent = text
    var close = box.querySelector('[data-alert-close]')
    if (close && !close.dataset.wired) {
      close.dataset.wired = '1'
      close.addEventListener('click', function () { box.close() })
    }
    try { box.showModal() } catch (error) { console.error('padali: окно отказа не открылось', error) }
  }

  function initSendForms () {
    document.addEventListener('submit', function (event) {
      var form = event.target.closest('[data-send-form]')
      if (!form) return
      event.preventDefault()

      var button = form.querySelector('button[type="submit"]')
      var note = form.querySelector('[data-send-note]')
      var contact = form.querySelector('[data-contact-pick]')
      var data = new FormData(form)
      var payload = { kind: form.getAttribute('data-kind'), locale: document.documentElement.lang }
      data.forEach(function (value, key) { payload[key] = value })

      /* Удача — строкой на месте формы: форма исчезает, и строка
         оказывается там, куда человек и смотрит. Отказ — окном:
         строку под кнопкой не замечают, на этом уже споткнулись с
         подписями полей. */
      function say (text, state) {
        if (state === 'error') { alertBox(text); return }
        if (!note) return
        note.hidden = false
        note.setAttribute('data-state', state)
        note.textContent = text
      }

      if (button) { button.disabled = true; button.classList.add('is-busy') }

      // Адрес проверяем до отправки: иначе заказ уйдёт в тупик.
      var ready = contact ? verify(contact) : Promise.resolve(true)

      function done () {
        if (!button) return
        button.disabled = false
        button.classList.remove('is-busy')
      }

      ready.then(function (valid) {
        if (!valid) { done(); return }
        send()
      })

      function send () {
      fetch('/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (response) { return response.json().catch(function () { return {} }) })
        .then(function (result) {
          if (!result.ok) {
            /* Токен капчи одноразовый: после отказа он уже потрачен,
               и вторая попытка упёрлась бы в «уже использован».
               Поэтому перед повтором виджет сбрасываем. */
            resetCaptcha()
            say(form.getAttribute(result.reason === 'captcha' ? 'data-captcha-failed' : 'data-failed'), 'error')
            return
          }
          // Форму убираем: повторная отправка того же — обычно промах.
          say(form.getAttribute('data-sent'), 'ok')
          form.reset()
          var fields = form.querySelectorAll('.field, button[type="submit"]')
          for (var i = 0; i < fields.length; i += 1) fields[i].hidden = true
        })
        .catch(function () { resetCaptcha(); say(form.getAttribute('data-failed'), 'error') })
        .finally(done)
      }

      function resetCaptcha () {
        var widget = form.querySelector('.cf-turnstile')
        if (widget && window.turnstile) {
          try { window.turnstile.reset(widget) } catch (error) { console.error('padali: капчу не сбросить', error) }
        }
      }
    })
  }

  /* ── Контакт покупателя ──────────────────────────────────
     Подсказка в поле следует за выбранным видом связи: до него человек
     не знает, что туда писать, и пишет как попало. Адрес
     проверяется у поля, а не после «отправлено». */
  /* Подсказку в поле выравниваем по выбранному виду связи.
     Отдельной функцией, потому что form.reset() возвращает радио
     к почте, но события не шлёт — и подсказка оставалась от
     телеграма. */
  function syncContactHint (box, focus) {
    var radio = box.querySelector('input[name="contact_kind"]:checked')
    var value = box.querySelector('[data-contact-value]')
    var note = box.querySelector('[data-contact-error]')
    if (!value) return

    value.placeholder = (radio && radio.value === 'telegram') ? '@username' : 'name@example.com'
    if (note) note.hidden = true
    if (focus) value.focus()
  }

  function initContactPick () {
    document.addEventListener('change', function (event) {
      var radio = event.target
      if (!radio.matches || !radio.matches('[data-contact-pick] input[name="contact_kind"]')) return

      var box = radio.closest('[data-contact-pick]')
      box.querySelector('[data-contact-value]').value = ''
      syncContactHint(box, true)
    })

    // Проверяем, когда человек ушёл из поля: подсказка вовремя,
    // но не на каждую букву.
    document.addEventListener('blur', function (event) {
      var value = event.target
      if (!value.matches || !value.matches('[data-contact-value]')) return
      if (value.value.trim() === '') return
      verify(value.closest('[data-contact-pick]'))
    }, true)
  }

  /** @returns {Promise<boolean>} годится ли адрес */
  function verify (box) {
    var kind = box.querySelector('input[name="contact_kind"]:checked')
    var value = box.querySelector('[data-contact-value]')
    var note = box.querySelector('[data-contact-error]')

    return fetch('/check-contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: kind ? kind.value : '', value: value.value })
    })
      /* Отказ по лимиту — это 429 с телом {error}, и `ok` в нём нет.
         Посетителю говорили «неверный адрес», и форма не уходила
         вовсе. Проверка — помощник, а не вахтёр: не ответили
         по делу, значит пропускаем. */
      .then(function (response) {
        if (!response.ok) return { ok: true }
        return response.json()
      })
      .then(function (result) {
        note.hidden = result.ok
        if (!result.ok) {
          note.setAttribute('data-state', 'error')
          note.textContent = box.getAttribute('data-invalid')
        }
        return result.ok
      })
      // Сеть не ответила — не повод держать человека у формы.
      .catch(function () { note.hidden = true; return true })
  }

  /* ── Окно заказа ─────────────────────────────────────────── */
  function initOrderDialog () {
    document.addEventListener('click', function (event) {
      var trigger = event.target.closest('.merch-order')
      if (trigger) {
        var section = trigger.closest('section')
        var dialog = section && section.querySelector('[data-order-dialog]')
        if (!dialog) return

        var item = trigger.getAttribute('data-order-item') || ''
        var label = dialog.querySelector('[data-order-label]')
        var field = dialog.querySelector('[data-order-field]')
        if (label) label.textContent = item
        if (field) field.value = item

        /* После отправки форма сворачивается в «спасибо». Второй
           заказ открывал бы её такой же — возвращаем поля на
           место при каждом открытии. */
        var form = dialog.querySelector('[data-send-form]')
        if (form) {
          form.reset()
          var hidden = form.querySelectorAll('.field, button[type="submit"]')
          for (var i = 0; i < hidden.length; i += 1) hidden[i].hidden = false
          var note = form.querySelector('[data-send-note]')
          if (note) { note.hidden = true; note.textContent = '' }
          var pick = form.querySelector('[data-contact-pick]')
          if (pick) syncContactHint(pick, false)
          if (field) field.value = item
        }

        dialog.showModal()
        var first = dialog.querySelector('input:not([type="hidden"]):not([tabindex="-1"])')
        if (first) first.focus()
        return
      }

      if (event.target.closest('[data-order-close]')) {
        var open = event.target.closest('[data-order-dialog]')
        if (open) open.close()
      }
    })
  }

  /* ── Меню телефона ───────────────────────────────────────── */

  /**
   * Боковое меню: кнопка в шапке открывает, крестик, подложка,
   * Escape и переход по ссылке закрывают.
   *
   * Прокрутку страницы под открытым меню запираем: иначе палец
   * на подложке уводит содержимое, а меню остаётся на месте.
   */
  function initSideMenu () {
    var toggle = document.querySelector('[data-menu-toggle]')
    var menu = document.getElementById('sideMenu')
    if (!toggle || !menu) return

    var closeButton = menu.querySelector('[data-menu-close]')
    var backdrop = menu.querySelector('[data-menu-backdrop]')

    function open () {
      menu.hidden = false
      toggle.setAttribute('aria-expanded', 'true')
      document.body.classList.add('no-scroll')
      shutOut(true)
      if (closeButton) closeButton.focus()
    }

    /* Возвращаем фокус на кнопку, только если меню закрыл человек:
       при расширении окна он смотрит в другое место, и прыжок
       фокуса был бы неожиданным. */
    function close (returnFocus) {
      if (menu.hidden) return
      menu.hidden = true
      toggle.setAttribute('aria-expanded', 'false')
      document.body.classList.remove('no-scroll')
      shutOut(false)
      if (returnFocus) toggle.focus()
    }

    toggle.addEventListener('click', function () { open() })
    if (closeButton) closeButton.addEventListener('click', function () { close(true) })
    if (backdrop) backdrop.addEventListener('click', function () { close(true) })

    // Переход к разделу — это тот же жест, что «закрыть».
    menu.addEventListener('click', function (event) {
      if (event.target.closest('a')) close(false)
    })

    document.addEventListener('keydown', function (event) {
      if (menu.hidden) return
      if (event.key === 'Escape') { close(true); return }

      // Tab не должен уводить из открытой панели на страницу под ней.
      if (event.key !== 'Tab') return
      var stops = menu.querySelectorAll('button, a[href]')
      if (stops.length === 0) return
      var at = Array.prototype.indexOf.call(stops, document.activeElement)
      var next = event.shiftKey ? at - 1 : at + 1
      event.preventDefault()
      stops[(next + stops.length) % stops.length].focus()
    })

    // Экран расширили — полоса разделов вернулась, меню лишнее.
    var narrow = Number(document.currentScript && document.currentScript.getAttribute('data-narrow'))
    window.addEventListener('resize', function () {
      if (window.innerWidth > (narrow || 640)) close(false)
    })
  }

  /* ── Где я сейчас ─────────────────────────────────────────
     На одностраничнике в три с половиной тысячи точек посетителю
     ни разу не сообщали, в каком он разделе: полоса разделов
     выглядела одинаково от начала до конца. Подсвечиваем текущий —
     и в полосе, и в боковом меню, они берут пункты из одного
     списка.

     Считаем по пересечению с полосой у верха окна, а не по
     «сколько видно»: раздел высотой в пол-экрана иначе никогда не
     побеждал бы соседа высотой в два экрана. */
  function initScrollSpy () {
    var links = document.querySelectorAll('.quicknav a[href^="#"], .side-menu-links a[href^="#"]')
    if (links.length === 0 || !window.IntersectionObserver) return

    var byAnchor = {}
    var sections = []
    for (var i = 0; i < links.length; i += 1) {
      var anchor = links[i].getAttribute('href').slice(1)
      if (!byAnchor[anchor]) {
        var section = document.getElementById(anchor)
        if (!section) continue
        byAnchor[anchor] = []
        sections.push(section)
      }
      byAnchor[anchor].push(links[i])
    }

    var visible = {}
    var current = ''

    function mark (anchor) {
      if (anchor === current) return
      current = anchor
      for (var key in byAnchor) {
        if (!Object.prototype.hasOwnProperty.call(byAnchor, key)) continue
        for (var j = 0; j < byAnchor[key].length; j += 1) {
          if (key === anchor) byAnchor[key][j].setAttribute('aria-current', 'true')
          else byAnchor[key][j].removeAttribute('aria-current')
        }
      }
    }

    /* Последний раздел до полосы отсчёта не доходит: страница
       упирается в низ раньше. Нажав «Контакты», человек оказывался
       внизу, а подсвечен оставался предыдущий пункт. Поэтому у низа
       страницы ответ один — последний раздел, и спорить тут не с
       чем: ниже ничего нет. */
    function atBottom () {
      var doc = document.documentElement
      // Страница короче экрана не «внизу»: иначе последний пункт
      // горел бы всегда, даже когда прокручивать нечего.
      if (doc.scrollHeight <= window.innerHeight + 4) return false
      return window.innerHeight + window.scrollY >= doc.scrollHeight - 2
    }

    function decide () {
      if (sections.length > 0 && atBottom()) {
        mark(sections[sections.length - 1].id)
        return
      }
      // Из пересекающих полосу берём самый верхний — тот, к которому подошли.
      var found = ''
      for (var m = 0; m < sections.length; m += 1) {
        if (visible[sections[m].id]) { found = sections[m].id; break }
      }
      mark(found)
    }

    var observer = new window.IntersectionObserver(function (entries) {
      for (var k = 0; k < entries.length; k += 1) {
        visible[entries[k].target.id] = entries[k].isIntersecting
      }
      decide()
    }, { rootMargin: '-15% 0px -80% 0px' })

    for (var n = 0; n < sections.length; n += 1) observer.observe(sections[n])

    /* Наблюдатель молчит, когда прокрутка идёт, а пересечения не
       меняются — у самого низа это как раз тот случай. */
    window.addEventListener('scroll', decide, { passive: true })
    window.addEventListener('resize', decide)
  }

  /* Страница лежит в кэше сервера до первой правки в админке, и
     после Нового года год в подвале мог бы остаться прошлым. */
  function initYear () {
    var now = String(new Date().getFullYear())
    var nodes = document.querySelectorAll('[data-year]')
    for (var i = 0; i < nodes.length; i += 1) nodes[i].textContent = now
  }

  initCountdowns()
  initLightbox()
  initGalleryScrollers()
  initVideoFacades()
  initSendForms()
  initContactPick()
  initOrderDialog()
  initSideMenu()
  initScrollSpy()
  initYear()
})()
