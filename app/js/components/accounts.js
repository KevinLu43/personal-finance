const AccountRowItem = {
  props: ['account', 'listId', 'index', 'dragging'],
  emits: ['edit', 'toggle-archive', 'delete', 'toggle-default', 'handle-down', 'handle-move', 'handle-up', 'pledge'],
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
    isForeign() {
      return !!this.account.currency && this.account.currency !== 'TWD' && !!Models.CURRENCIES[this.account.currency];
    },
    // The balance in the account's own currency; a foreign one also shows its
    // TWD equivalent underneath (foreignBase), since totals are in TWD.
    nativeAmount() {
      const owed = Store.accountBalance(this.account);
      return this.isDebt ? -owed : owed;
    },
    displayAmount() {
      const n = this.nativeAmount;
      const text = Models.formatMoney(n === 0 ? 0 : n, this.account.currency);
      return this.isForeign ? Models.currencySymbol(this.account.currency) + text : text;
    },
    foreignBase() {
      const twd = this.nativeAmount * Models.rateOf(this.account.currency, Store.state.rateHistory);
      return '≈ NT$ ' + Math.round(twd).toLocaleString('zh-TW');
    },
    isNegative() {
      return this.isDebt ? Store.accountBalance(this.account) > 0 : Store.accountBalance(this.account) < 0;
    },
    loanRateDisplay() {
      return ((this.account.loanRate || 0) * 100).toLocaleString('zh-TW', { maximumFractionDigits: 4 });
    },
    // Installments left, and roughly what the next payment will be — the
    // same figures the monthly engine (Store.generateLoanInstallments) uses.
    installmentsLeft() {
      return Math.max(0, (this.account.loanInstallments || 0) - (this.account.loanPaidInstallments || 0));
    },
    // Why an installment loan isn't booking payments, when it isn't — spelled
    // out on the row instead of leaving the operator to guess from an empty
    // ledger.
    installmentIssue() {
      const a = this.account;
      if (!this.isLoan || this.isPledge || !a.loanInstallments || this.installmentsLeft <= 0) return '';
      if (!a.loanPayFromAccountId) return '缺少扣款帳戶,不會自動記帳(按「編輯」補上)';
      if (!Store.state.accounts.some((x) => x.id === a.loanPayFromAccountId)) return '扣款帳戶已不存在,請按「編輯」重新選擇';
      if (!a.loanNextDue) return '缺少還款日,不會自動記帳(按「編輯」補上)';
      if (Store.accountBalance(a) <= 0) return '目前借款餘額是 0,沒有可還的本金,所以不會記帳(按「編輯」填貸款金額)';
      return '';
    },
    nextPayment() {
      const b = Models.installmentBreakdown(Store.accountBalance(this.account), this.account.loanRate, this.installmentsLeft);
      return Math.round(b.payment).toLocaleString('zh-TW');
    },
    isPledge() {
      return Models.isPledgeLoan(this.account);
    },
    loanTypeLabel() {
      return Models.LOAN_TYPE_LABELS[this.account.loanType] || '其他';
    },
    // A 質押 loan is its pledged stocks: how many are still pledged and the
    // interest they have accrued together (each has its own rate).
    activePledges() {
      return Store.state.pledges.filter((p) => p.loanAccountId === this.account.id && !p.isReleased);
    },
    pledgeAccruedTotal() {
      const today = Models.localToday();
      return this.activePledges.reduce((sum, p) => sum + Store.pledgeAccruedInterest(p, today), 0).toLocaleString('zh-TW');
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
        <div v-if="isPledge" class="list-row-sub">
          {{ loanTypeLabel }} · 質押 {{ activePledges.length }} 檔 · 應付利息合計 {{ pledgeAccruedTotal }}
        </div>
        <div v-else-if="isLoan && account.loanInstallments" class="list-row-sub">
          {{ loanTypeLabel }} · 年利率 {{ loanRateDisplay }}% · 已還 {{ account.loanPaidInstallments }}/{{ account.loanInstallments }} 期
          <template v-if="installmentsLeft > 0"> · 下次 {{ account.loanNextDue }} · 每期約 {{ nextPayment }}</template>
          <template v-else> · 已還清</template>
        </div>
        <div v-if="installmentIssue" class="list-row-sub negative">⚠ {{ installmentIssue }}</div>
        <div v-if="isLoan && !isPledge && !account.loanInstallments" class="list-row-sub">{{ loanTypeLabel }} · 尚未設定分期(按「編輯」設定分期數與扣款帳戶)</div>
      </div>
      <div class="list-row-amount" :class="{ negative: isNegative }">
        {{ displayAmount }}
        <div v-if="isForeign" class="list-row-sub">{{ foreignBase }}</div>
      </div>
      <div class="list-row-actions">
        <button v-if="isPledge" @click="$emit('pledge', account)">新增質押</button>
        <button @click="$emit('edit', account)">編輯</button>
        <button @click="$emit('toggle-archive', account)">{{ account.isArchived ? '取消封存' : '封存' }}</button>
        <button class="danger" @click="$emit('delete', account)">刪除</button>
      </div>
    </div>
  `,
};

const AccountsView = {
  components: { AccountRowItem, IconPickerField, LoanPledgeModal, PledgeRowItem, PledgeExtendModal, PledgeRepayModal, PledgeEditModal },
  mixins: [DragSortMixin],
  data() {
    return {
      pledgingLoanId: null, // loan whose 新增質押 dialog is open
      extendingPledgeId: null, // pledged stock whose 展延 dialog is open
      repayingPledgeId: null, // pledged stock whose 還款 dialog is open
      editingPledgeId: null, // pledged stock whose terms are being edited
      editingId: null, // null = form closed
      form: this.blankForm(),
      rateFieldsTouched: false, // once the operator edits a rate, market changes stop overwriting it
      iconTouched: false, // once the operator picks an icon by hand, kind changes stop overwriting it
      backupMessage: '',
      restoring: false, // true while a restore is in flight, to disable both buttons
      rateEffectiveDate: { USD: Models.localToday(), JPY: Models.localToday() }, // 匯率設定's date picker, per currency
      openRateHistoryCode: null, // which currency's past-rates list is open, one at a time
    };
  },
  computed: {
    sync() { return window.SyncInfo; },
    feedbackUrl() { return (window.APP_CONFIG && window.APP_CONFIG.feedbackUrl) || ''; },
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
    loanTypeLabels() {
      return Models.LOAN_TYPE_LABELS;
    },
    // Accounts an installment can be paid from: anything an ordinary expense
    // could be charged to.
    // What an installment loan still needs before it can book anything. Shown
    // under the form and blocks saving, so a loan can't be saved into a state
    // where it silently never generates a payment.
    loanFormError() {
      const f = this.form;
      if (f.kind !== 'loan' || f.loanType === 'pledge') return '';
      if (this.editingId === 'new' && !(Number(f.initialBalance) > 0)) return '請填貸款金額,沒有本金就沒有可還的款';
      if (!(Number(f.loanInstallments) >= 1)) return '請填分期數(至少 1 期)';
      if (Number(f.loanPaidInstallments) >= Number(f.loanInstallments)) return '已還期數要小於分期數';
      if (!f.loanNextDue) return this.editingId === 'new' ? '請填首期還款日' : '請填下次還款日';
      if (!f.loanPayFromAccountId) return '請選擇扣款帳戶';
      return '';
    },
    // A new installment loan is entered from its original amount; when some
    // periods are already paid they are booked as past payments (see save()),
    // and what is still owed is what the schedule implies after them.
    newLoanStartBalance() {
      const f = this.form;
      if (this.editingId !== 'new' || f.kind !== 'loan' || f.loanType === 'pledge') return null;
      return Models.installmentScheduleBalance(Number(f.initialBalance) || 0, (Number(f.loanRate) || 0) / 100, Number(f.loanInstallments) || 0, Number(f.loanPaidInstallments) || 0);
    },
    newLoanPreview() {
      const start = this.newLoanStartBalance;
      const f = this.form;
      if (start === null || !(Number(f.initialBalance) > 0) || !(Number(f.loanInstallments) >= 1)) return '';
      const paid = Math.max(0, Number(f.loanPaidInstallments) || 0);
      const left = Number(f.loanInstallments) - paid;
      if (left <= 0) return '';
      const pay = Math.round(Models.installmentBreakdown(start, (Number(f.loanRate) || 0) / 100, left).payment);
      const fmt = (n) => n.toLocaleString('zh-TW');
      return paid > 0
        ? `會補記前 ${paid} 期的還款紀錄(本金轉帳＋利息支出);補記後剩餘本金約 ${fmt(start)},之後每期約 ${fmt(pay)}`
        : `每期約 ${fmt(pay)}`;
    },
    currencies() {
      return Models.CURRENCIES;
    },
    // Today's rate for each currency — what the input shows before the
    // operator touches it, and what every "current" figure elsewhere
    // (account rows, 資產總覽, …) is actually using right now.
    rates() {
      return {
        USD: Models.rateOf('USD', Store.state.rateHistory),
        JPY: Models.rateOf('JPY', Store.state.rateHistory),
      };
    },
    rateHistory() {
      return Store.state.rateHistory;
    },
    payableAccounts() {
      return Store.activeAccounts().filter((a) => !Models.isTransferOnlyKind(a.kind));
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
    openGuide() { window.Guide.open = true; },
    openSheet() { window.open(this.sync.sheetUrl, '_blank', 'noopener'); },
    // The still-pledged stocks of one loan, oldest first.
    pledgesOf(loanId) {
      return Store.state.pledges
        .filter((p) => p.loanAccountId === loanId && !p.isReleased)
        .sort((a, b) => (a.date < b.date ? -1 : 1));
    },
    async releaseUnpriced(pledge) {
      if (!confirm('解除 ' + pledge.ticker + ' 的質押？')) return;
      await Store.releasePledge(pledge.id);
    },
    // A new installment loan starts with sensible answers already filled in,
    // so the easy path (name, amount, rate, term) can't leave out what the
    // engine needs: first payment a month from today, paid from the default
    // account.
    blankForm() {
      const today = Models.localToday();
      const payable = Store.activeAccounts().filter((a) => !Models.isTransferOnlyKind(a.kind));
      const payFrom = payable.find((a) => a.isDefault) || payable[0];
      return {
        name: '', kind: 'cash', icon: Models.accountIcon({ kind: 'cash' }), color: '#adb5bd', currency: 'TWD', initialBalance: 0, creditLimit: 0,
        market: 'TW', feeRate: 0, stockTaxRate: 0, etfTaxRate: 0,
        loanType: 'pledge', loanRate: 0, loanInstallments: 12, loanPaidInstallments: 0,
        loanNextDue: Models.addMonthClamped(today, Number(today.slice(8, 10))), loanPayFromAccountId: payFrom ? payFrom.id : '',
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
        loanType: account.loanType || 'other',
        loanRate: Math.round((account.loanRate || 0) * 1000000) / 10000,
        loanInstallments: account.loanInstallments || 0,
        loanPaidInstallments: account.loanPaidInstallments || 0,
        loanNextDue: account.loanNextDue || '',
        loanPayFromAccountId: account.loanPayFromAccountId || '',
      };
    },
    cancel() {
      this.editingId = null;
    },
    async save() {
      if (!this.form.name.trim()) return;
      const isPledgeForm = this.form.loanType === 'pledge';
      const fields = {
        name: this.form.name.trim(),
        kind: this.form.kind,
        icon: this.form.icon,
        color: this.form.color || '#adb5bd',
        currency: this.form.kind === 'brokerage' ? Models.marketCurrency(this.form.market) : this.form.currency || 'TWD',
        initialBalance: Number(this.form.initialBalance) || 0,
        creditLimit: this.form.kind === 'credit_card' ? Number(this.form.creditLimit) || 0 : null,
        market: this.form.kind === 'brokerage' ? this.form.market : null,
        feeRate: this.form.kind === 'brokerage' ? (Number(this.form.feeRate) || 0) / 100 : null,
        stockTaxRate: this.form.kind === 'brokerage' ? (Number(this.form.stockTaxRate) || 0) / 100 : null,
        etfTaxRate: this.form.kind === 'brokerage' ? (Number(this.form.etfTaxRate) || 0) / 100 : null,
        loanType: this.form.kind === 'loan' ? this.form.loanType : null,
        // A 質押 loan keeps its rate/maturity/extensions on each pledged stock;
        // every other loan is repaid in installments instead.
        loanRate: this.form.kind === 'loan' && !isPledgeForm ? (Number(this.form.loanRate) || 0) / 100 : null,
        loanInstallments: this.form.kind === 'loan' && !isPledgeForm ? Number(this.form.loanInstallments) || 0 : null,
        loanPaidInstallments: this.form.kind === 'loan' && !isPledgeForm ? Math.max(0, Number(this.form.loanPaidInstallments) || 0) : null,
        loanNextDue: this.form.kind === 'loan' && !isPledgeForm ? this.form.loanNextDue || null : null,
        loanPayFromAccountId: this.form.kind === 'loan' && !isPledgeForm ? this.form.loanPayFromAccountId || null : null,
      };
      // A new installment loan entered part-way through its term: the amount is
      // the original loan, and the periods already paid are booked as real
      // past payments. Rewind the first date by that many months and start the
      // count at 0, and the monthly engine below books each of them — a
      // principal transfer and an interest expense, dated when they fell due.
      const alreadyPaid = this.newLoanStartBalance !== null ? fields.loanPaidInstallments : 0;
      if (alreadyPaid > 0 && fields.loanNextDue) {
        fields.loanNextDue = Models.subtractMonthsClamped(fields.loanNextDue, Number(fields.loanNextDue.slice(8, 10)), alreadyPaid);
        fields.loanPaidInstallments = 0;
      }
      let savedId = this.editingId;
      if (this.editingId === 'new') {
        savedId = (await Store.addAccount(fields)).id;
      } else {
        await Store.updateAccount(this.editingId, fields);
      }
      // An installment loan may already have payments due (a past first
      // date), so book them right away instead of waiting for the next launch.
      if (fields.kind === 'loan') await Store.generateLoanInstallments(savedId);
      this.editingId = null;
    },
    async setRate(code, value) {
      await Store.setExchangeRate(code, value, this.rateEffectiveDate[code]);
      // Next edit defaults to today again rather than quietly reusing
      // whatever date was left in the field from the last one.
      this.rateEffectiveDate[code] = Models.localToday();
    },
    toggleRateHistory(code) {
      this.openRateHistoryCode = this.openRateHistoryCode === code ? null : code;
    },
    fmtRate(n) {
      return Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 4 });
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
      if (account.kind === 'loan') {
        const n = Store.loanRelatedTransactions(account.id).length;
        const pledges = Store.state.pledges.filter((p) => p.loanAccountId === account.id).length;
        const detail = [n ? `${n} 筆相關的借款、還款與利息交易` : '', pledges ? `${pledges} 筆質押紀錄` : ''].filter(Boolean).join('和');
        const msg = `刪除「${account.name}」會連同${detail || '它的相關紀錄'}一起刪除,銀行等帳戶的餘額也會回到沒有這筆借款的樣子,且無法復原。已經還清、想保留歷史的借款,建議改用「封存」。確定要刪除嗎？`;
        if (!confirm(msg)) return;
        await Store.deleteAccount(account.id);
        return;
      }
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
      const filename = `backup-${Models.localToday()}.json`;
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
    async importBackup() {
      this.backupMessage = '';
      let picked;
      try {
        picked = await Backup.loadBackupFile();
      } catch (err) {
        this.backupMessage = '讀取失敗:' + err.message;
        return;
      }
      if (!picked.ok) {
        if (!picked.cancelled) this.backupMessage = '讀取失敗,請確認選的是備份 JSON 檔。';
        return;
      }
      const invalidReason = Models.validateBackup(picked.data);
      if (invalidReason) {
        this.backupMessage = invalidReason;
        return;
      }
      const exportedDate = picked.data.exportedAt ? picked.data.exportedAt.slice(0, 10) : '未知';
      const msg = `匯入會清空目前所有資料(帳戶、分類、標籤、交易、投資、固定支出、質押、匯率設定),換成這份備份的內容,且無法復原。這份備份的匯出日期:${exportedDate}。確定要匯入嗎？`;
      if (!confirm(msg)) return;
      this.restoring = true;
      try {
        await Store.restoreFromBackup(picked.data);
        this.backupMessage = '匯入完成。';
      } catch (err) {
        this.backupMessage = '匯入失敗:' + err.message;
      } finally {
        this.restoring = false;
      }
    },
  },
  template: `
    <div class="view">
      <div class="view-header"><h2>帳戶</h2></div>

      <section class="panel">
        <h3>匯率設定<span class="muted"> · 1 單位外幣 = 多少台幣</span></h3>
        <div v-for="code in ['USD', 'JPY']" :key="code" class="subsection">
          <div class="rate-row">
            <span class="rate-label">1 {{ code }} {{ currencies[code].label }} =</span>
            <input type="number" step="any" min="0" :value="rates[code]" @change="setRate(code, $event.target.value)" />
            <span>TWD</span>
            <span class="field-hint">生效日 <input type="date" v-model="rateEffectiveDate[code]" /></span>
          </div>
          <div v-if="rateHistory[code] && rateHistory[code].length > 1" class="bar-row clickable" @click="toggleRateHistory(code)">
            <span class="bar-name muted">過去的匯率({{ rateHistory[code].length }} 筆)</span>
            <span class="expand-arrow" :class="{ open: openRateHistoryCode === code }">›</span>
          </div>
          <div v-if="openRateHistoryCode === code" class="category-detail">
            <div v-for="e in rateHistory[code].slice().reverse()" :key="e.date" class="category-detail-row">
              <span class="category-detail-note">{{ e.date }}</span>
              <span class="category-detail-amount">1 {{ code }} = {{ fmtRate(e.rate) }}</span>
            </div>
          </div>
        </div>
        <p class="muted" style="margin: 8px 0 0;">總覽、淨值、統計都用生效日當天(或最近一次更早的設定)換算成台幣;改匯率只影響生效日之後的紀錄,不會動到更早的</p>
      </section>

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
        <p class="muted" style="margin: -4px 0 10px;">質押借款的額度、利率、到期日、展延設在每檔質押股票上;其他借款設定分期數,每月自動記還款</p>
        <div v-for="(a, i) in displayList('loan', loanAccounts)" :key="a.id">
          <AccountRowItem
            :account="a" list-id="loan" :index="i" :dragging="dragId === a.id"
            @edit="openEdit" @toggle-archive="toggleArchive" @delete="deleteAccount" @toggle-default="toggleDefault"
            @pledge="pledgingLoanId = $event.id"
            @handle-down="startDrag('loan', loanAccounts, i, $event)" @handle-move="onDragMove" @handle-up="onDragEnd"
          />
          <div v-if="a.loanType === 'pledge'" class="pledge-list">
            <PledgeRowItem
              v-for="p in pledgesOf(a.id)" :key="p.id" :pledge="p"
              @extend="extendingPledgeId = $event.id" @repay="repayingPledgeId = $event.id"
              @edit="editingPledgeId = $event.id" @release="releaseUnpriced"
            />
            <div v-if="pledgesOf(a.id).length === 0" class="empty">還沒有質押的股票,按「新增質押」開始</div>
          </div>
        </div>
        <div v-if="loanAccounts.length === 0" class="empty">還沒有借款</div>
      </section>

      <section class="panel span-2">
        <h3>使用說明</h3>
        <button @click="openGuide">查看新手引導</button>
        <a class="text-link" href="privacy.html" target="_blank" rel="noopener">隱私權說明</a>
        <a v-if="feedbackUrl" class="text-link" :href="feedbackUrl" target="_blank" rel="noopener">意見回饋</a>
      </section>

      <section v-if="sync.mode === 'google'" class="panel span-2">
        <h3>雲端同步</h3>
        <p class="muted" style="margin: -4px 0 10px;">資料存放在你的 Google 試算表,任何裝置登入同一個 Google 帳號都能使用</p>
        <button v-if="sync.sheetUrl" @click="openSheet">開啟試算表</button>
        <button @click="sync.signOut()">登出 Google</button>
      </section>

      <section class="panel span-2">
        <h3>資料備份</h3>
        <p class="muted" style="margin: -4px 0 10px;">按下按鈕後請選擇要匯出到的路徑</p>
        <button class="primary" :disabled="restoring" @click="exportBackup">匯出備份</button>
        <button :disabled="restoring" @click="importBackup">匯入備份</button>
        <p class="field-hint negative" style="margin: 8px 0 0;">匯入會清空目前所有資料,換成備份檔的內容,且無法復原,請先確認選對檔案</p>
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
              <span class="field-hint">{{ form.market === 'US' ? '美股帳戶以美金(USD)記帳,總覽用「匯率設定」換算成台幣' : '台股帳戶以台幣記帳' }}</span>
            </label>
            <label v-else>幣別
              <select v-model="form.currency">
                <option v-for="(c, code) in currencies" :key="code" :value="code">{{ code }} {{ c.label }}</option>
              </select>
              <span v-if="form.currency !== 'TWD'" class="field-hint">金額以 {{ form.currency }} 記,總覽和淨值用「匯率設定」換算成台幣</span>
            </label>
            <label>{{ form.kind === 'credit_card' ? '目前欠款(起始)' : form.kind === 'loan' && form.loanType === 'pledge' ? '目前借款餘額(起始)' : form.kind === 'loan' ? (editingId === 'new' ? '貸款金額(原始借款金額)' : '貸款金額(目前還欠的本金)') : '起始餘額' }}
              <input type="number" v-model="form.initialBalance" />
            </label>
            <label v-if="form.kind === 'credit_card'">信用額度
              <input type="number" v-model="form.creditLimit" />
            </label>
            <label v-if="form.kind === 'loan'">借款類型
              <select v-model="form.loanType">
                <option v-for="(label, type) in loanTypeLabels" :key="type" :value="type">{{ label }}</option>
              </select>
              <span v-if="form.loanType === 'pledge'" class="field-hint">質押借款的額度、利率、到期日,在新增每檔質押股票時設定</span>
            </label>
            <template v-if="form.kind === 'loan' && form.loanType !== 'pledge'">
              <label>年利率(%) <input type="number" step="0.0001" min="0" v-model.number="form.loanRate" /></label>
              <label>分期數(總期數) <input type="number" min="1" step="1" v-model.number="form.loanInstallments" />
                <span class="field-hint">每月一期、本息平均攤還</span>
              </label>
              <label>已還期數 <input type="number" min="0" step="1" v-model.number="form.loanPaidInstallments" />
                <span class="field-hint">新貸款填 0;已經還了幾期就填幾期,並把下面的日期填成下一次還款日。系統會往前補記那幾期的還款紀錄</span>
              </label>
              <label>{{ editingId === 'new' ? '首期還款日' : '下次還款日' }} <input type="date" v-model="form.loanNextDue" />
                <span class="field-hint">之後每個月同一天自動記帳;日期若已過,會立刻補記到今天為止的期數</span>
              </label>
              <label>從哪個帳戶扣款
                <select v-model="form.loanPayFromAccountId">
                  <option value="">請選擇</option>
                  <option v-for="a in payableAccounts" :key="a.id" :value="a.id">{{ a.name }}</option>
                </select>
                <span class="field-hint">每期會記一筆本金轉帳和一筆「利息」支出,都從這個帳戶扣</span>
              </label>
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
          <p v-if="loanFormError" class="field-hint negative" style="margin: 0 20px 8px;">{{ loanFormError }}</p>
          <p v-else-if="newLoanPreview" class="field-hint" style="margin: 0 20px 8px;">{{ newLoanPreview }}</p>
          <div class="modal-actions">
            <button @click="cancel">取消</button>
            <button class="primary" :disabled="!!loanFormError" @click="save">儲存</button>
          </div>
        </div>
      </div>

      <LoanPledgeModal v-if="pledgingLoanId" :loan-id="pledgingLoanId" @close="pledgingLoanId = null" />
      <PledgeExtendModal v-if="extendingPledgeId" :pledge-id="extendingPledgeId" @close="extendingPledgeId = null" />
      <PledgeRepayModal v-if="repayingPledgeId" :pledge-id="repayingPledgeId" @close="repayingPledgeId = null" />
      <PledgeEditModal v-if="editingPledgeId" :pledge-id="editingPledgeId" @close="editingPledgeId = null" />
    </div>
  `,
};
