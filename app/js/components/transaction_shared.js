// The transaction row and the transaction form are shared by every screen
// that lists or edits transactions (the 記帳 day panel and the 交易 list).
// One owner for each, so a change to either is felt everywhere at once
// instead of drifting between two hand-copied forms.

const TransactionRowItem = {
  props: ['transaction'],
  emits: ['edit', 'remove'],
  computed: {
    category() {
      return Store.state.categories.find((c) => c.id === this.transaction.categoryId);
    },
    accountName() {
      const a = Store.state.accounts.find((x) => x.id === this.transaction.accountId);
      return a ? a.name : '(已刪除帳戶)';
    },
    toAccountName() {
      const a = Store.state.accounts.find((x) => x.id === this.transaction.toAccountId);
      return a ? a.name : '(已刪除帳戶)';
    },
    labelNames() {
      return Store.labelsForTransaction(this.transaction.id).map((l) => l.name);
    },
  },
  methods: {
    fmt(n) {
      return Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
    },
  },
  template: `
    <div class="list-row clickable" @click="$emit('edit', transaction)">
      <div class="list-row-main">
        <template v-if="transaction.type === 'transfer'">
          <span class="bar-icon">🔁</span>
          <span class="list-row-title">{{ accountName }} → {{ toAccountName }}</span>
        </template>
        <template v-else>
          <span class="icon-badge" :style="{ background: (category?.color || '#adb5bd') + '30' }">{{ category?.icon || '❔' }}</span>
          <span class="list-row-title">{{ transaction.note || category?.name || '(未分類)' }}</span>
        </template>
        <div class="list-row-sub">
          {{ accountName }}
          <span v-if="labelNames.length"> · {{ labelNames.join(', ') }}</span>
        </div>
      </div>
      <div class="list-row-amount" :class="{ negative: transaction.type === 'expense', positive: transaction.type === 'income' }">
        {{ transaction.type === 'expense' ? '-' : transaction.type === 'income' ? '+' : '' }}{{ fmt(transaction.amount) }}
      </div>
      <button class="row-delete" @click.stop="$emit('remove', transaction)" aria-label="刪除">✕</button>
    </div>
  `,
};

// Renders an already-grouped (Models.groupTransactionsByCategory) list for
// one type-section of the 記帳 day panel: a category with only one
// transaction that day renders as a plain row exactly as before, a category
// with several folds them under a clickable summary header showing the
// category's total, expanded on demand. Each group's open/closed state is
// independent and owned here so the parent view doesn't need to track it.
const TransactionCategoryGroupList = {
  components: { TransactionRowItem },
  props: {
    groups: { type: Array, required: true },
  },
  emits: ['edit', 'remove'],
  data() {
    return { expandedGroups: new Set() };
  },
  methods: {
    toggleGroupExpand(categoryId) {
      const key = categoryId || '__none__';
      if (this.expandedGroups.has(key)) this.expandedGroups.delete(key);
      else this.expandedGroups.add(key);
    },
    isGroupExpanded(categoryId) {
      return this.expandedGroups.has(categoryId || '__none__');
    },
    fmt(n) {
      return Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
    },
  },
  template: `
    <template v-for="g in groups" :key="g.categoryId || '__none__'">
      <TransactionRowItem v-if="g.items.length === 1" :transaction="g.items[0]" @edit="$emit('edit', $event)" @remove="$emit('remove', $event)" />
      <div v-else>
        <div class="list-row clickable" @click="toggleGroupExpand(g.categoryId)">
          <span class="icon-badge" :style="{ background: (g.category?.color || '#adb5bd') + '30' }">{{ g.category?.icon || '❔' }}</span>
          <div class="list-row-main">
            <div class="list-row-title">{{ g.category?.name || '(未分類)' }}</div>
            <div class="list-row-sub">{{ g.items.length }} 筆</div>
          </div>
          <div class="list-row-amount" :class="{ negative: g.items[0].type === 'expense', positive: g.items[0].type === 'income' }">
            {{ g.items[0].type === 'expense' ? '-' : g.items[0].type === 'income' ? '+' : '' }}{{ fmt(g.total) }}
          </div>
          <span class="expand-arrow" :class="{ open: isGroupExpanded(g.categoryId) }">›</span>
        </div>
        <template v-if="isGroupExpanded(g.categoryId)">
          <TransactionRowItem v-for="t in g.items" :key="t.id" :transaction="t" @edit="$emit('edit', $event)" @remove="$emit('remove', $event)" />
        </template>
      </div>
    </template>
  `,
};

const TransactionFormModal = {
  components: { CalculatorField },
  props: {
    // 'new' or an existing transaction's id. The component reads its own
    // starting values from the Store, so the caller need not build a form
    // object at all — it only tracks which id (if any) is open.
    editingId: { type: String, required: true },
    defaultDate: { type: String, default: null },
  },
  emits: ['close'],
  data() {
    return {
      form: this.buildForm(),
      newLabelInput: '',
    };
  },
  computed: {
    isNew() {
      return this.editingId === 'new';
    },
    accounts() {
      return Store.activeAccounts();
    },
    labels() {
      return Store.activeLabels();
    },
    categoryOptions() {
      return Store.activeCategories(this.form.type === 'income' ? 'income' : 'expense');
    },
    categoryGroupLabel() {
      return this.form.type === 'income' ? '收入分類' : '支出分類';
    },
    // 證券交割 accounts are only offered for a transfer (funding one from a
    // bank, or moving proceeds back out) — an expense or income never
    // touches one directly, trades settle through the 投資 form instead.
    accountGroups() {
      const kinds = [
        { kind: 'cash', label: '現金' },
        { kind: 'bank', label: '銀行' },
        { kind: 'credit_card', label: '信用卡' },
      ];
      if (this.form.type === 'transfer') kinds.push({ kind: 'brokerage', label: '證券交割' }, { kind: 'loan', label: '借款' });
      return kinds
        .map(({ kind, label }) => ({ label, accounts: this.accounts.filter((a) => a.kind === kind) }))
        .filter((g) => g.accounts.length > 0);
    },
  },
  watch: {
    // Leaving 轉帳 while a 證券交割 account is picked would leave a value the
    // select no longer lists, so fall back to a bookable account.
    'form.type'(type) {
      if (type === 'transfer') return;
      const current = this.accounts.find((a) => a.id === this.form.accountId);
      if (current && !Models.isTransferOnlyKind(current.kind)) return;
      const bookable = this.accounts.filter((a) => !Models.isTransferOnlyKind(a.kind));
      const fallback = bookable.find((a) => a.isDefault) || bookable[0];
      this.form.accountId = fallback ? fallback.id : '';
    },
  },
  methods: {
    buildForm() {
      if (!this.isNew) {
        const t = Store.state.transactions.find((x) => x.id === this.editingId);
        if (t) {
          return {
            date: t.date,
            type: t.type,
            amount: t.amount,
            accountId: t.accountId,
            toAccountId: t.toAccountId || '',
            categoryId: t.categoryId || '',
            note: t.note || '',
            labelNames: Store.labelsForTransaction(t.id).map((l) => l.name),
          };
        }
      }
      const today = new Date().toISOString().slice(0, 10);
      // 記帳's own default, independent of a brokerage/loan account's — this
      // form never lists brokerage or loan accounts (accountGroups below), so
      // picking one here would leave accountId pointing at nothing selectable.
      const bookableAccounts = Store.activeAccounts().filter((a) => !Models.isTransferOnlyKind(a.kind));
      const firstAccount = bookableAccounts.find((a) => a.isDefault) || bookableAccounts[0];
      return {
        date: this.defaultDate || today,
        type: 'expense',
        amount: '',
        accountId: firstAccount ? firstAccount.id : '',
        toAccountId: '',
        categoryId: '',
        note: '',
        labelNames: [],
      };
    },
    toggleLabel(name) {
      const idx = this.form.labelNames.indexOf(name);
      if (idx === -1) this.form.labelNames.push(name);
      else this.form.labelNames.splice(idx, 1);
    },
    async addNewLabelToForm() {
      const name = this.newLabelInput.trim();
      if (!name) return;
      await Store.findOrCreateLabel(name);
      if (!this.form.labelNames.includes(name)) this.form.labelNames.push(name);
      this.newLabelInput = '';
    },
    cancel() {
      this.$emit('close', {});
    },
    // Shared by save() and saveAndAddAnother() — returns null when the form
    // isn't valid to submit yet, so each caller just checks for that.
    buildFields() {
      const amount = Number(this.form.amount);
      if (!amount || amount <= 0 || !this.form.accountId) return null;
      if (this.form.type === 'transfer' && !this.form.toAccountId) return null;
      if (this.form.type !== 'transfer' && !this.form.categoryId) return null;
      return {
        date: this.form.date,
        type: this.form.type,
        amount,
        accountId: this.form.accountId,
        toAccountId: this.form.type === 'transfer' ? this.form.toAccountId : null,
        categoryId: this.form.type === 'transfer' ? null : this.form.categoryId,
        note: this.form.note.trim(),
      };
    },
    async save() {
      const fields = this.buildFields();
      if (!fields) return;
      if (this.isNew) {
        await Store.addTransaction(fields, this.form.labelNames);
      } else {
        await Store.updateTransaction(this.editingId, fields, this.form.labelNames);
      }
      this.$emit('close', { date: fields.date });
    },
    // Saves the current entry without closing the modal — keeps date, type
    // and account as-is (the common case is several entries the same day
    // from the same wallet) and clears only the per-entry fields, so the
    // operator can go straight into typing the next amount.
    async saveAndAddAnother() {
      const fields = this.buildFields();
      if (!fields) return;
      await Store.addTransaction(fields, this.form.labelNames);
      this.form = {
        ...this.form,
        amount: '',
        categoryId: '',
        note: '',
        labelNames: [],
      };
    },
    async removeCurrent() {
      if (this.isNew) return;
      if (!confirm('刪除這筆紀錄？')) return;
      await Store.deleteTransaction(this.editingId);
      this.$emit('close', {});
    },
  },
  template: `
    <div class="modal-backdrop" @click.self="cancel">
      <div class="modal">
        <h3>{{ isNew ? '新增紀錄' : '編輯紀錄' }}</h3>
        <div class="modal-body">
          <label>類型
            <select v-model="form.type">
              <option value="expense">支出</option>
              <option value="income">收入</option>
              <option value="transfer">轉帳</option>
            </select>
          </label>
          <label>日期 <input type="date" v-model="form.date" /></label>
          <label>金額 <CalculatorField v-model="form.amount" /></label>
          <label>{{ form.type === 'transfer' ? '轉出帳戶' : '帳戶' }}
            <select v-model="form.accountId">
              <optgroup v-for="g in accountGroups" :key="g.label" :label="g.label">
                <option v-for="a in g.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
              </optgroup>
            </select>
          </label>
          <label v-if="form.type === 'transfer'">轉入帳戶
            <select v-model="form.toAccountId">
              <optgroup v-for="g in accountGroups" :key="g.label" :label="g.label">
                <option v-for="a in g.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
              </optgroup>
            </select>
          </label>
          <label v-if="form.type !== 'transfer'">分類
            <select v-model="form.categoryId">
              <optgroup :label="categoryGroupLabel">
                <option v-for="c in categoryOptions" :key="c.id" :value="c.id">{{ c.icon }} {{ c.name }}</option>
              </optgroup>
            </select>
          </label>
          <label>備註 <input v-model="form.note" /></label>
          <label>標籤
            <div class="chip-row">
              <span
                v-for="l in labels" :key="l.id"
                class="chip" :class="{ selected: form.labelNames.includes(l.name) }"
                @click="toggleLabel(l.name)"
              >{{ l.icon || '🏷️' }} {{ l.name }}</span>
              <span v-if="labels.length === 0" class="muted">還沒有標籤,在下面新增一個</span>
            </div>
            <div class="chip-add-row">
              <input v-model="newLabelInput" placeholder="新增標籤" @keyup.enter.prevent="addNewLabelToForm" />
              <button type="button" @click="addNewLabelToForm">加入</button>
            </div>
          </label>
        </div>
        <div class="modal-actions" :class="{ 'with-delete': !isNew }">
          <button v-if="!isNew" class="danger" @click="removeCurrent">刪除</button>
          <div class="modal-actions-right">
            <button @click="cancel">取消</button>
            <button v-if="isNew" @click="saveAndAddAnother">再記一筆</button>
            <button class="primary" @click="save">儲存</button>
          </div>
        </div>
      </div>
    </div>
  `,
};
