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
    // Best match first: the exact code, then codes that start with the
    // query, then names that start with it, then names that merely contain
    // it. Ties keep directory order, and the directory lists the curated
    // ETFs/popular names before the full exchange lists — so with thousands
    // of tickers loaded, "2330" or "AAPL" still surface at the top.
    matches() {
      const q = this.query.trim();
      if (!q) return [];
      const qUpper = q.toUpperCase();
      const qLower = q.toLowerCase();
      const scored = [];
      (TickerDirectory[this.market] || []).forEach((t, index) => {
        const code = t.code.toUpperCase();
        const name = t.name.toLowerCase();
        let score;
        if (code === qUpper) score = 0;
        else if (code.startsWith(qUpper)) score = 1;
        else if (name.startsWith(qLower)) score = 2;
        else if (name.includes(qLower)) score = 3;
        else return;
        scored.push({ t, score, index });
      });
      return scored
        .sort((a, b) => a.score - b.score || a.index - b.index)
        .slice(0, 8)
        .map((s) => s.t);
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
