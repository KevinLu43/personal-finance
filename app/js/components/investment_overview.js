// The holdings summary, pulled out of the 投資 (recording) tab into its own
// screen — recording a trade and reviewing what you hold are different
// tasks with different rhythms, and stacking both under one calendar made
// the recording screen longer without making either easier to use.

const INVESTMENT_ACTION_LABELS = { buy: '買入', sell: '賣出' };

// 資產配置's four fixed colors, keyed by categoryOptions' value — distinct
// from --income/--expense/--warning elsewhere so this donut never reads as
// "gain/loss" by accident.
const ALLOCATION_COLORS = { listed: '#3d5a80', otc: '#bc6c25', etf: '#588157', US: '#6a4c93' };

// Codes known to the directory, per market — built once, the lists are static.
let knownTickerCodes = null;
function isKnownTickerCode(market, code) {
  if (!knownTickerCodes) {
    knownTickerCodes = {
      TW: new Set(TickerDirectory.TW.map((t) => t.code)),
      US: new Set(TickerDirectory.US.map((t) => t.code)),
    };
  }
  return knownTickerCodes[market].has(code);
}

// One entry per distinct market + ticker text on the trades whose 標的 isn't
// a code the directory knows — typically a company name typed in before the
// ticker field had a directory behind it — with the codes that name could be.
function tickerFixGroups() {
  const byKey = new Map();
  for (const inv of Store.state.investments) {
    if (inv.isDeleted || isKnownTickerCode(inv.market, inv.ticker)) continue;
    const key = inv.market + '|' + inv.ticker;
    const group = byKey.get(key) || { key, market: inv.market, ticker: inv.ticker, count: 0 };
    group.count += 1;
    byKey.set(key, group);
  }
  return [...byKey.values()].map((g) => ({ ...g, candidates: Models.suggestTickerCodes(TickerDirectory[g.market], g.ticker) }));
}

// Lists those trades with a suggested code for each and applies only what
// the operator confirms. A row left on 不變更 with nothing typed is untouched.
const TickerFixModal = {
  emits: ['close'],
  data() {
    const groups = tickerFixGroups();
    const choices = {};
    for (const g of groups) {
      // Pre-pick only a confident match (exact name or name starting with
      // the text); anything vaguer starts on 不變更 for the operator to decide.
      const best = g.candidates[0];
      choices[g.key] = { select: best && best.rank <= 1 ? best.code : '', manual: '' };
    }
    return { groups, choices };
  },
  computed: {
    pendingCount() {
      return this.groups.filter((g) => this.finalCode(g)).length;
    },
  },
  methods: {
    finalCode(g) {
      const c = this.choices[g.key];
      const code = (c.manual.trim().toUpperCase() || c.select).trim();
      return code && code !== g.ticker ? code : '';
    },
    marketLabel(m) {
      return m === 'TW' ? '台股' : '美股';
    },
    async apply() {
      for (const g of this.groups) {
        const code = this.finalCode(g);
        if (code) await Store.renameTicker(g.market, g.ticker, code);
      }
      this.$emit('close');
    },
  },
  template: `
    <div class="modal-backdrop" @click.self="$emit('close')">
      <div class="modal">
        <h3>補上股票代號</h3>
        <div class="modal-body">
          <p class="field-hint" style="margin: 0 0 12px;">這些交易的「標的」不是代號。確認每一列建議的代號,不需要改的保持「不變更」,按下套用後才會寫入。</p>
          <div v-if="groups.length === 0" class="empty">所有交易的標的都已經是代號</div>
          <div v-for="g in groups" :key="g.key" class="ticker-fix-row">
            <div class="list-row-title">{{ g.ticker }}<span class="ticker-name">{{ marketLabel(g.market) }} · {{ g.count }} 筆</span></div>
            <select v-model="choices[g.key].select">
              <option value="">不變更</option>
              <option v-for="c in g.candidates" :key="c.code" :value="c.code">{{ c.code }} {{ c.name }}</option>
            </select>
            <input v-model="choices[g.key].manual" placeholder="或自行輸入代號" />
          </div>
        </div>
        <div class="modal-actions">
          <button @click="$emit('close')">取消</button>
          <button class="primary" :disabled="pendingCount === 0" @click="apply">套用{{ pendingCount ? '(' + pendingCount + ')' : '' }}</button>
        </div>
      </div>
    </div>
  `,
};

const InvestmentOverviewView = {
  components: { InvestmentRowItem, InvestmentFormModal, TickerFixModal, DividendFormModal, DividendRowItem },
  data() {
    const now = new Date();
    return {
      selectedCategory: 'listed', // 'listed' | 'otc' | 'etf' | 'US'
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      query: '',
      actionFilters: [], // subset of buy/sell; empty means "all"
      showAllCategories: false, // 交易明細 only: ignore the 上市/上櫃/ETF/美股 tab and show every category's trades together
      editingId: null,
      formDefaultDate: null,
      expandedDate: null, // which 交易明細 date group is expanded, one at a time
      expandedHoldingKey: null, // which holding row's trade history is open, one at a time ('market:ticker')
      clearedOpen: false, // the 已出清 group under the holdings list is folded until asked for
      dividendForm: null, // null closed, or { id: 'new' | a dividend's id, accountId, ticker } to open the 股利 form
      fixOpen: false, // the 補上代號 dialog
    };
  },
  computed: {
    // Trades whose 標的 isn't a known code; the notice bar only appears when
    // one of them looks like a company name (a confident or Chinese-text match),
    // so a genuinely unlisted code never nags.
    fixGroups() {
      return tickerFixGroups();
    },
    needsTickerFix() {
      return this.fixGroups.some(
        (g) => g.candidates.some((c) => c.rank <= 1) || (/[^ -~]/.test(g.ticker) && g.candidates.length > 0)
      );
    },
    // Whole-history — "what do I hold and what have I made" is a running
    // total, not scoped to any one month.
    allHoldings() {
      return Models.holdingsSummary(Store.state.investments);
    },
    totalRealizedPL() {
      // In TWD, since it spans both markets (US holdings are in USD).
      return this.allHoldings.reduce((s, h) => s + h.realizedPL * Models.rateOf(Models.marketCurrency(h.market), Store.state.rateHistory), 0);
    },
    // The four tabs: TW's 上市/上櫃/ETF (Models.twInvestmentCategory, from
    // the ticker directory's listing-venue data plus the ETF code heuristic)
    // sit alongside 美股 as its own tab, same as before.
    categoryOptions() {
      return [
        { value: 'listed', label: '上市' },
        { value: 'otc', label: '上櫃' },
        { value: 'etf', label: 'ETF' },
        { value: 'US', label: '美股' },
      ];
    },
    categoryLabel() {
      return (this.categoryOptions.find((o) => o.value === this.selectedCategory) || {}).label || '';
    },
    // The underlying market a tab's holdings settle in — every TW tab is
    // 'TW', only 美股 is 'US'. Drives currentCurrency and the new-trade
    // form's default account below.
    currentMarket() {
      return this.selectedCategory === 'US' ? 'US' : 'TW';
    },
    // 資產配置: what the whole portfolio (every tab, current holdings only)
    // is worth at cost, split the same four ways the tabs are, each row also
    // carrying that category's own realized P&L — one place to compare all
    // four before drilling into any single tab. Cost, not live price (this
    // app has no quotes), in TWD so a 美股 holding can sit in the same total
    // as a TW one; ALLOCATION_COLORS keys by categoryOptions' value so this
    // and the donut/legend below always agree on which color is which.
    // realizedPL is summed from every holding ever in that category (not
    // just currentOnly) — a fully exited position's gain/loss still counts,
    // the same way totalRealizedPL up top never forgets a closed position.
    allocationBreakdown() {
      const currentOnly = this.allHoldings.filter((h) => h.quantity > 0);
      const inCategory = (rows, value) => (value === 'US'
        ? rows.filter((h) => h.market === 'US')
        : rows.filter((h) => h.market === 'TW' && Models.twInvestmentCategory(h.ticker) === value));
      return this.categoryOptions
        .map((opt) => {
          const costRows = inCategory(currentOnly, opt.value);
          const plRows = inCategory(this.allHoldings, opt.value);
          const rateOf = (h) => Models.rateOf(Models.marketCurrency(h.market), Store.state.rateHistory);
          const amount = costRows.reduce((s, h) => s + h.costBasis * rateOf(h), 0);
          const realizedPL = plRows.reduce((s, h) => s + h.realizedPL * rateOf(h), 0);
          // Dividends too count for every holding ever in the category, sold or not.
          const dividend = plRows.reduce((s, h) => s + (this.dividendBaseByHolding.get(this.holdingKey(h)) || 0), 0);
          return { value: opt.value, category: { name: opt.label, color: ALLOCATION_COLORS[opt.value] }, amount, realizedPL, dividend };
        })
        .filter((row) => row.amount > 0 || row.realizedPL !== 0 || row.dividend > 0);
    },
    allocationTotal() {
      return this.allocationBreakdown.reduce((s, row) => s + row.amount, 0);
    },
    allocationSegments() {
      return Models.buildDonutSegments(this.allocationBreakdown);
    },
    // Everything below this point is scoped to whichever tab is active —
    // one owner for "which category am I looking at" instead of each
    // section re-filtering by selectedCategory its own way.
    currentHoldings() {
      if (this.selectedCategory === 'US') return this.allHoldings.filter((h) => h.market === 'US');
      return this.allHoldings.filter((h) => h.market === 'TW' && Models.twInvestmentCategory(h.ticker) === this.selectedCategory);
    },
    // Cash dividends per holding (as received, in the holding's currency).
    dividendStats() {
      return Models.dividendsByHolding(Store.state.transactions, Models.localToday());
    },
    // The same, in TWD, each dividend at its own payment date's rate — what
    // the totals across markets add up.
    dividendBaseByHolding() {
      const byKey = new Map();
      for (const [key, entry] of this.dividendStats) {
        byKey.set(key, entry.items.reduce((sum, t) => sum + Store.baseAmountOf(t), 0));
      }
      return byKey;
    },
    totalDividend() {
      let total = 0;
      for (const v of this.dividendBaseByHolding.values()) total += v;
      return total;
    },
    currentDividendTotal() {
      return this.currentHoldings.reduce((sum, h) => sum + (this.dividendOf(h) ? this.dividendOf(h).total : 0), 0);
    },
    // Held vs. fully sold is decided by the quantity left, recomputed from the
    // trades every time — so a cleared stock that is bought again is simply
    // back among the held ones, with its earlier realized P/L still counted.
    activeHoldings() {
      return this.currentHoldings.filter((h) => h.quantity > 0);
    },
    clearedHoldings() {
      return this.currentHoldings.filter((h) => !(h.quantity > 0));
    },
    // Held first, then the cleared ones (shown only when their group is open).
    orderedHoldings() {
      return [...this.activeHoldings, ...this.clearedHoldings];
    },
    currentRealizedPL() {
      return this.currentHoldings.reduce((s, h) => s + h.realizedPL, 0);
    },
    portfolioBreakdown() {
      return Models.portfolioBreakdown(this.currentHoldings);
    },
    portfolioTotal() {
      return this.portfolioBreakdown.reduce((s, row) => s + row.amount, 0);
    },
    portfolioSegments() {
      return Models.buildDonutSegments(this.portfolioBreakdown);
    },
    // Everything below this point native to the active tab — TWD for every
    // TW tab, USD for 美股 — so a 美股 total shows both what it actually
    // settled in and, alongside it, the TWD equivalent every other screen's
    // totals use.
    currentCurrency() {
      return Models.marketCurrency(this.currentMarket);
    },
    yearMonth() {
      return `${this.year}-${String(this.month).padStart(2, '0')}`;
    },
    actionOptions() {
      return Object.entries(INVESTMENT_ACTION_LABELS).map(([action, label]) => ({ action, label }));
    },
    // The month-scoped buy/sell browse/search — separate from the
    // whole-history holdings summary above, which never changes with month.
    // Matches the ticker, the note, or the settlement account's name, same
    // three-way match the 記帳 transaction search uses.
    filteredInvestments() {
      const q = this.query.trim().toLowerCase();
      return Store.state.investments
        .filter((i) => !i.isDeleted && i.date.startsWith(this.yearMonth))
        .filter((i) => this.showAllCategories || (this.selectedCategory === 'US' ? i.market === 'US' : i.market === 'TW' && Models.twInvestmentCategory(i.ticker) === this.selectedCategory))
        .filter((i) => this.actionFilters.length === 0 || this.actionFilters.includes(i.action))
        .filter((i) => {
          if (!q) return true;
          const account = Store.state.accounts.find((a) => a.id === i.accountId);
          const accountMatch = account ? account.name.toLowerCase().includes(q) : false;
          return i.ticker.toLowerCase().includes(q) || (i.note || '').toLowerCase().includes(q) || accountMatch;
        })
        .sort((a, b) => {
          if (a.date !== b.date) return a.date < b.date ? 1 : -1;
          return a.updatedAt < b.updatedAt ? 1 : -1;
        });
    },
    groupedByDate() {
      const groups = [];
      const byDate = new Map();
      for (const i of this.filteredInvestments) {
        let group = byDate.get(i.date);
        if (!group) {
          group = { date: i.date, items: [], buyTotal: 0, sellTotal: 0 };
          byDate.set(i.date, group);
          groups.push(group);
        }
        group.items.push(i);
        const { net } = Models.investmentAmounts(i);
        // Showing every category together can mix TWD and USD trades on the
        // same day — there's no single native currency left to sum in, so
        // the day's total converts to TWD at each trade's own date instead.
        const amount = this.showAllCategories
          ? net * Models.rateOf(Models.marketCurrency(i.market), Store.state.rateHistory, i.date)
          : net;
        if (i.action === 'buy') group.buyTotal += amount;
        else group.sellTotal += amount;
      }
      return groups;
    },
  },
  methods: {
    fmt(n) {
      return Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
    },
    // Amounts round to whole currency, but a per-share average cost needs
    // its decimals — rounding NVDA's 164.27 down to 164 hides real drift
    // from a stock priced at 157.12 with a five-dollar fee baked in.
    fmtPrice(n) {
      return Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
    },
    currencySymbol(code) {
      return Models.currencySymbol(code);
    },
    fmtCur(n, code) {
      return Models.formatMoney(n, code);
    },
    // A native-currency amount converted to TWD at today's rate — for whole-
    // history aggregates (已實現, a holding's realizedPL) where there's no
    // one date to convert at anyway.
    toBase(n) {
      return n * Models.rateOf(this.currentCurrency, Store.state.rateHistory);
    },
    // Same, but at the rate in effect on a specific date — 交易明細's day
    // totals are all one real date, so unlike toBase above they can (and
    // should) convert at that day's rate instead of today's.
    toBaseAsOf(n, date) {
      return n * Models.rateOf(this.currentCurrency, Store.state.rateHistory, date);
    },
    // A 交易明細 day total's own text: the active tab's native currency
    // normally, or — once showAllCategories mixes markets — the TWD figure
    // groupedByDate already converted it to (a symbol here would be wrong,
    // since it's no longer any one currency).
    fmtGroupAmount(amount) {
      if (this.showAllCategories) return this.fmt(amount);
      const symbol = this.currentCurrency !== 'TWD' ? this.currencySymbol(this.currentCurrency) : '';
      return symbol + this.fmtCur(amount, this.currentCurrency);
    },
    // 持股比例's legend: a Taiwan holding reads as its company name (a bare
    // four-digit code says nothing at a glance), falling back to the code when
    // the directory has none; US tickers are already what people recognise.
    legendName(ticker) {
      return this.currentMarket === 'TW' ? window.tickerName('TW', ticker) || ticker : ticker;
    },
    nameOf(h) {
      return window.tickerName(h.market, h.ticker);
    },
    // Holdings are per-account now — shown next to the ticker so two
    // accounts holding the same stock read as the separate rows they are,
    // not a duplicate.
    accountName(h) {
      const a = Store.state.accounts.find((x) => x.id === h.accountId);
      return a ? a.name : '(已刪除帳戶)';
    },
    pledgedFor(h) {
      return Store.pledgedQuantity(h.accountId, h.market, h.ticker);
    },
    fmtPercent(amount) {
      return this.portfolioTotal > 0 ? (amount / this.portfolioTotal * 100).toFixed(1) + '%' : '0%';
    },
    fmtAllocationPercent(amount) {
      return this.allocationTotal > 0 ? (amount / this.allocationTotal * 100).toFixed(1) + '%' : '0%';
    },
    shiftMonth(delta) {
      let m = this.month + delta;
      let y = this.year;
      if (m < 1) { m = 12; y -= 1; }
      if (m > 12) { m = 1; y += 1; }
      this.month = m;
      this.year = y;
    },
    toggleAction(action) {
      const idx = this.actionFilters.indexOf(action);
      if (idx === -1) this.actionFilters.push(action);
      else this.actionFilters.splice(idx, 1);
    },
    toggleDateExpand(date) {
      this.expandedDate = this.expandedDate === date ? null : date;
    },
    holdingKey(h) {
      return h.accountId + ':' + h.market + ':' + h.ticker;
    },
    toggleHoldingExpand(h) {
      const key = this.holdingKey(h);
      this.expandedHoldingKey = this.expandedHoldingKey === key ? null : key;
    },
    // A holding's whole trade history, not scoped to the selected month —
    // the holding row itself is a whole-history total (Models.holdingsSummary),
    // so folding its trade list down to just the current month would silently
    // hide most of what built up that total. Newest first, same order 交易明細 uses.
    holdingTrades(h) {
      return Store.state.investments
        .filter((i) => !i.isDeleted && i.accountId === h.accountId && i.market === h.market && i.ticker === h.ticker)
        .sort((a, b) => {
          if (a.date !== b.date) return a.date < b.date ? 1 : -1;
          return a.updatedAt < b.updatedAt ? 1 : -1;
        });
    },
    dividendOf(h) {
      return this.dividendStats.get(this.holdingKey(h)) || null;
    },
    // Dividends over the last 12 months against what the shares cost — only
    // for a holding still owned, since a sold one has no cost left.
    dividendYieldText(h) {
      const d = this.dividendOf(h);
      if (!d || !(h.quantity > 0) || !(h.costBasis > 0) || !(d.last12 > 0)) return '';
      return (d.last12 / h.costBasis * 100).toFixed(1) + '%';
    },
    fmtNative(n) {
      return (this.currentCurrency !== 'TWD' ? this.currencySymbol(this.currentCurrency) : '') + this.fmtCur(n, this.currentCurrency);
    },
    openDividend(id, h) {
      this.dividendForm = { id, accountId: h ? h.accountId : null, ticker: h ? h.ticker : null };
    },
    async removeDividend(t) {
      if (!confirm('刪除這筆股利？')) return;
      await Store.deleteTransaction(t.id);
    },
    openNew() {
      const today = Models.localToday();
      this.formDefaultDate = today.startsWith(this.yearMonth) ? today : `${this.yearMonth}-01`;
      this.editingId = 'new';
    },
    openEdit(inv) {
      this.editingId = inv.id;
    },
    onFormClosed() {
      this.editingId = null;
    },
    async remove(inv) {
      if (!confirm('刪除這筆交易？')) return;
      await Store.deleteInvestment(inv.id);
    },
  },
  template: `
    <div class="view">
      <div class="view-header">
        <h2>投資總覽<span class="muted"> · 已實現(台幣){{ totalRealizedPL >= 0 ? '+' : '' }}{{ fmt(totalRealizedPL) }}<template v-if="totalDividend > 0"> · 股利(台幣)+{{ fmt(totalDividend) }}</template></span></h2>
      </div>

      <div v-if="needsTickerFix" class="notice-bar">
        <span>有 {{ fixGroups.length }} 種標的還沒有股票代號</span>
        <button class="primary" @click="fixOpen = true">補上代號</button>
      </div>

      <section v-if="allocationBreakdown.length" class="panel">
        <h3>資產配置<span class="muted"> · 上市/上櫃/ETF/美股,持股成本換算台幣</span></h3>
        <svg viewBox="0 0 100 100" class="donut-chart">
          <circle cx="50" cy="50" r="40" fill="none" stroke="var(--line)" stroke-width="14" />
          <circle
            v-for="(seg, i) in allocationSegments" :key="i"
            cx="50" cy="50" r="40" fill="none"
            :stroke="seg.color" stroke-width="14"
            :stroke-dasharray="seg.dash + ' ' + seg.gap"
            :stroke-dashoffset="seg.dashOffset"
            transform="rotate(-90 50 50)"
          />
        </svg>
        <div class="month-table-row month-table-header">
          <span class="month-table-cell month">分類</span>
          <span class="month-table-cell">佔比</span>
          <span class="month-table-cell">成本</span>
          <span class="month-table-cell">已實現</span>
          <span class="month-table-cell">股利</span>
        </div>
        <div
          v-for="row in allocationBreakdown" :key="row.value" class="month-table-row clickable"
          :class="{ active: selectedCategory === row.value }"
          @click="selectedCategory = row.value"
        >
          <span class="month-table-cell month"><span class="legend-swatch" :style="{ background: row.category.color }"></span>{{ row.category.name }}</span>
          <span class="month-table-cell">{{ fmtAllocationPercent(row.amount) }}</span>
          <span class="month-table-cell">{{ fmt(row.amount) }}</span>
          <span class="month-table-cell" :class="row.realizedPL >= 0 ? 'positive' : 'negative'">{{ row.realizedPL >= 0 ? '+' : '' }}{{ fmt(row.realizedPL) }}</span>
          <span class="month-table-cell" :class="row.dividend > 0 ? 'positive' : ''">{{ row.dividend > 0 ? '+' + fmt(row.dividend) : '-' }}</span>
        </div>
        <div class="month-table-row">
          <span class="month-table-cell month" style="font-weight: 700;">合計</span>
          <span class="month-table-cell"></span>
          <span class="month-table-cell" style="font-weight: 700;">{{ fmt(allocationTotal) }}</span>
          <span class="month-table-cell" :class="totalRealizedPL >= 0 ? 'positive' : 'negative'">{{ totalRealizedPL >= 0 ? '+' : '' }}{{ fmt(totalRealizedPL) }}</span>
          <span class="month-table-cell" :class="totalDividend > 0 ? 'positive' : ''">{{ totalDividend > 0 ? '+' + fmt(totalDividend) : '-' }}</span>
        </div>
      </section>

      <div class="mode-toggle">
        <button v-for="opt in categoryOptions" :key="opt.value" :class="{ active: selectedCategory === opt.value }" @click="selectedCategory = opt.value">{{ opt.label }}</button>
      </div>

      <div v-if="currentHoldings.length === 0" class="empty">{{ categoryLabel }}還沒有任何投資交易</div>

      <div class="panel-grid">
        <template v-if="currentHoldings.length > 0">
          <section v-if="portfolioBreakdown.length" class="panel">
            <h3>持股比例</h3>
            <svg viewBox="0 0 100 100" class="donut-chart">
              <circle cx="50" cy="50" r="40" fill="none" stroke="var(--line)" stroke-width="14" />
              <circle
                v-for="(seg, i) in portfolioSegments" :key="i"
                cx="50" cy="50" r="40" fill="none"
                :stroke="seg.color" stroke-width="14"
                :stroke-dasharray="seg.dash + ' ' + seg.gap"
                :stroke-dashoffset="seg.dashOffset"
                transform="rotate(-90 50 50)"
              />
            </svg>
            <div v-for="row in portfolioBreakdown" :key="row.category.name" class="bar-row">
              <span class="legend-swatch" :style="{ background: row.category.color }"></span>
              <span class="bar-name">{{ legendName(row.category.name) }}</span>
              <span class="bar-amount">{{ fmtPercent(row.amount) }}</span>
            </div>
          </section>

          <section class="panel">
            <div class="subsection-header">
              <span>{{ categoryLabel }}</span>
              <span :class="currentRealizedPL >= 0 ? 'positive' : 'negative'">
                已實現 {{ currentRealizedPL >= 0 ? '+' : '' }}{{ currentCurrency !== 'TWD' ? currencySymbol(currentCurrency) : '' }}{{ fmtCur(currentRealizedPL, currentCurrency) }}
                <span v-if="currentCurrency !== 'TWD'" class="muted"> (≈ NT$ {{ fmt(toBase(currentRealizedPL)) }})</span>
                <span v-if="currentDividendTotal > 0" class="positive"> · 股利 +{{ fmtNative(currentDividendTotal) }}</span>
              </span>
            </div>
            <template v-for="(h, idx) in orderedHoldings" :key="holdingKey(h)">
              <div v-if="idx === activeHoldings.length" class="list-row clickable cleared-header" @click="clearedOpen = !clearedOpen">
                <div class="list-row-main">
                  <div class="list-row-title">已出清<span class="ticker-name">{{ clearedHoldings.length }} 檔</span></div>
                </div>
                <span class="expand-arrow" :class="{ open: clearedOpen }">›</span>
              </div>
              <div v-if="h.quantity > 0 || clearedOpen" :class="{ 'holding-cleared': !(h.quantity > 0) }">
              <div class="list-row clickable" @click="toggleHoldingExpand(h)">
                <div class="list-row-main">
                  <div class="list-row-title">{{ h.ticker }}<span v-if="nameOf(h)" class="ticker-name">{{ nameOf(h) }}</span><span v-if="!(h.quantity > 0)" class="cleared-badge">已出清</span></div>
                  <div class="list-row-sub">
                    {{ accountName(h) }}<template v-if="h.quantity > 0"> · {{ '持有 ' + h.quantity + ' 股 · 均價 ' + (currentCurrency !== 'TWD' ? currencySymbol(currentCurrency) : '') + fmtPrice(h.avgCost) }}</template>
                    <span v-if="pledgedFor(h) > 0"> · 質押 {{ pledgedFor(h) }} 股(可賣 {{ Math.max(0, h.quantity - pledgedFor(h)) }})</span>
                    <span v-if="dividendOf(h)" class="positive"> · 股利 +{{ fmtNative(dividendOf(h).total) }}<template v-if="dividendYieldText(h)"> · 殖利率 {{ dividendYieldText(h) }}</template></span>
                  </div>
                </div>
                <div class="list-row-amount" :class="{ negative: h.realizedPL < 0, positive: h.realizedPL > 0 }">
                  <span v-if="!(h.quantity > 0)" class="amount-note">最終損益 </span>{{ h.realizedPL > 0 ? '+' : '' }}{{ currentCurrency !== 'TWD' ? currencySymbol(currentCurrency) : '' }}{{ fmtCur(h.realizedPL, currentCurrency) }}
                  <div v-if="currentCurrency !== 'TWD'" class="list-row-sub">≈ NT$ {{ fmt(toBase(h.realizedPL)) }}</div>
                </div>
                <span class="expand-arrow" :class="{ open: expandedHoldingKey === holdingKey(h) }">›</span>
              </div>
              <template v-if="expandedHoldingKey === holdingKey(h)">
                <InvestmentRowItem v-for="i in holdingTrades(h)" :key="i.id" :investment="i" show-date @edit="openEdit" @remove="remove" />
                <DividendRowItem v-for="t in (dividendOf(h) ? dividendOf(h).items : [])" :key="t.id" :dividend="t" show-date @edit="openDividend(t.id, h)" @remove="removeDividend" />
                <div class="dividend-add"><button @click.stop="openDividend('new', h)">＋ 記這檔的股利</button></div>
              </template>
              </div>
            </template>
          </section>
        </template>

        <section class="panel">
          <div class="view-header">
            <h3>交易明細<span v-if="showAllCategories" class="muted"> · 全部分類</span></h3>
            <button class="primary" @click="openNew">+ 新增</button>
          </div>

          <div class="month-nav">
            <button @click="shiftMonth(-1)">‹</button>
            <span class="month-label">{{ year }} 年 {{ month }} 月</span>
            <button @click="shiftMonth(1)">›</button>
          </div>

          <div class="search-controls">
            <input class="search-field" v-model="query" placeholder="搜尋標的、備註或帳戶" />

            <div class="chip-row" style="margin: 10px 0 4px;">
              <span
                v-for="opt in actionOptions" :key="opt.action"
                class="chip" :class="{ selected: actionFilters.includes(opt.action) }"
                @click="toggleAction(opt.action)"
              >{{ opt.label }}</span>
              <span class="chip" :class="{ selected: showAllCategories }" @click="showAllCategories = !showAllCategories">全部分類</span>
            </div>
          </div>

          <div v-if="groupedByDate.length === 0" class="empty">找不到符合條件的交易</div>
          <div v-for="g in groupedByDate" :key="g.date" class="subsection">
            <div class="subsection-header clickable" @click="toggleDateExpand(g.date)">
              <span>{{ g.date }}</span>
              <span>
                <span v-if="g.buyTotal" class="negative">-{{ fmtGroupAmount(g.buyTotal) }}<span v-if="!showAllCategories && currentCurrency !== 'TWD'" class="muted"> (≈ {{ fmt(toBaseAsOf(g.buyTotal, g.date)) }})</span></span>
                <span v-if="g.sellTotal" class="positive"> +{{ fmtGroupAmount(g.sellTotal) }}<span v-if="!showAllCategories && currentCurrency !== 'TWD'" class="muted"> (≈ {{ fmt(toBaseAsOf(g.sellTotal, g.date)) }})</span></span>
                <span class="expand-arrow" :class="{ open: expandedDate === g.date }">›</span>
              </span>
            </div>
            <template v-if="expandedDate === g.date">
              <InvestmentRowItem v-for="i in g.items" :key="i.id" :investment="i" @edit="openEdit" @remove="remove" />
            </template>
          </div>
        </section>
      </div>

      <TickerFixModal v-if="fixOpen" @close="fixOpen = false" />

      <DividendFormModal
        v-if="dividendForm"
        :editing-id="dividendForm.id"
        :preset-account-id="dividendForm.accountId"
        :preset-ticker="dividendForm.ticker"
        @close="dividendForm = null"
      />
      <InvestmentFormModal
        v-if="editingId"
        :editing-id="editingId"
        :default-date="formDefaultDate"
        :default-market="currentMarket"
        @close="onFormClosed"
      />
    </div>
  `,
};
