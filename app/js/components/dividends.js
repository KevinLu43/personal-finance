// Cash-dividend entry. A dividend is stored as an ordinary income transaction
// (category 股利／配息, booked on the account that received the money) that
// also carries a `dividend` block naming the holding it belongs to — so it
// flows into balances, income totals, trends and backups with no special
// cases, while 投資總覽 can still add it up per holding.
//
// Opened from the 投資 tab, from a holding in 投資總覽, and — through
// TransactionFormModal — from any list where the dividend shows up as an
// income row, so editing one never goes through the generic form (which
// would let the amount drift away from per-share x shares).

// One dividend in a list — laid out like InvestmentRowItem (icon, ticker and
// company, a sub-line, the amount, and ✕ to delete) so a dividend among trades
// reads and behaves the same way. `dividend` is the income transaction.
const DividendRowItem = {
  props: {
    dividend: { type: Object, required: true },
    // Lists spanning many dates (a holding's whole history) spell the date out.
    showDate: { type: Boolean, default: false },
  },
  emits: ['edit', 'remove'],
  computed: {
    detail() {
      return this.dividend.dividend;
    },
    companyName() {
      return window.tickerName(this.detail.market, this.detail.ticker);
    },
    accountName() {
      const a = Store.state.accounts.find((x) => x.id === this.dividend.accountId);
      return a ? a.name : '(已刪除帳戶)';
    },
    currency() {
      return Store.currencyOfAccount(this.dividend.accountId);
    },
    nativeAmountText() {
      const symbol = this.currency === 'TWD' ? '' : Models.currencySymbol(this.currency);
      return symbol + Models.formatMoney(this.dividend.amount, this.currency);
    },
    baseAmountText() {
      if (this.currency === 'TWD') return '';
      return '≈ NT$ ' + Math.round(Store.baseAmountOf(this.dividend)).toLocaleString('zh-TW');
    },
  },
  template: `
    <div class="list-row clickable" @click="$emit('edit', dividend)">
      <div class="list-row-main">
        <span class="bar-icon">🪙</span>
        <span class="list-row-title">{{ detail.ticker }}</span>
        <span v-if="companyName" class="ticker-name">{{ companyName }}</span>
        <div class="list-row-sub">
          <template v-if="showDate">{{ dividend.date }} · </template>配息 · 每股 {{ detail.perShare }} × {{ detail.shares }} 股 · {{ accountName }}
        </div>
      </div>
      <div class="list-row-amount positive">
        +{{ nativeAmountText }}
        <div v-if="baseAmountText" class="list-row-sub">{{ baseAmountText }}</div>
      </div>
      <button class="row-delete" @click.stop="$emit('remove', dividend)" aria-label="刪除">✕</button>
    </div>
  `,
};

const DividendFormModal = {
  props: {
    editingId: { type: String, required: true }, // 'new' or the dividend transaction's id
    defaultDate: { type: String, default: null },
    presetAccountId: { type: String, default: null }, // start on this holding's account...
    presetTicker: { type: String, default: null }, // ...and this ticker
  },
  emits: ['close'],
  data() {
    const isNew = this.editingId === 'new';
    return {
      form: this.buildForm(),
      // Editing starts "touched": opening an old dividend to fix a typo must
      // not recompute (and overwrite) what was actually paid out.
      sharesTouched: !isNew,
      perShareTouched: !isNew,
      grossTouched: !isNew,
    };
  },
  created() {
    if (this.isNew) this.applyDefaults();
  },
  computed: {
    isNew() {
      return this.editingId === 'new';
    },
    brokerageAccounts() {
      return Store.state.accounts.filter((a) => a.kind === 'brokerage' && (!a.isArchived || a.id === this.form.holdingAccountId));
    },
    holdingAccount() {
      return Store.state.accounts.find((a) => a.id === this.form.holdingAccountId) || null;
    },
    market() {
      return this.holdingAccount ? this.holdingAccount.market : 'TW';
    },
    currency() {
      return Models.marketCurrency(this.market);
    },
    symbol() {
      return this.currency === 'TWD' ? '' : Models.currencySymbol(this.currency);
    },
    // What this account has ever held — including what has since been sold,
    // since a dividend can still be entered for it afterwards.
    holdingOptions() {
      return Models.holdingsSummary(Store.state.investments)
        .filter((h) => h.accountId === this.form.holdingAccountId)
        .map((h) => ({ ticker: h.ticker, quantity: h.quantity }));
    },
    // Where the money landed: any account in the holding's currency, so a
    // dividend never quietly mixes currencies in one balance. The holding's
    // own settlement account comes first.
    receiveAccounts() {
      const list = Store.state.accounts.filter(
        (a) => a.kind !== 'loan' && Store.currencyOfAccount(a.id) === this.currency && (!a.isArchived || a.id === this.form.receiveAccountId)
      );
      return list.sort((a, b) => (a.id === this.form.holdingAccountId ? -1 : b.id === this.form.holdingAccountId ? 1 : a.sortOrder - b.sortOrder));
    },
    holdingRef() {
      return { accountId: this.form.holdingAccountId, market: this.market, ticker: this.form.ticker };
    },
    heldOnDate() {
      if (!this.form.ticker) return 0;
      return Models.quantityHeldOn(Store.state.investments, this.holdingRef, this.form.date);
    },
    // The previous dividend of this holding (not counting the one being
    // edited): ETFs pay a similar amount each time, so it's a good default.
    lastDividend() {
      const key = `${this.form.holdingAccountId}:${this.market}:${this.form.ticker}`;
      const entry = Models.dividendsByHolding(Store.state.transactions, Models.localToday()).get(key);
      if (!entry) return null;
      return entry.items.find((t) => t.id !== this.editingId) || null;
    },
    net() {
      return (Number(this.form.gross) || 0) - (Number(this.form.deduction) || 0);
    },
  },
  watch: {
    'form.holdingAccountId'() {
      if (!this.holdingOptions.some((o) => o.ticker === this.form.ticker)) {
        this.form.ticker = this.holdingOptions.length ? this.holdingOptions[0].ticker : '';
      }
      // A different holding account usually means a different settlement
      // account for the cash too, unless the old choice still fits.
      if (!this.receiveAccounts.some((a) => a.id === this.form.receiveAccountId)) {
        this.form.receiveAccountId = this.form.holdingAccountId;
      }
      this.applyDefaults();
    },
    'form.ticker'() {
      this.applyDefaults();
    },
    'form.date'() {
      this.applyDefaults();
    },
    'form.perShare'() {
      this.recalcGross();
    },
    'form.shares'() {
      this.recalcGross();
    },
  },
  methods: {
    buildForm() {
      if (this.editingId !== 'new') {
        const t = Store.state.transactions.find((x) => x.id === this.editingId);
        if (t && t.dividend) {
          return {
            date: t.date,
            holdingAccountId: t.dividend.accountId,
            ticker: t.dividend.ticker,
            perShare: t.dividend.perShare,
            shares: t.dividend.shares,
            gross: t.dividend.gross,
            deduction: t.dividend.deduction || 0,
            receiveAccountId: t.accountId,
          };
        }
      }
      const candidates = Store.state.accounts.filter((a) => a.kind === 'brokerage' && !a.isArchived);
      const account =
        candidates.find((a) => a.id === this.presetAccountId) || candidates.find((a) => a.isDefault) || candidates[0] || null;
      const options = account
        ? Models.holdingsSummary(Store.state.investments).filter((h) => h.accountId === account.id)
        : [];
      const ticker = options.some((h) => h.ticker === this.presetTicker) ? this.presetTicker : options.length ? options[0].ticker : '';
      return {
        date: this.defaultDate || Models.localToday(),
        holdingAccountId: account ? account.id : '',
        ticker,
        perShare: '',
        shares: '',
        gross: '',
        deduction: 0,
        receiveAccountId: account ? account.id : '',
      };
    },
    // Shares default to what was held on the payment date, and the per-share
    // amount to the last one paid — both only until the operator edits them.
    applyDefaults() {
      if (!this.sharesTouched) this.form.shares = this.heldOnDate || '';
      if (!this.perShareTouched) this.form.perShare = this.lastDividend ? this.lastDividend.dividend.perShare : '';
      this.recalcGross();
    },
    // Payers drop the fraction of a dollar (or cent, for USD): round down.
    recalcGross() {
      if (this.grossTouched) return;
      const factor = 10 ** Models.CURRENCIES[this.currency].decimals;
      const raw = (Number(this.form.perShare) || 0) * (Number(this.form.shares) || 0);
      const gross = Math.floor(raw * factor + 1e-9) / factor;
      this.form.gross = gross > 0 ? gross : '';
    },
    cancel() {
      this.$emit('close', {});
    },
    buildFields() {
      const perShare = Number(this.form.perShare);
      const shares = Number(this.form.shares);
      const gross = Number(this.form.gross);
      const deduction = Number(this.form.deduction) || 0;
      if (!this.form.holdingAccountId || !this.form.ticker || !this.form.receiveAccountId) return null;
      if (!(perShare > 0) || !(shares > 0) || !(gross > 0) || deduction < 0 || gross - deduction <= 0) return null;
      return {
        date: this.form.date,
        holdingAccountId: this.form.holdingAccountId,
        market: this.market,
        ticker: this.form.ticker,
        receiveAccountId: this.form.receiveAccountId,
        perShare,
        shares,
        gross,
        deduction,
      };
    },
    async save() {
      const fields = this.buildFields();
      if (!fields) return;
      if (this.isNew) await Store.addDividend(fields);
      else await Store.updateDividend(this.editingId, fields);
      this.$emit('close', { date: fields.date });
    },
    // Several holdings often pay on the same day: keep date and account,
    // clear the per-holding fields.
    async saveAndAddAnother() {
      const fields = this.buildFields();
      if (!fields) return;
      await Store.addDividend(fields);
      this.form = { ...this.form, ticker: '', perShare: '', shares: '', gross: '', deduction: 0 };
      this.sharesTouched = false;
      this.perShareTouched = false;
      this.grossTouched = false;
      if (this.holdingOptions.length) this.form.ticker = this.holdingOptions[0].ticker;
    },
    async removeCurrent() {
      if (this.isNew) return;
      if (!confirm('刪除這筆股利？')) return;
      await Store.deleteTransaction(this.editingId);
      this.$emit('close', {});
    },
    fmt(n) {
      return Models.formatMoney(n, this.currency);
    },
    tickerNameOf(ticker) {
      return window.tickerName(this.market, ticker);
    },
  },
  template: `
    <div class="modal-backdrop" @click.self="cancel">
      <div class="modal">
        <h3>{{ isNew ? '新增股利' : '編輯股利' }}</h3>
        <div class="modal-body">
          <div v-if="brokerageAccounts.length === 0" class="empty">還沒有證券交割帳戶,請先到「帳戶」分頁新增一個。</div>
          <template v-else>
            <label>持股所在的交割帳戶
              <select v-model="form.holdingAccountId">
                <option v-for="a in brokerageAccounts" :key="a.id" :value="a.id">{{ a.name }}({{ a.market === 'TW' ? '台股' : '美股' }})</option>
              </select>
            </label>
            <label>股票
              <select v-if="holdingOptions.length" v-model="form.ticker">
                <option v-for="o in holdingOptions" :key="o.ticker" :value="o.ticker">
                  {{ o.ticker }}{{ tickerNameOf(o.ticker) ? ' ' + tickerNameOf(o.ticker) : '' }}({{ o.quantity > 0 ? '持有 ' + o.quantity : '已出清' }})
                </option>
              </select>
              <div v-else class="field-hint">這個帳戶還沒有任何持股,請先記一筆買入</div>
            </label>
            <label>發放日 <input type="date" v-model="form.date" /></label>
            <label>每股股利{{ symbol ? '(' + symbol + ')' : '' }}
              <input type="number" v-model="form.perShare" min="0" step="0.0001" @input="perShareTouched = true" />
              <span v-if="lastDividend" class="field-hint">上次 {{ lastDividend.date }}:每股 {{ lastDividend.dividend.perShare }}</span>
            </label>
            <label>持有股數
              <input type="number" v-model="form.shares" min="0" step="0.0001" @input="sharesTouched = true" />
              <span class="field-hint">預設為發放日當天的持股({{ heldOnDate }} 股);實際以除息前一日的持股為準,不同時請自行修改</span>
            </label>
            <label>應領金額{{ symbol ? '(' + symbol + ')' : '' }}
              <input type="number" v-model="form.gross" min="0" step="any" @input="grossTouched = true" />
              <span class="field-hint">預設為每股 × 股數,不足一元(美股為一分)捨去;和實際入帳前的金額不同時可修改</span>
            </label>
            <label>扣款{{ symbol ? '(' + symbol + ')' : '' }}
              <input type="number" v-model="form.deduction" min="0" step="any" />
              <span class="field-hint">補充保費、匯費、美股扣繳稅等,依實際入帳金額自行填寫</span>
            </label>
            <label>入帳帳戶
              <select v-model="form.receiveAccountId">
                <option v-for="a in receiveAccounts" :key="a.id" :value="a.id">{{ a.name }}</option>
              </select>
            </label>
            <div class="field-hint" style="margin-top: 8px;">實領 <strong>{{ symbol }}{{ fmt(net) }}</strong>,會記成一筆「股利／配息」收入</div>
          </template>
        </div>
        <div class="modal-actions" :class="{ 'with-delete': !isNew }">
          <button v-if="!isNew" class="danger" @click="removeCurrent">刪除</button>
          <div class="modal-actions-right">
            <button @click="cancel">取消</button>
            <button v-if="isNew && brokerageAccounts.length > 0" @click="saveAndAddAnother">再記一筆</button>
            <button v-if="brokerageAccounts.length > 0" class="primary" @click="save">儲存</button>
          </div>
        </div>
      </div>
    </div>
  `,
};
