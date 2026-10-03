export default {
  type: 'concert',
  title: 'Концерт',
  description: 'Афиша, дата, площадка и ссылка на билеты.',

  texts: [
    { key: 'heading', label: 'Заголовок раздела', input: 'text' },
    { key: 'venue',   label: 'Площадка',          input: 'text' },
    { key: 'note',    label: 'Примечание',        input: 'textarea', rows: 2 },
    { key: 'tag',     label: 'Тег',               input: 'text' },
    { key: 'ticket_label', label: 'Подпись кнопки билетов', input: 'text' }
  ],

  media: [
    { key: 'poster', label: 'Афиша' }
  ],

  settings: [
    { key: 'date',       label: 'Дата концерта',   input: 'date' },
    { key: 'ticket_url', label: 'Ссылка на билеты', input: 'url' }
  ],

  template: 'blocks/concert'
}
