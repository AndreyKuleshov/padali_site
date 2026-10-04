/* PADALI — админка. Минимум поведения: подтверждения, порядок,
   повторители, выбор и загрузка картинок. Ни одного фреймворка.
   Все видимые строки приходят из разметки в data-атрибутах —
   скрипт не знает языка интерфейса. */
(function () {
  'use strict'

  function fill (template, params) {
    return String(template || '').replace(/\{(\w+)\}/g, function (match, key) {
      return Object.prototype.hasOwnProperty.call(params, key) ? params[key] : match
    })
  }

  /**
   * Токен из формы, в которой лежит узел. Способов было пять, и
   * они отличались: один работал вне формы, остальные нет.
   */
  function csrfToken (node) {
    // Список блоков лежит вне формы и носит токен атрибутом.
    var holder = (node && node.closest) ? node.closest('[data-csrf]') : null
    if (holder) return holder.getAttribute('data-csrf')

    var form = (node && node.closest) ? node.closest('form') : null
    var field = (form || document).querySelector('input[name="_csrf"]')
    return field ? field.value : ''
  }

  /* ── Подтверждение удаления ─────────────────────────────── */
  document.addEventListener('submit', function (event) {
    var message = event.target.getAttribute('data-confirm')
    if (message && !window.confirm(message)) event.preventDefault()
  })

  /* ── Enter в форме ───────────────────────────────────────
     В длинной форме Enter из любого поля отправлял всю форму —
     недописанный блок сохранялся на полуслове. Теперь Enter в
     строке перевода переводит, в остальных полях не делает
     ничего, а сохранение — Cmd+Enter (⌘) или Ctrl+Enter. */
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter') return

    var field = event.target
    var form = field.form
    if (!form) return

    // Перевод — по полю, а не по форме: строка перевода есть и в
    // длинных формах блока, и в коротких карточках медиатеки.
    if (field.matches('[data-translate-source]')) {
      var holder = field.closest('[data-translate]')
      var run = holder && holder.querySelector('[data-translate-run]')
      event.preventDefault()
      if (run && !run.hidden) run.click()
      return
    }

    if (event.metaKey || event.ctrlKey) {
      var save = form.querySelector('button[type="submit"]')
      if (!save) return
      event.preventDefault()
      save.click()
      return
    }

    if (field.tagName === 'TEXTAREA') return

    /* Отправку с полуслова придерживаем только у длинных форм —
       у блока, альбома и настроек. Прежний отбор ловил и короткие
       `.stack`, а среди них форма входа: Enter в поле пароля не
       делал ничего, и это читалось как «сайт не работает». */
    if (form.matches('.block-form') && field.matches('input')) event.preventDefault()
  })

  /* ── Ожидание на отправке формы ──────────────────────────
     Сохранение перезагружает страницу, и до ответа сервера
     ничего не меняется: редактор не понимает, нажалось ли, и
     жмёт второй раз. Крутилка отвечает за «идёт», а запрет
     повторного нажатия — за то, чтобы запрос ушёл один. */
  document.addEventListener('submit', function (event) {
    var form = event.target
    if (event.defaultPrevented) return
    if (form.hasAttribute('data-no-spinner')) return

    var button = event.submitter
    if (!button || button.disabled) return
    if (button.type !== 'submit') return

    button.classList.add('is-busy')
    button.setAttribute('aria-busy', 'true')

    /* Отключаем в следующем такте: браузер собирает данные формы
       синхронно, и выключенная прямо сейчас кнопка не попала бы
       в запрос вместе со своими name и value. */
    window.setTimeout(function () { button.disabled = true }, 0)
  })

  /* Возврат по «назад» отдаёт страницу из кэша вместе с
     выключенной кнопкой — форма выглядела бы мёртвой. */
  window.addEventListener('pageshow', function (event) {
    if (!event.persisted) return
    var busy = document.querySelectorAll('.is-busy')
    for (var i = 0; i < busy.length; i += 1) {
      busy[i].classList.remove('is-busy')
      busy[i].removeAttribute('aria-busy')
      busy[i].disabled = false
    }
  })

  /* ── Порядок блоков ─────────────────────────────────────── */
  function initBlockOrder () {
    var list = document.getElementById('blockList')
    if (!list || typeof window.Sortable === 'undefined') return

    window.Sortable.create(list, {
      handle: '.drag-handle:not(.drag-handle--locked)',
      animation: 140,
      // Шапка и подвал закреплены: мимо них не перетащить.
      onMove: function (event) {
        return !event.related.classList.contains('block-row--pinned')
      },
      onEnd: function () {
        var order = Array.prototype.map.call(
          list.querySelectorAll('.block-row'),
          function (row) { return row.getAttribute('data-id') }
        )
        fetch('/admin/blocks/reorder', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': list.getAttribute('data-csrf')
          },
          body: JSON.stringify({ order: order, _csrf: csrfToken(list) })
        }).then(function (response) {
          if (!response.ok) window.alert(list.getAttribute('data-error'))
        })
      }
    })
  }

  /* ── Повторители ────────────────────────────────────────── */
  function initRepeaters () {
    document.querySelectorAll('[data-repeater]').forEach(function (repeater) {
      var rows = repeater.querySelector('.repeater-rows')
      var template = repeater.querySelector('[data-repeater-template]')
      var addButton = repeater.querySelector('.repeater-add')
      if (!rows || !template || !addButton) return

      addButton.addEventListener('click', function () {
        // Индексы могут быть разрежены после удалений — берём следующий за максимальным.
        var used = Array.prototype.map.call(
          rows.querySelectorAll('.repeater-row'),
          function (row) { return Number(row.getAttribute('data-index')) || 0 }
        )
        var next = used.length > 0 ? Math.max.apply(null, used) + 1 : 0

        var holder = document.createElement('div')
        holder.innerHTML = template.innerHTML.split('__INDEX__').join(String(next))
        rows.appendChild(holder.firstElementChild)
      })

      rows.addEventListener('click', function (event) {
        var button = event.target.closest('.repeater-remove')
        if (!button) return
        var row = button.closest('.repeater-row')
        if (row) row.remove()
      })
    })
  }

  /* ── Порядок фотографий в альбоме ───────────────────────── */
  function syncGalleryValue () {
    var container = document.getElementById('galleryItems')
    var value = document.getElementById('galleryItemsValue')
    if (!container || !value) return
    value.value = Array.prototype.map.call(
      container.querySelectorAll('.gallery-chip'),
      function (chip) { return chip.getAttribute('data-id') }
    ).join(',')
  }

  function initGalleryItems () {
    var container = document.getElementById('galleryItems')
    if (!container) return

    if (typeof window.Sortable !== 'undefined') {
      window.Sortable.create(container, { animation: 140, onEnd: syncGalleryValue })
    }

    container.addEventListener('click', function (event) {
      var button = event.target.closest('.media-remove')
      if (!button) return
      var chip = button.closest('.gallery-chip')
      if (chip) chip.remove()
      syncGalleryValue()
    })
  }

  /** Картинка попадает в слот поля — и из выбора, и из загрузки. */
  function addToBlockField (field, item) {
    var slots = field.querySelector('.media-slots')
    if (field.getAttribute('data-multiple') !== '1') slots.innerHTML = ''

    var slot = document.createElement('div')
    slot.className = 'media-slot'

    var shot = document.createElement('img')
    shot.src = item.thumb
    shot.alt = ''

    var hidden = document.createElement('input')
    hidden.type = 'hidden'
    hidden.name = 'media[' + field.getAttribute('data-media-field') + '][]'
    hidden.value = String(item.id)

    var drop = document.createElement('button')
    drop.type = 'button'
    drop.className = 'media-remove'
    drop.textContent = '×'

    slot.replaceChildren(shot, hidden, drop)
    slots.appendChild(slot)

    // Подпись «сейчас на сайте стоит такой-то» больше не к месту:
    // у поля появилась своя картинка.
    var inherited = field.querySelector('.media-inherited')
    if (inherited) inherited.remove()
  }

  /* ── Выбор картинок из медиатеки ────────────────────────── */
  function initMediaPicker () {
    var dialog = document.getElementById('mediaPicker')
    var grid = document.getElementById('mediaPickerGrid')
    if (!dialog || !grid) return

    var library = null
    var activeTrigger = null

    /* Список забирается один раз на страницу. Загрузка из панели
       альбома его пополняет, и без сброса в выборе не было бы
       только что отправленных снимков. */
    window.padaliMediaLibraryStale = function () { library = null }

    function renderLibrary () {
      if (library.length === 0) {
        grid.innerHTML = '<p class="hint"></p>'
        grid.firstChild.textContent = dialog.getAttribute('data-empty')
        return
      }
      /* Узлами, а не строкой: имя файла приходит из медиатеки как
         есть, и `a" onerror="…` в нём выполнил бы код прямо в
         админке — с сессией и CSRF-токеном со страницы. */
      grid.innerHTML = ''
      library.forEach(function (item) {
        var button = document.createElement('button')
        button.type = 'button'
        button.className = 'picker-item'
        button.setAttribute('data-id', String(item.id))
        button.setAttribute('data-thumb', item.thumb)
        button.title = item.name

        var shot = document.createElement('img')
        shot.src = item.thumb
        shot.alt = ''
        shot.loading = 'lazy'

        button.appendChild(shot)
        grid.appendChild(button)
      })
    }

    /* Что уже в альбоме — отмечаем в выборе: иначе один и тот же
       снимок жмут повторно, а он просто не добавляется, и это
       выглядит как сломанная кнопка. */
    function markPicked () {
      var panel = activeTrigger && activeTrigger.closest('[data-album-panel]')
      var taken = (panel && panel.albumMediaIds) || []
      var items = grid.querySelectorAll('.picker-item')

      for (var i = 0; i < items.length; i += 1) {
        var picked = taken.indexOf(Number(items[i].getAttribute('data-id'))) !== -1
        items[i].classList.toggle('is-picked', picked)
        items[i].setAttribute('aria-pressed', picked ? 'true' : 'false')
      }
    }

    window.padaliMarkPicked = markPicked

    function open (trigger) {
      activeTrigger = trigger
      dialog.showModal()
      if (library) { renderLibrary(); markPicked(); return }

      grid.textContent = dialog.getAttribute('data-loading')
      fetch('/admin/media.json')
        .then(function (response) { return response.json() })
        .then(function (items) { library = items; renderLibrary(); markPicked() })
        .catch(function () { grid.textContent = dialog.getAttribute('data-failed') })
    }

    function addToGallery (item) {
      var container = document.getElementById('galleryItems')
      if (!container) return
      if (container.querySelector('.gallery-chip[data-id="' + item.id + '"]')) return

      var chip = document.createElement('div')
      chip.className = 'gallery-chip'
      chip.setAttribute('data-id', String(item.id))
      var price = container.getAttribute('data-price-label') || ''

      var shot = document.createElement('img')
      shot.src = item.thumb
      shot.alt = ''
      shot.loading = 'lazy'

      var drop = document.createElement('button')
      drop.type = 'button'
      drop.className = 'media-remove'
      drop.textContent = '×'

      var cost = document.createElement('input')
      cost.type = 'text'
      cost.className = 'chip-price'
      // Буква перед id — соглашение itemKey, см. routes/admin/helpers.js.
      cost.name = 'price[m' + item.id + ']'
      cost.maxLength = 64
      cost.placeholder = price

      chip.replaceChildren(shot, drop, cost)
      container.appendChild(chip)
      syncGalleryValue()
    }

    document.addEventListener('click', function (event) {
      var trigger = event.target.closest('.media-pick')
      if (trigger) { event.preventDefault(); open(trigger); return }

      if (event.target.closest('[data-picker-close]')) { dialog.close(); return }

      var choice = event.target.closest('.picker-item')
      if (choice && activeTrigger) {
        var item = { id: Number(choice.getAttribute('data-id')), thumb: choice.getAttribute('data-thumb') }
        if (activeTrigger.getAttribute('data-target') === 'galleryItems') addToGallery(item)
        else if (activeTrigger.hasAttribute('data-album-pick')) {
          /* Панель альбома сама знает, куда дописывать. Повторный
             клик по уже добавленному убирает его: бездействие
             выглядело бы как сломанная кнопка. */
          var panel = activeTrigger.closest('[data-album-panel]')
          if (panel) {
            var taken = (panel.albumMediaIds || []).indexOf(item.id) !== -1
            if (taken && panel.albumDrop) panel.albumDrop([item.id])
            else if (panel.albumAdd) panel.albumAdd([item.id])
          }
        } else {
          var field = activeTrigger.closest('.media-field')
          if (field) addToBlockField(field, item)
        }
        if (activeTrigger.getAttribute('data-multiple') !== '1') dialog.close()
        return
      }

      var remove = event.target.closest('.media-slot .media-remove')
      if (remove) {
        var slot = remove.closest('.media-slot')
        if (slot) slot.remove()
      }
    })

  }

  /* ── Загрузка картинки прямо из поля формы ────────────────
     Без неё замена логотипа — это уход на страницу медиатеки
     и возврат за файлом в выбор, с потерей незаписанных правок. */
  function initFieldUpload () {
    var strings = document.getElementById('uploadStrings')
    if (!strings) return

    function upload (files, element, onDone) {
      var note = element.querySelector('.media-upload-note')
      var data = new FormData()
      // Токен кладём первым: сервер читает части потоком и
      // проверяет его, как только дойдёт до файла.
      data.append('_csrf', csrfToken(element))
      for (var i = 0; i < files.length; i += 1) data.append('files', files[i])

      if (note) { note.hidden = false; note.textContent = strings.getAttribute('data-uploading') }

      fetch('/admin/media/upload.json', { method: 'POST', body: data })
        .then(function (response) { return response.json() })
        .then(function (result) {
          var items = result.items || []
          items.forEach(onDone)
          if (note) {
            var failed = (result.errors || []).join('; ')
            if (failed) { note.textContent = failed } else { note.hidden = true; note.textContent = '' }
          }
        })
        .catch(function () {
          if (note) { note.hidden = false; note.textContent = strings.getAttribute('data-failed') }
        })
    }

    document.addEventListener('change', function (event) {
      var input = event.target
      if (!input.matches || !input.matches('.media-upload input[type="file"]')) return
      if (input.files.length === 0) return

      var label = input.closest('.media-upload')
      var field = input.closest('.media-field')

      if (field) {
        upload(input.files, field, function (item) { addToBlockField(field, item) })
      } else if (label && label.hasAttribute('data-logo-upload')) {
        upload(input.files, label.closest('[data-logo-field]'), applyLogoChoice)
      }

      // Сбрасываем, иначе повторный выбор того же файла не событие.
      input.value = ''
    })
  }

  /** Новый логотип: добавляем в список настроек и выбираем его. */
  function applyLogoChoice (item) {
    var select = document.getElementById('logo_id')
    var preview = document.getElementById('logoPreview')
    var note = document.getElementById('logoPreviewNote')
    if (!select) return

    var option = select.querySelector('option[value="' + item.id + '"]')
    if (!option) {
      option = document.createElement('option')
      option.value = String(item.id)
      option.textContent = item.name
      option.setAttribute('data-thumb', item.thumb)
      select.appendChild(option)
    }
    select.value = String(item.id)
    if (preview) preview.src = item.thumb
    if (note) note.textContent = item.name

    var box = document.getElementById('logoPreviewBox')
    if (box) box.classList.remove('media-slot--invert')
  }

  /** Превью в настройках следует за выбором в списке. */
  function initLogoPreview () {
    var select = document.getElementById('logo_id')
    var preview = document.getElementById('logoPreview')
    var note = document.getElementById('logoPreviewNote')
    if (!select || !preview) return

    var box = document.getElementById('logoPreviewBox')
    var builtInSrc = box ? box.getAttribute('data-builtin-thumb') : preview.getAttribute('src')
    var builtInNote = box ? box.getAttribute('data-builtin-note') : ''

    select.addEventListener('change', function () {
      var option = select.selectedOptions[0]
      var thumb = option && option.getAttribute('data-thumb')
      preview.src = thumb || builtInSrc
      if (note) note.textContent = thumb ? option.textContent : builtInNote
      // Осветляющий фильтр нужен только встроенному логотипу.
      if (box) box.classList.toggle('media-slot--invert', !thumb)
    })
  }

  /* ── Загрузка: перетаскивание и превью выбранных файлов ───
     Перетаскивание на <label> браузер не обрабатывает — нужны
     собственные обработчики и перенос списка файлов в input.
     Выбранные кадры показываем сразу, чтобы было видно, что ушло
     в форму, и можно было убрать лишнее до отправки. */
  function initUpload () {
    var zone = document.getElementById('uploadDrop')
    var input = document.getElementById('uploadInput')
    var caption = document.getElementById('uploadCaption')
    var previews = document.getElementById('uploadPreviews')
    var note = document.getElementById('uploadNote')
    if (!zone || !input) return

    var ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']
    var chosen = []

    function render () {
      previews.innerHTML = ''
      if (chosen.length === 0) {
        previews.hidden = true
        caption.textContent = zone.getAttribute('data-idle')
        return
      }

      previews.hidden = false
      caption.textContent = fill(zone.getAttribute('data-ready'), { count: chosen.length })

      chosen.forEach(function (file, index) {
        var item = document.createElement('div')
        item.className = 'upload-preview'

        var image = document.createElement('img')
        image.alt = ''
        // Объектный URL освобождаем после загрузки кадра — иначе утечёт.
        var url = URL.createObjectURL(file)
        image.src = url
        image.addEventListener('load', function () { URL.revokeObjectURL(url) })

        var name = document.createElement('span')
        name.className = 'upload-preview-name'
        name.textContent = file.name

        var remove = document.createElement('button')
        remove.type = 'button'
        remove.className = 'media-remove'
        remove.setAttribute('aria-label', zone.getAttribute('data-remove'))
        remove.textContent = '×'
        remove.addEventListener('click', function () {
          chosen.splice(index, 1)
          commit()
        })

        item.append(image, name, remove)
        previews.appendChild(item)
      })
    }

    /** Список файлов переносим обратно в input — отправляется именно он. */
    function commit () {
      var transfer = new DataTransfer()
      chosen.forEach(function (file) { transfer.items.add(file) })
      input.files = transfer.files
      render()
    }

    function accept (files) {
      var rejected = []
      Array.prototype.forEach.call(files, function (file) {
        if (ALLOWED.indexOf(file.type) === -1) { rejected.push(file.name); return }
        var duplicate = chosen.some(function (existing) {
          return existing.name === file.name && existing.size === file.size
        })
        if (!duplicate) chosen.push(file)
      })
      commit()

      // Сообщение строкой в форме, а не окном: модальное окно
      // прерывает перетаскивание и раздражает при пакетной загрузке.
      if (note) {
        note.hidden = rejected.length === 0
        note.textContent = rejected.length === 0
          ? ''
          : fill(zone.getAttribute('data-rejected'), { names: rejected.join(', ') })
      }
    }

    input.addEventListener('change', function () {
      chosen = []
      accept(input.files)
    })

    ;['dragenter', 'dragover'].forEach(function (name) {
      zone.addEventListener(name, function (event) {
        event.preventDefault()
        zone.classList.add('is-over')
        caption.textContent = zone.getAttribute('data-over')
      })
    })

    ;['dragleave', 'dragend'].forEach(function (name) {
      zone.addEventListener(name, function (event) {
        if (name === 'dragleave' && zone.contains(event.relatedTarget)) return
        zone.classList.remove('is-over')
        render()
      })
    })

    zone.addEventListener('drop', function (event) {
      event.preventDefault()
      zone.classList.remove('is-over')
      if (event.dataTransfer && event.dataTransfer.files.length > 0) accept(event.dataTransfer.files)
      else render()
    })

    // Файл, брошенный мимо зоны, иначе откроется вместо страницы.
    ;['dragover', 'drop'].forEach(function (name) {
      window.addEventListener(name, function (event) {
        if (!event.target.closest('#uploadDrop')) event.preventDefault()
      })
    })
  }

  /* ── Карта кликов ─────────────────────────────────────────
     Страница показывается живьём во фрейме размером с настоящий
     экран: если растянуть фрейм на всю высоту документа, единицы
     svh раздуют шапку и страница перестанет быть похожей на то,
     что видят люди. Поэтому фрейм — «окно», а по документу его
     двигает ползунок; пятна смещаются вместе с ним. */
  function initHeatmap () {
    var root = document.getElementById('heatmap')
    var stage = document.getElementById('heatmapStage')
    var frame = document.getElementById('heatmapFrame')
    var canvas = document.getElementById('heatmapCanvas')
    var slider = document.getElementById('heatmapScroll')
    if (!root || !frame || !canvas) return

    var width = Number(root.getAttribute('data-width')) || 1440
    var height = Number(root.getAttribute('data-height')) || 900
    var points = []
    try { points = JSON.parse(root.getAttribute('data-points')) || [] } catch (error) { points = [] }

    var offset = 0
    var radius = Math.max(26, Math.round(width / 28))

    frame.style.width = width + 'px'
    frame.style.height = height + 'px'
    stage.style.width = width + 'px'
    stage.style.height = height + 'px'
    canvas.width = width
    canvas.height = height

    /**
     * Где точка окажется на экране. Клик привязан к блоку: ищем блок
     * во фрейме и отмеряем от его центра по горизонтали и от верха
     * по вертикали. Фрейм уже прокручен на offset, поэтому
     * getBoundingClientRect даёт сразу экранные координаты.
     */
    function place (point, boxes) {
      // Порядок задаёт POINT в routes/admin/analytics.js.
      var xOffset = point[0]
      var yOffset = point[1]
      var box = boxes[point[2]]
      // Нулевой размер — блок на этой ширине скрыт (боковое меню
      // на мониторе). Его точки иначе сбивались бы в левый угол.
      if (!box || box.width === 0) return null
      return { x: box.left + box.width / 2 + xOffset, y: box.top + yOffset }
    }

    function draw () {
      var context = canvas.getContext('2d')
      context.clearRect(0, 0, width, height)
      // Пятна складываются по яркости: скопление светится сильнее.
      context.globalCompositeOperation = 'lighter'

      // Прямоугольники блоков читаем один раз на отрисовку.
      var boxes = {}
      var document_ = frame.contentDocument
      if (document_) {
        document_.querySelectorAll('[data-block]').forEach(function (element) {
          boxes[element.getAttribute('data-block')] = element.getBoundingClientRect()
        })
      }

      points.forEach(function (point) {
        var spot = place(point, boxes)
        if (!spot) return
        if (spot.y < -radius || spot.y > height + radius) return

        var gradient = context.createRadialGradient(spot.x, spot.y, 0, spot.x, spot.y, radius)
        gradient.addColorStop(0, 'rgba(214, 255, 46, 0.5)')
        gradient.addColorStop(0.45, 'rgba(214, 255, 46, 0.2)')
        gradient.addColorStop(1, 'rgba(214, 255, 46, 0)')
        context.fillStyle = gradient
        context.beginPath()
        context.arc(spot.x, spot.y, radius, 0, Math.PI * 2)
        context.fill()
      })
    }

    function scrollTo (value) {
      offset = value
      if (frame.contentWindow) frame.contentWindow.scrollTo(0, offset)
      draw()
    }

    function fit () {
      var document_ = frame.contentDocument
      if (!document_) return

      var documentHeight = Math.max(
        document_.documentElement.scrollHeight,
        document_.body ? document_.body.scrollHeight : 0
      )
      // Ползунок ходит по той части документа, что не влезла в окно,
      // но не меньше самого нижнего клика — иначе до него не добраться.
      var lowestClick = points.reduce(function (max, point) {
        // Вертикаль отмеряется от блока, поэтому самую нижнюю точку
        // ищем через положение блока в документе.
        var host = document_.querySelector('[data-block="' + point[2] + '"]')
        if (!host) return max
        return Math.max(max, host.getBoundingClientRect().top + frame.contentWindow.scrollY + point[1])
      }, 0)
      var reach = Math.max(0, Math.max(documentHeight, lowestClick + radius) - height)

      if (slider) {
        slider.max = String(Math.round(reach))
        slider.disabled = reach === 0
      }
      scrollTo(Math.min(offset, reach))

      // Панель уже страницы — ужимаем целиком, сохраняя пропорции.
      var scale = Math.min(1, root.clientWidth / width)
      stage.style.transform = 'scale(' + scale + ')'
      root.style.height = Math.round(height * scale) + 'px'
    }

    if (slider) {
      slider.addEventListener('input', function () { scrollTo(Number(slider.value)) })
    }

    // Высота документа меняется, пока догружаются шрифты и картинки.
    /**
     * Готовим страницу во фрейме: прячем полосу прокрутки и
     * выключаем плавную прокрутку. У сайта она включена для якорных
     * ссылок, но здесь из-за неё страница ехала уже после отрисовки
     * пятен, и карта оказывалась пустой.
     */
    function prepareFrame () {
      var document_ = frame.contentDocument
      if (!document_ || document_.getElementById('heatmap-style')) return
      var style = document_.createElement('style')
      style.id = 'heatmap-style'
      style.textContent =
        'html { scrollbar-width: none; scroll-behavior: auto !important; }' +
        'html::-webkit-scrollbar { width: 0; height: 0; }'
      document_.head.appendChild(style)

      // Страница может уехать и помимо ползунка — перерисовываем.
      frame.contentWindow.addEventListener('scroll', function () {
        offset = frame.contentWindow.scrollY
        draw()
      }, { passive: true })
    }

    frame.addEventListener('load', function () {
      prepareFrame()
      fit()
      var document_ = frame.contentDocument
      if (document_ && typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(fit).observe(document_.documentElement)
      }
    })
    window.addEventListener('resize', fit)
  }

  /* ── Проверка ролика YouTube ─────────────────────────────
     Редактор вставляет ссылку и должен сразу увидеть, тот ли это
     ролик, а не узнать об опечатке с опубликованного сайта. */
  function initYoutubeField () {
    var fields = document.querySelectorAll('[data-youtube-field]')
    if (fields.length === 0) return

    for (var i = 0; i < fields.length; i += 1) setup(fields[i])

    function setup (field) {
      var input = field.querySelector('input')
      var preview = field.querySelector('[data-youtube-preview]')
      var timer = null
      var request = 0

      /* Очищаем узлами: присваивание innerHTML здесь всегда было
         пустой строкой, но оставляло в коде готовую дыру под
         чужую разметку. */
      function show (state) {
        preview.hidden = false
        preview.setAttribute('data-state', state)
        preview.replaceChildren()
      }

      function message (text, state) {
        preview.hidden = false
        preview.setAttribute('data-state', state)
        preview.textContent = ''
        var line = document.createElement('p')
        line.textContent = text
        preview.appendChild(line)
      }

      function check () {
        var value = input.value.trim()
        if (value === '') { preview.hidden = true; return }

        // Нумеруем запросы: медленный ответ по старой ссылке не
        // должен перебить результат по той, что набрана сейчас.
        request += 1
        var mine = request
        message(field.getAttribute('data-checking'), 'pending')

        fetch('/admin/youtube.json?url=' + encodeURIComponent(value))
          .then(function (response) { return response.json() })
          .then(function (result) {
            if (mine !== request) return
            if (!result.ok) { message(result.message || field.getAttribute('data-failed'), 'error'); return }
            show('ok')
            var image = document.createElement('img')
            image.src = result.thumbnail
            image.alt = ''
            /* Без ленивой загрузки: поле бывает ниже экрана, и
               обложка так и не грузилась бы, пока редактор не
               прокрутит — а он смотрит именно на неё. */
            image.loading = 'eager'
            // Обложку может резать блокировщик — пустой квадрат
            // рядом с названием выглядит как сломанное превью.
            image.addEventListener('error', function () { image.remove() })
            var text = document.createElement('div')
            var title = document.createElement('strong')
            title.textContent = result.title
            var author = document.createElement('span')
            author.textContent = result.author
            text.appendChild(title)
            text.appendChild(author)
            preview.appendChild(image)
            preview.appendChild(text)
          })
          .catch(function () {
            if (mine !== request) return
            message(field.getAttribute('data-failed'), 'error')
          })
      }

      input.addEventListener('input', function () {
        clearTimeout(timer)
        timer = setTimeout(check, 500)
      })
      input.addEventListener('change', function () { clearTimeout(timer); check() })

      if (input.value.trim() !== '') check()
    }
  }

  /* ── Перевод полей ───────────────────────────────────────
     Редактор пишет на том языке, на котором думает, и получает
     обе версии разом. Результат попадает в обычные поля: это
     подсказка, а не истина, и правится руками. */
  function initTranslate () {
    var strings = document.getElementById('translateStrings')
    if (!strings) return

    /* Цели перевода: обычные поля блока зовутся «text[<язык>]…»,
       а названия товаров — иначе, и язык у них помечен атрибутом.
       Поддерживаем оба способа, чтобы не плодить вторую машинку. */
    function targetsOf (field) {
      var found = []
      var inputs = field.querySelectorAll('[name^="text["], [data-locale]')

      for (var i = 0; i < inputs.length; i += 1) {
        var marked = inputs[i].getAttribute('data-locale')
        if (marked) { found.push({ locale: marked, node: inputs[i] }); continue }
        var match = /^text\[([^\]]+)\]/.exec(inputs[i].getAttribute('name') || '')
        if (match) found.push({ locale: match[1], node: inputs[i] })
      }
      return found
    }

    /* Пустое языковое поле заперто: заполняется оно переводом, а
       не руками. Как только значение появилось — обычное поле.
       Запираем только здесь, где строка перевода есть: без ключа
       её не рисуют, и запертая админка осталась бы без выхода.
       Пока редактор правит поле сам, не трогаем: иначе стёртое
       до конца значение заперло бы поле прямо под курсором. */
    function lockEmpty (field) {
      targetsOf(field).forEach(function (target) {
        if (target.node.value.trim() === '') target.node.disabled = true
      })
    }

    var fields = document.querySelectorAll('[data-translate]')
    for (var index = 0; index < fields.length; index += 1) lockEmpty(fields[index])

    /* Карточки товаров и строки повторителя рисуются уже после
       загрузки страницы. Без наблюдателя правило «пустое поле
       заперто» действовало бы только на то, что пришло с сервера:
       в только что добавленной строке языковые поля оставались
       открытыми, и туда писали руками мимо перевода. */
    if (window.MutationObserver) {
      new window.MutationObserver(function (records) {
        for (var r = 0; r < records.length; r += 1) {
          var added = records[r].addedNodes
          for (var a = 0; a < added.length; a += 1) {
            var node = added[a]
            if (node.nodeType !== 1) continue
            if (node.matches('[data-translate]')) lockEmpty(node)
            var nested = node.querySelectorAll('[data-translate]')
            for (var k = 0; k < nested.length; k += 1) lockEmpty(nested[k])
          }
        }
      }).observe(document.body, { childList: true, subtree: true })
    }

    document.addEventListener('input', function (event) {
      var source = event.target
      if (!source.matches || !source.matches('[data-translate-source]')) return
      var field = source.closest('[data-translate]')
      var button = field && field.querySelector('[data-translate-run]')
      if (button) button.hidden = source.value.trim() === ''
    })

    document.addEventListener('click', function (event) {
      var button = event.target.closest('[data-translate-run]')
      if (!button) return

      var field = button.closest('[data-translate]')
      var source = field.querySelector('[data-translate-source]')
      var note = field.querySelector('[data-translate-note]')
      var targets = targetsOf(field)
      var text = source.value.trim()
      if (text === '' || targets.length === 0) return

      button.disabled = true
      button.classList.add('is-busy')
      if (note) { note.hidden = false; note.removeAttribute('data-state'); note.textContent = strings.getAttribute('data-working') }

      /* Перевод не вышел — отпираем поля. Запертые они потому,
         что заполняться должны переводом; раз его нет, остаётся
         руки, и запереть редактора наедине с ошибкой нельзя. */
      function unlock () {
        targets.forEach(function (target) { target.node.disabled = false })
      }

      function fail (message) {
        unlock()
        if (!note) return
        note.hidden = false
        note.setAttribute('data-state', 'error')
        note.textContent = message
      }

      fetch('/admin/translate.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _csrf: csrfToken(button), text: text })
      })
        .then(function (response) { return response.json() })
        .then(function (result) {
          if (!result.ok) {
            fail(result.message || strings.getAttribute('data-failed'))
            return
          }

          var filled = 0
          targets.forEach(function (target) {
            var value = result.translations[target.locale]
            if (typeof value !== 'string') return
            target.node.value = value
            // Значение есть — поле снова обычное.
            target.node.disabled = false
            // Чужой код мог слушать поле — пусть узнает.
            target.node.dispatchEvent(new Event('input', { bubbles: true }))
            filled += 1
          })

          // Язык, который модель пропустила, остаётся пустым —
          // запирать его дальше незачем, заполнять придётся руками.
          unlock()

          if (note) {
            note.textContent = ''
            note.hidden = true
          }
          // Исходник больше не нужен: перевод лежит в полях.
          if (filled > 0) { source.value = ''; button.hidden = true }
        })
        .catch(function () { fail(strings.getAttribute('data-failed')) })
        .finally(function () {
          button.disabled = false
          button.classList.remove('is-busy')
        })
    })
  }

  /* ── Новый альбом не уходя из формы ──────────────────────
     Редактор заполняет блок мерча и обнаруживает, что альбома
     ещё нет. Переход на страницу альбомов терял всё незаписанное,
     поэтому заводим прямо здесь и сразу выбираем. */
  function initAlbumDialog () {
    var dialog = document.getElementById('albumDialog')
    if (!dialog) return

    var slug = document.getElementById('albumSlug')
    var error = document.getElementById('albumError')
    var create = document.getElementById('albumCreate')
    var select = null

    /* Ответ без текста и оборванная сеть выглядят одинаково, и
       показать в этом месте нечего, кроме общей фразы. Раньше
       сюда попадали введённое имя и подсказка поля — редактор
       читал собственный ввод как сообщение об ошибке. */
    function fail (message) {
      error.hidden = false
      error.setAttribute('data-state', 'error')
      error.textContent = message || error.getAttribute('data-failed') || ''
    }

    document.addEventListener('click', function (event) {
      if (event.target.closest('[data-new-album]')) {
        select = event.target.closest('.field').querySelector('select')
        slug.value = ''
        error.hidden = true
        document.getElementById('albumStepName').hidden = false
        document.getElementById('albumStepPhotos').hidden = true
        document.getElementById('albumDialogTitle').textContent = create.textContent.trim()
        dialog.showModal()
        slug.focus()
        return
      }
      if (event.target.closest('[data-album-close]')) {
        dialog.close()
        // В окне могли дослать снимки — полоса под выбором устарела.
        var inline = document.querySelector('.field [data-album-panel]')
        if (inline && inline.albumRefresh) inline.albumRefresh()
      }
    })

    // Enter в поле — то же, что нажать «Создать».
    slug.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); create.click() }
    })

    create.addEventListener('click', function () {
      var value = slug.value.trim()
      if (value === '' || !select) return

      create.disabled = true
      create.classList.add('is-busy')

      fetch('/admin/galleries.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _csrf: csrfToken(select), slug: value })
      })
        .then(function (response) { return response.json() })
        .then(function (result) {
          if (!result.ok) { fail(result.message); return }

          var option = document.createElement('option')
          option.value = String(result.id)
          option.textContent = result.label
          select.appendChild(option)
          select.value = String(result.id)
          select.dispatchEvent(new Event('change', { bubbles: true }))

          /* Альбом создан, но пуст. Закрыть окно значило бы
             отправить редактора искать те же кнопки ниже —
             показываем наполнение прямо здесь. */
          var panel = document.querySelector('#albumStepPhotos [data-album-panel]')
          if (panel) {
            panel.setAttribute('data-album-id', String(result.id))
            panel.albumRefresh()
          }
          document.getElementById('albumStepName').hidden = true
          document.getElementById('albumStepPhotos').hidden = false
          document.getElementById('albumDialogTitle').textContent = result.slug
        })
        .catch(function () { fail('') })
        .finally(function () {
          create.disabled = false
          create.classList.remove('is-busy')
        })
    })
  }

  /* ── Панель альбома: что внутри, загрузка, выбор ─────────
     Одна и та же панель живёт под выбором альбома в форме блока
     и во втором шаге окна создания. Альбом она спрашивает у
     хозяина: в форме это выпадайка, в окне — только что
     созданный. */
  var STRIP_MAX = 48

  function initAlbumPanels () {
    var panels = document.querySelectorAll('[data-album-panel]')
    if (panels.length === 0) return

    var strings = document.getElementById('albumStrings')
    for (var i = 0; i < panels.length; i += 1) setup(panels[i])

    function setup (panel) {
      var strip = panel.querySelector('[data-album-strip]')
      var count = panel.querySelector('[data-album-count]')
      var note = panel.querySelector('[data-album-note]')
      var upload = panel.querySelector('[data-album-upload]')
      var input = upload && upload.querySelector('input[type="file"]')
      var select = panel.closest('.field') && panel.closest('.field').querySelector('select')

      // В окне альбом задаётся снаружи, в форме — выбором в списке.
      panel.albumId = function () {
        return panel.getAttribute('data-album-id') || (select ? select.value : '')
      }

      function say (text, state) {
        if (!note) return
        note.hidden = text === ''
        note.textContent = text
        if (state) note.setAttribute('data-state', state)
        else note.removeAttribute('data-state')
      }

      var withFields = panel.hasAttribute('data-album-fields')
      var locales = (strings.getAttribute('data-locales') || '').split(',').filter(Boolean)

      /* Имя не «input»: так уже называется файловое поле в этой
         же области, и объявление переменной затирало бы функцию. */
      function fieldInput (key, item, locale, placeholder, limit) {
        var node = document.createElement('input')
        node.type = 'text'
        node.className = 'album-card-' + key
        // Ключ с буквой: «item[7]» qs считает индексом массива.
        // Буква перед id — соглашение itemKey, см. routes/admin/helpers.js.
        node.name = 'item[m' + item.id + '][' + key + ']' + (locale ? '[' + locale + ']' : '')
        node.value = (locale ? (item[key] || {})[locale] : item[key]) || ''
        node.placeholder = placeholder || ''
        node.maxLength = limit
        if (locale) node.setAttribute('data-locale', locale)
        return node
      }

      /** Название товара: строка перевода и поле на каждый язык. */
      function titleBox (item) {
        var box = document.createElement('div')
        box.className = 'album-card-title-box'
        box.setAttribute('data-translate', '')

        var row = document.querySelector('[data-translate-template]')
        if (row) box.appendChild(row.content.cloneNode(true))

        locales.forEach(function (locale) {
          var line = document.createElement('label')
          line.className = 'album-card-locale'
          var tag = document.createElement('span')
          tag.textContent = locale.toUpperCase()
          line.appendChild(tag)
          line.appendChild(fieldInput('title', item, locale,
            strings.getAttribute('data-item-title'), 160))
          box.appendChild(line)
        })

        return box
      }

      function render (result) {
        var items = result.items

        /* Подпись пункта в списке — «имя (сколько фото)». После
           дозагрузки она устаревала, и редактор видел старое
           число прямо над свежими снимками. */
        if (select && select.selectedOptions[0] && result.slug) {
          select.selectedOptions[0].textContent = result.slug + ' (' + items.length + ')'
        }

        strip.innerHTML = ''
        // Полоска — напоминание о составе, а не галерея: в альбоме
        // бывает триста снимков, и рисовать их все незачем.
        items.slice(0, STRIP_MAX).forEach(function (item) {
          var shot = document.createElement('img')
          shot.src = item.thumb
          shot.alt = ''
          shot.title = item.name

          var card = document.createElement('div')
          card.className = withFields ? 'album-card' : 'album-card album-card--bare'
          card.setAttribute('data-media', String(item.id))

          /* Крестик нужен ровно для «добавил не ту»: убирает снимок
             из альбома, но не из медиатеки — файл мог попасть и в
             другой блок. */
          var drop = document.createElement('button')
          drop.type = 'button'
          drop.className = 'media-remove'
          drop.setAttribute('data-album-remove', String(item.id))
          drop.textContent = '×'
          drop.title = strings.getAttribute('data-remove') || ''

          card.appendChild(shot)
          card.appendChild(drop)

          /* Название и цена правятся здесь же и уходят с формой
             блока: ради двух строк гонять редактора на страницу
             альбома незачем. Обычной галерее они не нужны. */
          if (withFields) {
            card.appendChild(titleBox(item))
            card.appendChild(fieldInput('price', item, '', strings.getAttribute('data-item-price'), 64))
          }
          strip.appendChild(card)
        })
        count.textContent = items.length === 0
          ? strings.getAttribute('data-empty')
          : fill(strings.getAttribute('data-count'), { count: items.length })

        // Выбор из медиатеки отмечает по этому списку уже добавленные.
        panel.albumMediaIds = items.map(function (item) { return item.id })

        // Отметка «карточки нарисованы для этого альбома».
        var stamp = panel.querySelector('[data-album-stamp]')
        if (stamp) stamp.value = String(result.id)
        if (window.padaliMarkPicked) window.padaliMarkPicked()
      }

      function refresh () {
        var id = panel.albumId()
        var stamp = panel.querySelector('[data-album-stamp]')
        // Пока состав не пришёл, отметки нет: сохранение в этот
        // промежуток не должно записать строки прошлого альбома.
        if (stamp) stamp.value = ''
        if (!id) { panel.hidden = true; return }
        panel.hidden = false

        fetch('/admin/galleries/' + encodeURIComponent(id) + '/items.json')
          .then(function (response) { return response.json() })
          .then(function (result) { if (result.ok) render(result) })
          // Ошибку видно в консоли: молчаливый catch однажды
          // спрятал опечатку в имени, и полоса просто пустовала.
          .catch(function (error) { console.error('Состав альбома:', error) })
      }

      panel.albumRefresh = refresh

      /** Привязать уже загруженные картинки к альбому. */
      panel.albumAdd = function (mediaIds) {
        var id = panel.albumId()
        if (!id || mediaIds.length === 0) return Promise.resolve()

        return fetch('/admin/galleries/' + encodeURIComponent(id) + '/items.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ _csrf: csrfToken(panel), media: mediaIds })
        })
          .then(function (response) { return response.json() })
          .then(function (result) {
            if (!result.ok) throw new Error('reject')
            say('')
            refresh()
          })
          .catch(function () { say(strings.getAttribute('data-failed'), 'error') })
      }

      /** Убрать снимки из альбома; файлы остаются в медиатеке. */
      panel.albumDrop = function (mediaIds) {
        var id = panel.albumId()
        if (!id || mediaIds.length === 0) return Promise.resolve()

        return fetch('/admin/galleries/' + encodeURIComponent(id) + '/items/remove.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ _csrf: csrfToken(panel), media: mediaIds })
        })
          .then(function (response) { return response.json() })
          .then(function (result) {
            if (!result.ok) throw new Error('reject')
            say('')
            refresh()
          })
          .catch(function () { say(strings.getAttribute('data-failed'), 'error') })
      }

      strip.addEventListener('click', function (event) {
        var drop = event.target.closest('[data-album-remove]')
        if (!drop) return
        drop.disabled = true
        panel.albumDrop([Number(drop.getAttribute('data-album-remove'))])
      })

      if (select) select.addEventListener('change', refresh)
      refresh()

      if (!input) return
      input.addEventListener('change', function () {
        if (input.files.length === 0 || !panel.albumId()) return

        var data = new FormData()
        data.append('_csrf', csrfToken(panel))
        for (var k = 0; k < input.files.length; k += 1) data.append('files', input.files[k])
        input.value = ''

        say(strings.getAttribute('data-uploading'))
        upload.classList.add('is-busy')

        fetch('/admin/media/upload.json', { method: 'POST', body: data })
          .then(function (response) { return response.json() })
          .then(function (result) {
            var ids = (result.items || []).map(function (item) { return item.id })
            if (ids.length === 0) throw new Error('empty')
            // Медиатека пополнилась — список в выборе устарел.
            if (window.padaliMediaLibraryStale) window.padaliMediaLibraryStale()
            return panel.albumAdd(ids)
          })
          .catch(function () { say(strings.getAttribute('data-failed'), 'error') })
          .finally(function () { upload.classList.remove('is-busy') })
      })
    }
  }

  initBlockOrder()
  initRepeaters()
  initGalleryItems()
  initMediaPicker()
  initUpload()
  initFieldUpload()
  initLogoPreview()
  initYoutubeField()
  initTranslate()
  initAlbumDialog()
  initAlbumPanels()
  initHeatmap()
})()
