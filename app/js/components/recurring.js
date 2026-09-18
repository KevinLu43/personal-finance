// Management panel for monthly recurring rules (rent/subscriptions/salary/
// ...) — reviewing/editing the rules is a different rhythm from browsing
// the calendar TransactionsView already shows, the same reasoning
// investment_overview.js split off of investments.js for. Self-contained:
// reads Store.state directly and owns its own modal, so embedding it is a
// single <RecurringTransactionsPanel /> with no props.
const RecurringFormModal = {
  components: { CalculatorField },
  props: {
    editingId: { type: String, required: true }, // 'new' or an existing rule's id
  },
  emits: ['close'],
  data() {
    return { form: this.buildForm(), newLabelInput: '' };
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
    // Same cash/bank/credit_card grouping (no brokerage) TransactionFormModal
    // uses — a recurring rule is a regular ledger entry, not a trade.
    accountGroups() {
      const kinds = [
        { kind: 'cash', label: '現金' },
        { kind: 'bank', label: '銀行' },
        { kind: 'credit_card', label: '信用卡' },
      ];
      return kinds
        .map(({ kind, label }) => ({ label, accounts: this.accounts.filter((a) => a.kind === kind) }))
        .filter((g) => g.accounts.length > 0);
    },
    existingRule() {
      return this.isNew ? null : Store.state.recurringTransactions.find((r) => r.id === this.editingId);
    },
  },
  methods: {
    buildForm() {
      if (!this.isNew) {
        const r = Store.state.recurringTransactions.find((x) => x.id === this.editingId);
        if (r) {
          return {
            type: r.type,
            amount: r.amount,
            accountId: r.accountId,
            toAccountId: r.toAccountId || '',
            categoryId: r.categoryId || '',
            note: r.note || '',
            labelNames: r.labelNames || [],
            anchorDay: r.anchorDay, // display only while editing; not resubmitted
            occurrenceCount: r.remainingOccurrences == null ? '' : r.remainingOccurrences,
          };
        }
      }
      // 記帳's own default, independent of a brokerage account's — this
      // form never lists brokerage accounts (accountGroups below), so
      // picking one here would leave accountId pointing at nothing selectable.
      const bookableAccounts = Store.activeAccounts().filter((a) => a.kind !== 'brokerage');
      const firstAccount = bookableAccounts.find((a) => a.isDefault) || bookableAccounts[0];
      return {
        type: 'expense',
        amount: '',
        accountId: firstAccount ? firstAccount.id : '',
        toAccountId: '',
        categoryId: '',
        note: '',
        labelNames: [],
        anchorDay: new Date().getDate(),
        occurrenceCount: '',
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
      this.$emit('close');
    },
    async save() {
      const amount = Number(this.form.amount);
      if (!amount || amount <= 0 || !this.form.accountId) return;
      if (this.form.type === 'transfer' && !this.form.toAccountId) return;
      if (this.form.type !== 'transfer' && !this.form.categoryId) return;

      const fields = {
        type: this.form.type,
        amount,
        accountId: this.form.accountId,
        toAccountId: this.form.type === 'transfer' ? this.form.toAccountId : null,
        categoryId: this.form.type === 'transfer' ? null : this.form.categoryId,
        note: this.form.note.trim(),
        // Plain array, not the form's reactive one — IndexedDB's structured
        // clone (via Db.put) chokes on a Vue proxy.
        labelNames: [...this.form.labelNames],
      };

      if (this.isNew) {
        await Store.addRecurring({ ...fields, anchorDay: this.form.anchorDay, occurrenceCount: this.form.occurrenceCount || null });
      } else {
        fields.remainingOccurrences = this.form.occurrenceCount === '' ? null : Number(this.form.occurrenceCount);
        await Store.updateRecurring(this.editingId, fields);
      }
      this.$emit('close');
    },
    async removeCurrent() {
      if (this.isNew) return;
      if (!confirm('刪除這筆固定支出？已經產生的紀錄不會被刪除。')) return;
      await Store.deleteRecurring(this.editingId);
      this.$emit('close');
    },
  },
  template: `
    <div class="modal-backdrop" @click.self="cancel">
      <div class="modal">
        <h3>{{ isNew ? '新增固定支出' : '編輯固定支出' }}</h3>
        <div class="modal-body">
          <label>類型
            <select v-model="form.type" :disabled="!isNew">
              <option value="expense">支出</option>
              <option value="income">收入</option>
              <option value="transfer">轉帳</option>
            </select>
          </label>
          <label v-if="isNew">執行日(每月幾號)
            <select v-model.number="form.anchorDay">
              <option v-for="d in 31" :key="d" :value="d">{{ d }} 號</option>
            </select>
            <span class="field-hint">如果這個月的這一天已經過了,新增後會立刻補產生這個月那一筆;之後每個月固定執行,若某月沒有這一天(例如 31 號)會自動改在當月最後一天</span>
          </label>
          <label v-else>執行週期
            <div class="field-hint" style="margin-top: 4px;">每月 {{ existingRule ? existingRule.anchorDay : '' }} 日(建立後不可修改,如需更改請刪除重建)</div>
          </label>
          <label>執行期數(選填) <input type="number" min="1" v-model="form.occurrenceCount" placeholder="不限期數" />
            <span class="field-hint">設定這筆要總共執行幾次,執行完會自動封存;留空代表不限期數,持續執行下去</span>
          </label>
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
            <button class="primary" @click="save">儲存</button>
          </div>
        </div>
      </div>
    </div>
  `,
};

const RECURRING_TYPE_ICON = { expense: '➖', income: '➕', transfer: '🔁' };

const RecurringTransactionsPanel = {
  components: { RecurringFormModal },
  data() {
    return { editingId: null }; // null closed, 'new' or a rule id
  },
  computed: {
    rules() {
      return Store.state.recurringTransactions
        .slice()
        .sort((a, b) => (a.nextDueDate < b.nextDueDate ? -1 : 1));
    },
  },
  methods: {
    category(r) {
      return Store.state.categories.find((c) => c.id === r.categoryId);
    },
    accountName(id) {
      const a = Store.state.accounts.find((x) => x.id === id);
      return a ? a.name : '(已刪除帳戶)';
    },
    label(r) {
      if (r.type === 'transfer') return `${this.accountName(r.accountId)} → ${this.accountName(r.toAccountId)}`;
      const c = this.category(r);
      return r.note || (c ? c.name : '(未分類)');
    },
    icon(r) {
      if (r.type === 'transfer') return RECURRING_TYPE_ICON.transfer;
      const c = this.category(r);
      return c ? c.icon : RECURRING_TYPE_ICON[r.type];
    },
    fmt(n) {
      return Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
    },
    subLabel(r) {
      const parts = [`每月 ${r.anchorDay} 日`, `下次 ${r.nextDueDate}`];
      if (r.remainingOccurrences != null) parts.push(`剩 ${r.remainingOccurrences} 期`);
      return parts.join(' · ');
    },
    openNew() {
      this.editingId = 'new';
    },
    openEdit(r) {
      this.editingId = r.id;
    },
    onFormClosed() {
      this.editingId = null;
    },
    async toggleArchive(r) {
      await Store.setRecurringArchived(r.id, !r.isArchived);
    },
  },
  template: `
    <section class="panel span-2">
      <div class="view-header">
        <h3>固定支出<span class="muted"> · 每月自動記帳</span></h3>
        <button class="primary" @click="openNew">+ 新增</button>
      </div>

      <div v-if="rules.length === 0" class="empty">還沒有固定支出,適合用來記房租、訂閱、保費、薪資這類每月固定發生的項目</div>

      <div v-for="r in rules" :key="r.id" class="list-row clickable" :class="{ archived: r.isArchived }" @click="openEdit(r)">
        <span class="icon-badge" :style="{ background: (category(r)?.color || '#adb5bd') + '30' }">{{ icon(r) }}</span>
        <div class="list-row-main">
          <div class="list-row-title">{{ label(r) }}</div>
          <div class="list-row-sub">{{ subLabel(r) }}</div>
        </div>
        <div class="list-row-amount" :class="{ negative: r.type === 'expense', positive: r.type === 'income' }">
          {{ r.type === 'expense' ? '-' : r.type === 'income' ? '+' : '' }}{{ fmt(r.amount) }}
        </div>
        <div class="list-row-actions">
          <button @click.stop="toggleArchive(r)">{{ r.isArchived ? '取消封存' : '封存' }}</button>
        </div>
      </div>

      <RecurringFormModal
        v-if="editingId"
        :editing-id="editingId"
        @close="onFormClosed"
      />
    </section>
  `,
};
