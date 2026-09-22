const INVESTMENT_WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

const InvestmentRowItem = {
  props: ['investment'],
  emits: ['edit', 'remove'],
  computed: {
    net() {
      return Models.investmentAmounts(this.investment).net;
    },
    companyName() {
      return window.tickerName(this.investment.market, this.investment.ticker);
    },
    accountName() {
      const a = Store.state.accounts.find((x) => x.id === this.investment.accountId);
      return a ? a.name : '(已刪除帳戶)';
    },
    // A trade settles in its own market's currency (US = USD) — shown as such
    // everywhere a trade amount appears, with a TWD equivalent alongside so it
    // reads against every other TWD figure in the app (the calendar cell's
    // day total among them) instead of looking like a stray TWD number.
    currency() {
      return Models.marketCurrency(this.investment.market);
    },
    nativeAmountText() {
      const symbol = this.currency === 'TWD' ? '' : Models.currencySymbol(this.currency);
      return symbol + Models.formatMoney(this.net, this.currency);
    },
    baseAmountText() {
      if (this.currency === 'TWD') return '';
      const base = this.net * Models.rateOf(this.currency, Store.state.rates);
      return '≈ NT$ ' + Math.round(base).toLocaleString('zh-TW');
    },
  },
  methods: {
    fmt(n) {
      return Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
    },
  },
  template: `
    <div class="list-row clickable" @click="$emit('edit', investment)">
      <div class="list-row-main">
        <span class="bar-icon">{{ investment.action === 'buy' ? '🟢' : '🔴' }}</span>
        <span class="list-row-title">{{ investment.ticker }}</span>
        <span v-if="companyName" class="ticker-name">{{ companyName }}</span>
        <div class="list-row-sub">
          {{ investment.action === 'buy' ? '買入' : '賣出' }} · {{ fmt(investment.price) }} × {{ investment.quantity }} · {{ accountName }}
        </div>
      </div>
      <div class="list-row-amount" :class="{ negative: investment.action === 'buy', positive: investment.action === 'sell' }">
        {{ investment.action === 'buy' ? '-' : '+' }}{{ nativeAmountText }}
        <div v-if="baseAmountText" class="list-row-sub">{{ baseAmountText }}</div>
      </div>
      <button class="row-delete" @click.stop="$emit('remove', investment)" aria-label="刪除">✕</button>
    </div>
  `,
};

// Renders an already-grouped (Models.groupInvestmentsByTicker) list for one
// market-section of the 投資 day panel — the investment counterpart of
// TransactionCategoryGroupList. A ticker traded once that day renders as a
// plain row exactly as before; several trades on the same ticker (e.g. a
// buy and a same-day sell) fold under a clickable header showing the trade
// count, not a dollar total — a group can mix buy and sell, and netting
// those into one signed figure would quietly hide that money moved both ways.
const InvestmentTickerGroupList = {
  components: { InvestmentRowItem },
  props: {
    groups: { type: Array, required: true },
  },
  emits: ['edit', 'remove'],
  data() {
    return { expandedGroups: new Set() };
  },
  methods: {
    toggleGroupExpand(ticker) {
      if (this.expandedGroups.has(ticker)) this.expandedGroups.delete(ticker);
      else this.expandedGroups.add(ticker);
    },
    isGroupExpanded(ticker) {
      return this.expandedGroups.has(ticker);
    },
    nameOf(group) {
      return window.tickerName(group.items[0].market, group.ticker);
    },
  },
  template: `
    <template v-for="g in groups" :key="g.ticker">
      <InvestmentRowItem v-if="g.items.length === 1" :investment="g.items[0]" @edit="$emit('edit', $event)" @remove="$emit('remove', $event)" />
      <div v-else>
        <div class="list-row clickable" @click="toggleGroupExpand(g.ticker)">
          <span class="icon-badge">📈</span>
          <div class="list-row-main">
            <div class="list-row-title">{{ g.ticker }}<span v-if="nameOf(g)" class="ticker-name">{{ nameOf(g) }}</span></div>
            <div class="list-row-sub">{{ g.items.length }} 筆</div>
          </div>
          <span class="expand-arrow" :class="{ open: isGroupExpanded(g.ticker) }">›</span>
        </div>
        <template v-if="isGroupExpanded(g.ticker)">
          <InvestmentRowItem v-for="i in g.items" :key="i.id" :investment="i" @edit="$emit('edit', $event)" @remove="$emit('remove', $event)" />
        </template>
      </div>
    </template>
  `,
};

const InvestmentFormModal = {
  components: { TickerPickerField },
  props: {
    editingId: { type: String, required: true }, // 'new' or an existing investment's id
    defaultDate: { type: String, default: null },
    defaultMarket: { type: String, default: null }, // preselects an account of this market when adding fresh
  },
  emits: ['close'],
  data() {
    const isNew = this.editingId === 'new';
    return {
      form: this.buildForm(),
      // Editing an existing trade starts "touched" so opening it to fix a
      // typo doesn't silently recompute and overwrite whatever fee/tax was
      // actually charged at the time.
      feeTouched: !isNew,
      taxTouched: !isNew,
    };
  },
  computed: {
    isNew() {
      return this.editingId === 'new';
    },
    // Only 證券交割 accounts settle a trade — every fee/tax figure below
    // reads this account's own configured rates, not a market-wide guess.
    brokerageAccounts() {
      return Store.state.accounts.filter((a) => a.kind === 'brokerage' && !a.isArchived);
    },
    selectedAccount() {
      return Store.state.accounts.find((a) => a.id === this.form.accountId) || null;
    },
    taxApplies() {
      return !!this.selectedAccount && this.selectedAccount.market === 'TW' && this.form.action === 'sell';
    },
    tickerIsEtf() {
      return Models.isTaiwanEtfTicker(this.form.ticker);
    },
    // A sell can only ever be against something actually held, in this
    // account's own market — free-typing a ticker to sell risked a typo
    // silently opening a short position the holdings math never expects.
    heldTickers() {
      if (!this.selectedAccount) return [];
      return Models.holdingsSummary(Store.state.investments)
        .filter((h) => h.market === this.selectedAccount.market && h.quantity > 0);
    },
    // Shares of the chosen ticker that may actually be sold: what's held in
    // this market less anything pledged as loan collateral. Counted without
    // the trade being edited, so it doesn't block its own quantity.
    sellable() {
      if (!this.selectedAccount || !this.form.ticker) return 0;
      return Store.sellableQuantity(this.selectedAccount.market, this.form.ticker.trim().toUpperCase(), this.isNew ? null : this.editingId);
    },
    pledgedForTicker() {
      if (!this.selectedAccount || !this.form.ticker) return 0;
      return Store.pledgedQuantity(this.selectedAccount.market, this.form.ticker.trim().toUpperCase());
    },
    // Only a sell is limited; null means nothing to complain about.
    sellError() {
      if (this.form.action !== 'sell' || !this.form.ticker || !Number(this.form.quantity)) return null;
      if (Number(this.form.quantity) <= this.sellable + 1e-9) return null;
      return this.pledgedForTicker > 0
        ? `最多可賣 ${this.sellable} 股(已扣除質押中的 ${this.pledgedForTicker} 股)`
        : `最多可賣 ${this.sellable} 股`;
    },
    // The trade being edited may hold a ticker no longer (or not yet, mid
    // pick) in heldTickers — keep it selectable so opening an old sell to
    // fix a typo doesn't silently blank or swap its ticker out from under it.
    sellTickerOptions() {
      const list = this.heldTickers
        .map((h) => ({ ticker: h.ticker, quantity: Store.sellableQuantity(h.market, h.ticker, this.isNew ? null : this.editingId) }))
        .filter((o) => o.quantity > 0);
      if (this.form.ticker && !list.some((o) => o.ticker === this.form.ticker)) {
        list.unshift({ ticker: this.form.ticker, quantity: null });
      }
      return list;
    },
  },
  watch: {
    'form.accountId'() {
      this.feeTouched = false;
      this.taxTouched = false;
      this.recalc();
    },
    'form.action'() {
      this.taxTouched = false;
      this.recalc();
    },
    'form.ticker'() {
      this.recalc();
    },
    'form.price'() {
      this.recalc();
    },
    'form.quantity'() {
      this.recalc();
    },
  },
  methods: {
    tickerNameFor(ticker) {
      return this.selectedAccount ? window.tickerName(this.selectedAccount.market, ticker) : '';
    },
    recalc() {
      const price = Number(this.form.price) || 0;
      const quantity = Number(this.form.quantity) || 0;
      if (!this.feeTouched) {
        this.form.fee = Models.suggestedFee(this.selectedAccount, price, quantity);
      }
      if (!this.taxTouched) {
        this.form.tax = Models.suggestedTax(this.selectedAccount, this.form.action, this.form.ticker, price, quantity);
      }
    },
    buildForm() {
      if (!this.isNew) {
        const inv = Store.state.investments.find((i) => i.id === this.editingId);
        if (inv) {
          return {
            date: inv.date,
            accountId: inv.accountId,
            action: inv.action,
            ticker: inv.ticker,
            price: inv.price,
            quantity: inv.quantity,
            fee: inv.fee,
            tax: inv.tax,
            note: inv.note || '',
          };
        }
      }
      const today = new Date().toISOString().slice(0, 10);
      const candidates = Store.state.accounts.filter((a) => a.kind === 'brokerage' && !a.isArchived);
      const marketPreferred = this.defaultMarket ? candidates.find((a) => a.market === this.defaultMarket) : null;
      const firstAccount = candidates.find((a) => a.isDefault) || marketPreferred || candidates[0];
      return {
        date: this.defaultDate || today,
        accountId: firstAccount ? firstAccount.id : '',
        action: 'buy',
        ticker: '',
        price: '',
        quantity: '',
        fee: 0,
        tax: 0,
        note: '',
      };
    },
    cancel() {
      this.$emit('close', {});
    },
    // Shared by save() and saveAndAddAnother() — null means not valid to
    // submit yet, so each caller just checks for that.
    buildFields() {
      const price = Number(this.form.price);
      const quantity = Number(this.form.quantity);
      if (!this.form.accountId || !this.form.ticker.trim() || !price || price <= 0 || !quantity || quantity <= 0) return null;
      if (this.sellError) return null;
      return {
        date: this.form.date,
        accountId: this.form.accountId,
        market: this.selectedAccount.market, // copied from the account at entry time
        action: this.form.action,
        ticker: this.form.ticker.trim().toUpperCase(),
        price,
        quantity,
        fee: Number(this.form.fee) || 0,
        tax: Number(this.form.tax) || 0,
        note: this.form.note.trim(),
      };
    },
    async save() {
      const fields = this.buildFields();
      if (!fields) return;
      if (this.isNew) {
        await Store.addInvestment(fields);
      } else {
        await Store.updateInvestment(this.editingId, fields);
      }
      this.$emit('close', { date: fields.date });
    },
    // Saves the current trade without closing the modal — keeps date,
    // account and buy/sell action as-is (the common case is several trades
    // the same day through the same settlement account) and clears the
    // per-trade fields, including the fee/tax touched-guards so the next
    // ticker gets its own auto-suggested fee/tax instead of inheriting this
    // one's manually-adjusted values.
    async saveAndAddAnother() {
      const fields = this.buildFields();
      if (!fields) return;
      await Store.addInvestment(fields);
      this.form = { ...this.form, ticker: '', price: '', quantity: '', fee: 0, tax: 0, note: '' };
      this.feeTouched = false;
      this.taxTouched = false;
    },
    async removeCurrent() {
      if (this.isNew) return;
      if (!confirm('刪除這筆交易？')) return;
      await Store.deleteInvestment(this.editingId);
      this.$emit('close', {});
    },
  },
  template: `
    <div class="modal-backdrop" @click.self="cancel">
      <div class="modal">
        <h3>{{ isNew ? '新增投資交易' : '編輯投資交易' }}</h3>
        <div class="modal-body">
          <div v-if="brokerageAccounts.length === 0" class="empty">
            還沒有證券交割帳戶,請先到「帳戶」分頁新增一個。
          </div>
          <template v-else>
            <label>交割帳戶
              <select v-model="form.accountId">
                <option v-for="a in brokerageAccounts" :key="a.id" :value="a.id">{{ a.name }}({{ a.market === 'TW' ? '台股' : '美股' }})</option>
              </select>
            </label>
            <label>類型
              <select v-model="form.action">
                <option value="buy">買入</option>
                <option value="sell">賣出</option>
              </select>
            </label>
            <label>日期 <input type="date" v-model="form.date" /></label>
            <label>標的
              <template v-if="form.action === 'sell'">
                <select v-if="sellTickerOptions.length" v-model="form.ticker">
                  <option v-for="o in sellTickerOptions" :key="o.ticker" :value="o.ticker">
                    {{ o.ticker }}{{ tickerNameFor(o.ticker) ? ' ' + tickerNameFor(o.ticker) : '' }}{{ o.quantity != null ? '(可賣 ' + o.quantity + ')' : '' }}
                  </option>
                </select>
                <div v-else class="field-hint">這個帳戶目前沒有持股可以賣出</div>
              </template>
              <TickerPickerField v-else v-model="form.ticker" :market="selectedAccount.market" />
            </label>
            <label>價格 <input type="number" v-model="form.price" min="0" step="0.01" /></label>
            <label>數量 <input type="number" v-model="form.quantity" min="0" step="0.0001" />
              <span v-if="sellError" class="field-hint negative">{{ sellError }}</span>
            </label>
            <label>手續費 <input type="number" v-model="form.fee" min="0" @input="feeTouched = true" />
              <span class="field-hint" v-if="selectedAccount">
                依「{{ selectedAccount.name }}」設定的 {{ (selectedAccount.feeRate * 100).toLocaleString('zh-TW', { maximumFractionDigits: 4 }) }}% 自動試算,可自行調整
              </span>
            </label>
            <label v-if="taxApplies">交易稅 <input type="number" v-model="form.tax" min="0" @input="taxTouched = true" />
              <span class="field-hint">
                依帳戶設定的{{ tickerIsEtf ? ' ETF ' : ' 股票 ' }}稅率試算(依代碼開頭猜測是否為 ETF,可自行調整)
              </span>
            </label>
            <label>備註 <input v-model="form.note" /></label>
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

const InvestmentsView = {
  components: { InvestmentRowItem, InvestmentFormModal, InvestmentTickerGroupList },
  data() {
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      selectedDay: now.toISOString().slice(0, 10),
      editingId: null,
      formDefaultDate: null,
    };
  },
  computed: {
    yearMonth() {
      return `${this.year}-${String(this.month).padStart(2, '0')}`;
    },
    todayStr() {
      return new Date().toISOString().slice(0, 10);
    },
    weekdayLabels() {
      return INVESTMENT_WEEKDAY_LABELS;
    },
    calendarCells() {
      const firstWeekday = new Date(this.year, this.month - 1, 1).getDay();
      const daysInMonth = new Date(this.year, this.month, 0).getDate();
      const totals = Store.dailyInvestmentTotals(this.yearMonth);
      const cells = [];
      for (let i = 0; i < firstWeekday; i++) cells.push(null);
      for (let d = 1; d <= daysInMonth; d++) {
        const row = totals.get(d) || { buy: 0, sell: 0 };
        cells.push({
          day: d,
          dateStr: `${this.yearMonth}-${String(d).padStart(2, '0')}`,
          buy: row.buy,
          sell: row.sell,
        });
      }
      return cells;
    },
    selectedDayInvestments() {
      if (!this.selectedDay) return [];
      return Store.state.investments
        .filter((i) => !i.isDeleted && i.date === this.selectedDay)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    },
    twInvestments() {
      return this.selectedDayInvestments.filter((i) => i.market === 'TW');
    },
    usInvestments() {
      return this.selectedDayInvestments.filter((i) => i.market === 'US');
    },
    twGroups() {
      return Models.groupInvestmentsByTicker(this.twInvestments);
    },
    usGroups() {
      return Models.groupInvestmentsByTicker(this.usInvestments);
    },
    twBuyTotal() {
      return this.twInvestments.filter((i) => i.action === 'buy').reduce((s, i) => s + Models.investmentAmounts(i).net, 0);
    },
    twSellTotal() {
      return this.twInvestments.filter((i) => i.action === 'sell').reduce((s, i) => s + Models.investmentAmounts(i).net, 0);
    },
    usBuyTotal() {
      return this.usInvestments.filter((i) => i.action === 'buy').reduce((s, i) => s + Models.investmentAmounts(i).net, 0);
    },
    usSellTotal() {
      return this.usInvestments.filter((i) => i.action === 'sell').reduce((s, i) => s + Models.investmentAmounts(i).net, 0);
    },
    usBuyBase() {
      return this.usBuyTotal * Models.rateOf('USD', Store.state.rates);
    },
    usSellBase() {
      return this.usSellTotal * Models.rateOf('USD', Store.state.rates);
    },
  },
  methods: {
    shiftMonth(delta) {
      let m = this.month + delta;
      let y = this.year;
      if (m < 1) { m = 12; y -= 1; }
      if (m > 12) { m = 1; y += 1; }
      this.month = m;
      this.year = y;
    },
    selectDay(dateStr) {
      this.selectedDay = dateStr;
    },
    openNew(dateOverride) {
      this.formDefaultDate = dateOverride || this.selectedDay;
      this.editingId = 'new';
    },
    openEdit(inv) {
      this.editingId = inv.id;
    },
    onFormClosed(payload) {
      if (payload && payload.date) this.selectedDay = payload.date;
      this.editingId = null;
    },
    async remove(inv) {
      if (!confirm('刪除這筆交易？')) return;
      await Store.deleteInvestment(inv.id);
    },
    fmt(n) {
      return Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
    },
    currencySymbol(code) {
      return Models.currencySymbol(code);
    },
    fmtCur(n, code) {
      return Models.formatMoney(n, code);
    },
  },
  template: `
    <div class="view">
      <div class="view-header">
        <h2>投資</h2>
        <button class="primary" @click="openNew()">+ 新增</button>
      </div>

      <div class="panel-grid">
      <section class="panel">
        <div class="month-nav">
          <button @click="shiftMonth(-1)">‹</button>
          <span class="month-label">{{ year }} 年 {{ month }} 月</span>
          <button @click="shiftMonth(1)">›</button>
        </div>

        <div class="calendar-weekdays">
          <span v-for="w in weekdayLabels" :key="w">{{ w }}</span>
        </div>
        <div class="calendar-grid">
          <div
            v-for="(cell, i) in calendarCells"
            :key="i"
            class="calendar-day"
            :class="{ empty: !cell, today: cell && cell.dateStr === todayStr, selected: cell && cell.dateStr === selectedDay }"
            @click="cell && selectDay(cell.dateStr)"
          >
            <template v-if="cell">
              <div class="day-num">{{ cell.day }}</div>
              <div v-if="cell.buy" class="day-amount negative">-{{ fmt(cell.buy) }}</div>
              <div v-if="cell.sell" class="day-amount positive">+{{ fmt(cell.sell) }}</div>
            </template>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="view-header">
          <h3>{{ selectedDay }}</h3>
          <button class="primary" @click="openNew(selectedDay)">+ 新增</button>
        </div>

        <div v-if="selectedDayInvestments.length === 0" class="empty">這天還沒有投資交易</div>

        <template v-else>
          <div v-if="twInvestments.length" class="subsection">
            <div class="subsection-header">
              <span>台股</span>
              <span>
                <span v-if="twBuyTotal" class="negative">-{{ fmt(twBuyTotal) }}</span>
                <span v-if="twSellTotal" class="positive"> +{{ fmt(twSellTotal) }}</span>
              </span>
            </div>
            <InvestmentTickerGroupList :groups="twGroups" @edit="openEdit" @remove="remove" />
          </div>

          <div v-if="usInvestments.length" class="subsection">
            <div class="subsection-header">
              <span>美股</span>
              <span>
                <span v-if="usBuyTotal" class="negative">-{{ currencySymbol('USD') }}{{ fmtCur(usBuyTotal, 'USD') }}<span class="muted"> (≈ {{ fmt(usBuyBase) }})</span></span>
                <span v-if="usSellTotal" class="positive"> +{{ currencySymbol('USD') }}{{ fmtCur(usSellTotal, 'USD') }}<span class="muted"> (≈ {{ fmt(usSellBase) }})</span></span>
              </span>
            </div>
            <InvestmentTickerGroupList :groups="usGroups" @edit="openEdit" @remove="remove" />
          </div>
        </template>
      </section>
      </div>

      <InvestmentFormModal
        v-if="editingId"
        :editing-id="editingId"
        :default-date="formDefaultDate"
        @close="onFormClosed"
      />
    </div>
  `,
};
