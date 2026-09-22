// A 質押 loan is a set of pledged stocks, and each pledged stock is its own
// small borrowing: its own amount, annual rate, maturity and extensions
// (brokers price every stock differently). Everything here acts on one
// pledge — the loan account only holds the running owed balance, which the
// borrow/repay transfers these dialogs book keep correct.
// Relies on loanPayableAccounts() / loanToday() from loans.js.

function pledgeFmt(n) {
  return Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
}

function pledgeRatePercent(rate) {
  return (rate * 100).toLocaleString('zh-TW', { maximumFractionDigits: 4 });
}

// One pledged stock: name, shares, amount borrowed, rate, maturity, and the
// actions that apply to it.
const PledgeRowItem = {
  props: { pledge: { type: Object, required: true } },
  emits: ['extend', 'repay', 'edit', 'release'],
  computed: {
    name() {
      return window.tickerName(this.pledge.market, this.pledge.ticker);
    },
    accountName() {
      const a = Store.state.accounts.find((x) => x.id === this.pledge.accountId);
      return a ? a.name : '(已刪除帳戶)';
    },
    overdue() {
      return !!this.pledge.maturity && this.pledge.maturity < loanToday();
    },
    accrued() {
      return Store.pledgeAccruedInterest(this.pledge, loanToday());
    },
    canExtend() {
      return this.pledge.extensions < this.pledge.maxExtensions;
    },
  },
  methods: {
    fmt: pledgeFmt,
    rateText() {
      return pledgeRatePercent(this.pledge.rate);
    },
  },
  template: `
    <div class="list-row pledge-row">
      <div class="list-row-main">
        <div class="list-row-title">{{ pledge.ticker }}<span v-if="name" class="ticker-name">{{ name }}</span> × {{ pledge.quantity }}</div>
        <div v-if="pledge.amount > 0" class="list-row-sub">
          額度 {{ fmt(pledge.amount) }} · 年利率 {{ rateText() }}% · 到期 {{ pledge.maturity || '未設定' }}<span v-if="overdue" class="negative">(已到期)</span>
          · 展延 {{ pledge.extensions }}/{{ pledge.maxExtensions }} · 應付利息 {{ fmt(accrued) }}
        </div>
        <div v-else class="list-row-sub">尚未設定額度(按「編輯」補上額度與利率)· 到期 {{ pledge.maturity || '未設定' }}</div>
        <div class="list-row-sub">{{ pledge.market === 'TW' ? '台股' : '美股' }} · {{ accountName }} · 質押於 {{ pledge.date }}</div>
      </div>
      <div class="list-row-actions">
        <button v-if="pledge.amount > 0" :disabled="!canExtend" @click="$emit('extend', pledge)">展延</button>
        <button v-if="pledge.amount > 0" @click="$emit('repay', pledge)">還款</button>
        <button v-else @click="$emit('release', pledge)">解除</button>
        <button @click="$emit('edit', pledge)">編輯</button>
      </div>
    </div>
  `,
};

const PledgeExtendModal = {
  props: { pledgeId: { type: String, required: true } },
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
    pledge() {
      return Store.state.pledges.find((p) => p.id === this.pledgeId);
    },
    payableAccounts() {
      return loanPayableAccounts();
    },
    accrued() {
      return this.pledge ? Store.pledgeAccruedInterest(this.pledge, this.form.date) : 0;
    },
    valid() {
      return (
        !!this.pledge &&
        this.form.date >= this.pledge.interestFrom &&
        !!this.form.newMaturity &&
        this.form.newMaturity > this.form.date &&
        this.form.newRate !== '' &&
        Number(this.form.newRate) >= 0 &&
        (this.accrued === 0 || !!this.form.payFromAccountId)
      );
    },
  },
  methods: {
    fmt: pledgeFmt,
    rateText: pledgeRatePercent,
    async save() {
      if (!this.valid) return;
      await Store.extendPledge(this.pledgeId, {
        date: this.form.date,
        newMaturity: this.form.newMaturity,
        newRate: Number(this.form.newRate) / 100,
        payFromAccountId: this.form.payFromAccountId,
      });
      this.$emit('close');
    },
  },
  template: `
    <div class="modal-backdrop" @click.self="$emit('close')">
      <div class="modal" v-if="pledge">
        <h3>展延 {{ pledge.ticker }}</h3>
        <div class="modal-body">
          <p class="field-hint" style="margin: 0 0 12px;">
            目前第 {{ pledge.extensions }}/{{ pledge.maxExtensions }} 次,原到期日 {{ pledge.maturity || '未設定' }}、年利率 {{ rateText(pledge.rate) }}%
          </p>
          <label>展延日期 <input type="date" v-model="form.date" :min="pledge.interestFrom" /></label>
          <label>新到期日 <input type="date" v-model="form.newMaturity" /></label>
          <label>新年利率(%)
            <input type="number" step="0.0001" min="0" v-model="form.newRate" placeholder="必須重新輸入" />
            <span class="field-hint">從展延日起,這檔改用這個利率計息</span>
          </label>
          <label>到目前為止的利息 {{ fmt(accrued) }}
            <select v-model="form.payFromAccountId">
              <option v-for="a in payableAccounts" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
            <span class="field-hint">展延時會把這筆利息記成一筆「利息」支出,從這個帳戶扣</span>
          </label>
        </div>
        <div class="modal-actions">
          <button @click="$emit('close')">取消</button>
          <button class="primary" :disabled="!valid" @click="save">確認展延</button>
        </div>
      </div>
    </div>
  `,
};

const PledgeRepayModal = {
  props: { pledgeId: { type: String, required: true } },
  emits: ['close'],
  data() {
    const payable = loanPayableAccounts();
    const first = payable.find((a) => a.isDefault) || payable[0];
    const pledge = Store.state.pledges.find((p) => p.id === this.pledgeId);
    return {
      form: {
        date: loanToday(),
        amount: pledge ? pledge.amount : '', // defaults to paying this stock's borrowing off
        fromAccountId: first ? first.id : '',
      },
    };
  },
  computed: {
    pledge() {
      return Store.state.pledges.find((p) => p.id === this.pledgeId);
    },
    payableAccounts() {
      return loanPayableAccounts();
    },
    accrued() {
      return this.pledge ? Store.pledgeAccruedInterest(this.pledge, this.form.date) : 0;
    },
    paysOff() {
      return !!this.pledge && Number(this.form.amount) >= this.pledge.amount;
    },
    valid() {
      return (
        !!this.pledge &&
        this.form.date >= this.pledge.interestFrom &&
        Number(this.form.amount) > 0 &&
        !!this.form.fromAccountId
      );
    },
  },
  methods: {
    fmt: pledgeFmt,
    async save() {
      if (!this.valid) return;
      await Store.repayPledge(this.pledgeId, {
        date: this.form.date,
        amount: Number(this.form.amount),
        fromAccountId: this.form.fromAccountId,
      });
      this.$emit('close');
    },
  },
  template: `
    <div class="modal-backdrop" @click.self="$emit('close')">
      <div class="modal" v-if="pledge">
        <h3>還款 {{ pledge.ticker }}</h3>
        <div class="modal-body">
          <label>還款日期 <input type="date" v-model="form.date" :min="pledge.interestFrom" /></label>
          <label>還本金 <input type="number" min="0" :max="pledge.amount" v-model="form.amount" />
            <span class="field-hint">這檔目前借款 {{ fmt(pledge.amount) }}</span>
          </label>
          <label>從哪個帳戶還
            <select v-model="form.fromAccountId">
              <option v-for="a in payableAccounts" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
          </label>
          <p class="field-hint">同時會結算到還款日為止的利息 {{ fmt(accrued) }},記成一筆「利息」支出,從同一個帳戶扣</p>
          <p v-if="paysOff" class="field-hint">全部還清後會解除這檔的質押,股票可以再賣出</p>
        </div>
        <div class="modal-actions">
          <button @click="$emit('close')">取消</button>
          <button class="primary" :disabled="!valid" @click="save">確認還款</button>
        </div>
      </div>
    </div>
  `,
};

// Edits the terms of a pledge that is already recorded. The amount can only
// be filled in while it is still 0 (a pledge recorded before amounts existed):
// changing a real amount would put it out of step with the borrow transfer
// already booked, so from then on it moves only through 還款.
const PledgeEditModal = {
  props: { pledgeId: { type: String, required: true } },
  emits: ['close'],
  data() {
    const p = Store.state.pledges.find((x) => x.id === this.pledgeId);
    return {
      form: {
        amount: p && p.amount ? p.amount : '',
        rate: p ? pledgeRatePercent(p.rate).replace(/,/g, '') : '',
        maturity: (p && p.maturity) || '',
        maxExtensions: p ? p.maxExtensions : 0,
      },
    };
  },
  computed: {
    pledge() {
      return Store.state.pledges.find((p) => p.id === this.pledgeId);
    },
    amountEditable() {
      return !!this.pledge && !this.pledge.amount;
    },
  },
  methods: {
    async save() {
      const fields = {
        rate: (Number(this.form.rate) || 0) / 100,
        maturity: this.form.maturity || null,
        maxExtensions: Math.max(Number(this.form.maxExtensions) || 0, this.pledge.extensions),
      };
      if (this.amountEditable) fields.amount = Number(this.form.amount) || 0;
      await Store.updatePledge(this.pledgeId, fields);
      this.$emit('close');
    },
  },
  template: `
    <div class="modal-backdrop" @click.self="$emit('close')">
      <div class="modal" v-if="pledge">
        <h3>編輯 {{ pledge.ticker }} 的質押條件</h3>
        <div class="modal-body">
          <label v-if="amountEditable">借款額度 <input type="number" min="0" v-model="form.amount" />
            <span class="field-hint">這檔實際借出的金額;只有還沒設定時能填,之後請用「還款」調整</span>
          </label>
          <label>年利率(%) <input type="number" step="0.0001" min="0" v-model="form.rate" /></label>
          <label>到期日 <input type="date" v-model="form.maturity" /></label>
          <label>最多可展延次數 <input type="number" min="0" step="1" v-model="form.maxExtensions" />
            <span class="field-hint">已展延 {{ pledge.extensions }} 次,上限不會低於這個數字</span>
          </label>
        </div>
        <div class="modal-actions">
          <button @click="$emit('close')">取消</button>
          <button class="primary" @click="save">儲存</button>
        </div>
      </div>
    </div>
  `,
};

// Pledges one more stock against a loan: which shares, how much is borrowed
// against them, at what rate and until when, and which account receives the
// money (booked as a transfer out of the loan by Store.addPledge). The
// pledged shares are locked out of the sell form until repaid/released.
const LoanPledgeModal = {
  props: { loanId: { type: String, required: true } },
  emits: ['close'],
  data() {
    const brokerages = Store.state.accounts.filter((a) => a.kind === 'brokerage' && !a.isArchived);
    const receive = Store.activeAccounts().filter((a) => a.kind !== 'loan');
    const firstReceive = receive.find((a) => !Models.isTransferOnlyKind(a.kind) && a.isDefault) || receive[0];
    return {
      form: {
        accountId: brokerages[0] ? brokerages[0].id : '',
        ticker: '',
        quantity: '',
        amount: '',
        rate: '',
        date: loanToday(),
        maturity: '',
        maxExtensions: 0,
        receiveAccountId: firstReceive ? firstReceive.id : '',
      },
    };
  },
  computed: {
    loan() {
      return Store.state.accounts.find((a) => a.id === this.loanId);
    },
    brokerageAccounts() {
      return Store.state.accounts.filter((a) => a.kind === 'brokerage' && !a.isArchived);
    },
    receiveAccounts() {
      return Store.activeAccounts().filter((a) => a.kind !== 'loan');
    },
    // Grouped by kind, same convention TransactionFormModal's accountGroups
    // uses — receiveAccounts alone sorts by each account's raw creation-order
    // sortOrder, which interleaves cash/bank/credit_card/brokerage accounts
    // in whatever order they happened to be created rather than keeping each
    // kind together.
    receiveAccountGroups() {
      const kinds = [
        { kind: 'cash', label: '現金' },
        { kind: 'bank', label: '銀行' },
        { kind: 'credit_card', label: '信用卡' },
        { kind: 'brokerage', label: '證券交割' },
      ];
      return kinds
        .map(({ kind, label }) => ({ label, accounts: this.receiveAccounts.filter((a) => a.kind === kind) }))
        .filter((g) => g.accounts.length > 0);
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
    valid() {
      return (
        !!this.account &&
        !!this.form.ticker &&
        Number(this.form.quantity) > 0 &&
        Number(this.form.quantity) <= this.free + 1e-9 &&
        Number(this.form.amount) > 0 &&
        this.form.rate !== '' &&
        Number(this.form.rate) >= 0 &&
        !!this.form.maturity &&
        this.form.maturity > this.form.date &&
        !!this.form.receiveAccountId
      );
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
    nameOf(market, ticker) {
      return window.tickerName(market, ticker);
    },
    async save() {
      if (!this.valid) return;
      await Store.addPledge({
        loanAccountId: this.loanId,
        accountId: this.form.accountId,
        ticker: this.form.ticker,
        quantity: Number(this.form.quantity),
        amount: Number(this.form.amount),
        rate: Number(this.form.rate) / 100,
        date: this.form.date,
        maturity: this.form.maturity,
        maxExtensions: Number(this.form.maxExtensions) || 0,
        receiveAccountId: this.form.receiveAccountId,
      });
      this.$emit('close');
    },
  },
  template: `
    <div class="modal-backdrop" @click.self="$emit('close')">
      <div class="modal" v-if="loan">
        <h3>新增質押到「{{ loan.name }}」</h3>
        <div class="modal-body">
          <div v-if="brokerageAccounts.length === 0" class="empty">還沒有證券交割帳戶</div>
          <template v-else>
            <label>持股所在帳戶
              <select v-model="form.accountId">
                <option v-for="a in brokerageAccounts" :key="a.id" :value="a.id">{{ a.name }}({{ a.market === 'TW' ? '台股' : '美股' }})</option>
              </select>
            </label>
            <label>質押的股票
              <select v-model="form.ticker">
                <option value="">請選擇</option>
                <option v-for="o in pledgeableTickers" :key="o.ticker" :value="o.ticker">{{ o.ticker }} {{ nameOf(account.market, o.ticker) }}(可質押 {{ o.free }} 股)</option>
              </select>
              <span v-if="pledgeableTickers.length === 0" class="field-hint">這個帳戶沒有可以質押的持股</span>
            </label>
            <label>質押股數 <input type="number" min="0" step="0.0001" v-model="form.quantity" />
              <span v-if="form.ticker && Number(form.quantity) > free" class="field-hint negative">最多可質押 {{ free }} 股</span>
            </label>
            <label>借款額度(這檔實際借出的金額) <input type="number" min="0" v-model="form.amount" /></label>
            <label>這檔的年利率(%) <input type="number" step="0.0001" min="0" v-model="form.rate" /></label>
            <label>質押日期(從這天起算利息) <input type="date" v-model="form.date" /></label>
            <label>到期日 <input type="date" v-model="form.maturity" /></label>
            <label>最多可展延次數 <input type="number" min="0" step="1" v-model="form.maxExtensions" /></label>
            <label>借到的錢轉入
              <select v-model="form.receiveAccountId">
                <optgroup v-for="g in receiveAccountGroups" :key="g.label" :label="g.label">
                  <option v-for="a in g.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
                </optgroup>
              </select>
              <span class="field-hint">會自動記一筆「借款 → 這個帳戶」的轉帳</span>
            </label>
          </template>
        </div>
        <div class="modal-actions">
          <button @click="$emit('close')">取消</button>
          <button class="primary" :disabled="!valid" @click="save">確認質押</button>
        </div>
      </div>
    </div>
  `,
};
