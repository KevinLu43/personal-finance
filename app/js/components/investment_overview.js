// The holdings summary, pulled out of the 投資 (recording) tab into its own
// screen — recording a trade and reviewing what you hold are different
// tasks with different rhythms, and stacking both under one calendar made
// the recording screen longer without making either easier to use.

const INVESTMENT_ACTION_LABELS = { buy: '買入', sell: '賣出' };

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
  components: { InvestmentRowItem, InvestmentFormModal, TickerFixModal },
  data() {
    const now = new Date();
    return {
      selectedMarket: 'TW',
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      query: '',
      actionFilters: [], // subset of buy/sell; empty means "all"
      editingId: null,
      formDefaultDate: null,
      expandedDate: null, // which 交易明細 date group is expanded, one at a time
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
      return this.allHoldings.reduce((s, h) => s + h.realizedPL * Models.rateOf(Models.marketCurrency(h.market), Store.state.rates), 0);
    },
    // Everything below this point is scoped to whichever market tab is
    // active — one owner for "which market am I looking at" instead of each
    // section re-filtering by selectedMarket its own way.
    currentHoldings() {
      return this.allHoldings.filter((h) => h.market === this.selectedMarket);
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
    marketLabel() {
      return this.selectedMarket === 'TW' ? '台股' : '美股';
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
        .filter((i) => !i.isDeleted && i.market === this.selectedMarket && i.date.startsWith(this.yearMonth))
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
        if (i.action === 'buy') group.buyTotal += net;
        else group.sellTotal += net;
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
    // 持股比例's legend: a Taiwan holding reads as its company name (a bare
    // four-digit code says nothing at a glance), falling back to the code when
    // the directory has none; US tickers are already what people recognise.
    legendName(ticker) {
      return this.selectedMarket === 'TW' ? window.tickerName('TW', ticker) || ticker : ticker;
    },
    nameOf(h) {
      return window.tickerName(h.market, h.ticker);
    },
    pledgedFor(h) {
      return Store.pledgedQuantity(h.market, h.ticker);
    },
    fmtPercent(amount) {
      return this.portfolioTotal > 0 ? (amount / this.portfolioTotal * 100).toFixed(1) + '%' : '0%';
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
    openNew() {
      const today = new Date().toISOString().slice(0, 10);
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
        <h2>投資總覽<span class="muted"> · 已實現(台幣){{ totalRealizedPL >= 0 ? '+' : '' }}{{ fmt(totalRealizedPL) }}</span></h2>
      </div>

      <div v-if="needsTickerFix" class="notice-bar">
        <span>有 {{ fixGroups.length }} 種標的還沒有股票代號</span>
        <button class="primary" @click="fixOpen = true">補上代號</button>
      </div>

      <div class="mode-toggle">
        <button :class="{ active: selectedMarket === 'TW' }" @click="selectedMarket = 'TW'">台股</button>
        <button :class="{ active: selectedMarket === 'US' }" @click="selectedMarket = 'US'">美股</button>
      </div>

      <div v-if="currentHoldings.length === 0" class="empty">{{ marketLabel }}還沒有任何投資交易</div>

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
              <span>{{ marketLabel }}</span>
              <span :class="currentRealizedPL >= 0 ? 'positive' : 'negative'">
                已實現 {{ currentRealizedPL >= 0 ? '+' : '' }}{{ fmt(currentRealizedPL) }}
              </span>
            </div>
            <div v-for="h in currentHoldings" :key="h.ticker" class="list-row">
              <div class="list-row-main">
                <div class="list-row-title">{{ h.ticker }}<span v-if="nameOf(h)" class="ticker-name">{{ nameOf(h) }}</span></div>
                <div class="list-row-sub">
                  {{ h.quantity > 0 ? ('持有 ' + h.quantity + ' 股 · 均價 ' + fmtPrice(h.avgCost)) : '已出清' }}
                  <span v-if="pledgedFor(h) > 0"> · 質押 {{ pledgedFor(h) }} 股(可賣 {{ Math.max(0, h.quantity - pledgedFor(h)) }})</span>
                </div>
              </div>
              <div class="list-row-amount" :class="{ negative: h.realizedPL < 0, positive: h.realizedPL > 0 }">
                {{ h.realizedPL > 0 ? '+' : '' }}{{ fmt(h.realizedPL) }}
              </div>
            </div>
          </section>
        </template>

        <section class="panel">
          <div class="view-header">
            <h3>交易明細</h3>
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
            </div>
          </div>

          <div v-if="groupedByDate.length === 0" class="empty">找不到符合條件的交易</div>
          <div v-for="g in groupedByDate" :key="g.date" class="subsection">
            <div class="subsection-header clickable" @click="toggleDateExpand(g.date)">
              <span>{{ g.date }}</span>
              <span>
                <span v-if="g.buyTotal" class="negative">-{{ fmt(g.buyTotal) }}</span>
                <span v-if="g.sellTotal" class="positive"> +{{ fmt(g.sellTotal) }}</span>
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

      <InvestmentFormModal
        v-if="editingId"
        :editing-id="editingId"
        :default-date="formDefaultDate"
        :default-market="selectedMarket"
        @close="onFormClosed"
      />
    </div>
  `,
};
