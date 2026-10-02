// The colour field for categories, labels and accounts: a row of swatches
// from Models.CHART_PALETTE (chosen to stay apart from each other on a
// donut), a 自訂 swatch for any other colour, and a note naming whichever
// sibling already wears a colour too close to tell apart, with the swatches
// that would not be (one tap to switch). The note only warns — the operator
// may still keep the colour. A caller whose colour never meets a sibling's on
// a chart (labels, most accounts) passes no `others`, and nothing is checked.
const ColorPickerField = {
  props: {
    modelValue: { type: String, default: '' },
    // The siblings this colour will sit beside on a chart: [{ name, color }].
    others: { type: Array, default: () => [] },
  },
  emits: ['update:modelValue'],
  computed: {
    palette() {
      return Models.CHART_PALETTE;
    },
    isCustom() {
      const v = (this.modelValue || '').toLowerCase();
      return !this.palette.some((c) => c.color === v);
    },
    // Swatches another sibling already wears, marked so an unused one is easy to spot.
    usedColors() {
      return new Set(this.others.map((o) => (o.color || '').toLowerCase()));
    },
    tooClose() {
      if (!this.modelValue) return [];
      return this.others.filter((o) => o.color && Models.colorsTooClose(o.color, this.modelValue)).map((o) => o.name);
    },
    suggestions() {
      return Models.suggestColors(this.others.map((o) => o.color)).slice(0, 4);
    },
  },
  methods: {
    pick(color) {
      this.$emit('update:modelValue', color);
    },
  },
  template: `
    <div class="color-picker">
      <div class="color-picker-row">
        <button
          type="button"
          v-for="c in palette" :key="c.color"
          class="color-swatch" :class="{ selected: modelValue && modelValue.toLowerCase() === c.color, used: usedColors.has(c.color) }"
          :style="{ background: c.color }" :title="c.name + (usedColors.has(c.color) ? '(已使用)' : '')"
          @click="pick(c.color)"
        ></button>
        <label class="color-swatch custom" :class="{ selected: isCustom }" :style="isCustom ? { background: modelValue } : {}" title="自訂">
          <span v-if="!isCustom">自訂</span>
          <input type="color" :value="modelValue" @input="pick($event.target.value)" />
        </label>
      </div>
      <div v-if="tooClose.length" class="color-picker-warning">
        跟「{{ tooClose.join('、') }}」的顏色很接近,圖表上可能不好分辨
        <div class="color-picker-suggest">
          <template v-if="suggestions.length">
            建議改用:
            <button type="button" v-for="c in suggestions" :key="c.color" class="color-suggest" @click="pick(c.color)">
              <span class="color-suggest-dot" :style="{ background: c.color }"></span>{{ c.name }}
            </button>
          </template>
          <template v-else>色票都已被相近的顏色用掉了,可以用「自訂」挑其他顏色,或到「分類」頁按「重新配色」。</template>
        </div>
      </div>
    </div>
  `,
};
