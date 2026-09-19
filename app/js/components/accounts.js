const AccountRowItem = {
  props: ['account', 'listId', 'index', 'dragging'],
  emits: ['edit', 'toggle-archive', 'delete', 'toggle-default', 'handle-down', 'handle-move', 'handle-up', 'extend', 'repay', 'pledge'],
  computed: {
    isCredit() {
      return this.account.kind === 'credit_card';
    },
    isLoan() {
      return this.account.kind === 'loan';
    },
    isBrokerage() {
      return this.account.kind === 'brokerage';
    },
    // A credit card or loan's stored balance is what is owed (a positive
    // figure). It displays as a negative number here — debt reads the same
    // red/negative way an expense does everywhere else in the app, rather
    // than looking like money the reader actually has.
    isDebt() {
      return Models.isLiabilityKind(this.account.kind);
    },
    displayAmount() {
      const owed = Store.accountBalance(this.account);
      const n = this.isDebt ? -owed : owed;
      return (n === 0 ? 0 : n).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
    },
    isNegative() {
      return this.isDebt ? Store.accountBalance(this.account) > 0 : Store.accountBalance(this.account) < 0;
    },
    loanRateDisplay() {
      return ((this.account.loanRate || 0) * 100).toLocaleString('zh-TW', { maximumFractionDigits: 4 });
    },
    loanOverdue() {
      return !!this.account.loanMaturity && this.account.loanMaturity < new Date().toISOString().slice(0, 10);
    },
    loanAccruedInterest() {
      return Store.accruedInterest(this.account, new Date().toISOString().slice(0, 10)).toLocaleString('zh-TW');
    },
    // Active pledges against this loan, e.g. "2330×1000、0050×2000".
    pledgeSummary() {
      return Store.state.pledges
        .filter((p) => p.loanAccountId === this.account.id && !p.isReleased)
        .map((p) => p.ticker + '×' + p.quantity)
        .join('、');
    },
    canExtend() {
      return this.account.loanExtensions < this.account.loanMaxExtensions;
    },
    creditLimitDisplay() {
      return Number(this.account.creditLimit || 0).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
    },
    feeRateDisplay() {
      return ((this.account.feeRate || 0) * 100).toLocaleString('zh-TW', { maximumFractionDigits: 4 });
    },
    icon() {
      return Models.accountIcon(this.account);
    },
  },
  template: `
    <div class="list-row" :class="{ archived: account.isArchived, dragging }" :data-drag-list="listId" :data-drag-row="index">
      <span class="drag-handle"
        @pointerdown="$emit('handle-down', $event)"
        @pointermove="$emit('handle-move', $event)"
        @pointerup="$emit('handle-up', $event)"
        @pointercancel="$emit('handle-up', $event)"
      >⠿</span>
      <button
        v-if="!isLoan"
        class="default-star" :class="{ active: account.isDefault }"
        :aria-label="account.isDefault ? '取消預設帳戶' : '設為預設帳戶'"
        @click.stop="$emit('toggle-default', account)"
      >{{ account.isDefault ? '★' : '☆' }}</button>
      <span class="icon-badge" :style="{ background: (account.color || '#adb5bd') + '30' }">{{ icon }}</span>
      <div class="list-row-main">
        <div class="list-row-title">{{ account.name }}</div>
        <div class="list-row-sub">
          {{ account.currency }}
          <span v-if="account.isDefault"> · 預設帳戶</span>
          <span v-if="isCredit"> · 額度 {{ creditLimitDisplay }}</span>
          <span v-if="isBrokerage"> · {{ account.market === 'TW' ? '台股' : '美股' }} · 手續費 {{ feeRateDisplay }}%</span>
        </div>
        <div v-if="isLoan" class="list-row-sub">
          年利率 {{ loanRateDisplay }}% · 到期 {{ account.loanMaturity || '未設定' }}<span v-if="loanOverdue" class="negative">(已到期)</span>
          · 展延 {{ account.loanExtensions }}/{{ account.loanMaxExtensions }} · 應付利息 {{ loanAccruedInterest }}
        </div>
        <div v-if="isLoan" class="list-row-sub">質押:{{ pledgeSummary || '無' }}</div>
      </div>
      <div class="list-row-amount" :class="{ negative: isNegative }">{{ displayAmount }}</div>
      <div class="list-row-actions">
        <button v-if="isLoan" :disabled="!canExtend" @click="$emit('extend', account)">展延</button>
        <button v-if="isLoan" @click="$emit('pledge', account)">質押</button>
        <button v-if="isLoan" @click="$emit('repay', account)">還款</button>
        <button @click="$emit('edit', account)">編輯</button>
        <button @click="$emit('toggle-archive', account)">{{ account.isArchived ? '取消封存' : '封存' }}</button>
        <button class="danger" @click="$emit('delete', account)">刪除</button>
      </div>
    </div>
  `,
};

const AccountsView = {
  components: { AccountRowItem, IconPickerField, LoanExtendModal, LoanRepayModal, LoanPledgeModal },
  mixins: [DragSortMixin],
  data() {
    return {
      extendingLoanId: null, // loan whose 展延 dialog is open
      repayingLoanId: null, // loan whose 還款 dialog is open
      pledgingLoanId: null, // loan whose 質押 dialog is open
      editingId: null, // null = form closed
      form: this.blankForm(),
      rateFieldsTouched: false, // once the operator edits a rate, market changes stop overwriting it
      iconTouched: false, // once the operator picks an icon by hand, kind changes stop overwriting it
      backupMessage: '',
    };
  },
  computed: {
    accounts() {
      return Store.state.accounts.slice().sort((a, b) => a.sortOrder - b.sortOrder);
    },
    cashAccounts() {
      return this.accounts.filter((a) => a.kind === 'cash');
    },
    bankAccounts() {
      return this.accounts.filter((a) => a.kind === 'bank');
    },
    creditAccounts() {
      return this.accounts.filter((a) => a.kind === 'credit_card');
    },
    brokerageAccounts() {
      return this.accounts.filter((a) => a.kind === 'brokerage');
    },
    loanAccounts() {
      return this.accounts.filter((a) => a.kind === 'loan');
    },
  },
  watch: {
    // Picking a market fills in that market's factory-default rates — a
    // starting point, not a lock: once the operator edits a rate by hand,
    // later market changes stop clobbering it, the same "touched" guard
    // the investment form's own fee/tax auto-fill uses. The form's rate
    // fields are typed and shown as a percentage (0.1425 means 0.1425%);
    // Models.defaultRatesFor returns the decimal fraction actually stored
    // (0.001425), so *100 / 100 is the one place that conversion happens.
    'form.market'(market) {
      if (this.rateFieldsTouched) return;
      const defaults = Models.defaultRatesFor(market);
      // Round off the float noise *100 produces (0.001425 * 100 ===
      // 0.14250000000000002) — real, but not a number worth showing.
      this.form.feeRate = Math.round(defaults.feeRate * 1000000) / 10000;
      this.form.stockTaxRate = Math.round(defaults.stockTaxRate * 1000000) / 10000;
      this.form.etfTaxRate = Math.round(defaults.etfTaxRate * 1000000) / 10000;
    },
    'form.kind'(kind) {
      if (this.iconTouched) return;
      this.form.icon = Models.accountIcon({ kind });
    },
  },
  methods: {
    blankForm() {
      return {
        name: '', kind: 'cash', icon: Models.accountIcon({ kind: 'cash' }), color: '#adb5bd', currency: 'TWD', initialBalance: 0, creditLimit: 0,
        market: 'TW', feeRate: 0, stockTaxRate: 0, etfTaxRate: 0,
        loanRate: 0, loanInterestFrom: new Date().toISOString().slice(0, 10), loanMaturity: '', loanMaxExtensions: 0,
      };
    },
    openNew(kind) {
      this.editingId = 'new';
      this.rateFieldsTouched = false;
      this.iconTouched = false;
      const defaults = kind === 'brokerage' ? Models.defaultRatesFor('TW') : { feeRate: 0, stockTaxRate: 0, etfTaxRate: 0 };
      this.form = {
        ...this.blankForm(),
        kind,
        icon: Models.accountIcon({ kind }),
        feeRate: Math.round(defaults.feeRate * 1000000) / 10000,
        stockTaxRate: Math.round(defaults.stockTaxRate * 1000000) / 10000,
        etfTaxRate: Math.round(defaults.etfTaxRate * 1000000) / 10000,
      };
    },
    openEdit(account) {
      this.editingId = account.id;
      this.rateFieldsTouched = true; // an existing account's rates are real values, not a fresh default
      this.iconTouched = true; // ditto for its icon
      this.form = {
        name: account.name,
        kind: account.kind,
        icon: Models.accountIcon(account),
        color: account.color || '#adb5bd',
        currency: account.currency,
        initialBalance: account.initialBalance,
        creditLimit: account.creditLimit || 0,
        market: account.market || 'TW',
        feeRate: Math.round((account.feeRate || 0) * 1000000) / 10000,
        stockTaxRate: Math.round((account.stockTaxRate || 0) * 1000000) / 10000,
        etfTaxRate: Math.round((account.etfTaxRate || 0) * 1000000) / 10000,
        loanRate: Math.round((account.loanRate || 0) * 1000000) / 10000,
        loanInterestFrom: account.loanInterestFrom || new Date().toISOString().slice(0, 10),
        loanMaturity: account.loanMaturity || '',
        loanMaxExtensions: account.loanMaxExtensions || 0,
      };
    },
    cancel() {
      this.editingId = null;
    },
    async save() {
      if (!this.form.name.trim()) return;
      const fields = {
        name: this.form.name.trim(),
        kind: this.form.kind,
        icon: this.form.icon,
        color: this.form.color || '#adb5bd',
        currency: this.form.currency || 'TWD',
        initialBalance: Number(this.form.initialBalance) || 0,
        creditLimit: this.form.kind === 'credit_card' ? Number(this.form.creditLimit) || 0 : null,
        market: this.form.kind === 'brokerage' ? this.form.market : null,
        feeRate: this.form.kind === 'brokerage' ? (Number(this.form.feeRate) || 0) / 100 : null,
        stockTaxRate: this.form.kind === 'brokerage' ? (Number(this.form.stockTaxRate) || 0) / 100 : null,
        etfTaxRate: this.form.kind === 'brokerage' ? (Number(this.form.etfTaxRate) || 0) / 100 : null,
        // loanExtensions is deliberately not here: it starts at 0 in
        // newAccount and only the 展延 action ever changes it.
        loanRate: this.form.kind === 'loan' ? (Number(this.form.loanRate) || 0) / 100 : null,
        loanInterestFrom: this.form.kind === 'loan' ? this.form.loanInterestFrom || null : null,
        loanMaturity: this.form.kind === 'loan' ? this.form.loanMaturity || null : null,
        loanMaxExtensions: this.form.kind === 'loan' ? Number(this.form.loanMaxExtensions) || 0 : null,
      };
      if (this.editingId === 'new') {
        await Store.addAccount(fields);
      } else {
        await Store.updateAccount(this.editingId, fields);
      }
      this.editingId = null;
    },
    async toggleArchive(account) {
      await Store.setAccountArchived(account.id, !account.isArchived);
    },
    // A second click on the current default just clears it — leaving no
    // default is a valid state (falls back to the first active account,
    // same as before this feature existed), not something the star needs
    // a separate "none" option to reach.
    async toggleDefault(account) {
      if (account.isDefault) {
        await Store.updateAccount(account.id, { isDefault: false });
      } else {
        await Store.setDefaultAccount(account.id);
      }
    },
    async deleteAccount(account) {
      const count = Store.state.transactions.filter(
        (t) => !t.isDeleted && (t.accountId === account.id || t.toAccountId === account.id)
      ).length + Store.state.investments.filter((i) => !i.isDeleted && i.accountId === account.id).length;
      const msg = count > 0
        ? `這個帳戶還有 ${count} 筆交易紀錄,刪除帳戶後這些紀錄會顯示為「已刪除帳戶」,且無法復原。確定要刪除嗎？`
        : '確定要刪除這個帳戶嗎？此操作無法復原。';
      if (!confirm(msg)) return;
      await Store.deleteAccount(account.id);
    },
    // Renumbers only the dragged section — sortOrder is a single global
    // counter across all kinds, but every list here filters by kind before
    // sorting, so two accounts in different sections never have their
    // sortOrder compared against each other and reusing 0..n-1 per section
    // is safe.
    async persistOrder(listId, items) {
      await Promise.all(items.map((a, i) => Store.updateAccount(a.id, { sortOrder: i })));
    },
    async exportBackup() {
      const backup = Store.exportBackupData();
      const filename = `backup-${new Date().toISOString().slice(0, 10)}.json`;
      this.backupMessage = '';
      try {
        const result = await Backup.saveBackupFile(backup, filename);
        if (result.cancelled) {
          this.backupMessage = '已取消。';
        } else if (result.method === 'picker') {
          this.backupMessage = '備份已儲存。';
        } else {
          this.backupMessage = '備份已下載到瀏覽器的下載資料夾,請自行搬到 data 資料夾。';
        }
      } catch (err) {
        this.backupMessage = '匯出失敗:' + err.message;
      }
    },
  },
  template: `
    <div class="view">
      <div class="view-header"><h2>帳戶</h2></div>

      <div class="panel-grid">
      <section class="panel">
        <div class="view-header"><h3>現金</h3><button class="primary" @click="openNew('cash')">+ 新增</button></div>
        <AccountRowItem
          v-for="(a, i) in displayList('cash', cashAccounts)" :key="a.id"
          :account="a" list-id="cash" :index="i" :dragging="dragId === a.id"
          @edit="openEdit" @toggle-archive="toggleArchive" @delete="deleteAccount" @toggle-default="toggleDefault"
          @handle-down="startDrag('cash', cashAccounts, i, $event)" @handle-move="onDragMove" @handle-up="onDragEnd"
        />
        <div v-if="cashAccounts.length === 0" class="empty">還沒有現金帳戶</div>
      </section>

      <section class="panel">
        <div class="view-header"><h3>銀行</h3><button class="primary" @click="openNew('bank')">+ 新增</button></div>
        <AccountRowItem
          v-for="(a, i) in displayList('bank', bankAccounts)" :key="a.id"
          :account="a" list-id="bank" :index="i" :dragging="dragId === a.id"
          @edit="openEdit" @toggle-archive="toggleArchive" @delete="deleteAccount" @toggle-default="toggleDefault"
          @handle-down="startDrag('bank', bankAccounts, i, $event)" @handle-move="onDragMove" @handle-up="onDragEnd"
        />
        <div v-if="bankAccounts.length === 0" class="empty">還沒有銀行帳戶</div>
      </section>

      <section class="panel">
        <div class="view-header"><h3>信用卡</h3><button class="primary" @click="openNew('credit_card')">+ 新增</button></div>
        <AccountRowItem
          v-for="(a, i) in displayList('credit_card', creditAccounts)" :key="a.id"
          :account="a" list-id="credit_card" :index="i" :dragging="dragId === a.id"
          @edit="openEdit" @toggle-archive="toggleArchive" @delete="deleteAccount" @toggle-default="toggleDefault"
          @handle-down="startDrag('credit_card', creditAccounts, i, $event)" @handle-move="onDragMove" @handle-up="onDragEnd"
        />
        <div v-if="creditAccounts.length === 0" class="empty">還沒有信用卡</div>
      </section>

      <section class="panel">
        <div class="view-header"><h3>證券交割</h3><button class="primary" @click="openNew('brokerage')">+ 新增</button></div>
        <AccountRowItem
          v-for="(a, i) in displayList('brokerage', brokerageAccounts)" :key="a.id"
          :account="a" list-id="brokerage" :index="i" :dragging="dragId === a.id"
          @edit="openEdit" @toggle-archive="toggleArchive" @delete="deleteAccount" @toggle-default="toggleDefault"
          @handle-down="startDrag('brokerage', brokerageAccounts, i, $event)" @handle-move="onDragMove" @handle-up="onDragEnd"
        />
        <div v-if="brokerageAccounts.length === 0" class="empty">還沒有證券交割帳戶</div>
      </section>

      <section class="panel">
        <div class="view-header"><h3>借款</h3><button class="primary" @click="openNew('loan')">+ 新增</button></div>
        <p class="muted" style="margin: -4px 0 10px;">借出與還本金請用「轉帳」記,利息在展延或還款時一次結算</p>
        <AccountRowItem
          v-for="(a, i) in displayList('loan', loanAccounts)" :key="a.id"
          :account="a" list-id="loan" :index="i" :dragging="dragId === a.id"
          @edit="openEdit" @toggle-archive="toggleArchive" @delete="deleteAccount" @toggle-default="toggleDefault"
          @extend="extendingLoanId = $event.id" @repay="repayingLoanId = $event.id" @pledge="pledgingLoanId = $event.id"
          @handle-down="startDrag('loan', loanAccounts, i, $event)" @handle-move="onDragMove" @handle-up="onDragEnd"
        />
        <div v-if="loanAccounts.length === 0" class="empty">還沒有借款</div>
      </section>

      <section class="panel span-2">
        <h3>資料備份</h3>
        <p class="muted" style="margin: -4px 0 10px;">按下按鈕後請選擇要匯出到的路徑</p>
        <button class="primary" @click="exportBackup">匯出備份</button>
        <p v-if="backupMessage" class="muted" style="margin-top: 8px;">{{ backupMessage }}</p>
      </section>
      </div>

      <div v-if="editingId" class="modal-backdrop" @click.self="cancel">
        <div class="modal">
          <h3>{{ editingId === 'new' ? '新增帳戶' : '編輯帳戶' }}</h3>
          <div class="modal-body">
            <label>名稱 <input v-model="form.name" placeholder="例如：永豐活存" /></label>
            <label>圖示
              <IconPickerField v-model="form.icon" @update:model-value="iconTouched = true" />
            </label>
            <label>圖示底色 <input type="color" v-model="form.color" /></label>
            <label>類型
              <select v-model="form.kind">
                <option value="cash">現金</option>
                <option value="bank">銀行</option>
                <option value="credit_card">信用卡</option>
                <option value="brokerage">證券交割</option>
                <option value="loan">借款</option>
              </select>
            </label>
            <label v-if="form.kind === 'brokerage'">市場
              <select v-model="form.market">
                <option value="TW">台股</option>
                <option value="US">美股</option>
              </select>
            </label>
            <label v-else>幣別 <input v-model="form.currency" /></label>
            <label>{{ form.kind === 'credit_card' ? '目前欠款(起始)' : form.kind === 'loan' ? '目前借款餘額(起始)' : '起始餘額' }}
              <input type="number" v-model="form.initialBalance" />
            </label>
            <label v-if="form.kind === 'credit_card'">信用額度
              <input type="number" v-model="form.creditLimit" />
            </label>
            <template v-if="form.kind === 'loan'">
              <label>年利率(%) <input type="number" step="0.0001" min="0" v-model.number="form.loanRate" /></label>
              <label>計息起始日 <input type="date" v-model="form.loanInterestFrom" />
                <span class="field-hint">利息從這天起算;之後借出的金額請記成「借款 → 銀行」的轉帳</span>
              </label>
              <label>到期日 <input type="date" v-model="form.loanMaturity" /></label>
              <label>最多可展延次數 <input type="number" min="0" step="1" v-model.number="form.loanMaxExtensions" /></label>
            </template>
            <template v-if="form.kind === 'brokerage'">
              <label>手續費率(%) <input type="number" step="0.0001" v-model.number="form.feeRate" @input="rateFieldsTouched = true" />
                <span class="field-hint">買賣都適用,小數表示,例如 0.1425 代表 0.1425%</span>
              </label>
              <template v-if="form.market === 'TW'">
                <label>股票交易稅率(%,僅賣出) <input type="number" step="0.0001" v-model.number="form.stockTaxRate" @input="rateFieldsTouched = true" /></label>
                <label>ETF 交易稅率(%,僅賣出) <input type="number" step="0.0001" v-model.number="form.etfTaxRate" @input="rateFieldsTouched = true" /></label>
              </template>
            </template>
          </div>
          <div class="modal-actions">
            <button @click="cancel">取消</button>
            <button class="primary" @click="save">儲存</button>
          </div>
        </div>
      </div>

      <LoanExtendModal v-if="extendingLoanId" :loan-id="extendingLoanId" @close="extendingLoanId = null" />
      <LoanRepayModal v-if="repayingLoanId" :loan-id="repayingLoanId" @close="repayingLoanId = null" />
      <LoanPledgeModal v-if="pledgingLoanId" :loan-id="pledgingLoanId" @close="pledgingLoanId = null" />
    </div>
  `,
};
