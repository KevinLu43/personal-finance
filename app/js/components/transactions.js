const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

const TransactionsView = {
  components: { TransactionRowItem, TransactionFormModal, TransactionCategoryGroupList, LoanPaymentRow, RecurringTransactionsPanel },
  data() {
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1, // 1-12
      // Always a real date, not a popup toggle: the bottom half always
      // shows *some* day's records, defaulting to today.
      selectedDay: Models.localToday(),
      editingId: null, // null closed, 'new' or a transaction id, drives the form modal
      formDefaultDate: null,
    };
  },
  computed: {
    yearMonth() {
      return `${this.year}-${String(this.month).padStart(2, '0')}`;
    },
    todayStr() {
      return Models.localToday();
    },
    selectedHoliday() {
      return Models.holidayOf(this.selectedDay);
    },
    weekdayLabels() {
      return WEEKDAY_LABELS;
    },
    // 固定支出 still to run and accounts' due dates, from tomorrow to the end
    // of the month on screen (Models.projectedItems) — empty for a past month.
    projected() {
      const monthEnd = `${this.yearMonth}-31`;
      if (monthEnd <= this.todayStr) return [];
      const { recurringTransactions, accounts, pledges } = Store.state;
      return Models.projectedItems({ recurrings: recurringTransactions, accounts, pledges }, this.todayStr, monthEnd)
        .filter((p) => p.date.startsWith(this.yearMonth))
        .map((p) => (p.kind === 'loan' ? { ...p, amount: this.loanInstallmentAmounts.get(p.accountId) || 0 } : p));
    },
    // Each loan's monthly installment, principal + interest — the same
    // estimate the 固定收支 panel shows. An equal-payment loan pays the same
    // each month, so one figure from today's balance serves every month ahead.
    loanInstallmentAmounts() {
      const byId = new Map();
      for (const a of Store.state.accounts) {
        if (a.kind !== 'loan' || a.loanType === 'pledge' || !a.loanInstallments) continue;
        const left = a.loanInstallments - a.loanPaidInstallments;
        if (left > 0) byId.set(a.id, Math.round(Models.installmentBreakdown(Store.accountBalance(a), a.loanRate, left).payment));
      }
      return byId;
    },
    projectedByDate() {
      const byDate = new Map();
      for (const p of this.projected) {
        if (!byDate.has(p.date)) byDate.set(p.date, []);
        byDate.get(p.date).push(p);
      }
      return byDate;
    },
    // 本月還有預計: what the rules will still book this month, in TWD, with
    // loan installments as their own 還款 — only their interest is an expense
    // in the reports (the principal is a transfer), so folding the whole
    // payment into 支出 would disagree with 總覽.
    projectedTotals() {
      const totals = { expense: 0, repay: 0, income: 0 };
      for (const p of this.projected) {
        if (p.kind === 'recurring' && (p.type === 'expense' || p.type === 'income')) totals[p.type] += this.projectedBase(p);
        else if (p.kind === 'loan' && p.amount) totals.repay += this.projectedBase(p);
      }
      return totals;
    },
    projectedSummaryParts() {
      const t = this.projectedTotals;
      return [
        t.expense && { label: '支出', text: '-' + this.fmt(t.expense), cls: 'negative' },
        t.repay && { label: '還款', text: '-' + this.fmt(t.repay), cls: 'negative' },
        t.income && { label: '收入', text: '+' + this.fmt(t.income), cls: 'positive' },
      ].filter(Boolean);
    },
    selectedProjected() {
      return this.projectedByDate.get(this.selectedDay) || [];
    },
    calendarCells() {
      const firstWeekday = new Date(this.year, this.month - 1, 1).getDay();
      const daysInMonth = new Date(this.year, this.month, 0).getDate();
      const totals = Store.dailyTotals(this.yearMonth);
      const cells = [];
      for (let i = 0; i < firstWeekday; i++) cells.push(null);
      for (let d = 1; d <= daysInMonth; d++) {
        const row = totals.get(d) || { expense: 0, income: 0 };
        const dateStr = `${this.yearMonth}-${String(d).padStart(2, '0')}`;
        cells.push({
          day: d,
          dateStr,
          holiday: Models.holidayOf(dateStr),
          ...this.projectedCell(dateStr),
          expense: row.expense,
          income: row.income,
        });
      }
      return cells;
    },
    selectedDayTransactions() {
      if (!this.selectedDay) return [];
      return Store.state.transactions
        .filter((t) => !t.isDeleted && t.date === this.selectedDay)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    },
    // Loan installments are pulled out first and shown as their own
    // 貸款還款 section, one row per payment, so neither the interest expense
    // nor the principal transfer also shows up as a stray row below.
    dayLoanSplit() {
      return Models.splitLoanPayments(this.selectedDayTransactions);
    },
    loanPayments() {
      return this.dayLoanSplit.payments;
    },
    loanPaymentDayTotal() {
      return this.loanPayments.reduce((sum, p) => sum + p.total, 0);
    },
    selectedDayExpenses() {
      return this.dayLoanSplit.others.filter((t) => t.type === 'expense');
    },
    selectedDayIncomes() {
      return this.dayLoanSplit.others.filter((t) => t.type === 'income');
    },
    selectedDayTransfers() {
      return this.dayLoanSplit.others.filter((t) => t.type === 'transfer');
    },
    // Each type-section groups by category (transfers have none, so that
    // section stays a flat list) — a category with just one transaction
    // that day still renders plainly via TransactionCategoryGroupList.
    expenseGroups() {
      return Models.groupTransactionsByCategory(this.selectedDayExpenses, Store.state.categories, Store.baseAmountOf);
    },
    incomeGroups() {
      return Models.groupTransactionsByCategory(this.selectedDayIncomes, Store.state.categories, Store.baseAmountOf);
    },
    selectedDayExpenseTotal() {
      return this.selectedDayExpenses.reduce((sum, t) => sum + Store.baseAmountOf(t), 0);
    },
    selectedDayIncomeTotal() {
      return this.selectedDayIncomes.reduce((sum, t) => sum + Store.baseAmountOf(t), 0);
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

    // --- Projected (預計) items ---
    projectedBase(p) {
      return Store.baseAmountOf({ amount: p.amount, accountId: p.accountId, date: p.date });
    },
    // A cell's share of the projection: the rules' expense/income sums, and
    // the first due date's short tag (a second one shows up in the day's list).
    projectedCell(dateStr) {
      const items = this.projectedByDate.get(dateStr) || [];
      let expectedExpense = 0;
      let expectedIncome = 0;
      let expectedRepay = 0;
      let due = null;
      for (const p of items) {
        if (p.kind === 'recurring') {
          if (p.type === 'expense') expectedExpense += this.projectedBase(p);
          else if (p.type === 'income') expectedIncome += this.projectedBase(p);
        } else {
          if (p.kind === 'loan' && p.amount) expectedRepay += this.projectedBase(p);
          if (!due) due = { card: '💳繳款', loan: '🏦還款', pledge: '📌到期' }[p.kind];
        }
      }
      return { expectedExpense, expectedIncome, expectedRepay, due };
    },
    accountNameOf(id) {
      const a = Store.state.accounts.find((x) => x.id === id);
      return a ? a.name : '';
    },
    // One line of the selected day's 預計 list: what it is and where from.
    projectedRow(p) {
      if (p.kind === 'card') return { icon: '💳', name: '信用卡繳款', sub: this.accountNameOf(p.accountId), amount: '' };
      if (p.kind === 'loan') {
        return { icon: '🏦', name: '貸款還款', sub: `${this.accountNameOf(p.accountId)} 第 ${p.installment}/${p.installments} 期 · 本金 + 利息(預估)`, amount: p.amount ? '-' + this.fmt(this.projectedBase(p)) : '' };
      }
      if (p.kind === 'pledge') {
        const name = window.tickerName(p.market, p.ticker);
        return { icon: '📌', name: '質押到期', sub: `${p.ticker}${name ? ' ' + name : ''} · ${this.accountNameOf(p.accountId)}`, amount: '' };
      }
      const category = Store.state.categories.find((c) => c.id === p.categoryId);
      const from = this.accountNameOf(p.accountId);
      const rule = Store.state.recurringTransactions.find((r) => p.key.startsWith(`rec:${r.id}:`));
      if (p.type === 'transfer') {
        return { icon: '🔁', name: p.note || '轉帳', sub: `${from} → ${this.accountNameOf(p.toAccountId)}`, amount: this.fmt(p.amount), sign: '' };
      }
      return {
        icon: category ? category.icon : '❔',
        name: p.note || (category ? category.name : '固定收支'),
        sub: rule && rule.installment ? `信用卡分期 · ${from}` : `固定${p.type === 'income' ? '收入' : '支出'} · ${p.type === 'income' ? '存入' : '從'}${from}`,
        amount: (p.type === 'income' ? '+' : '-') + this.fmt(this.projectedBase(p)),
        sign: p.type,
      };
    },

    // --- Calendar ---
    selectDay(dateStr) {
      this.selectedDay = dateStr;
    },

    // --- Transaction form ---
    openNew(dateOverride) {
      this.formDefaultDate = dateOverride || this.selectedDay;
      this.editingId = 'new';
    },
    openEdit(t) {
      this.editingId = t.id;
    },
    onFormClosed(payload) {
      if (payload && payload.date) this.selectedDay = payload.date;
      this.editingId = null;
    },
    async remove(t) {
      if (!confirm('刪除這筆紀錄？')) return;
      await Store.deleteTransaction(t.id);
    },
    fmt(n) {
      return Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
    },
  },
  template: `
    <div class="view">
      <div class="view-header">
        <h2>記帳</h2>
        <button class="primary" @click="openNew()">+ 新增</button>
      </div>

      <div class="panel-grid ledger-grid">
      <!-- Left (top on mobile): the calendar -->
      <section class="panel ledger-calendar">
        <div class="month-nav">
          <button @click="shiftMonth(-1)">‹</button>
          <span class="month-label">{{ year }} 年 {{ month }} 月</span>
          <button @click="shiftMonth(1)">›</button>
        </div>

        <div v-if="projectedSummaryParts.length" class="projected-summary">
          本月還有預計:<template v-for="(part, i) in projectedSummaryParts" :key="part.label"><template v-if="i"> · </template>{{ part.label }} <span :class="part.cls">{{ part.text }}</span></template>
        </div>
        <div class="calendar-weekdays">
          <span v-for="(w, i) in weekdayLabels" :key="w" :class="{ weekend: i === 0 || i === 6 }">{{ w }}</span>
        </div>
        <div class="calendar-grid">
          <div
            v-for="(cell, i) in calendarCells"
            :key="i"
            class="calendar-day"
            :class="{ empty: !cell, today: cell && cell.dateStr === todayStr, selected: cell && cell.dateStr === selectedDay, off: cell && cell.holiday.off, holiday: cell && cell.holiday.holiday, makeup: cell && cell.holiday.makeup }"
            @click="cell && selectDay(cell.dateStr)"
          >
            <template v-if="cell">
              <div class="day-num">{{ cell.day }}</div>
              <div v-if="cell.holiday.short" class="day-holiday">{{ cell.holiday.short }}</div>
              <div v-if="cell.expense" class="day-amount negative">-{{ fmt(cell.expense) }}</div>
              <div v-if="cell.income" class="day-amount positive">+{{ fmt(cell.income) }}</div>
              <div v-if="cell.expectedExpense" class="day-amount expected">-{{ fmt(cell.expectedExpense) }}</div>
              <div v-if="cell.expectedIncome" class="day-amount expected positive">+{{ fmt(cell.expectedIncome) }}</div>
              <div v-if="cell.due" class="day-due">{{ cell.due }}</div>
              <div v-if="cell.expectedRepay" class="day-amount expected">-{{ fmt(cell.expectedRepay) }}</div>
            </template>
          </div>
        </div>
      </section>

      <!-- Right (below the calendar on mobile): the selected day's records, split by expense/income/transfer -->
      <section class="panel ledger-day">
        <div class="view-header">
          <h3>{{ selectedDay }}</h3>
          <button class="primary" @click="openNew(selectedDay)">+ 新增</button>
        </div>
        <div v-if="selectedHoliday.name" class="selected-day-holiday" :class="{ off: selectedHoliday.off }">{{ selectedHoliday.name }}</div>

        <div v-if="selectedProjected.length" class="subsection projected-list">
          <div class="subsection-header"><span>預計 · 到期當天自動記帳</span></div>
          <div v-for="p in selectedProjected" :key="p.key" class="list-row">
            <span class="icon-badge-sm">{{ projectedRow(p).icon }}</span>
            <div class="list-row-main">
              <div class="list-row-title">{{ projectedRow(p).name }}</div>
              <div class="list-row-sub">{{ projectedRow(p).sub }}</div>
            </div>
            <div class="list-row-amount projected-amount" :class="projectedRow(p).sign === 'income' ? 'positive' : ''">{{ projectedRow(p).amount }}</div>
          </div>
        </div>
        <div v-if="selectedDayTransactions.length === 0" class="empty">這天還沒有紀錄</div>

        <template v-else>
          <div v-if="selectedDayExpenses.length" class="subsection">
            <div class="subsection-header">
              <span>支出</span>
              <span class="negative">-{{ fmt(selectedDayExpenseTotal) }}</span>
            </div>
            <TransactionCategoryGroupList :groups="expenseGroups" @edit="openEdit" @remove="remove" />
          </div>

          <div v-if="selectedDayIncomes.length" class="subsection">
            <div class="subsection-header">
              <span>收入</span>
              <span class="positive">+{{ fmt(selectedDayIncomeTotal) }}</span>
            </div>
            <TransactionCategoryGroupList :groups="incomeGroups" @edit="openEdit" @remove="remove" />
          </div>

          <div v-if="selectedDayTransfers.length" class="subsection">
            <div class="subsection-header">
              <span>轉帳</span>
            </div>
            <TransactionRowItem v-for="t in selectedDayTransfers" :key="t.id" :transaction="t" @edit="openEdit" @remove="remove" />
          </div>

          <div v-if="loanPayments.length" class="subsection">
            <div class="subsection-header">
              <span>貸款還款</span>
              <span class="negative">-{{ fmt(loanPaymentDayTotal) }}</span>
            </div>
            <LoanPaymentRow v-for="p in loanPayments" :key="p.key" :payment="p" @edit="openEdit" @remove="remove" />
          </div>
        </template>
      </section>

      <RecurringTransactionsPanel class="ledger-recurring" />
      </div>

      <TransactionFormModal
        v-if="editingId"
        :editing-id="editingId"
        :default-date="formDefaultDate"
        @close="onFormClosed"
      />
    </div>
  `,
};
