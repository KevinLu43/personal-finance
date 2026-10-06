// Past this many categories, 分類支出's donut and legend fold the rest into one "其他" row (dashboard.js's categoryBreakdownRows).
const DASHBOARD_CATEGORY_MAX_SERIES = 6;

const DASHBOARD_TYPE_LABELS = { expense: '支出', income: '收入', transfer: '轉帳' };

// The 記帳明細 date groups (one folded header per day, its transactions
// underneath when open). Shared by the month view, where they are the whole
// list, and the year view, where each month folds a set of them.
const DashboardDateGroups = {
  components: { TransactionRowItem },
  props: {
    groups: { type: Array, required: true },
    expandedDate: { type: String, default: null },
  },
  emits: ['toggle', 'edit', 'remove'],
  methods: {
    fmt(n) {
      return Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
    },
  },
  template: `
    <div v-for="g in groups" :key="g.date" class="subsection">
      <div class="subsection-header clickable" @click="$emit('toggle', g.date)">
        <span>{{ g.date }}</span>
        <span>
          <span v-if="g.expenseTotal" class="negative">-{{ fmt(g.expenseTotal) }}</span>
          <span v-if="g.incomeTotal" class="positive"> +{{ fmt(g.incomeTotal) }}</span>
          <span class="expand-arrow" :class="{ open: expandedDate === g.date }">›</span>
        </span>
      </div>
      <template v-if="expandedDate === g.date">
        <TransactionRowItem v-for="t in g.items" :key="t.id" :transaction="t" @edit="$emit('edit', $event)" @remove="$emit('remove', $event)" />
      </template>
    </div>
  `,
};

// 資產總覽's account rows, one instance per column (資產/負債) so the two
// sides render from the same markup instead of two hand-copied blocks.
// percentBase is only passed for the 資產 column — a debt figure showing
// "X% of assets" wouldn't mean anything, so omitting it (0) just turns the
// percentage off, the same way the old single-list version skipped it for
// credit_card/loan rows.
const DashboardAccountGroups = {
  props: {
    groups: { type: Array, required: true },
    percentBase: { type: Number, default: 0 },
  },
  methods: {
    fmt(n) {
      return Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
    },
    fmtCur(n, code) {
      return Models.formatMoney(n, code);
    },
    currencySymbol(code) {
      return Models.currencySymbol(code);
    },
    fmtPercent(amount) {
      return this.percentBase > 0 ? (amount / this.percentBase * 100).toFixed(1) + '%' : '0%';
    },
  },
  template: `
    <div v-for="g in groups" :key="g.label" class="subsection">
      <div class="subsection-header">
        <span>{{ g.label }}</span>
        <span :class="{ negative: g.subtotal < 0 }">{{ fmt(g.subtotal) }}</span>
      </div>
      <div v-for="row in g.rows" :key="row.account.id">
        <div class="bar-row">
          <span class="icon-badge-sm" :style="{ background: (row.account.color || '#adb5bd') + '30' }">{{ row.icon }}</span>
          <span class="bar-name">{{ row.account.name }}</span>
          <span class="bar-amount" :class="{ negative: row.displayBalance < 0 }">
            <span v-if="row.foreign" class="muted">{{ currencySymbol(row.account.currency) }}{{ fmtCur(row.nativeBalance, row.account.currency) }} ≈ </span>{{ fmt(row.displayBalance) }}<template v-if="percentBase > 0"> · {{ fmtPercent(row.displayBalance) }}</template>
          </span>
        </div>
        <div v-if="row.unbilled > 0" class="account-split">
          <span>含分期總欠款 {{ fmt(row.displayBalance - row.unbilled) }}</span>
          <span>分期未入帳 {{ fmt(row.unbilled) }}</span>
        </div>
        <div v-if="row.account.kind === 'brokerage'" class="account-split">
          <span>現金 {{ row.foreign ? currencySymbol(row.account.currency) + fmtCur(row.cash, row.account.currency) : fmt(row.cash) }}</span>
          <span>持股成本 {{ row.foreign ? currencySymbol(row.account.currency) + fmtCur(row.holdingsCost, row.account.currency) : fmt(row.holdingsCost) }}</span>
        </div>
      </div>
    </div>
  `,
};

// The body of an expanded label in 標籤統計: a summary line, then a titled list
// of bar rows per breakdown. Purely presentational — DashboardView.labelDetail
// prepares `detail` (already formatted), so a label in the list and a label
// folded under 其他 render through the same code.
const LabelDetail = {
  props: ['detail'],
  data() {
    // What the operator has toggled; a section not in here follows its own
    // default (`open` from the parent — the short ones open, the long ones folded).
    return { toggled: {} };
  },
  methods: {
    isOpen(sec) {
      return sec.title in this.toggled ? this.toggled[sec.title] : sec.open;
    },
    toggle(sec) {
      this.toggled[sec.title] = !this.isOpen(sec);
    },
  },
  template: `
    <div class="category-detail-summary">{{ detail.summary }}</div>
    <template v-for="sec in detail.sections" :key="sec.title">
      <div class="category-detail-heading foldable" @click="toggle(sec)">
        <span class="expand-arrow" :class="{ open: isOpen(sec) }">›</span>{{ sec.title }}<span class="heading-count">{{ sec.rows.length }}</span>
      </div>
      <template v-if="isOpen(sec)">
        <div v-for="r in sec.rows" :key="r.key" class="category-detail-row">
          <span class="category-detail-note">{{ r.name }}</span>
          <span class="category-detail-bar-track">
            <span class="category-detail-bar-fill" :style="{ width: r.pct + '%', background: r.color }"></span>
          </span>
          <span class="category-detail-amount" :class="{ wide: r.wide }">{{ r.text }}</span>
        </div>
      </template>
    </template>
  `,
};

// The trend chart's 長條/折線 choice is a per-device viewing preference, kept
// in this browser only (the chart still works when storage is blocked).
const TREND_STYLE_KEY = 'pf_trend_style';
function readTrendStyle() {
  try {
    return localStorage.getItem(TREND_STYLE_KEY) === 'line' ? 'line' : 'bar';
  } catch (e) {
    return 'bar';
  }
}

const DashboardView = {
  components: { TransactionRowItem, TransactionFormModal, DashboardDateGroups, DashboardAccountGroups, LabelDetail, DonutChart },
  mixins: [DonutFocusMixin],
  data() {
    const now = new Date();
    return {
      viewMode: 'month', // 'month' | 'year'
      year: now.getFullYear(),
      month: now.getMonth() + 1, // 1-12
      query: '',
      typeFilters: [], // subset of expense/income/transfer; empty means "all"
      editingId: null,
      expandedCategoryId: null, // which 分類支出 row is expanded, one at a time
      categorySectionToggled: {}, // year view: that row's sections the operator folded/unfolded, by title
      expandedLabelId: null, // which 標籤統計 row is expanded, one at a time
      expandedOtherLabelId: null, // ...and, when that row is 其他, which label inside it is expanded
      labelScope: 'period', // 標籤統計 reads the selected month/year ('period') or every date ('all') — for a trip spanning months
      incomeOtherOpen: false, // 收入分類's folded 其他 row
      fixedExpenseOtherOpen: false, // 固定支出（月）'s folded 其他 row
      creditDebtOtherOpen: false, // 信用卡欠款's folded 其他 row
      creditSpendOtherOpen: false, // 信用卡刷卡's folded 其他 row
      expandedCreditCardId: null, // year view: which 信用卡刷卡 card's monthly trend is open, one at a time
      expandedDate: null, // which 記帳明細 date group is expanded, one at a time
      expandedMonth: null, // year view: which 記帳明細 month is open, one at a time
      trendPick: null, // index of the month picked on the trend chart, for the readout
      trendStyle: readTrendStyle(), // 收支與淨值趨勢 draws income/expense as 'bar' or 'line'
      fixedExpensePick: null, // year view: index of the month picked on 固定支出's chart, for the readout
      kpiCompareMode: 'prev', // month view only: 'prev' (較上月) | 'yoy' (較去年同月)
    };
  },
  watch: {
    // A different year or mode is a different list; don't carry an open month over.
    viewMode() {
      this.clearDonutFocus();
      this.trendPick = null;
      this.expandedMonth = null;
      this.expandedDate = null;
    },
    month() {
      this.clearDonutFocus();
      this.trendPick = null;
    },
    year() {
      this.clearDonutFocus();
      this.trendPick = null;
      this.fixedExpensePick = null;
      this.expandedMonth = null;
      this.expandedDate = null;
    },
  },
  computed: {
    yearMonth() {
      return `${this.year}-${String(this.month).padStart(2, '0')}`;
    },
    // Descending so the dropdown's most likely picks (this year, last year)
    // sit at the top. Reaches back to cover every year real data exists in,
    // not just a fixed lookback, the same rule the reference app's own
    // month/year picker used: min(earliest entry, now - 4).
    yearOptions() {
      const now = new Date().getFullYear();
      const dataYears = [...Store.state.transactions, ...Store.state.investments].map((r) => Number(r.date.slice(0, 4)));
      const minYear = dataYears.length ? Math.min(now - 4, ...dataYears) : now - 4;
      const years = [];
      for (let y = now; y >= minYear; y--) years.push(y);
      return years;
    },
    monthOptions() {
      return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    },

    // --- Month mode ---
    monthSummary() {
      return Store.monthlySummary(this.yearMonth);
    },
    monthTrendMonths() {
      return Store.monthlyTrend(this.yearMonth, 6);
    },

    // --- Year mode ---
    yearSummary() {
      return Store.yearlySummary(this.year);
    },
    // Exactly Jan-Dec of the selected year, by asking for 12 months ending
    // at December — monthlyTrend needs no year-specific variant for this.
    yearTrendMonths() {
      return Store.monthlyTrend(`${this.year}-12`, 12);
    },

    // --- Whichever mode is active, read through one name ---
    // The date prefix that scopes "this period" — one owner rather than
    // each period-scoped computed/method redoing the same ternary.
    periodPrefix() {
      return this.viewMode === 'year' ? String(this.year) : this.yearMonth;
    },
    activeSummary() {
      return this.viewMode === 'year' ? this.yearSummary : this.monthSummary;
    },
    activeTrendMonths() {
      return this.viewMode === 'year' ? this.yearTrendMonths : this.monthTrendMonths;
    },
    trendChart() {
      return Models.buildTrendChart(this.activeTrendMonths, Models.localToday().slice(0, 7));
    },
    // Net worth over the same window the income/expense trend above uses
    // (6 months in month mode, the selected year's Jan–Dec in year mode) —
    // one owner for "which window" via activeTrendMonths.length so the two
    // charts never quietly fall out of sync on range.
    netWorthTrendMonths() {
      return this.viewMode === 'year'
        ? Store.netWorthTrend(`${this.year}-12`, 12)
        : Store.netWorthTrend(this.yearMonth, 6);
    },
    netWorthChart() {
      return Models.buildNetWorthChart(this.netWorthTrendMonths, Models.localToday().slice(0, 7));
    },
    netWorthChange() {
      const months = this.netWorthTrendMonths;
      return months.length < 2 ? 0 : months[months.length - 1].netWorth - months[0].netWorth;
    },
    // The period the summary cards compare against: last month (or, toggled
    // in month view, the same month last year) — year view always compares
    // to last year, the only "same period a year back" a year has.
    previousSummary() {
      if (this.viewMode === 'year') return Store.yearlySummary(this.year - 1);
      if (this.kpiCompareMode === 'yoy') return Store.monthlySummary(`${this.year - 1}-${String(this.month).padStart(2, '0')}`);
      const prev = this.month === 1 ? `${this.year - 1}-12` : `${this.year}-${String(this.month - 1).padStart(2, '0')}`;
      return Store.monthlySummary(prev);
    },
    // Net worth at the end of the selected period and how far it moved since
    // whichever period previousSummary is comparing against (month: the
    // previous month's end, or toggled, the same month a year back; year:
    // the previous December's).
    netWorthKpi() {
      let months;
      if (this.viewMode === 'year') months = Store.netWorthTrend(`${this.year}-12`, 13);
      else if (this.kpiCompareMode === 'yoy') months = Store.netWorthTrend(this.yearMonth, 13);
      else months = Store.netWorthTrend(this.yearMonth, 2);
      const last = months[months.length - 1];
      const first = months[0];
      return { value: last.netWorth, change: months.length < 2 ? 0 : last.netWorth - first.netWorth };
    },
    kpiCards() {
      const year = this.viewMode === 'year';
      const s = this.activeSummary;
      const p = this.previousSummary;
      const w = this.netWorthKpi;
      return [
        { key: 'income', label: year ? '全年收入' : '收入', value: s.income, tone: 'income', delta: this.kpiDelta(s.income, p.income, true) },
        { key: 'expense', label: year ? '全年支出' : '支出', value: s.expense, tone: 'expense', delta: this.kpiDelta(s.expense, p.expense, false) },
        { key: 'net', label: year ? '全年結餘' : '結餘', value: s.net, tone: s.net >= 0 ? 'income' : 'expense', delta: this.kpiDelta(s.net, p.net, true) },
        { key: 'worth', label: year ? '年底淨值' : '月底淨值', value: w.value, tone: w.value >= 0 ? 'income' : 'expense', changeText: (year ? '今年 ' : (this.kpiCompareMode === 'yoy' ? '較去年同月 ' : '本月 ')) + (w.change >= 0 ? '+' : '') + this.fmt(w.change), changeGood: w.change >= 0 },
      ];
    },
    // What the trend chart's picked month reads out: that month's income,
    // expense and net, plus net worth at its end.
    trendReadout() {
      const i = this.trendPick;
      const m = i === null ? null : this.activeTrendMonths[i];
      if (!m) return null;
      const w = this.netWorthTrendMonths[i];
      return { label: m.yearMonth.slice(0, 4) + ' 年 ' + m.month + ' 月', income: m.income, expense: m.expense, net: m.net, worth: w ? w.netWorth : null };
    },
    // 分類支出's rows, capped at the biggest DASHBOARD_CATEGORY_MAX_SERIES —
    // past that, a household with many small categories turns the donut
    // into unreadable slivers and the legend into a wall of text. The rest
    // fold into one "其他" row that still expands (see the template) onto
    // the categories inside it, so nothing is actually hidden, just collapsed.
    categoryBreakdownRows() {
      return this.capBreakdown(this.activeSummary.categoryBreakdown, 'category');
    },
    donutSegments() {
      return Models.buildDonutSegments(this.categoryBreakdownRows);
    },
    // The percentage base for 分類支出's rows — the breakdown's own total
    // rather than activeSummary.expense, since an uncategorized expense has
    // no row here at all and would otherwise make the shown rows add up to
    // less than 100%.
    categoryBreakdownTotal() {
      return this.activeSummary.categoryBreakdown.reduce((s, row) => s + row.amount, 0);
    },
    incomeBreakdownRows() {
      return this.capBreakdown(this.activeSummary.incomeCategoryBreakdown, 'category');
    },
    incomeDonutSegments() {
      return Models.buildDonutSegments(this.incomeBreakdownRows);
    },
    incomeBreakdownTotal() {
      return this.activeSummary.incomeCategoryBreakdown.reduce((s, row) => s + row.amount, 0);
    },
    // Budgets are a standing monthly cap; the year view compares a whole
    // year's spend against 12 months of it instead of leaving budgets out
    // of year mode entirely.
    budgetProgress() {
      const breakdown = this.viewMode === 'year' ? this.yearSummary.categoryBreakdown : this.monthSummary.categoryBreakdown;
      const periods = this.viewMode === 'year' ? 12 : 1;
      return Models.budgetProgress(Store.state.categories, breakdown, periods);
    },
    // Month mode's 固定支出: every recurring rule and every loan that was paid
    // this month as its own line, charted as a donut. Loan payments count in
    // full — principal *and* interest — since this is money that goes out
    // every month regardless; unlike 支出 (which only sees the interest, because
    // repaying principal isn't spending).
    fixedExpenseRows() {
      if (this.viewMode !== 'month') return [];
      return Models.fixedExpenseBreakdown(Store.baseTransactionList(), this.periodPrefix, Store.state.categories, Store.state.accounts, Store.state.recurringTransactions);
    },
    // This month only: the 固定支出 still to run before the month ends — rules
    // not yet booked and loan installments (principal + interest, estimated the
    // way the 固定收支 panel does) — as 預計 rows beside what is booked, so the
    // month's whole fixed spend shows from its first day. Nothing else on the
    // page counts them; they are never written anywhere.
    fixedExpenseExpectedRows() {
      const today = Models.localToday();
      if (this.viewMode !== 'month' || this.yearMonth !== today.slice(0, 7)) return [];
      const { recurringTransactions, accounts, categories } = Store.state;
      const md = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
      return Models.projectedItems({ recurrings: recurringTransactions, accounts, pledges: [] }, today, `${this.yearMonth}-31`)
        .filter((p) => p.date.startsWith(this.yearMonth) && ((p.kind === 'recurring' && p.type === 'expense') || p.kind === 'loan'))
        .map((p) => {
          if (p.kind === 'loan') {
            const loan = accounts.find((a) => a.id === p.accountId);
            const left = loan.loanInstallments - loan.loanPaidInstallments;
            const payment = Math.round(Models.installmentBreakdown(Store.accountBalance(loan), loan.loanRate, left).payment);
            const color = loan.color || '#e09f3e';
            return { key: 'expected:' + p.key, kind: 'loan', expected: true, category: { name: loan.name, color }, detail: `${md(p.date)} 預計`, amount: Store.baseAmountOf({ amount: payment, accountId: loan.id, date: p.date }) };
          }
          const rule = recurringTransactions.find((r) => p.key.startsWith(`rec:${r.id}:`));
          const category = categories.find((c) => c.id === p.categoryId);
          const plan = rule && rule.installment;
          const name = plan ? `${plan.item || rule.note || (category ? category.name : '')} 分期` : (rule && rule.note) || (category ? category.name : '(未分類)');
          const detail = plan ? `第 ${Models.installmentIndex(rule) + 1}/${plan.count} 期 · ${md(p.date)} 預計` : `${md(p.date)} 預計`;
          return { key: 'expected:' + p.key, kind: 'rule', expected: true, category: { name, color: (category && category.color) || '#adb5bd' }, detail, amount: Store.baseAmountOf({ amount: p.amount, accountId: p.accountId, date: p.date }) };
        });
    },
    // Booked and 預計 rows together, biggest first — what the donut and list show.
    fixedExpenseAllRows() {
      return [...this.fixedExpenseRows, ...this.fixedExpenseExpectedRows].sort((a, b) => b.amount - a.amount);
    },
    fixedExpenseBookedTotal() {
      return this.fixedExpenseRows.reduce((sum, row) => sum + row.amount, 0);
    },
    fixedExpenseExpectedTotal() {
      return this.fixedExpenseExpectedRows.reduce((sum, row) => sum + row.amount, 0);
    },
    fixedExpenseTotal() {
      return this.fixedExpenseBookedTotal + this.fixedExpenseExpectedTotal;
    },
    // Capped the same way as every other donut on this page — a household
    // with several subscriptions and a couple of loan installments can
    // easily pass 6 lines otherwise.
    fixedExpenseCappedRows() {
      return this.capBreakdown(this.fixedExpenseAllRows, 'category');
    },
    fixedExpenseDonutSegments() {
      return Models.buildDonutSegments(this.fixedExpenseCappedRows);
    },
    // Year mode's 固定支出 chart: rule spending and loan payments per month
    // of the selected year, Jan–Dec, stacked.
    yearlyFixedExpenseMonths() {
      return Store.monthlyFixedExpense(this.year);
    },
    fixedExpenseChart() {
      return Models.buildFixedExpenseChart(this.yearlyFixedExpenseMonths, Store.state.categories, Store.state.accounts);
    },
    recurringExpenseYearTotal() {
      return this.yearlyFixedExpenseMonths.reduce((sum, m) => sum + m.amount, 0);
    },
    // What 固定支出's chart reads out when a month is picked: that month's
    // total plus its breakdown, split the same way the chart's own bars and
    // legend are (top categories, then 其他, then each loan) so the numbers under
    // a bar always match the colors in it.
    fixedExpenseReadout() {
      const i = this.fixedExpensePick;
      const m = i === null ? null : this.yearlyFixedExpenseMonths[i];
      if (!m) return null;
      const topKeys = new Set(this.fixedExpenseChart.series.filter((s) => s.key !== '__other__' && !s.loanId).map((s) => s.key));
      const parts = this.fixedExpenseChart.series
        .map((s) => {
          let amount;
          if (s.loanId) amount = m.byLoan.get(s.loanId) || 0;
          else if (s.key === '__other__') amount = [...m.byCategory.entries()].filter(([key]) => !topKeys.has(key)).reduce((sum, [, v]) => sum + v, 0);
          else amount = m.byCategory.get(s.key) || 0;
          return { key: s.key, name: s.name, color: s.color, amount };
        })
        .filter((p) => p.amount > 0);
      return { label: `${this.year} 年 ${m.month} 月`, total: m.amount + m.loanAmount, parts };
    },
    loanPaymentYearTotal() {
      return this.yearlyFixedExpenseMonths.reduce((sum, m) => sum + m.loanAmount, 0);
    },
    // Same period, expense-only transactions — the input labelBreakdown
    // needs and the same set categoryLabelBreakdown/labelNoteBreakdown pick
    // through by category or by label.
    periodExpenseTransactions() {
      return Store.baseTransactionList().filter(
        (t) => !t.isDeleted && t.type === 'expense' && t.date.startsWith(this.periodPrefix)
      );
    },
    // What 標籤統計 works from: the selected period, or all expenses ever.
    labelScopeTransactions() {
      if (this.labelScope === 'all') {
        return Store.baseTransactionList().filter((t) => !t.isDeleted && t.type === 'expense');
      }
      return this.periodExpenseTransactions;
    },
    // Each transaction's own-currency amount, so a label's spend can be shown
    // in yen/dollars as well as the TWD it converts to.
    nativeAmountById() {
      return new Map(Store.state.transactions.map((t) => [t.id, t.amount]));
    },
    labelBreakdown() {
      return Models.labelBreakdown(this.labelScopeTransactions, Store.state.transactionLabels, Store.state.labels);
    },
    labelBreakdownRows() {
      return this.capBreakdown(this.labelBreakdown, 'label');
    },
    // The percentage base for 標籤統計's rows — same "sum of the rows
    // actually shown" rule categoryBreakdownTotal uses, not a share of
    // total period expense. Labels overlap by construction, so these
    // percentages were never going to add up to 100% of anything anyway;
    // this just answers "how does this label's total compare to the
    // period's other labelled spending" one label at a time.
    labelBreakdownTotal() {
      return this.labelBreakdown.reduce((s, row) => s + row.amount, 0);
    },
    typeOptions() {
      return Object.entries(DASHBOARD_TYPE_LABELS).map(([type, label]) => ({ type, label }));
    },
    // Search matches the note, the category name, either side of the
    // account (the account it's on, and — for a transfer — the account it
    // went to), or any label it carries — the same browse/search feature
    // that used to live on its own "交易" tab, now folded into the overview
    // since that is where the operator actually wanted it. Scoped to the
    // month or the whole year depending on which mode is active.
    filteredTransactions() {
      const q = this.query.trim().toLowerCase();
      return Store.state.transactions
        .filter((t) => !t.isDeleted && t.date.startsWith(this.periodPrefix))
        .filter((t) => this.typeFilters.length === 0 || this.typeFilters.includes(t.type))
        .filter((t) => {
          if (!q) return true;
          const category = Store.state.categories.find((c) => c.id === t.categoryId);
          const account = Store.state.accounts.find((a) => a.id === t.accountId);
          const toAccount = Store.state.accounts.find((a) => a.id === t.toAccountId);
          const noteMatch = (t.note || '').toLowerCase().includes(q);
          const categoryMatch = category ? category.name.toLowerCase().includes(q) : false;
          const accountMatch = account ? account.name.toLowerCase().includes(q) : false;
          const toAccountMatch = toAccount ? toAccount.name.toLowerCase().includes(q) : false;
          const labelMatch = Store.labelsForTransaction(t.id).some((l) => l.name.toLowerCase().includes(q));
          return noteMatch || categoryMatch || accountMatch || toAccountMatch || labelMatch;
        })
        .sort((a, b) => {
          if (a.date !== b.date) return a.date < b.date ? 1 : -1;
          return a.updatedAt < b.updatedAt ? 1 : -1;
        });
    },
    groupedByDate() {
      const groups = [];
      const byDate = new Map();
      for (const t of this.filteredTransactions) {
        let group = byDate.get(t.date);
        if (!group) {
          group = { date: t.date, items: [], expenseTotal: 0, incomeTotal: 0 };
          byDate.set(t.date, group);
          groups.push(group);
        }
        group.items.push(t);
        if (t.type === 'expense') group.expenseTotal += Store.baseAmountOf(t);
        else if (t.type === 'income') group.incomeTotal += Store.baseAmountOf(t);
      }
      return groups;
    },
    // Year view folds 記帳明細 by month — a whole year of dates in one list
    // is far too long to scroll — each month showing its count and totals and
    // opening onto its date groups. A search opens every month that has a
    // match, since a hit hidden inside a folded month would look like no result.
    monthGroups() {
      const months = [];
      const byKey = new Map();
      for (const g of this.groupedByDate) {
        const key = g.date.slice(0, 7);
        let m = byKey.get(key);
        if (!m) {
          m = { key, month: Number(key.slice(5, 7)), groups: [], count: 0, expenseTotal: 0, incomeTotal: 0 };
          byKey.set(key, m);
          months.push(m);
        }
        m.groups.push(g);
        m.count += g.items.length;
        m.expenseTotal += g.expenseTotal;
        m.incomeTotal += g.incomeTotal;
      }
      return months;
    },
    accountsWithBalance() {
      return Store.activeAccounts().map((a) => {
        const balance = Store.accountBalance(a); // what is owed, for a credit card — always positive
        // A credit card reduces net worth, so it displays (and sums) as a
        // negative figure — the same red/negative convention an expense
        // uses everywhere else, rather than reading like money on hand.
        // A 證券交割 account's worth is its cash plus what it holds, valued at
        // cost (no live quotes) — displayBalance is that total, so it flows
        // into netWorth/assetTotal/percentages; cash and holdingsCost are
        // kept alongside so the row can show the split.
        const holdingsCost = Store.accountHoldingsCost(a);
        const rate = Models.rateOf(a.currency, Store.state.rateHistory);
        const nativeBalance = (Models.isLiabilityKind(a.kind) ? -balance : balance) + holdingsCost;
        // Every total is in TWD; a foreign account keeps its own-currency
        // figure alongside for the row to show.
        const displayBalance = nativeBalance * rate;
        // A card's installment principal not billed yet, in TWD (see creditCardStatus).
        const card = a.kind === 'credit_card' ? Store.creditCardStatus(a) : null;
        const unbilled = card ? card.unbilled * rate : 0;
        return {
          account: a,
          unbilled,
          nativeBalance,
          foreign: rate !== 1 || (a.currency && a.currency !== 'TWD'),
          balance,
          cash: a.kind === 'brokerage' ? balance : null,
          holdingsCost,
          displayBalance,
          icon: Models.accountIcon(a),
        };
      });
    },
    netWorth() {
      return this.accountsWithBalance.reduce((sum, row) => sum + row.displayBalance, 0);
    },
    // 資產 − 負債 = 淨值, spelled out under 資產總覽's heading — assetTotal
    // already excludes every liability-kind row, so what's left out of
    // netWorth is exactly the debt those rows carry.
    liabilityTotal() {
      return this.assetTotal - this.netWorth;
    },
    // Installment principal on the cards not billed yet, in TWD — owed to the
    // bank but not in any balance (each period is booked as it's billed), so
    // shown beside 負債 and as a more conservative 淨值, never folded in.
    installmentUnbilledTotal() {
      return this.accountsWithBalance.reduce((sum, r) => sum + (r.unbilled || 0), 0);
    },
    // Which foreign currencies actually have an active account right now —
    // only those rates are shown, so a currency nobody holds doesn't clutter
    // the summary just because Models.CURRENCIES lists it.
    heldCurrencies() {
      const codes = new Set(
        this.accountsWithBalance
          .filter((r) => r.account.currency && r.account.currency !== 'TWD')
          .map((r) => r.account.currency)
      );
      return [...codes];
    },
    rateSummaryText() {
      return this.heldCurrencies
        .map((code) => `1 ${code} = ${Models.rateOf(code, Store.state.rateHistory)}`)
        .join('、');
    },
    // The percentage base for 資產總覽's rows — assets only. A credit card
    // is debt, not a slice of what you own, so it still counts toward
    // netWorth above (pulling it down) but is left out of this total and
    // never gets a percentage of its own.
    assetTotal() {
      return this.accountsWithBalance
        .filter((r) => !Models.isLiabilityKind(r.account.kind))
        .reduce((sum, r) => sum + r.displayBalance, 0);
    },
    // Grouped the same way the Accounts tab and the transaction form's
    // account picker already are, so "which account is which kind" reads
    // the same wherever an account list appears.
    accountGroups() {
      const kinds = [
        { kind: 'cash', label: '現金' },
        { kind: 'bank', label: '銀行' },
        { kind: 'credit_card', label: '信用卡' },
        { kind: 'brokerage', label: '證券交割' },
        { kind: 'loan', label: '借款' },
      ];
      return kinds
        .map(({ kind, label }) => {
          const rows = this.accountsWithBalance.filter((r) => r.account.kind === kind);
          return { kind, label, rows, subtotal: rows.reduce((sum, r) => sum + r.displayBalance, 0) };
        })
        .filter((g) => g.rows.length > 0);
    },
    // 資產總覽's two columns — same groups as accountGroups, just split by
    // whether the kind is a liability, so 資產 and 負債 read side by side
    // instead of interleaved in one stacked list.
    assetAccountGroups() {
      return this.accountGroups.filter((g) => !Models.isLiabilityKind(g.kind));
    },
    liabilityAccountGroups() {
      return this.accountGroups.filter((g) => Models.isLiabilityKind(g.kind));
    },
    // Share of total card debt each credit card carries, by its own colour —
    // a running snapshot like the rest of 資產總覽, not scoped to the
    // selected month/year. A card sitting at 0 (or, same as the 永豐大戶卡
    // case, showing a positive figure because of a sign mixup) isn't money
    // spent, so only genuine debt (a negative displayBalance) counts.
    creditCardDebtBreakdown() {
      return this.accountsWithBalance
        .filter((r) => r.account.kind === 'credit_card' && r.displayBalance < 0)
        .map((r) => ({
          category: { name: r.account.name, color: r.account.color || '#adb5bd' },
          amount: -r.displayBalance,
          card: Store.creditCardStatus(r.account),
        }))
        .sort((a, b) => b.amount - a.amount);
    },
    creditCardDebtTotal() {
      return this.creditCardDebtBreakdown.reduce((s, row) => s + row.amount, 0);
    },
    creditCardDebtRows() {
      return this.capBreakdown(this.creditCardDebtBreakdown, 'category');
    },
    creditCardDebtSegments() {
      return Models.buildDonutSegments(this.creditCardDebtRows);
    },
    // Unlike the debt snapshot above, this one *is* scoped to the selected
    // month/year — "how much did I actually charge to each card in this
    // period" reads periodExpenseTransactions the same way 分類支出 does,
    // just grouped by the transaction's account instead of its category.
    creditCardSpendBreakdown() {
      const byAccountId = new Map();
      for (const t of this.periodExpenseTransactions) {
        const account = Store.state.accounts.find((a) => a.id === t.accountId);
        if (!account || account.kind !== 'credit_card') continue;
        byAccountId.set(t.accountId, (byAccountId.get(t.accountId) || 0) + t.amount);
      }
      return [...byAccountId.entries()]
        .map(([accountId, amount]) => {
          const account = Store.state.accounts.find((a) => a.id === accountId);
          return { accountId, category: { name: account.name, color: account.color || '#adb5bd' }, amount };
        })
        .sort((a, b) => b.amount - a.amount);
    },
    creditCardSpendTotal() {
      return this.creditCardSpendBreakdown.reduce((s, row) => s + row.amount, 0);
    },
    creditCardSpendRows() {
      return this.capBreakdown(this.creditCardSpendBreakdown, 'category');
    },
    creditCardSpendSegments() {
      return Models.buildDonutSegments(this.creditCardSpendRows);
    },
  },
  methods: {
    // Shared by every donut/legend list on this page that can grow long —
    // caps at DASHBOARD_CATEGORY_MAX_SERIES rows (already sorted by amount
    // desc) and folds the rest into one foldable "其他" row, the same
    // pattern categoryBreakdownRows introduced for 支出分類. `keyField` is
    // 'category' or 'label' — whichever key a row's name/icon/color live
    // under; the synthetic 其他 row always uses that same key so its shape
    // matches every other row in the list.
    capBreakdown(rows, keyField = 'category') {
      if (rows.length <= DASHBOARD_CATEGORY_MAX_SERIES) return rows;
      const top = rows.slice(0, DASHBOARD_CATEGORY_MAX_SERIES);
      const rest = rows.slice(DASHBOARD_CATEGORY_MAX_SERIES);
      const otherAmount = rest.reduce((s, row) => s + row.amount, 0);
      const other = { amount: otherAmount, otherRows: rest };
      other[keyField] = { id: '__other__', name: '其他', icon: '➕', color: '#8a8a8a' };
      return [...top, other];
    },
    toggleIncomeOther() {
      this.incomeOtherOpen = !this.incomeOtherOpen;
    },
    toggleCreditDebtOther() {
      this.creditDebtOtherOpen = !this.creditDebtOtherOpen;
    },
    toggleCreditSpendOther() {
      this.creditSpendOtherOpen = !this.creditSpendOtherOpen;
    },
    toggleFixedExpenseOther() {
      this.fixedExpenseOtherOpen = !this.fixedExpenseOtherOpen;
    },
    // Net worth's marker: a diamond, so it isn't mistaken for the net line's circles.
    // "較上月 ▲12%" against the previous period; `goodWhenUp` says whether a
    // rise is the good direction (income, net) or the bad one (expense).
    currencySymbol(code) {
      return Models.currencySymbol(code);
    },
    fmtCur(n, code) {
      return Models.formatMoney(n, code);
    },
    kpiDelta(cur, prev, goodWhenUp) {
      const label = this.viewMode === 'year' ? '較去年' : (this.kpiCompareMode === 'yoy' ? '較去年同月' : '較上月');
      if (cur === prev) return { text: label + ' 持平', good: null };
      if (!prev) return { text: label + ' 新增', good: null };
      const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
      if (pct === 0) return { text: label + ' 持平', good: null };
      const up = cur > prev;
      return { text: label + ' ' + (up ? '▲' : '▼') + Math.abs(pct) + '%', good: up === goodWhenUp };
    },
    pickTrend(i) {
      this.trendPick = this.trendPick === i ? null : i;
    },
    pickFixedExpense(i) {
      this.fixedExpensePick = this.fixedExpensePick === i ? null : i;
    },
    setTrendStyle(style) {
      this.trendStyle = style;
      try { localStorage.setItem(TREND_STYLE_KEY, style); } catch (e) { /* this view only */ }
    },
    diamondPoints(x, y) {
      return [x + ',' + (y - 3), (x + 2.5) + ',' + y, x + ',' + (y + 3), (x - 2.5) + ',' + y].join(' ');
    },
    fmt(n) {
      return n.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
    },
    fmtCreditCardDebtPercent(amount) {
      return this.creditCardDebtTotal > 0 ? (amount / this.creditCardDebtTotal * 100).toFixed(1) + '%' : '0%';
    },
    fmtCreditCardSpendPercent(amount) {
      return this.creditCardSpendTotal > 0 ? (amount / this.creditCardSpendTotal * 100).toFixed(1) + '%' : '0%';
    },
    fmtFixedPercent(amount) {
      return this.fixedExpenseTotal > 0 ? (amount / this.fixedExpenseTotal * 100).toFixed(1) + '%' : '0%';
    },
    fmtCategoryPercent(amount) {
      return this.categoryBreakdownTotal > 0 ? (amount / this.categoryBreakdownTotal * 100).toFixed(1) + '%' : '0%';
    },
    fmtLabelPercent(amount) {
      return this.labelBreakdownTotal > 0 ? (amount / this.labelBreakdownTotal * 100).toFixed(1) + '%' : '0%';
    },
    fmtIncomePercent(amount) {
      return this.incomeBreakdownTotal > 0 ? (amount / this.incomeBreakdownTotal * 100).toFixed(1) + '%' : '0%';
    },
    toggleType(type) {
      const idx = this.typeFilters.indexOf(type);
      if (idx === -1) this.typeFilters.push(type);
      else this.typeFilters.splice(idx, 1);
    },
    toggleCategoryExpand(categoryId) {
      this.expandedCategoryId = this.expandedCategoryId === categoryId ? null : categoryId;
      this.categorySectionToggled = {};
    },
    // Year view folds an expanded 分類支出 row's sections the way LabelDetail
    // does: the breakdown open, the 12-row 逐月比較 folded, until toggled.
    isCategorySectionOpen(title, open) {
      return title in this.categorySectionToggled ? this.categorySectionToggled[title] : open;
    },
    toggleCategorySection(title, open) {
      this.categorySectionToggled[title] = !this.isCategorySectionOpen(title, open);
    },
    // 分類支出(年度)'s 逐月比較: this category's (or, for the folded 其他 row,
    // every category folded into it) spending in each of the selected year's
    // 12 months. Same source as monthlySummary/yearlySummary (baseTransactionList,
    // expense only), just bucketed by calendar month instead of summed once.
    monthlyAmountsForCategories(categoryIds) {
      const totals = new Array(12).fill(0);
      for (const t of Store.baseTransactionList()) {
        if (t.isDeleted || t.type !== 'expense' || !t.categoryId || !categoryIds.has(t.categoryId)) continue;
        if (t.date.slice(0, 4) !== String(this.year)) continue;
        totals[Number(t.date.slice(5, 7)) - 1] += t.amount;
      }
      const max = Math.max(...totals, 1);
      return totals.map((amount, i) => ({ month: i + 1, amount, pct: (amount / max) * 100 }));
    },
    categoryMonthlyBreakdown(row) {
      const ids = row.otherRows ? new Set(row.otherRows.map((d) => d.category.id)) : new Set([row.category.id]);
      return this.monthlyAmountsForCategories(ids);
    },
    // 信用卡刷卡(年度)'s 逐月比較, one card at a time — 其他 keeps its existing
    // fold/unfold instead of gaining a second meaning here.
    toggleCreditCardExpand(accountId) {
      this.expandedCreditCardId = this.expandedCreditCardId === accountId ? null : accountId;
    },
    creditCardMonthlyBreakdown(accountId) {
      const totals = new Array(12).fill(0);
      for (const t of Store.baseTransactionList()) {
        if (t.isDeleted || t.type !== 'expense' || t.accountId !== accountId) continue;
        if (t.date.slice(0, 4) !== String(this.year)) continue;
        totals[Number(t.date.slice(5, 7)) - 1] += t.amount;
      }
      const max = Math.max(...totals, 1);
      return totals.map((amount, i) => ({ month: i + 1, amount, pct: (amount / max) * 100 }));
    },
    // What a category's spend looks like by label — the same
    // Models.labelBreakdown the page-level 標籤統計 panel uses, just scoped
    // first to this one category's transactions instead of the whole period.
    categoryLabelBreakdown(categoryId) {
      const inCategory = this.periodExpenseTransactions.filter((t) => t.categoryId === categoryId);
      return Models.labelBreakdown(inCategory, Store.state.transactionLabels, Store.state.labels);
    },
    toggleLabelExpand(labelId) {
      this.expandedLabelId = this.expandedLabelId === labelId ? null : labelId;
      this.expandedOtherLabelId = null;
    },
    toggleOtherLabelExpand(labelId) {
      this.expandedOtherLabelId = this.expandedOtherLabelId === labelId ? null : labelId;
    },
    toggleMonthExpand(key) {
      this.expandedMonth = this.expandedMonth === key ? null : key;
    },
    isMonthOpen(key) {
      return this.query.trim() !== '' || this.expandedMonth === key;
    },
    toggleDateExpand(date) {
      this.expandedDate = this.expandedDate === date ? null : date;
    },
    // Unlike categoryLabelBreakdown above, a label's own drill-down is still
    // by note — labels don't nest the way categories do, so "which notes
    // carry this label" is the only breakdown that says anything new.
    // The scoped expense transactions carrying this label — what every
    // 標籤統計 drill-down below reads from.
    labelTransactions(labelId) {
      const taggedIds = new Set(
        Store.state.transactionLabels.filter((tl) => tl.labelId === labelId).map((tl) => tl.transactionId)
      );
      return this.labelScopeTransactions.filter((t) => taggedIds.has(t.id));
    },
    // "2026-09-01 ~ 2026-09-07 · 共 7 天 · 平均每天 1,234 · 12 筆" — the span
    // runs first to last transaction, so a trip reads as one stretch even when
    // some days had no spending.
    labelSummaryText(labelId) {
      const txs = this.labelTransactions(labelId);
      if (txs.length === 0) return '';
      const dates = txs.map((t) => t.date).sort();
      const first = dates[0];
      const last = dates[dates.length - 1];
      const span = Models.daysBetween(first, last) + 1;
      const total = txs.reduce((s, t) => s + t.amount, 0);
      const range = first === last ? first : `${first} ~ ${last}`;
      return `${range} · 共 ${span} 天 · 平均每天 ${this.fmt(total / span)} · ${txs.length} 筆`;
    },
    // Where a label's spend went, by expense category — the reverse of
    // categoryLabelBreakdown, so a label (which cuts across categories) can
    // be read back down into them.
    labelCategoryBreakdown(labelId) {
      const byCategory = new Map();
      for (const t of this.labelTransactions(labelId)) {
        const key = t.categoryId || '';
        byCategory.set(key, (byCategory.get(key) || 0) + t.amount);
      }
      return [...byCategory.entries()]
        .map(([id, amount]) => ({ category: Store.state.categories.find((c) => c.id === id) || null, amount }))
        .sort((a, b) => b.amount - a.amount);
    },
    // Spend per account it was paid from, biggest first: TWD it converts to,
    // plus the account's own-currency amount when that isn't TWD. Empty when
    // one TWD account paid for everything — a single row says nothing.
    labelAccountBreakdown(labelId) {
      const byAccount = new Map();
      for (const t of this.labelTransactions(labelId)) {
        const row = byAccount.get(t.accountId) || { accountId: t.accountId, native: 0, base: 0 };
        row.native += this.nativeAmountById.get(t.id) || 0;
        row.base += t.amount;
        byAccount.set(t.accountId, row);
      }
      const rows = [...byAccount.values()].map((r) => {
        const account = Store.state.accounts.find((x) => x.id === r.accountId);
        const code = Store.currencyOfAccount(r.accountId);
        return {
          ...r,
          icon: account ? Models.accountIcon(account) : '❔',
          name: account ? account.name : '(已刪除帳戶)',
          text: code === 'TWD' ? this.fmt(r.base) : `${Models.currencySymbol(code)}${Models.formatMoney(r.native, code)} ≈ ${this.fmt(r.base)}`,
        };
      });
      const foreign = rows.some((r) => Store.currencyOfAccount(r.accountId) !== 'TWD');
      if (rows.length < 2 && !foreign) return [];
      const total = rows.reduce((sum, r) => sum + r.base, 0) || 1; // bars are shares of the label's total, like 依分類
      return rows.sort((x, y) => y.base - x.base).map((r) => ({ ...r, pct: r.base / total * 100 }));
    },
    // Spend per calendar day, oldest first, with each day's share of the
    // busiest one for the bar length.
    labelDayBreakdown(labelId) {
      const byDay = new Map();
      for (const t of this.labelTransactions(labelId)) {
        byDay.set(t.date, (byDay.get(t.date) || 0) + t.amount);
      }
      const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      const max = Math.max(...days.map(([, amount]) => amount), 1);
      return days.map(([date, amount]) => ({ date, label: date.slice(5).replace('-', '/'), amount, pct: amount / max * 100 }));
    },
    // Spend per calendar month, oldest first — the 依日期 section switches to
    // this once a label's transactions span more than about a month (labelDetail
    // decides), since a year-long label listed day by day would be unreadable
    // and comparing months is the actual question at that span.
    labelMonthBreakdown(labelId) {
      const byMonth = new Map();
      for (const t of this.labelTransactions(labelId)) {
        const key = t.date.slice(0, 7);
        byMonth.set(key, (byMonth.get(key) || 0) + t.amount);
      }
      const months = [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      const max = Math.max(...months.map(([, amount]) => amount), 1);
      return months.map(([key, amount]) => ({ key, label: key.replace('-', '/'), amount, pct: amount / max * 100 }));
    },
    // Everything LabelDetail shows for one label. `total` is what the bars are
    // shares of: the label's own spend in the scope.
    labelDetail(labelId, total) {
      const share = (amount) => (total > 0 ? amount / total * 100 : 0);
      const sections = [{
        title: '依分類',
        open: true,
        rows: this.labelCategoryBreakdown(labelId).map((d) => ({
          key: d.category ? d.category.id : '__none__',
          name: d.category ? `${d.category.icon || ''} ${d.category.name}` : '(未分類)',
          color: (d.category && d.category.color) || '#adb5bd',
          pct: share(d.amount),
          text: this.fmt(d.amount),
        })),
      }];
      const accounts = this.labelAccountBreakdown(labelId);
      if (accounts.length) {
        sections.push({
          title: '依帳戶',
          open: true,
          rows: accounts.map((d) => ({ key: d.accountId, name: `${d.icon} ${d.name}`, pct: d.pct, text: d.text, wide: true })),
        });
      }
      // A span over ~31 days reads better bucketed by month than listed day by
      // day (labelSummaryText already works out the same span for its own line).
      const txDates = this.labelTransactions(labelId).map((t) => t.date).sort();
      const spansMonths = txDates.length > 0 && Models.daysBetween(txDates[0], txDates[txDates.length - 1]) > 31;
      sections.push({
        title: spansMonths ? '依月份' : '依日期',
        open: false,
        rows: (spansMonths ? this.labelMonthBreakdown(labelId) : this.labelDayBreakdown(labelId))
          .map((d) => ({ key: spansMonths ? d.key : d.date, name: d.label, pct: d.pct, text: this.fmt(d.amount) })),
      });
      sections.push({
        title: '依備註',
        open: false,
        rows: this.labelNoteBreakdown(labelId).map((d) => ({ key: d.note, name: d.note, pct: share(d.amount), text: this.fmt(d.amount) })),
      });
      return { summary: this.labelSummaryText(labelId), sections };
    },
    labelNoteBreakdown(labelId) {
      const byNote = new Map();
      for (const t of this.labelTransactions(labelId)) {
        const key = t.note.trim() || '(無備註)';
        byNote.set(key, (byNote.get(key) || 0) + t.amount);
      }
      return [...byNote.entries()]
        .map(([note, amount]) => ({ note, amount }))
        .sort((a, b) => b.amount - a.amount);
    },
    openEdit(t) {
      this.editingId = t.id;
    },
    onFormClosed() {
      this.editingId = null;
    },
    async remove(t) {
      if (!confirm('刪除這筆紀錄？')) return;
      await Store.deleteTransaction(t.id);
    },
  },
  template: `
    <div class="view">
      <div class="mode-toggle">
        <button :class="{ active: viewMode === 'month' }" @click="viewMode = 'month'">月份總覽</button>
        <button :class="{ active: viewMode === 'year' }" @click="viewMode = 'year'">年度總覽</button>
      </div>

      <div class="period-select">
        <select v-model.number="year">
          <option v-for="y in yearOptions" :key="y" :value="y">{{ y }} 年</option>
        </select>
        <select v-if="viewMode === 'month'" v-model.number="month">
          <option v-for="m in monthOptions" :key="m" :value="m">{{ m }} 月</option>
        </select>
      </div>

      <div v-if="viewMode === 'month'" class="chip-row" style="margin: -6px 0 10px;">
        <span class="chip" :class="{ selected: kpiCompareMode === 'prev' }" @click="kpiCompareMode = 'prev'">較上月</span>
        <span class="chip" :class="{ selected: kpiCompareMode === 'yoy' }" @click="kpiCompareMode = 'yoy'">較去年同月</span>
      </div>

      <div class="kpi-row">
        <div v-for="c in kpiCards" :key="c.key" class="kpi-card" :class="c.tone">
          <div class="kpi-label">{{ c.label }}</div>
          <div class="kpi-value">{{ fmt(c.value) }}</div>
          <div v-if="c.delta" class="kpi-delta" :class="{ good: c.delta.good === true, bad: c.delta.good === false }">{{ c.delta.text }}</div>
          <div v-else class="kpi-delta" :class="c.changeGood ? 'good' : 'bad'">{{ c.changeText }}</div>
        </div>
      </div>

      <div class="panel-grid">
      <section class="panel span-2">
        <div class="view-header chart-header">
          <h3>收支與淨值趨勢<span class="muted"> · <span class="nowrap">{{ viewMode === 'year' ? (year + ' 年 1–12 月') : '最近 6 個月' }}</span></span></h3>
          <div class="trend-legend">
            <span class="legend-item"><span class="legend-dot income" :class="{ square: trendStyle === 'bar' }"></span>收入</span>
            <span class="legend-item"><span class="legend-dot expense square"></span>支出</span>
            <span class="legend-item"><span class="legend-line net"></span>結餘</span>
            <span class="legend-item"><span class="legend-dot worth"></span>淨值</span>
          </div>
        </div>
        <div class="trend-toolbar">
        <div class="trend-readout" :class="{ empty: !trendReadout }">
          <template v-if="trendReadout">
            <strong>{{ trendReadout.label }}</strong>
            <span class="positive">收入 {{ fmt(trendReadout.income) }}</span>
            <span class="negative">支出 {{ fmt(trendReadout.expense) }}</span>
            <span :class="trendReadout.net >= 0 ? 'positive' : 'negative'">結餘 {{ fmt(trendReadout.net) }}</span>
            <span v-if="trendReadout.worth !== null">淨值 {{ fmt(trendReadout.worth) }}</span>
          </template>
          <template v-else>點選月份查看數字</template>
        </div>
        <div class="trend-style-toggle" role="group" aria-label="收入支出的呈現方式">
          <button :class="{ active: trendStyle === 'bar' }" @click="setTrendStyle('bar')">長條</button>
          <button :class="{ active: trendStyle === 'line' }" @click="setTrendStyle('line')">折線</button>
        </div>
        </div>
        <svg viewBox="0 0 300 100" preserveAspectRatio="none" class="trend-svg">
          <rect v-if="trendPick !== null" :x="trendPick * 300 / trendChart.bars.length" y="-4" :width="300 / trendChart.bars.length" height="108" class="trend-pick" />
          <line x1="0" :y1="trendChart.baselineY" x2="300" :y2="trendChart.baselineY" class="trend-baseline" />
          <!-- Markers are zero-length lines with a round or square cap: with
               non-scaling strokes they stay round/square however the SVG is
               stretched, where a circle would turn into an ellipse. -->
          <template v-if="trendStyle === 'bar'">
          <template v-for="b in trendChart.bars.filter((x) => !x.future)" :key="'bar-' + b.yearMonth">
            <rect :x="b.expenseBarX" :y="b.expenseBarY" :width="trendChart.barWidth" :height="b.expenseH" class="trend-bar expense" />
            <rect :x="b.incomeBarX" :y="b.incomeBarY" :width="trendChart.barWidth" :height="b.incomeH" class="trend-bar income" />
          </template>
          </template>
          <polyline :points="trendChart.netPoints" class="trend-net-line" />
          <template v-if="trendStyle === 'line'">
            <polyline :points="trendChart.expensePoints" class="trend-flow-line expense" />
            <polyline :points="trendChart.incomePoints" class="trend-flow-line income" />
          </template>
          <template v-for="b in trendChart.bars.filter((x) => !x.future)" :key="b.yearMonth">
            <line :x1="b.x" :y1="b.netY" :x2="b.x" :y2="b.netY" class="trend-marker net" />
            <template v-if="trendStyle === 'line'">
              <line :x1="b.x" :y1="b.expenseY" :x2="b.x" :y2="b.expenseY" class="trend-marker expense" />
              <line :x1="b.x" :y1="b.incomeY" :x2="b.x" :y2="b.incomeY" class="trend-marker income" />
            </template>
          </template>
          <rect v-for="(b, i) in trendChart.bars" :key="'hit-' + b.yearMonth" :x="i * 300 / trendChart.bars.length" y="-4" :width="300 / trendChart.bars.length" height="108" class="trend-hit" @click="pickTrend(i)" />
        </svg>
        <!-- Net worth gets its own scale (it's nowhere near 0), stacked under the
             bars so both read against the one month axis at the bottom. -->
        <div class="view-header trend-sub-header">
          <span class="trend-sub-title"><span class="legend-dot worth"></span>淨值</span>
          <span class="net-worth-change" :class="netWorthChange >= 0 ? 'positive' : 'negative'">{{ netWorthChange >= 0 ? '+' : '' }}{{ fmt(netWorthChange) }}</span>
        </div>
        <svg viewBox="0 0 300 100" preserveAspectRatio="none" class="trend-svg">
          <rect v-if="trendPick !== null" :x="trendPick * 300 / trendChart.bars.length" y="-4" :width="300 / trendChart.bars.length" height="108" class="trend-pick" />
          <polyline :points="netWorthChart.points" class="trend-worth-line" />
          <polygon v-for="d in netWorthChart.dots.filter((x) => !x.future)" :key="'nw-' + d.yearMonth" :points="diamondPoints(d.x, d.y)" class="trend-worth-dot" />
          <rect v-for="(d, i) in netWorthChart.dots" :key="'nwhit-' + d.yearMonth" :x="i * 300 / netWorthChart.dots.length" y="-4" :width="300 / netWorthChart.dots.length" height="108" class="trend-hit" @click="pickTrend(i)" />
        </svg>
        <div class="trend-labels">
          <span v-for="(b, i) in trendChart.bars" :key="'lbl-' + b.yearMonth" :class="{ picked: trendPick === i }" @click="pickTrend(i)">{{ b.month }}月</span>
        </div>
      </section>

      <section v-if="viewMode === 'year'" class="panel span-2">
        <div class="view-header chart-header">
          <h3>固定支出<span class="muted"> · <span class="nowrap">{{ year }} 年共 {{ fmt(recurringExpenseYearTotal + loanPaymentYearTotal) }}</span><span class="nowrap">(貸款含本金)</span></span></h3>
          <div class="trend-legend">
            <span v-for="s in fixedExpenseChart.series" :key="s.key" class="legend-item">
              <span class="legend-dot" :style="{ background: s.color }"></span>{{ s.name }} {{ fmt(s.total) }}
            </span>
          </div>
        </div>
        <div class="trend-readout" :class="{ empty: !fixedExpenseReadout }">
          <template v-if="fixedExpenseReadout">
            <strong>{{ fixedExpenseReadout.label }}</strong>
            <span v-for="p in fixedExpenseReadout.parts" :key="p.key"><span class="legend-dot" :style="{ background: p.color }"></span>{{ p.name }} {{ fmt(p.amount) }}</span>
            <span class="negative">合計 {{ fmt(fixedExpenseReadout.total) }}</span>
          </template>
          <template v-else>點選月份查看數字</template>
        </div>
        <svg viewBox="0 0 300 100" preserveAspectRatio="none" class="trend-svg">
          <rect v-if="fixedExpensePick !== null" :x="fixedExpensePick * 300 / fixedExpenseChart.bars.length" y="-4" :width="300 / fixedExpenseChart.bars.length" height="108" class="trend-pick" />
          <template v-for="b in fixedExpenseChart.bars" :key="b.month">
            <rect v-for="seg in b.segments" :key="seg.key" :x="b.x" :y="seg.y" :width="b.width" :height="seg.height" :fill="seg.color" />
          </template>
          <rect v-for="(b, i) in fixedExpenseChart.bars" :key="'hit-' + b.month" :x="i * 300 / fixedExpenseChart.bars.length" y="-4" :width="300 / fixedExpenseChart.bars.length" height="108" class="trend-hit" @click="pickFixedExpense(i)" />
        </svg>
        <div class="trend-labels">
          <span v-for="(b, i) in fixedExpenseChart.bars" :key="'re-' + b.month" :class="{ picked: fixedExpensePick === i }" @click="pickFixedExpense(i)">{{ b.month }}月</span>
        </div>
      </section>

      <section v-if="viewMode === 'year'" class="panel span-2">
        <h3>逐月明細</h3>
        <div class="month-table-row month-table-header">
          <span class="month-table-cell month">月份</span>
          <span class="month-table-cell">收入</span>
          <span class="month-table-cell">支出</span>
          <span class="month-table-cell">結餘</span>
        </div>
        <div v-for="m in yearTrendMonths" :key="m.yearMonth" class="month-table-row">
          <span class="month-table-cell month">{{ m.month }} 月</span>
          <span class="month-table-cell positive">{{ fmt(m.income) }}</span>
          <span class="month-table-cell negative">{{ fmt(m.expense) }}</span>
          <span class="month-table-cell" :class="{ negative: m.net < 0, positive: m.net > 0 }">{{ fmt(m.net) }}</span>
        </div>
      </section>

      <!-- Full width in both modes — 資產 and 負債 side by side need the room
           a half-width panel doesn't have, so this isn't paired with anything. -->
      <section class="panel span-2">
        <h3>資產總覽<span class="muted"> · 淨值 {{ fmt(netWorth) }}</span></h3>
        <div v-if="liabilityTotal !== 0" class="muted asset-formula">資產 {{ fmt(assetTotal) }} − 負債 {{ fmt(liabilityTotal) }} = 淨值 {{ fmt(netWorth) }}</div>
        <div v-if="installmentUnbilledTotal > 0" class="muted asset-formula">扣除分期未入帳 {{ fmt(installmentUnbilledTotal) }} 後的淨值 {{ fmt(netWorth - installmentUnbilledTotal) }}(僅供參考)</div>
        <div v-if="heldCurrencies.length" class="muted asset-formula">匯率 · {{ rateSummaryText }}(TWD,可在「帳戶」頁調整)</div>
        <div v-if="accountsWithBalance.length === 0" class="empty">還沒有帳戶,先到「帳戶」分頁新增一個</div>
        <div v-else class="asset-liability-split">
          <div class="asset-liability-col">
            <div class="asset-liability-col-header"><span>資產</span><span>{{ fmt(assetTotal) }}</span></div>
            <div v-if="assetAccountGroups.length === 0" class="empty">還沒有資產帳戶</div>
            <DashboardAccountGroups :groups="assetAccountGroups" :percent-base="assetTotal" />
          </div>
          <div class="asset-liability-col">
            <div class="asset-liability-col-header"><span>負債</span><span :class="{ negative: liabilityTotal > 0 }">{{ fmt(liabilityTotal) }}</span></div>
            <div v-if="installmentUnbilledTotal > 0" class="liability-note">另有分期未入帳 {{ fmt(installmentUnbilledTotal) }}</div>
            <div v-if="liabilityAccountGroups.length === 0" class="empty">目前沒有負債</div>
            <DashboardAccountGroups :groups="liabilityAccountGroups" />
          </div>
        </div>
      </section>

      <!-- The breakdowns run down two independent columns, so a tall panel
           (支出分類) never leaves a hole beside a short one (標籤統計) the way
           grid rows did. On a phone the columns are display: contents and
           each panel's order puts them back in one reading order. -->
      <div class="dash-cols">
      <div class="dash-col">
      <section style="order: 1;" class="panel">
        <h3>{{ viewMode === 'year' ? '全年支出分類' : '支出分類' }}</h3>
        <div v-if="activeSummary.categoryBreakdown.length === 0" class="empty">{{ viewMode === 'year' ? '這一年還沒有紀錄' : '這個月還沒有紀錄' }}</div>
        <template v-else>
          <DonutChart :segments="donutSegments" :focus="donutFocusIndex('donutSegments', donutSegments)" @focus="toggleDonutFocus('donutSegments', $event)" />
          <div v-for="(row, i) in categoryBreakdownRows" :key="row.category.id" :class="donutLegendClass('donutSegments', donutSegments, i)">
            <div class="bar-row clickable" @click="toggleCategoryExpand(row.category.id); toggleDonutFocus('donutSegments', i)">
              <span class="icon-badge-sm" :style="{ background: (row.category.color || '#adb5bd') + '30' }">{{ row.category.icon }}</span>
              <span class="bar-name">{{ row.category.name }}</span>
              <span class="expand-arrow" :class="{ open: expandedCategoryId === row.category.id }">›</span>
              <span class="bar-amount">{{ fmt(row.amount) }} · {{ fmtCategoryPercent(row.amount) }}</span>
            </div>
            <div v-if="expandedCategoryId === row.category.id" class="category-detail">
              <div v-if="viewMode === 'year'" class="category-detail-heading foldable" @click="toggleCategorySection(row.otherRows ? '依分類' : '依標籤', true)">
                <span class="expand-arrow" :class="{ open: isCategorySectionOpen(row.otherRows ? '依分類' : '依標籤', true) }">›</span>{{ row.otherRows ? '依分類' : '依標籤' }}<span class="heading-count">{{ row.otherRows ? row.otherRows.length : categoryLabelBreakdown(row.category.id).length }}</span>
              </div>
              <template v-if="viewMode !== 'year' || isCategorySectionOpen(row.otherRows ? '依分類' : '依標籤', true)">
              <template v-if="row.otherRows">
                <div v-for="d in row.otherRows" :key="d.category.id" class="category-detail-row">
                  <span class="category-detail-note">{{ d.category.icon }} {{ d.category.name }}</span>
                  <span class="category-detail-bar-track">
                    <span class="category-detail-bar-fill" :style="{ width: (d.amount / row.amount * 100) + '%', background: d.category.color || '#adb5bd' }"></span>
                  </span>
                  <span class="category-detail-amount">{{ fmt(d.amount) }}</span>
                </div>
              </template>
              <template v-else>
                <div v-if="categoryLabelBreakdown(row.category.id).length === 0" class="empty">這個分類底下的交易都還沒有標籤</div>
                <div v-for="d in categoryLabelBreakdown(row.category.id)" :key="d.label.id" class="category-detail-row">
                  <span class="category-detail-note">{{ d.label.name }}</span>
                  <span class="category-detail-bar-track">
                    <span class="category-detail-bar-fill" :style="{ width: (d.amount / row.amount * 100) + '%' }"></span>
                  </span>
                  <span class="category-detail-amount">{{ fmt(d.amount) }}</span>
                </div>
              </template>
              </template>
              <template v-if="viewMode === 'year'">
                <div class="category-detail-heading foldable" @click="toggleCategorySection('逐月比較', false)">
                  <span class="expand-arrow" :class="{ open: isCategorySectionOpen('逐月比較', false) }">›</span>逐月比較
                </div>
                <template v-if="isCategorySectionOpen('逐月比較', false)">
                <div v-for="d in categoryMonthlyBreakdown(row)" :key="d.month" class="category-detail-row">
                  <span class="category-detail-note">{{ d.month }}月</span>
                  <span class="category-detail-bar-track">
                    <span class="category-detail-bar-fill" :style="{ width: d.pct + '%', background: row.category.color || '#adb5bd' }"></span>
                  </span>
                  <span class="category-detail-amount">{{ fmt(d.amount) }}</span>
                </div>
                </template>
              </template>
            </div>
          </div>
        </template>
      </section>

      <section style="order: 2;" v-if="budgetProgress.length" class="panel">
        <h3>預算<span v-if="viewMode === 'year'" class="muted"> · 全年(每月上限 × 12)</span></h3>
        <div v-for="row in budgetProgress" :key="row.category.id" class="budget-row">
          <div class="budget-row-top">
            <span class="icon-badge-sm" :style="{ background: (row.category.color || '#adb5bd') + '30' }">{{ row.category.icon }}</span>
            <span class="bar-name">{{ row.category.name }}</span>
            <span class="budget-amount" :class="row.status">{{ fmt(row.spent) }} / {{ fmt(row.limit) }}</span>
          </div>
          <div class="budget-track">
            <div class="budget-fill" :class="row.status" :style="{ width: Math.min(row.ratio, 1) * 100 + '%' }"></div>
          </div>
        </div>
      </section>

      <section style="order: 4;" v-if="viewMode === 'month'" class="panel">
        <h3>固定支出<span class="muted">
          <template v-if="fixedExpenseExpectedTotal > 0"> · <span class="nowrap">已入帳 {{ fmt(fixedExpenseBookedTotal) }}</span> · <span class="nowrap">本月預計共 {{ fmt(fixedExpenseTotal) }}</span></template>
          <template v-else> · <span class="nowrap">共 {{ fmt(fixedExpenseTotal) }}</span></template><span class="nowrap">(貸款含本金)</span></span></h3>
        <div v-if="fixedExpenseAllRows.length === 0" class="empty">這個月還沒有固定支出</div>
        <template v-else>
          <DonutChart :segments="fixedExpenseDonutSegments" :focus="donutFocusIndex('fixedExpenseDonutSegments', fixedExpenseDonutSegments)" @focus="toggleDonutFocus('fixedExpenseDonutSegments', $event)" />
          <div v-for="(row, i) in fixedExpenseCappedRows" :key="row.key" :class="donutLegendClass('fixedExpenseDonutSegments', fixedExpenseDonutSegments, i)">
            <div class="bar-row clickable" @click="row.otherRows && toggleFixedExpenseOther(); toggleDonutFocus('fixedExpenseDonutSegments', i)">
              <span class="legend-swatch" :class="{ expected: row.expected }" :style="{ background: row.category.color }"></span>
              <span class="bar-name">{{ row.category.name }}<span v-if="row.detail" class="row-detail">{{ row.detail }}</span></span>
              <span v-if="row.otherRows" class="expand-arrow" :class="{ open: fixedExpenseOtherOpen }">›</span>
              <span class="bar-amount" :class="{ 'expected-amount': row.expected }">{{ fmt(row.amount) }} · {{ fmtFixedPercent(row.amount) }}</span>
            </div>
            <div v-if="row.otherRows && fixedExpenseOtherOpen" class="category-detail">
              <div v-for="d in row.otherRows" :key="d.key" class="category-detail-row">
                <span class="category-detail-note">{{ d.category.name }}</span>
                <span class="category-detail-bar-track">
                  <span class="category-detail-bar-fill" :style="{ width: (d.amount / row.amount * 100) + '%', background: d.category.color }"></span>
                </span>
                <span class="category-detail-amount">{{ fmt(d.amount) }}</span>
              </div>
            </div>
          </div>
        </template>
      </section>

      <section style="order: 7;" v-if="creditCardSpendBreakdown.length" class="panel">
        <h3>{{ viewMode === 'year' ? '全年信用卡刷卡' : '本月信用卡刷卡' }}<span class="muted"> · 共 {{ fmt(creditCardSpendTotal) }}</span></h3>
        <DonutChart :segments="creditCardSpendSegments" :focus="donutFocusIndex('creditCardSpendSegments', creditCardSpendSegments)" @focus="toggleDonutFocus('creditCardSpendSegments', $event)" />
        <div v-for="(row, i) in creditCardSpendRows" :key="row.category.name" :class="donutLegendClass('creditCardSpendSegments', creditCardSpendSegments, i)">
          <div
            class="bar-row clickable"
            @click="row.otherRows ? toggleCreditSpendOther() : (viewMode === 'year' && toggleCreditCardExpand(row.accountId)); toggleDonutFocus('creditCardSpendSegments', i)"
          >
            <span class="legend-swatch" :style="{ background: row.category.color }"></span>
            <span class="bar-name">{{ row.category.name }}</span>
            <span v-if="row.otherRows || viewMode === 'year'" class="expand-arrow" :class="{ open: row.otherRows ? creditSpendOtherOpen : expandedCreditCardId === row.accountId }">›</span>
            <span class="bar-amount">{{ fmt(row.amount) }} · {{ fmtCreditCardSpendPercent(row.amount) }}</span>
          </div>
          <div v-if="row.otherRows && creditSpendOtherOpen" class="category-detail">
            <div v-for="d in row.otherRows" :key="d.category.name" class="category-detail-row">
              <span class="category-detail-note"><span class="legend-swatch" :style="{ background: d.category.color }"></span>{{ d.category.name }}</span>
              <span class="category-detail-bar-track">
                <span class="category-detail-bar-fill" :style="{ width: (d.amount / row.amount * 100) + '%', background: d.category.color }"></span>
              </span>
              <span class="category-detail-amount">{{ fmt(d.amount) }}</span>
            </div>
          </div>
          <div v-if="!row.otherRows && viewMode === 'year' && expandedCreditCardId === row.accountId" class="category-detail">
            <div class="category-detail-heading">逐月比較</div>
            <div v-for="d in creditCardMonthlyBreakdown(row.accountId)" :key="d.month" class="category-detail-row">
              <span class="category-detail-note">{{ d.month }}月</span>
              <span class="category-detail-bar-track">
                <span class="category-detail-bar-fill" :style="{ width: d.pct + '%', background: row.category.color }"></span>
              </span>
              <span class="category-detail-amount">{{ fmt(d.amount) }}</span>
            </div>
          </div>
        </div>
      </section>
      </div>
      <div class="dash-col">
      <section style="order: 3;" class="panel">
        <h3>{{ labelScope === 'all' ? '標籤統計 · 全部期間' : (viewMode === 'year' ? '全年標籤統計' : '標籤統計') }}</h3>
        <div class="chip-row" style="margin: 0 0 8px;">
          <span class="chip" :class="{ selected: labelScope === 'period' }" @click="labelScope = 'period'">{{ viewMode === 'year' ? '本年' : '本月' }}</span>
          <span class="chip" :class="{ selected: labelScope === 'all' }" @click="labelScope = 'all'">全部期間</span>
        </div>
        <div v-if="labelBreakdown.length === 0" class="empty">{{ labelScope === 'all' ? '還沒有標籤紀錄' : (viewMode === 'year' ? '這一年還沒有標籤紀錄' : '這個月還沒有標籤紀錄') }}</div>
        <div v-for="row in labelBreakdownRows" :key="row.label.id">
          <div class="bar-row clickable" @click="toggleLabelExpand(row.label.id)">
            <span class="icon-badge-sm" :style="{ background: (row.label.color || '#6d6875') + '30' }">{{ row.label.icon || '🏷️' }}</span>
            <span class="bar-name">{{ row.label.name }}</span>
            <span class="expand-arrow" :class="{ open: expandedLabelId === row.label.id }">›</span>
            <span class="bar-amount">{{ fmt(row.amount) }} · {{ fmtLabelPercent(row.amount) }}</span>
          </div>
          <div v-if="expandedLabelId === row.label.id" class="category-detail">
            <template v-if="row.otherRows">
              <template v-for="d in row.otherRows" :key="d.label.id">
                <div class="category-detail-row clickable-row" @click="toggleOtherLabelExpand(d.label.id)">
                  <span class="category-detail-note">{{ d.label.icon || '🏷️' }} {{ d.label.name }}</span>
                  <span class="category-detail-bar-track">
                    <span class="category-detail-bar-fill" :style="{ width: (d.amount / row.amount * 100) + '%', background: d.label.color || '#6d6875' }"></span>
                  </span>
                  <span class="category-detail-amount">{{ fmt(d.amount) }}</span>
                  <span class="expand-arrow" :class="{ open: expandedOtherLabelId === d.label.id }">›</span>
                </div>
                <div v-if="expandedOtherLabelId === d.label.id" class="category-detail">
                  <LabelDetail :detail="labelDetail(d.label.id, d.amount)" />
                </div>
              </template>
            </template>
            <LabelDetail v-else :detail="labelDetail(row.label.id, row.amount)" />
          </div>
        </div>
      </section>

      <section style="order: 5;" v-if="activeSummary.incomeCategoryBreakdown.length" class="panel">
        <h3>{{ viewMode === 'year' ? '全年收入分類' : '收入分類' }}</h3>
        <DonutChart :segments="incomeDonutSegments" :focus="donutFocusIndex('incomeDonutSegments', incomeDonutSegments)" @focus="toggleDonutFocus('incomeDonutSegments', $event)" />
        <div v-for="(row, i) in incomeBreakdownRows" :key="row.category.id" :class="donutLegendClass('incomeDonutSegments', incomeDonutSegments, i)">
          <div class="bar-row clickable" @click="row.otherRows && toggleIncomeOther(); toggleDonutFocus('incomeDonutSegments', i)">
            <span class="icon-badge-sm" :style="{ background: (row.category.color || '#adb5bd') + '30' }">{{ row.category.icon }}</span>
            <span class="bar-name">{{ row.category.name }}</span>
            <span v-if="row.otherRows" class="expand-arrow" :class="{ open: incomeOtherOpen }">›</span>
            <span class="bar-amount">{{ fmt(row.amount) }} · {{ fmtIncomePercent(row.amount) }}</span>
          </div>
          <div v-if="row.otherRows && incomeOtherOpen" class="category-detail">
            <div v-for="d in row.otherRows" :key="d.category.id" class="category-detail-row">
              <span class="category-detail-note">{{ d.category.icon }} {{ d.category.name }}</span>
              <span class="category-detail-bar-track">
                <span class="category-detail-bar-fill" :style="{ width: (d.amount / row.amount * 100) + '%', background: d.category.color || '#adb5bd' }"></span>
              </span>
              <span class="category-detail-amount">{{ fmt(d.amount) }}</span>
            </div>
          </div>
        </div>
      </section>

      <section style="order: 6;" v-if="creditCardDebtBreakdown.length" class="panel">
        <h3>信用卡欠款<span class="muted"> · 共 {{ fmt(creditCardDebtTotal) }}</span></h3>
        <DonutChart :segments="creditCardDebtSegments" :focus="donutFocusIndex('creditCardDebtSegments', creditCardDebtSegments)" @focus="toggleDonutFocus('creditCardDebtSegments', $event)" />
        <div v-for="(row, i) in creditCardDebtRows" :key="row.category.name" :class="donutLegendClass('creditCardDebtSegments', creditCardDebtSegments, i)">
          <div class="bar-row clickable" @click="row.otherRows && toggleCreditDebtOther(); toggleDonutFocus('creditCardDebtSegments', i)">
            <span class="legend-swatch" :style="{ background: row.category.color }"></span>
            <span class="bar-name">{{ row.category.name }}</span>
            <span v-if="row.otherRows" class="expand-arrow" :class="{ open: creditDebtOtherOpen }">›</span>
            <span class="bar-amount">{{ fmt(row.amount) }} · {{ fmtCreditCardDebtPercent(row.amount) }}</span>
          </div>
          <div v-if="row.card && (row.card.available !== null || row.card.unbilled > 0)" class="bar-row-sub">
            <template v-if="row.card.available !== null">可用 {{ fmt(row.card.available) }} / {{ fmt(row.card.limit) }}</template>
            <template v-if="row.card.available !== null && row.card.unbilled > 0"> · </template>
            <template v-if="row.card.unbilled > 0">分期未入帳 {{ fmt(row.card.unbilled) }}</template>
          </div>
          <div v-if="row.otherRows && creditDebtOtherOpen" class="category-detail">
            <div v-for="d in row.otherRows" :key="d.category.name" class="category-detail-row">
              <span class="category-detail-note"><span class="legend-swatch" :style="{ background: d.category.color }"></span>{{ d.category.name }}</span>
              <span class="category-detail-bar-track">
                <span class="category-detail-bar-fill" :style="{ width: (d.amount / row.amount * 100) + '%', background: d.category.color }"></span>
              </span>
              <span class="category-detail-amount">{{ fmt(d.amount) }}</span>
            </div>
          </div>
        </div>
      </section>
      </div>
      </div>

      <section class="panel span-2">
        <h3>記帳明細</h3>

        <div class="search-controls">
          <input class="search-field" v-model="query" placeholder="搜尋備註、分類、帳戶或標籤" />

          <div class="chip-row" style="margin: 10px 0 4px;">
            <span
              v-for="opt in typeOptions" :key="opt.type"
              class="chip" :class="{ selected: typeFilters.includes(opt.type) }"
              @click="toggleType(opt.type)"
            >{{ opt.label }}</span>
          </div>
        </div>

        <div v-if="groupedByDate.length === 0" class="empty">找不到符合條件的紀錄</div>
        <template v-if="viewMode === 'year'">
          <div v-for="m in monthGroups" :key="m.key" class="subsection">
            <div class="subsection-header clickable" @click="toggleMonthExpand(m.key)">
              <span>{{ m.key.slice(0, 4) }} 年 {{ m.month }} 月<span class="muted"> · {{ m.count }} 筆</span></span>
              <span>
                <span v-if="m.expenseTotal" class="negative">-{{ fmt(m.expenseTotal) }}</span>
                <span v-if="m.incomeTotal" class="positive"> +{{ fmt(m.incomeTotal) }}</span>
                <span class="expand-arrow" :class="{ open: isMonthOpen(m.key) }">›</span>
              </span>
            </div>
            <div v-if="isMonthOpen(m.key)" class="month-detail">
              <DashboardDateGroups :groups="m.groups" :expanded-date="expandedDate" @toggle="toggleDateExpand" @edit="openEdit" @remove="remove" />
            </div>
          </div>
        </template>
        <DashboardDateGroups v-else :groups="groupedByDate" :expanded-date="expandedDate" @toggle="toggleDateExpand" @edit="openEdit" @remove="remove" />
      </section>
      </div>

      <TransactionFormModal
        v-if="editingId"
        :editing-id="editingId"
        @close="onFormClosed"
      />
    </div>
  `,
};
