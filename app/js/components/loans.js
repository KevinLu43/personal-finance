// The two loan dialogs opened from a 借款 row on the 帳戶 tab. Borrowing and
// repaying principal are ordinary transfers, so the only loan-specific
// actions are the two that settle interest: repaying, and extending (which
// also asks for a fresh rate — an extension is a new agreement, so the old
// rate is never silently carried over).

// Accounts interest can be paid from: anything a regular expense could be
// charged to, so not a brokerage or another loan.
function loanPayableAccounts() {
  return Store.activeAccounts().filter((a) => !Models.isTransferOnlyKind(a.kind));
}

function loanToday() {
  return new Date().toISOString().slice(0, 10);
}

const LoanExtendModal = {
  props: { loanId: { type: String, required: true } },
  emits: ['close'],
  data() {
    const payable = loanPayableAccounts();
    const first = payable.find((a) => a.isDefault) || payable[0];
    return {
      form: {
        date: loanToday(),
        newMaturity: '',
        newRate: '', // left blank on purpose so the operator has to enter one
        payFromAccountId: first ? first.id : '',
      },
    };
  },
  computed: {
    loan() {
      return Store.state.accounts.find((a) => a.id === this.loanId);
    },
    payableAccounts() {
      return loanPayableAccounts();
    },
    accrued() {
      return this.loan ? Store.accruedInterest(this.loan, this.form.date) : 0;
    },
    valid() {
      return (
        !!this.loan &&
        this.form.date >= this.loan.loanInterestFrom &&
        !!this.form.newMaturity &&
        this.form.newMaturity > this.form.date &&
        this.form.newRate !== '' &&
        Number(this.form.newRate) >= 0 &&
        (this.accrued === 0 || !!this.form.payFromAccountId)
      );
    },
  },
  methods: {
    fmt(n) {
      return Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
    },
    cancel() {
      this.$emit('close');
    },
    async save() {
      if (!this.valid) return;
      await Store.extendLoan(this.loanId, {
        date: this.form.date,
        newMaturity: this.form.newMaturity,
        newRate: Number(this.form.newRate) / 100,
        payFromAccountId: this.form.payFromAccountId,
      });
      this.$emit('close');
    },
  },
  template: `
    <div class="modal-backdrop" @click.self="cancel">
      <div class="modal" v-if="loan">
        <h3>展延「{{ loan.name }}」</h3>
        <div class="modal-body">
          <p class="field-hint" style="margin: 0 0 12px;">
            目前第 {{ loan.loanExtensions }}/{{ loan.loanMaxExtensions }} 次,原到期日 {{ loan.loanMaturity || '未設定' }}、年利率 {{ (loan.loanRate * 100).toLocaleString('zh-TW', { maximumFractionDigits: 4 }) }}%
          </p>
          <label>展延日期 <input type="date" v-model="form.date" :min="loan.loanInterestFrom" /></label>
          <label>新到期日 <input type="date" v-model="form.newMaturity" /></label>
          <label>新年利率(%)
            <input type="number" step="0.0001" min="0" v-model="form.newRate" placeholder="必須重新輸入" />
            <span class="field-hint">從展延日起改用這個利率計息</span>
          </label>
          <label>到目前為止的利息 {{ fmt(accrued) }}
            <select v-model="form.payFromAccountId">
              <option v-for="a in payableAccounts" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
            <span class="field-hint">展延時會把這筆利息記成一筆「利息」支出,從這個帳戶扣</span>
          </label>
        </div>
        <div class="modal-actions">
          <button @click="cancel">取消</button>
          <button class="primary" :disabled="!valid" @click="save">確認展延</button>
        </div>
      </div>
    </div>
  `,
};

const LoanRepayModal = {
  props: { loanId: { type: String, required: true } },
  emits: ['close'],
  data() {
    const payable = loanPayableAccounts();
    const first = payable.find((a) => a.isDefault) || payable[0];
    const loan = Store.state.accounts.find((a) => a.id === this.loanId);
    return {
      form: {
        date: loanToday(),
        amount: loan ? Store.accountBalance(loan) : '', // defaults to repaying it all
        fromAccountId: first ? first.id : '',
      },
    };
  },
  computed: {
    loan() {
      return Store.state.accounts.find((a) => a.id === this.loanId);
    },
    payableAccounts() {
      return loanPayableAccounts();
    },
    owed() {
      return this.loan ? Store.accountBalance(this.loan) : 0;
    },
    accrued() {
      return this.loan ? Store.accruedInterest(this.loan, this.form.date) : 0;
    },
    valid() {
      return (
        !!this.loan &&
        this.form.date >= this.loan.loanInterestFrom &&
        Number(this.form.amount) > 0 &&
        !!this.form.fromAccountId
      );
    },
  },
  methods: {
    fmt(n) {
      return Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
    },
    cancel() {
      this.$emit('close');
    },
    async save() {
      if (!this.valid) return;
      await Store.repayLoan(this.loanId, {
        date: this.form.date,
        amount: Number(this.form.amount),
        fromAccountId: this.form.fromAccountId,
      });
      this.$emit('close');
    },
  },
  template: `
    <div class="modal-backdrop" @click.self="cancel">
      <div class="modal" v-if="loan">
        <h3>還款「{{ loan.name }}」</h3>
        <div class="modal-body">
          <label>還款日期 <input type="date" v-model="form.date" :min="loan.loanInterestFrom" /></label>
          <label>還本金 <input type="number" min="0" v-model="form.amount" />
            <span class="field-hint">目前借款餘額 {{ fmt(owed) }}</span>
          </label>
          <label>從哪個帳戶還
            <select v-model="form.fromAccountId">
              <option v-for="a in payableAccounts" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
          </label>
          <p class="field-hint">同時會結算到還款日為止的利息 {{ fmt(accrued) }},記成一筆「利息」支出,從同一個帳戶扣</p>
        </div>
        <div class="modal-actions">
          <button @click="cancel">取消</button>
          <button class="primary" :disabled="!valid" @click="save">確認還款</button>
        </div>
      </div>
    </div>
  `,
};

// Shares locked as collateral for one loan. A pledge only takes quantity out
// of what the sell form will allow — no price, since there are no live
// quotes — and is released by hand, or automatically once the loan is repaid
// in full (Store.repayLoan).
const LoanPledgeModal = {
  props: { loanId: { type: String, required: true } },
  emits: ['close'],
  data() {
    const brokerages = Store.state.accounts.filter((a) => a.kind === 'brokerage' && !a.isArchived);
    return {
      form: { accountId: brokerages[0] ? brokerages[0].id : '', ticker: '', quantity: '', date: loanToday() },
    };
  },
  computed: {
    loan() {
      return Store.state.accounts.find((a) => a.id === this.loanId);
    },
    brokerageAccounts() {
      return Store.state.accounts.filter((a) => a.kind === 'brokerage' && !a.isArchived);
    },
    account() {
      return Store.state.accounts.find((a) => a.id === this.form.accountId) || null;
    },
    // Tickers the chosen account still has unpledged shares of.
    pledgeableTickers() {
      if (!this.account) return [];
      const own = Store.state.investments.filter((i) => i.accountId === this.account.id);
      return Models.holdingsSummary(own)
        .filter((h) => h.quantity > 0)
        .map((h) => ({ ticker: h.ticker, free: Store.freeQuantityInAccount(this.account.id, this.account.market, h.ticker) }))
        .filter((o) => o.free > 0);
    },
    free() {
      const t = this.pledgeableTickers.find((o) => o.ticker === this.form.ticker);
      return t ? t.free : 0;
    },
    activePledges() {
      return Store.state.pledges
        .filter((p) => p.loanAccountId === this.loanId && !p.isReleased)
        .map((p) => {
          const acct = Store.state.accounts.find((a) => a.id === p.accountId);
          return { ...p, accountName: acct ? acct.name : '(已刪除帳戶)' };
        });
    },
    valid() {
      return !!this.account && !!this.form.ticker && Number(this.form.quantity) > 0 && Number(this.form.quantity) <= this.free + 1e-9;
    },
  },
  watch: {
    // Picking another account (or ticker) resets the quantity to everything
    // still free, the common "pledge the lot" case.
    'form.accountId'() {
      this.form.ticker = '';
      this.form.quantity = '';
    },
    'form.ticker'() {
      this.form.quantity = this.free || '';
    },
  },
  methods: {
    async add() {
      if (!this.valid) return;
      await Store.addPledge({
        loanAccountId: this.loanId,
        accountId: this.form.accountId,
        ticker: this.form.ticker,
        quantity: Number(this.form.quantity),
        date: this.form.date,
      });
      this.form.ticker = '';
      this.form.quantity = '';
    },
    async release(p) {
      if (!confirm(`解除 ${p.ticker} ${p.quantity} 股的質押？`)) return;
      await Store.releasePledge(p.id);
    },
  },
  template: `
    <div class="modal-backdrop" @click.self="$emit('close')">
      <div class="modal" v-if="loan">
        <h3>「{{ loan.name }}」的質押股票</h3>
        <div class="modal-body">
          <div v-if="activePledges.length === 0" class="empty">還沒有質押的股票</div>
          <div v-for="p in activePledges" :key="p.id" class="list-row">
            <div class="list-row-main">
              <div class="list-row-title">{{ p.ticker }} × {{ p.quantity }}</div>
              <div class="list-row-sub">{{ p.market === 'TW' ? '台股' : '美股' }} · {{ p.accountName }} · {{ p.date }}</div>
            </div>
            <div class="list-row-actions"><button @click="release(p)">解除</button></div>
          </div>

          <h4 style="margin: 14px 0 6px; font-size: 13px;">新增質押</h4>
          <div v-if="brokerageAccounts.length === 0" class="empty">還沒有證券交割帳戶</div>
          <template v-else>
            <label>持股所在帳戶
              <select v-model="form.accountId">
                <option v-for="a in brokerageAccounts" :key="a.id" :value="a.id">{{ a.name }}({{ a.market === 'TW' ? '台股' : '美股' }})</option>
              </select>
            </label>
            <label>標的
              <select v-model="form.ticker">
                <option value="">請選擇</option>
                <option v-for="o in pledgeableTickers" :key="o.ticker" :value="o.ticker">{{ o.ticker }}(可質押 {{ o.free }} 股)</option>
              </select>
              <span v-if="pledgeableTickers.length === 0" class="field-hint">這個帳戶沒有可以質押的持股</span>
            </label>
            <label>質押股數 <input type="number" min="0" step="0.0001" v-model="form.quantity" />
              <span v-if="form.ticker && Number(form.quantity) > free" class="field-hint negative">最多可質押 {{ free }} 股</span>
            </label>
            <label>質押日期 <input type="date" v-model="form.date" /></label>
          </template>
        </div>
        <div class="modal-actions">
          <button @click="$emit('close')">關閉</button>
          <button class="primary" :disabled="!valid" @click="add">加入質押</button>
        </div>
      </div>
    </div>
  `,
};
