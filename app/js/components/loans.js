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
