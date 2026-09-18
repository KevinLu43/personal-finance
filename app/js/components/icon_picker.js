// One curated emoji set, one picker component, shared by categories,
// accounts, and labels — a raw text input asked the reader to already know
// their OS has an emoji keyboard, which most people typing into a plain
// text box never discover. Tapping a tile needs no such knowledge.
//
// Grouped rather than one flat wall, so growing the set stays scannable —
// the reader can jump straight to "交通" instead of scanning every icon in
// the picker to find a car.
const ICON_GROUPS = [
  { label: '飲食', icons: ['🍚', '🍔', '🍕', '🍜', '🍱', '🍣', '🍞', '🥗', '🍎', '🍰', '☕', '🍺', '🍷', '🥤', '🍳'] },
  { label: '交通', icons: ['🚗', '🚕', '🚌', '🚇', '🚆', '🚲', '🛵', '🛴', '⛽', '🅿️', '🚦', '✈️', '🚢', '🚀'] },
  { label: '居住', icons: ['🏠', '🏢', '🏬', '🔑', '🛋️', '🛏️', '🚿', '🧹', '🪴', '💡', '🔌', '🧯', '🧺', '🪑'] },
  { label: '購物 / 服飾', icons: ['👕', '👗', '👟', '👜', '💍', '🛍️', '🛒', '🎁', '👓', '⌚', '🧢', '👒', '🧦', '🧳'] },
  { label: '健康', icons: ['💊', '🏥', '🩺', '🦷', '💉', '🧴', '🧠', '🩹', '🧬', '🚑', '😷'] },
  { label: '運動 / 戶外', icons: ['🏋️', '🧘', '🚴', '⚽', '🏀', '🎾', '🏊', '🏕️', '⛺', '🗻', '🏖️'] },
  { label: '娛樂', icons: ['🎮', '🎬', '🎵', '🎨', '🎤', '🎭', '🎳', '🎯', '📷', '🎡', '🎪', '🎲', '🃏'] },
  { label: '學習 / 工作', icons: ['📚', '🎓', '✏️', '💻', '🖥️', '🖨️', '📎', '📁', '🗂️', '📅', '🧮', '🧑‍💻', '💼'] },
  { label: '理財', icons: ['💰', '🏦', '💳', '🪙', '📈', '📉', '📊', '🧾', '💵', '💴', '💶', '💷', '🏧'] },
  { label: '家庭 / 寵物', icons: ['🐾', '🐶', '🐱', '🐟', '👨‍👩‍👧', '👶', '🍼', '🧸', '🎂', '🎀'] },
  { label: '通訊 / 雜項', icons: ['📱', '🔁', '⭐', '📌', '🚩', '❤️', '👤', '🛡️', '☂️', '🔧', '🏷️', '🔥', '🌱', '❔'] },
];

const IconPickerField = {
  props: {
    modelValue: { type: String, default: '' },
  },
  emits: ['update:modelValue'],
  data() {
    return { groups: ICON_GROUPS };
  },
  template: `
    <div class="icon-picker">
      <div v-for="group in groups" :key="group.label" class="icon-picker-group">
        <div class="icon-picker-group-label">{{ group.label }}</div>
        <div class="icon-picker-row">
          <button
            type="button"
            v-for="icon in group.icons" :key="icon"
            class="icon-option" :class="{ selected: modelValue === icon }"
            @click="$emit('update:modelValue', icon)"
          >{{ icon }}</button>
        </div>
      </div>
    </div>
  `,
};
