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

  /* ── Подтверждение удаления ─────────────────────────────── */
  document.addEventListener('submit', function (event) {
    var message = event.target.getAttribute('data-confirm')
    if (message && !window.confirm(message)) event.preventDefault()
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
          body: JSON.stringify({ order: order, _csrf: list.getAttribute('data-csrf') })
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
    slot.innerHTML =
      '<img src="' + item.thumb + '" alt="">' +
      '<input type="hidden" name="media[' + field.getAttribute('data-media-field') + '][]" value="' + item.id + '">' +
      '<button type="button" class="media-remove">×</button>'
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

    function renderLibrary () {
      if (library.length === 0) {
        grid.innerHTML = '<p class="hint"></p>'
        grid.firstChild.textContent = dialog.getAttribute('data-empty')
        return
      }
      grid.innerHTML = library.map(function (item) {
        return '<button type="button" class="picker-item" data-id="' + item.id +
               '" data-thumb="' + item.thumb + '" title="' + item.name + '">' +
               '<img src="' + item.thumb + '" alt="" loading="lazy"></button>'
      }).join('')
    }

    function open (trigger) {
      activeTrigger = trigger
      dialog.showModal()
      if (library) { renderLibrary(); return }

      grid.textContent = dialog.getAttribute('data-loading')
      fetch('/admin/media.json')
        .then(function (response) { return response.json() })
        .then(function (items) { library = items; renderLibrary() })
        .catch(function () { grid.textContent = dialog.getAttribute('data-failed') })
    }

    function addToGallery (item) {
      var container = document.getElementById('galleryItems')
      if (!container) return
      if (container.querySelector('.gallery-chip[data-id="' + item.id + '"]')) return

      var chip = document.createElement('div')
      chip.className = 'gallery-chip'
      chip.setAttribute('data-id', String(item.id))
      chip.innerHTML =
        '<img src="' + item.thumb + '" alt="" loading="lazy">' +
        '<button type="button" class="media-remove">×</button>'
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
        else {
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

    function csrfOf (element) {
      var form = element.closest('form')
      var field = form && form.querySelector('input[name="_csrf"]')
      return field ? field.value : ''
    }

    function upload (files, element, onDone) {
      var note = element.querySelector('.media-upload-note')
      var data = new FormData()
      // Токен кладём первым: сервер читает части потоком и
      // проверяет его, как только дойдёт до файла.
      data.append('_csrf', csrfOf(element))
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
      var box = boxes[point[2]]
      if (!box) return null
      return { x: box.left + box.width / 2 + point[0], y: box.top + point[1] }
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

  initBlockOrder()
  initRepeaters()
  initGalleryItems()
  initMediaPicker()
  initUpload()
  initFieldUpload()
  initLogoPreview()
  initHeatmap()
})()
