const ICONS = [
  'instagram', 'tiktok', 'youtube', 'spotify', 'apple-music',
  'youtube-music', 'deezer', 'bandcamp', 'soundcloud', 'vk', 'telegram'
]

export default {
  type: 'links',
  title: 'Ссылки',
  description: 'Список площадок и соцсетей крупными строками.',

  texts: [
    { key: 'heading', label: 'Заголовок раздела', input: 'text' }
  ],

  media: [],

  settings: [
    {
      key: 'items',
      label: 'Ссылки',
      input: 'repeater',
      addLabel: 'Добавить ссылку',
      fields: [
        { key: 'icon',   label: 'Иконка',   input: 'select', options: ICONS },
        { key: 'label',  label: 'Название', input: 'text' },
        { key: 'handle', label: 'Подпись справа', input: 'text' },
        { key: 'url',    label: 'Ссылка',   input: 'url' }
      ],
      default: []
    }
  ],

  template: 'blocks/links'
}
