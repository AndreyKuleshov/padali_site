/* PADALI — админка. Минимум поведения: подтверждения, порядок, повторители,
   выбор картинок из медиатеки. Ни одного фреймворка. */
(function () {
  'use strict'

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
      handle: '.drag-handle',
      animation: 140,
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
          if (!response.ok) window.alert('Не удалось сохранить порядок. Обновите страницу.')
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

        var html = template.innerHTML.split('__INDEX__').join(String(next))
        var holder = document.createElement('div')
        holder.innerHTML = html
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

  /* ── Выбор картинок из медиатеки ────────────────────────── */
  function initMediaPicker () {
    var dialog = document.getElementById('mediaPicker')
    var grid = document.getElementById('mediaPickerGrid')
    if (!dialog || !grid) return

    var library = null
    var activeTrigger = null

    function renderLibrary () {
      if (library.length === 0) {
        grid.innerHTML = '<p class="hint">Медиатека пуста. Сначала загрузите файлы.</p>'
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

      grid.textContent = 'Загружаю…'
      fetch('/admin/media.json')
        .then(function (response) { return response.json() })
        .then(function (items) { library = items; renderLibrary() })
        .catch(function () { grid.textContent = 'Не удалось загрузить медиатеку.' })
    }

    function addToBlockField (field, item) {
      var slots = field.querySelector('.media-slots')
      var multiple = field.getAttribute('data-multiple') === '1'
      if (!multiple) slots.innerHTML = ''

      var slot = document.createElement('div')
      slot.className = 'media-slot'
      slot.innerHTML =
        '<img src="' + item.thumb + '" alt="">' +
        '<input type="hidden" name="media[' + field.getAttribute('data-media-field') + '][]" value="' + item.id + '">' +
        '<button type="button" class="media-remove" aria-label="Убрать">×</button>'
      slots.appendChild(slot)
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
        '<button type="button" class="media-remove" aria-label="Убрать">×</button>'
      container.appendChild(chip)
      syncGalleryValue()
    }

    document.addEventListener('click', function (event) {
      var trigger = event.target.closest('.media-pick')
      if (trigger) { event.preventDefault(); open(trigger); return }

      var close = event.target.closest('[data-picker-close]')
      if (close) { dialog.close(); return }

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

  /* ── Имя выбранного файла в форме загрузки ──────────────── */
  function initUploadLabel () {
    var input = document.querySelector('.upload-drop input[type="file"]')
    if (!input) return
    var caption = input.nextElementSibling
    var original = caption ? caption.textContent : ''

    input.addEventListener('change', function () {
      if (!caption) return
      caption.textContent = input.files.length > 0
        ? 'Выбрано файлов: ' + input.files.length
        : original
    })
  }

  initBlockOrder()
  initRepeaters()
  initGalleryItems()
  initMediaPicker()
  initUploadLabel()
})()
