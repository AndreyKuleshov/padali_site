const PLATFORMS = [
  'spotify', 'apple-music', 'youtube-music', 'deezer',
  'youtube', 'tiktok', 'bandcamp', 'soundcloud', 'vk'
]

export default {
  type: 'release',
  title: 'Релиз',
  description: 'Обложка, дата выхода, обратный отсчёт и ссылки на платформы.',

  texts: [
    { key: 'eyebrow', label: 'Бейдж',      input: 'text' },
    { key: 'title',   label: 'Название',   input: 'text' },
    { key: 'note',    label: 'Примечание', input: 'textarea', rows: 2 },
    { key: 'more_label', label: 'Подпись «ещё»', input: 'text' },
    {
      key: 'countdown_label',
      label: 'Подпись обратного отсчёта',
      input: 'text',
      hint: '{days} подставится числом дней, например: {days} дней до выхода'
    }
  ],

  media: [
    { key: 'cover',   label: 'Обложка',                required: true },
    { key: 'sticker', label: 'Наклейка поверх обложки' }
  ],

  settings: [
    { key: 'release_date',   label: 'Дата релиза',          input: 'date' },
    { key: 'show_countdown', label: 'Показывать обратный отсчёт', input: 'checkbox', default: true },
    {
      key: 'platforms',
      label: 'Платформы',
      input: 'repeater',
      addLabel: 'Добавить платформу',
      fields: [
        { key: 'icon',  label: 'Иконка',  input: 'select', options: PLATFORMS },
        // Названия платформ — торговые марки, не переводятся.
        { key: 'label', label: 'Подпись', input: 'text' },
        { key: 'url',   label: 'Ссылка',  input: 'url' }
      ],
      default: []
    }
  ],

  template: 'blocks/release'
}
