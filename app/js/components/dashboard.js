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

const DashboardView = {
  components: { TransactionRowItem, TransactionFormModal, DashboardDateGroups },
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
      expandedLabelId: null, // which 標籤統計 row is expanded, one at a time
      expandedDate: null, // which 記帳明細 date group is expanded, one at a time
      expandedMonth: null, // year view: which 記帳明細 month is open, one at a time
      trendPick: null, // index of the month picked on the trend chart, for the readout
    };
  },
  watch: {
    // A different year or mode is a different list; don't carry an open month over.
    viewMode() {
      this.trendPick = null;
      this.expandedMonth = null;
      this.expandedDate = null;
    },
    month() {
      this.trendPick = null;
    },
    year() {
      this.trendPick = null;
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
      return Models.buildTrendChart(this.activeTrendMonths);
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
      return Models.buildNetWorthChart(this.netWorthTrendMonths);
    },
    netWorthChange() {
      const months = this.netWorthTrendMonths;
      return months.length < 2 ? 0 : months[months.length - 1].netWorth - months[0].netWorth;
    },
    // The period right before the selected one (last month / last year), for
    // the "較上月" deltas on the summary cards.
    previousSummary() {
      if (this.viewMode === 'year') return Store.yearlySummary(this.year - 1);
      const prev = this.month === 1 ? `${this.year - 1}-12` : `${this.year}-${String(this.month - 1).padStart(2, '0')}`;
      return Store.monthlySummary(prev);
    },
    // Net worth at the end of the selected period and how far it moved over it
    // (month: vs the previous month's end; year: vs the previous December's).
    netWorthKpi() {
      const months = this.viewMode === 'year'
        ? Store.netWorthTrend(`${this.year}-12`, 13)
        : Store.netWorthTrend(this.yearMonth, 2);
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
        { key: 'worth', label: year ? '年底淨值' : '月底淨值', value: w.value, tone: w.value >= 0 ? 'income' : 'expense', changeText: (year ? '今年 ' : '本月 ') + (w.change >= 0 ? '+' : '') + this.fmt(w.change), changeGood: w.change >= 0 },
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
    donutSegments() {
      return Models.buildDonutSegments(this.activeSummary.categoryBreakdown);
    },
    // The percentage base for 分類支出's rows — the breakdown's own total
    // rather than activeSummary.expense, since an uncategorized expense has
    // no row here at all and would otherwise make the shown rows add up to
    // less than 100%.
    categoryBreakdownTotal() {
      return this.activeSummary.categoryBreakdown.reduce((s, row) => s + row.amount, 0);
    },
    incomeDonutSegments() {
      return Models.buildDonutSegments(this.activeSummary.incomeCategoryBreakdown);
    },
    incomeBreakdownTotal() {
      return this.activeSummary.incomeCategoryBreakdown.reduce((s, row) => s + row.amount, 0);
    },
    // Budgets are a standing monthly cap, so this only means something in
    // month mode — the year view has no single number to compare a whole
    // year's spend against.
    budgetProgress() {
      if (this.viewMode !== 'month') return [];
      return Models.budgetProgress(Store.state.categories, this.monthSummary.categoryBreakdown);
    },
    // Month mode's 固定支出: every recurring rule and every loan that was paid
    // this month as its own line, charted as a donut. Loan payments count in
    // full — principal *and* interest — since this is money that goes out
    // every month regardless; unlike 支出 (which only sees the interest, because
    // repaying principal isn't spending).
    fixedExpenseRows() {
      if (this.viewMode !== 'month') return [];
      return Models.fixedExpenseBreakdown(Store.state.transactions, this.periodPrefix, Store.state.categories, Store.state.accounts);
    },
    fixedExpenseTotal() {
      return this.fixedExpenseRows.reduce((sum, row) => sum + row.amount, 0);
    },
    fixedExpenseDonutSegments() {
      return Models.buildDonutSegments(this.fixedExpenseRows);
    },
    // Year mode's 固定支出 chart: rule spending and loan payments per month
    // of the selected year, Jan–Dec, stacked.
    yearlyFixedExpenseMonths() {
      return Store.monthlyFixedExpense(this.year);
    },
    fixedExpenseChart() {
      return Models.buildFixedExpenseChart(this.yearlyFixedExpenseMonths);
    },
    recurringExpenseYearTotal() {
      return this.yearlyFixedExpenseMonths.reduce((sum, m) => sum + m.amount, 0);
    },
    loanPaymentYearTotal() {
      return this.yearlyFixedExpenseMonths.reduce((sum, m) => sum + m.loanAmount, 0);
    },
    // Same period, expense-only transactions — the input labelBreakdown
    // needs and the same set categoryLabelBreakdown/labelNoteBreakdown pick
    // through by category or by label.
    periodExpenseTransactions() {
      return Store.state.transactions.filter(
        (t) => !t.isDeleted && t.type === 'expense' && t.date.startsWith(this.periodPrefix)
      );
    },
    labelBreakdown() {
      return Models.labelBreakdown(this.periodExpenseTransactions, Store.state.transactionLabels, Store.state.labels);
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
        if (t.type === 'expense') group.expenseTotal += t.amount;
        else if (t.type === 'income') group.incomeTotal += t.amount;
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
        const displayBalance = (Models.isLiabilityKind(a.kind) ? -balance : balance) + holdingsCost;
        return {
          account: a,
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
          return { label, rows, subtotal: rows.reduce((sum, r) => sum + r.displayBalance, 0) };
        })
        .filter((g) => g.rows.length > 0);
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
        }))
        .sort((a, b) => b.amount - a.amount);
    },
    creditCardDebtTotal() {
      return this.creditCardDebtBreakdown.reduce((s, row) => s + row.amount, 0);
    },
    creditCardDebtSegments() {
      return Models.buildDonutSegments(this.creditCardDebtBreakdown);
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
          return { category: { name: account.name, color: account.color || '#adb5bd' }, amount };
        })
        .sort((a, b) => b.amount - a.amount);
    },
    creditCardSpendTotal() {
      return this.creditCardSpendBreakdown.reduce((s, row) => s + row.amount, 0);
    },
    creditCardSpendSegments() {
      return Models.buildDonutSegments(this.creditCardSpendBreakdown);
    },
  },
  methods: {
    // Net worth's marker: a diamond, so it isn't mistaken for the net line's circles.
    // "較上月 ▲12%" against the previous period; `goodWhenUp` says whether a
    // rise is the good direction (income, net) or the bad one (expense).
    kpiDelta(cur, prev, goodWhenUp) {
      const label = this.viewMode === 'year' ? '較去年' : '較上月';
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
    fmtAssetPercent(amount) {
      return this.assetTotal > 0 ? (amount / this.assetTotal * 100).toFixed(1) + '%' : '0%';
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
    labelNoteBreakdown(labelId) {
      const taggedIds = new Set(
        Store.state.transactionLabels.filter((tl) => tl.labelId === labelId).map((tl) => tl.transactionId)
      );
      const byNote = new Map();
      for (const t of this.periodExpenseTransactions) {
        if (!taggedIds.has(t.id)) continue;
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
        <div class="view-header">
          <h3>收支與淨值趨勢<span class="muted"> · {{ viewMode === 'year' ? (year + ' 年 1–12 月') : '最近 6 個月' }}</span></h3>
          <div class="trend-legend">
            <span class="legend-item"><span class="legend-dot expense"></span>支出</span>
            <span class="legend-item"><span class="legend-dot income"></span>收入</span>
            <span class="legend-item"><span class="legend-dot net"></span>結餘</span>
          </div>
        </div>
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
        <svg viewBox="0 0 300 100" preserveAspectRatio="none" class="trend-svg">
          <rect v-if="trendPick !== null" :x="trendPick * 300 / trendChart.bars.length" y="-4" :width="300 / trendChart.bars.length" height="108" class="trend-pick" />
          <line x1="0" :y1="trendChart.baselineY" x2="300" :y2="trendChart.baselineY" class="trend-baseline" />
          <template v-for="b in trendChart.bars" :key="b.yearMonth">
            <rect :x="b.expenseX" :y="b.expenseY" :width="trendChart.barWidth" :height="b.expenseH" fill="var(--expense)" />
            <rect :x="b.incomeX" :y="b.incomeY" :width="trendChart.barWidth" :height="b.incomeH" fill="var(--income)" />
          </template>
          <polyline :points="trendChart.netPoints" class="trend-net-line" />
          <circle v-for="b in trendChart.bars" :key="'dot-' + b.yearMonth" :cx="b.netX" :cy="b.netY" r="2.5" class="trend-net-dot" />
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
          <polygon v-for="d in netWorthChart.dots" :key="'nw-' + d.yearMonth" :points="diamondPoints(d.x, d.y)" class="trend-worth-dot" />
          <rect v-for="(d, i) in netWorthChart.dots" :key="'nwhit-' + d.yearMonth" :x="i * 300 / netWorthChart.dots.length" y="-4" :width="300 / netWorthChart.dots.length" height="108" class="trend-hit" @click="pickTrend(i)" />
        </svg>
        <div class="trend-labels">
          <span v-for="(b, i) in trendChart.bars" :key="'lbl-' + b.yearMonth" :class="{ picked: trendPick === i }" @click="pickTrend(i)">{{ b.month }}月</span>
        </div>
      </section>

      <section v-if="viewMode === 'year'" class="panel span-2">
        <div class="view-header">
          <h3>固定支出<span class="muted"> · {{ year }} 年共 {{ fmt(recurringExpenseYearTotal + loanPaymentYearTotal) }}(貸款含本金)</span></h3>
          <div class="trend-legend">
            <span class="legend-item"><span class="legend-dot expense"></span>規則 {{ fmt(recurringExpenseYearTotal) }}</span>
            <span class="legend-item"><span class="legend-dot loan"></span>貸款 {{ fmt(loanPaymentYearTotal) }}</span>
          </div>
        </div>
        <svg viewBox="0 0 300 100" preserveAspectRatio="none" class="trend-svg">
          <template v-for="b in fixedExpenseChart.bars" :key="b.month">
            <rect :x="b.x" :y="b.recurring.y" :width="b.width" :height="b.recurring.height" fill="var(--expense)" />
            <rect :x="b.x" :y="b.loan.y" :width="b.width" :height="b.loan.height" fill="var(--warning)" />
          </template>
        </svg>
        <div class="trend-labels">
          <span v-for="b in fixedExpenseChart.bars" :key="'re-' + b.month">{{ b.month }}月</span>
        </div>
      </section>

      <section v-if="viewMode === 'month' && budgetProgress.length" class="panel">
        <h3>預算</h3>
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

      <!-- Month view flows its panels through the two-column grid (the wrappers are
           display: contents), so a missing optional panel like 預算 or the card
           breakdowns never leaves a lone half-empty row; year view keeps the pairs. -->
      <div :class="viewMode === 'year' ? 'panel-pair' : 'panel-contents'">
      <section v-if="viewMode === 'year'" class="panel">
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

      <section class="panel">
        <h3>資產總覽<span class="muted"> · 淨值 {{ fmt(netWorth) }}</span></h3>
        <div v-if="accountsWithBalance.length === 0" class="empty">還沒有帳戶,先到「帳戶」分頁新增一個</div>
        <div v-for="g in accountGroups" :key="g.label" class="subsection">
          <div class="subsection-header">
            <span>{{ g.label }}</span>
            <span :class="{ negative: g.subtotal < 0 }">{{ fmt(g.subtotal) }}</span>
          </div>
          <div v-for="row in g.rows" :key="row.account.id">
            <div class="bar-row">
              <span class="icon-badge-sm" :style="{ background: (row.account.color || '#adb5bd') + '30' }">{{ row.icon }}</span>
              <span class="bar-name">{{ row.account.name }}</span>
              <span class="bar-amount" :class="{ negative: row.displayBalance < 0 }">
                {{ fmt(row.displayBalance) }}<template v-if="!['credit_card', 'loan'].includes(row.account.kind)"> · {{ fmtAssetPercent(row.displayBalance) }}</template>
              </span>
            </div>
            <div v-if="row.account.kind === 'brokerage'" class="account-split">
              <span>現金 {{ fmt(row.cash) }}</span>
              <span>持股成本 {{ fmt(row.holdingsCost) }}</span>
            </div>
          </div>
        </div>
      </section>
      </div>

      <div :class="viewMode === 'year' ? 'panel-pair' : 'panel-contents'">
      <section class="panel">
        <h3>{{ viewMode === 'year' ? '全年分類支出' : '分類支出' }}</h3>
        <div v-if="activeSummary.categoryBreakdown.length === 0" class="empty">{{ viewMode === 'year' ? '這一年還沒有紀錄' : '這個月還沒有紀錄' }}</div>
        <template v-else>
          <svg viewBox="0 0 100 100" class="donut-chart">
            <circle cx="50" cy="50" r="40" fill="none" stroke="var(--line)" stroke-width="14" />
            <circle
              v-for="(seg, i) in donutSegments" :key="i"
              cx="50" cy="50" r="40" fill="none"
              :stroke="seg.color" stroke-width="14"
              :stroke-dasharray="seg.dash + ' ' + seg.gap"
              :stroke-dashoffset="seg.dashOffset"
              transform="rotate(-90 50 50)"
            />
          </svg>
          <div v-for="row in activeSummary.categoryBreakdown" :key="row.category.id">
            <div class="bar-row clickable" @click="toggleCategoryExpand(row.category.id)">
              <span class="icon-badge-sm" :style="{ background: (row.category.color || '#adb5bd') + '30' }">{{ row.category.icon }}</span>
              <span class="bar-name">{{ row.category.name }}</span>
              <span class="expand-arrow" :class="{ open: expandedCategoryId === row.category.id }">›</span>
              <span class="bar-amount">{{ fmt(row.amount) }} · {{ fmtCategoryPercent(row.amount) }}</span>
            </div>
            <div v-if="expandedCategoryId === row.category.id" class="category-detail">
              <div v-if="categoryLabelBreakdown(row.category.id).length === 0" class="empty">這個分類底下的交易都還沒有標籤</div>
              <div v-for="d in categoryLabelBreakdown(row.category.id)" :key="d.label.id" class="category-detail-row">
                <span class="category-detail-note">{{ d.label.name }}</span>
                <span class="category-detail-bar-track">
                  <span class="category-detail-bar-fill" :style="{ width: (d.amount / row.amount * 100) + '%' }"></span>
                </span>
                <span class="category-detail-amount">{{ fmt(d.amount) }}</span>
              </div>
            </div>
          </div>
        </template>
      </section>

      <section class="panel">
        <h3>{{ viewMode === 'year' ? '全年標籤統計' : '標籤統計' }}</h3>
        <div v-if="labelBreakdown.length === 0" class="empty">{{ viewMode === 'year' ? '這一年還沒有標籤紀錄' : '這個月還沒有標籤紀錄' }}</div>
        <div v-for="row in labelBreakdown" :key="row.label.id">
          <div class="bar-row clickable" @click="toggleLabelExpand(row.label.id)">
            <span class="icon-badge-sm" :style="{ background: (row.label.color || '#6d6875') + '30' }">{{ row.label.icon || '🏷️' }}</span>
            <span class="bar-name">{{ row.label.name }}</span>
            <span class="expand-arrow" :class="{ open: expandedLabelId === row.label.id }">›</span>
            <span class="bar-amount">{{ fmt(row.amount) }} · {{ fmtLabelPercent(row.amount) }}</span>
          </div>
          <div v-if="expandedLabelId === row.label.id" class="category-detail">
            <div v-for="d in labelNoteBreakdown(row.label.id)" :key="d.note" class="category-detail-row">
              <span class="category-detail-note">{{ d.note }}</span>
              <span class="category-detail-bar-track">
                <span class="category-detail-bar-fill" :style="{ width: (d.amount / row.amount * 100) + '%' }"></span>
              </span>
              <span class="category-detail-amount">{{ fmt(d.amount) }}</span>
            </div>
          </div>
        </div>
      </section>
      </div>

      <div :class="viewMode === 'year' ? 'panel-pair' : 'panel-contents'">
      <section v-if="viewMode === 'month'" class="panel">
        <h3>固定支出<span class="muted"> · 共 {{ fmt(fixedExpenseTotal) }}(貸款含本金)</span></h3>
        <div v-if="fixedExpenseRows.length === 0" class="empty">這個月還沒有固定支出</div>
        <template v-else>
          <svg viewBox="0 0 100 100" class="donut-chart">
            <circle cx="50" cy="50" r="40" fill="none" stroke="var(--line)" stroke-width="14" />
            <circle
              v-for="(seg, i) in fixedExpenseDonutSegments" :key="i"
              cx="50" cy="50" r="40" fill="none"
              :stroke="seg.color" stroke-width="14"
              :stroke-dasharray="seg.dash + ' ' + seg.gap"
              :stroke-dashoffset="seg.dashOffset"
              transform="rotate(-90 50 50)"
            />
          </svg>
          <div v-for="row in fixedExpenseRows" :key="row.key" class="bar-row">
            <span class="legend-swatch" :style="{ background: row.color }"></span>
            <span class="bar-name">{{ row.name }}<span v-if="row.detail" class="row-detail">{{ row.detail }}</span></span>
            <span class="bar-amount">{{ fmt(row.amount) }} · {{ fmtFixedPercent(row.amount) }}</span>
          </div>
        </template>
      </section>

      <section v-if="activeSummary.incomeCategoryBreakdown.length" class="panel">
        <h3>{{ viewMode === 'year' ? '全年收入分類' : '收入分類' }}</h3>
        <svg viewBox="0 0 100 100" class="donut-chart">
          <circle cx="50" cy="50" r="40" fill="none" stroke="var(--line)" stroke-width="14" />
          <circle
            v-for="(seg, i) in incomeDonutSegments" :key="i"
            cx="50" cy="50" r="40" fill="none"
            :stroke="seg.color" stroke-width="14"
            :stroke-dasharray="seg.dash + ' ' + seg.gap"
            :stroke-dashoffset="seg.dashOffset"
            transform="rotate(-90 50 50)"
          />
        </svg>
        <div v-for="row in activeSummary.incomeCategoryBreakdown" :key="row.category.id" class="bar-row">
          <span class="icon-badge-sm" :style="{ background: (row.category.color || '#adb5bd') + '30' }">{{ row.category.icon }}</span>
          <span class="bar-name">{{ row.category.name }}</span>
          <span class="bar-amount">{{ fmt(row.amount) }} · {{ fmtIncomePercent(row.amount) }}</span>
        </div>
      </section>
      </div>

      <div :class="viewMode === 'year' ? 'panel-pair' : 'panel-contents'">
      <section v-if="creditCardDebtBreakdown.length" class="panel">
        <h3>信用卡欠款<span class="muted"> · 共 {{ fmt(creditCardDebtTotal) }}</span></h3>
        <svg viewBox="0 0 100 100" class="donut-chart">
          <circle cx="50" cy="50" r="40" fill="none" stroke="var(--line)" stroke-width="14" />
          <circle
            v-for="(seg, i) in creditCardDebtSegments" :key="i"
            cx="50" cy="50" r="40" fill="none"
            :stroke="seg.color" stroke-width="14"
            :stroke-dasharray="seg.dash + ' ' + seg.gap"
            :stroke-dashoffset="seg.dashOffset"
            transform="rotate(-90 50 50)"
          />
        </svg>
        <div v-for="row in creditCardDebtBreakdown" :key="row.category.name" class="bar-row">
          <span class="legend-swatch" :style="{ background: row.category.color }"></span>
          <span class="bar-name">{{ row.category.name }}</span>
          <span class="bar-amount">{{ fmt(row.amount) }} · {{ fmtCreditCardDebtPercent(row.amount) }}</span>
        </div>
      </section>

      <section v-if="creditCardSpendBreakdown.length" class="panel">
        <h3>{{ viewMode === 'year' ? '全年信用卡刷卡' : '本月信用卡刷卡' }}<span class="muted"> · 共 {{ fmt(creditCardSpendTotal) }}</span></h3>
        <svg viewBox="0 0 100 100" class="donut-chart">
          <circle cx="50" cy="50" r="40" fill="none" stroke="var(--line)" stroke-width="14" />
          <circle
            v-for="(seg, i) in creditCardSpendSegments" :key="i"
            cx="50" cy="50" r="40" fill="none"
            :stroke="seg.color" stroke-width="14"
            :stroke-dasharray="seg.dash + ' ' + seg.gap"
            :stroke-dashoffset="seg.dashOffset"
            transform="rotate(-90 50 50)"
          />
        </svg>
        <div v-for="row in creditCardSpendBreakdown" :key="row.category.name" class="bar-row">
          <span class="legend-swatch" :style="{ background: row.category.color }"></span>
          <span class="bar-name">{{ row.category.name }}</span>
          <span class="bar-amount">{{ fmt(row.amount) }} · {{ fmtCreditCardSpendPercent(row.amount) }}</span>
        </div>
      </section>
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
