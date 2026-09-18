// An amount field that accepts typing directly (a physical/on-screen system
// keyboard both work — nothing here is readonly) and also offers a tap-able
// calculator pad next to it for "120+35"-style entry, useful for splitting a
// bill or adding a tip without doing the math first. Both write into the
// same text, so switching between typing and tapping mid-entry just works.
const CALC_OPERATORS = ['+', '-', '×', '÷'];

const CalculatorField = {
  props: {
    modelValue: { type: [String, Number], default: '' },
  },
  emits: ['update:modelValue'],
  data() {
    return {
      open: false,
      text: this.modelValue != null && this.modelValue !== '' ? String(this.modelValue) : '',
    };
  },
  watch: {
    // commit() sets `text` itself before emitting, so the prop change that
    // echoes back here already matches — this only fires text-vs-prop drift
    // an external reset actually caused.
    modelValue(v) {
      const next = v != null && v !== '' ? String(v) : '';
      if (next !== this.text) this.text = next;
    },
  },
  methods: {
    openPad() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
    press(token) {
      const isOp = CALC_OPERATORS.includes(token);
      if (isOp) {
        if (this.text === '') return; // no leading operator
        const last = this.text.slice(-1);
        if (CALC_OPERATORS.includes(last)) {
          this.text = this.text.slice(0, -1) + token; // replace, don't stack
          return;
        }
        this.text += token;
        return;
      }
      if (token === '.') {
        const segment = this.text.split(/[+\-×÷]/).pop();
        if (segment.includes('.')) return; // one decimal point per number
      }
      this.text += token;
    },
    backspace() {
      this.text = this.text.slice(0, -1);
    },
    clearAll() {
      this.text = '';
    },
    // Evaluates whatever is currently typed and emits it — shared by typing
    // Enter/blur and tapping 確定 on the pad, so either path commits the
    // same way.
    commit() {
      if (this.text === '') {
        this.$emit('update:modelValue', '');
        return;
      }
      const value = Models.evaluateExpression(this.text);
      if (value === null || Number.isNaN(value)) return; // leave text as-is, let them keep fixing it
      const rounded = Math.round(value * 100) / 100;
      this.text = String(rounded);
      this.$emit('update:modelValue', rounded);
    },
    confirmFromPad() {
      this.commit();
      this.open = false;
    },
    onKeydown(e) {
      if (e.key === 'Enter') this.commit();
    },
  },
  template: `
    <div class="calc-field">
      <div class="calc-input-row">
        <input
          type="text" inputmode="decimal" class="calc-display"
          v-model="text" placeholder="0"
          @keydown="onKeydown" @blur="commit"
        />
        <button type="button" class="calc-open-btn" @click="openPad" aria-label="開啟計算機">🧮</button>
      </div>
      <div v-if="open" class="modal-backdrop" @click.self="confirmFromPad">
        <div class="modal calc-modal">
          <div class="calc-expression">{{ text || '0' }}</div>
          <div class="calc-grid">
            <button type="button" @click="press('7')">7</button>
            <button type="button" @click="press('8')">8</button>
            <button type="button" @click="press('9')">9</button>
            <button type="button" class="calc-op" @click="press('÷')">÷</button>
            <button type="button" @click="press('4')">4</button>
            <button type="button" @click="press('5')">5</button>
            <button type="button" @click="press('6')">6</button>
            <button type="button" class="calc-op" @click="press('×')">×</button>
            <button type="button" @click="press('1')">1</button>
            <button type="button" @click="press('2')">2</button>
            <button type="button" @click="press('3')">3</button>
            <button type="button" class="calc-op" @click="press('-')">−</button>
            <button type="button" @click="press('0')">0</button>
            <button type="button" @click="press('.')">.</button>
            <button type="button" @click="clearAll">C</button>
            <button type="button" class="calc-op" @click="press('+')">+</button>
          </div>
          <div class="modal-actions with-delete">
            <button type="button" @click="backspace">⌫</button>
            <div class="modal-actions-right">
              <button type="button" @click="close">取消</button>
              <button type="button" class="primary" @click="confirmFromPad">確定</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
};
