const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

const TransactionsView = {
  components: { TransactionRowItem, TransactionFormModal, TransactionCategoryGroupList, RecurringTransactionsPanel },
  data() {
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1, // 1-12
      // Always a real date, not a popup toggle: the bottom half always
      // shows *some* day's records, defaulting to today.
      selectedDay: now.toISOString().slice(0, 10),
      editingId: null, // null closed, 'new' or a transaction id, drives the form modal
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
      return WEEKDAY_LABELS;
    },
    calendarCells() {
      const firstWeekday = new Date(this.year, this.month - 1, 1).getDay();
      const daysInMonth = new Date(this.year, this.month, 0).getDate();
      const totals = Store.dailyTotals(this.yearMonth);
      const cells = [];
      for (let i = 0; i < firstWeekday; i++) cells.push(null);
      for (let d = 1; d <= daysInMonth; d++) {
        const row = totals.get(d) || { expense: 0, income: 0 };
        cells.push({
          day: d,
          dateStr: `${this.yearMonth}-${String(d).padStart(2, '0')}`,
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
    selectedDayExpenses() {
      return this.selectedDayTransactions.filter((t) => t.type === 'expense');
    },
    selectedDayIncomes() {
      return this.selectedDayTransactions.filter((t) => t.type === 'income');
    },
    selectedDayTransfers() {
      return this.selectedDayTransactions.filter((t) => t.type === 'transfer');
    },
    // Each type-section groups by category (transfers have none, so that
    // section stays a flat list) — a category with just one transaction
    // that day still renders plainly via TransactionCategoryGroupList.
    expenseGroups() {
      return Models.groupTransactionsByCategory(this.selectedDayExpenses, Store.state.categories);
    },
    incomeGroups() {
      return Models.groupTransactionsByCategory(this.selectedDayIncomes, Store.state.categories);
    },
    selectedDayExpenseTotal() {
      return this.selectedDayExpenses.reduce((sum, t) => sum + t.amount, 0);
    },
    selectedDayIncomeTotal() {
      return this.selectedDayIncomes.reduce((sum, t) => sum + t.amount, 0);
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

      <div class="panel-grid">
      <!-- Left (top on mobile): the calendar -->
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
              <div v-if="cell.expense" class="day-amount negative">-{{ fmt(cell.expense) }}</div>
              <div v-if="cell.income" class="day-amount positive">+{{ fmt(cell.income) }}</div>
            </template>
          </div>
        </div>
      </section>

      <!-- Right (bottom on mobile): the selected day's records, split by expense/income/transfer -->
      <section class="panel">
        <div class="view-header">
          <h3>{{ selectedDay }}</h3>
          <button class="primary" @click="openNew(selectedDay)">+ 新增</button>
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
        </template>
      </section>

      <RecurringTransactionsPanel />
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
