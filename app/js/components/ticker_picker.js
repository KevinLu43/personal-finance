// Autocomplete over TICKER_DIRECTORY for the buy-side ticker field. Plain
// <input list> (datalist) would have been zero-JS, but iOS Safari doesn't
// reliably show datalist suggestions at all — this app's primary device —
// so the suggestion list is hand-rolled instead. The field stays a normal
// free-text input underneath: a ticker outside the curated directory still
// types and saves exactly as before, this only adds suggestions on top.
const TickerPickerField = {
  props: {
    modelValue: { type: String, default: '' },
    market: { type: String, required: true }, // 'TW' | 'US'
  },
  emits: ['update:modelValue'],
  data() {
    return { query: this.modelValue || '', focused: false };
  },
  watch: {
    modelValue(v) {
      if (v !== this.query) this.query = v || '';
    },
  },
  computed: {
    matches() {
      const q = this.query.trim();
      if (!q) return [];
      const qUpper = q.toUpperCase();
      const list = TickerDirectory[this.market] || [];
      return list
        .filter((t) => t.code.toUpperCase().startsWith(qUpper) || t.name.includes(q))
        .slice(0, 8);
    },
  },
  methods: {
    onInput(e) {
      this.query = e.target.value;
      this.$emit('update:modelValue', this.query.toUpperCase());
    },
    pick(t) {
      this.query = t.code;
      this.$emit('update:modelValue', t.code);
      this.focused = false;
    },
  },
  template: `
    <div class="ticker-picker">
      <input
        v-model="query" @input="onInput"
        @focus="focused = true" @blur="focused = false"
        placeholder="輸入代號或名稱，例如：00919 / NVDA / 台積"
      />
      <div v-if="focused && matches.length" class="ticker-suggestions">
        <div
          v-for="t in matches" :key="t.code" class="ticker-suggestion"
          @mousedown.prevent="pick(t)"
        >
          <span class="ticker-suggestion-code">{{ t.code }}</span>
          <span class="ticker-suggestion-name">{{ t.name }}</span>
        </div>
      </div>
    </div>
  `,
};
