const DASHBOARD_TYPE_LABELS = { expense: '支出', income: '收入', transfer: '轉帳' };

const DashboardView = {
  components: { TransactionRowItem, TransactionFormModal },
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
    };
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
    // This month's known fixed-cost total — the sum of this period's expense
    // transactions that a recurring rule actually generated (recurringId
    // set), not a projection from today's rule list. Month-mode only, same
    // as budgetProgress above; the year view gets its own chart instead.
    recurringExpenseTotal() {
      if (this.viewMode !== 'month') return 0;
      return this.periodExpenseTransactions
        .filter((t) => t.recurringId)
        .reduce((sum, t) => sum + t.amount, 0);
    },
    // Year mode's 固定支出 chart: actual recurring-generated expense per
    // month of the selected year, Jan–Dec.
    yearlyRecurringExpenseMonths() {
      return Store.monthlyRecurringExpense(this.year);
    },
    recurringExpenseChart() {
      return Models.buildRecurringExpenseChart(this.yearlyRecurringExpenseMonths);
    },
    recurringExpenseYearTotal() {
      return this.yearlyRecurringExpenseMonths.reduce((sum, m) => sum + m.amount, 0);
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
    accountsWithBalance() {
      return Store.activeAccounts().map((a) => {
        const balance = Store.accountBalance(a); // what is owed, for a credit card — always positive
        // A credit card reduces net worth, so it displays (and sums) as a
        // negative figure — the same red/negative convention an expense
        // uses everywhere else, rather than reading like money on hand.
        const displayBalance = a.kind === 'credit_card' ? -balance : balance;
        return { account: a, balance, displayBalance, icon: Models.accountIcon(a) };
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
        .filter((r) => r.account.kind !== 'credit_card')
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
    fmt(n) {
      return n.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
    },
    fmtCreditCardDebtPercent(amount) {
      return this.creditCardDebtTotal > 0 ? (amount / this.creditCardDebtTotal * 100).toFixed(1) + '%' : '0%';
    },
    fmtCreditCardSpendPercent(amount) {
      return this.creditCardSpendTotal > 0 ? (amount / this.creditCardSpendTotal * 100).toFixed(1) + '%' : '0%';
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
        <div class="kpi-card income">
          <div class="kpi-label">{{ viewMode === 'year' ? '全年收入' : '收入' }}</div>
          <div class="kpi-value">{{ fmt(activeSummary.income) }}</div>
        </div>
        <div class="kpi-card expense">
          <div class="kpi-label">{{ viewMode === 'year' ? '全年支出' : '支出' }}</div>
          <div class="kpi-value">{{ fmt(activeSummary.expense) }}</div>
        </div>
        <div class="kpi-card" :class="activeSummary.net >= 0 ? 'income' : 'expense'">
          <div class="kpi-label">{{ viewMode === 'year' ? '全年結餘' : '結餘' }}</div>
          <div class="kpi-value">{{ fmt(activeSummary.net) }}</div>
        </div>
        <div v-if="viewMode === 'month'" class="kpi-card expense">
          <div class="kpi-label">固定支出</div>
          <div class="kpi-value">{{ fmt(recurringExpenseTotal) }}</div>
        </div>
      </div>

      <div class="panel-grid">
      <section class="panel span-2">
        <div class="view-header">
          <h3>收支趨勢<span class="muted"> · {{ viewMode === 'year' ? (year + ' 年 1–12 月') : '最近 6 個月' }}</span></h3>
          <div class="trend-legend">
            <span class="legend-item"><span class="legend-dot expense"></span>支出</span>
            <span class="legend-item"><span class="legend-dot income"></span>收入</span>
            <span class="legend-item"><span class="legend-dot net"></span>結餘</span>
          </div>
        </div>
        <svg viewBox="0 0 300 100" preserveAspectRatio="none" class="trend-svg">
          <line x1="0" :y1="trendChart.baselineY" x2="300" :y2="trendChart.baselineY" class="trend-baseline" />
          <template v-for="b in trendChart.bars" :key="b.yearMonth">
            <rect :x="b.expenseX" :y="b.expenseY" :width="trendChart.barWidth" :height="b.expenseH" fill="var(--expense)" />
            <rect :x="b.incomeX" :y="b.incomeY" :width="trendChart.barWidth" :height="b.incomeH" fill="var(--income)" />
          </template>
          <polyline :points="trendChart.netPoints" class="trend-net-line" />
          <circle v-for="b in trendChart.bars" :key="'dot-' + b.yearMonth" :cx="b.netX" :cy="b.netY" r="2.5" class="trend-net-dot" />
        </svg>
        <div class="trend-labels">
          <span v-for="b in trendChart.bars" :key="'lbl-' + b.yearMonth">{{ b.month }}月</span>
        </div>
      </section>

      <section class="panel span-2">
        <div class="view-header">
          <h3>淨值趨勢<span class="muted"> · {{ viewMode === 'year' ? (year + ' 年 1–12 月') : '最近 6 個月' }}</span></h3>
          <span class="net-worth-change" :class="netWorthChange >= 0 ? 'positive' : 'negative'">{{ netWorthChange >= 0 ? '+' : '' }}{{ fmt(netWorthChange) }}</span>
        </div>
        <svg viewBox="0 0 300 100" preserveAspectRatio="none" class="trend-svg">
          <polyline :points="netWorthChart.points" class="trend-net-line" />
          <circle v-for="d in netWorthChart.dots" :key="'nw-' + d.yearMonth" :cx="d.x" :cy="d.y" r="2.5" class="trend-net-dot" />
        </svg>
        <div class="trend-labels">
          <span v-for="d in netWorthChart.dots" :key="'nwl-' + d.yearMonth">{{ d.month }}月</span>
        </div>
      </section>

      <section v-if="viewMode === 'year'" class="panel span-2">
        <h3>固定支出<span class="muted"> · {{ year }} 年共 {{ fmt(recurringExpenseYearTotal) }}</span></h3>
        <svg viewBox="0 0 300 100" preserveAspectRatio="none" class="trend-svg">
          <rect v-for="b in recurringExpenseChart.bars" :key="b.month" :x="b.x" :y="b.y" :width="b.width" :height="b.height" fill="var(--expense)" />
        </svg>
        <div class="trend-labels">
          <span v-for="b in recurringExpenseChart.bars" :key="'re-' + b.month">{{ b.month }}月</span>
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

      <section class="panel">
        <h3>資產總覽<span class="muted"> · 淨值 {{ fmt(netWorth) }}</span></h3>
        <div v-if="accountsWithBalance.length === 0" class="empty">還沒有帳戶,先到「帳戶」分頁新增一個</div>
        <div v-for="g in accountGroups" :key="g.label" class="subsection">
          <div class="subsection-header">
            <span>{{ g.label }}</span>
            <span :class="{ negative: g.subtotal < 0 }">{{ fmt(g.subtotal) }}</span>
          </div>
          <div v-for="row in g.rows" :key="row.account.id" class="bar-row">
            <span class="icon-badge-sm" :style="{ background: (row.account.color || '#adb5bd') + '30' }">{{ row.icon }}</span>
            <span class="bar-name">{{ row.account.name }}</span>
            <span class="bar-amount" :class="{ negative: row.displayBalance < 0 }">
              {{ fmt(row.displayBalance) }}<template v-if="row.account.kind !== 'credit_card'"> · {{ fmtAssetPercent(row.displayBalance) }}</template>
            </span>
          </div>
        </div>
      </section>

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

      <section class="panel">
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
        <div v-for="g in groupedByDate" :key="g.date" class="subsection">
          <div class="subsection-header clickable" @click="toggleDateExpand(g.date)">
            <span>{{ g.date }}</span>
            <span>
              <span v-if="g.expenseTotal" class="negative">-{{ fmt(g.expenseTotal) }}</span>
              <span v-if="g.incomeTotal" class="positive"> +{{ fmt(g.incomeTotal) }}</span>
              <span class="expand-arrow" :class="{ open: expandedDate === g.date }">›</span>
            </span>
          </div>
          <template v-if="expandedDate === g.date">
            <TransactionRowItem v-for="t in g.items" :key="t.id" :transaction="t" @edit="openEdit" @remove="remove" />
          </template>
        </div>
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
