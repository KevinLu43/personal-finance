// Pure data helpers: id generation, default seed data, and the calculations
// that derive account balances / monthly summaries from transactions rather
// than storing them redundantly. No DOM, no Vue — testable by eye alone.

function uuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  // Fallback for non-secure contexts (e.g. a plain file:// open).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function nowIso() {
  return new Date().toISOString();
}

// Today as the operator's calendar reads it ('YYYY-MM-DD', local time).
// toISOString() is UTC, which in Taiwan is still *yesterday* between 00:00 and
// 08:00 — so anything that decides "is this due yet?" must use this instead,
// or a payment due today isn't booked until mid-morning.
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Seeded once on first launch. Not locked — the user can rename, reorder,
// archive, or add their own; this is a starting point, not a fixed enum.
const SEED_CATEGORIES = [
  { name: '餐飲', kind: 'expense', icon: '🍚', color: '#e07a5f' },
  { name: '交通', kind: 'expense', icon: '🚗', color: '#3d5a80' },
  { name: '居住', kind: 'expense', icon: '🏠', color: '#8d6a9f' },
  { name: '服飾', kind: 'expense', icon: '👕', color: '#5c9ead' },
  { name: '醫療', kind: 'expense', icon: '💊', color: '#c1666b' },
  { name: '教育學習', kind: 'expense', icon: '📚', color: '#588157' },
  { name: '娛樂', kind: 'expense', icon: '🎮', color: '#f4a261' },
  { name: '訂閱服務', kind: 'expense', icon: '🔁', color: '#6d6875' },
  { name: '保險', kind: 'expense', icon: '🛡️', color: '#457b9d' },
  { name: '其他', kind: 'expense', icon: '❔', color: '#adb5bd' },
  { name: '薪資', kind: 'income', icon: '💰', color: '#2a9d8f' },
  { name: '投資收益', kind: 'income', icon: '📈', color: '#264653' },
  { name: '其他收入', kind: 'income', icon: '❔', color: '#adb5bd' },
];

// A new account's icon starting point, one per kind — the picker still
// lets the operator choose anything else before saving.
const DEFAULT_ACCOUNT_ICON = { cash: '💵', bank: '🏦', credit_card: '💳', brokerage: '📈', loan: '💴' };

// A credit card and a loan both store what is *owed*, so the same events move
// them the opposite way from a cash-style account and they subtract from net
// worth. One owner for "which kinds are debt" so the several places that flip
// a sign or leave an account out of the asset total never drift apart.
function isLiabilityKind(kind) {
  return kind === 'credit_card' || kind === 'loan';
}

// Accounts that only ever appear in a transfer, never as the account of an
// ordinary expense/income: a 證券交割 account settles trades through the 投資
// form, a loan moves only by borrowing/repaying (a transfer).
function isTransferOnlyKind(kind) {
  return kind === 'brokerage' || kind === 'loan';
}

// What a loan account is for. 質押 (borrowing against pledged shares) carries
// its terms per pledged stock — amount, rate, maturity, extensions. Every other
// type is one borrowing repaid in equal monthly installments.
const LOAN_TYPE_LABELS = { pledge: '質押', credit: '信用貸款', mortgage: '房屋貸款', auto: '汽車貸款', other: '其他' };

function isPledgeLoan(account) {
  return !!account && account.kind === 'loan' && account.loanType === 'pledge';
}

function accountIcon(account) {
  return account.icon || DEFAULT_ACCOUNT_ICON[account.kind] || '❔';
}

function newAccount(fields) {
  const isBrokerage = fields.kind === 'brokerage';
  const isLoan = fields.kind === 'loan';
  return {
    id: uuid(),
    name: fields.name,
    kind: fields.kind, // cash | bank | credit_card | brokerage
    icon: fields.icon || DEFAULT_ACCOUNT_ICON[fields.kind] || '❔',
    // An emoji icon carries its own fixed colour — no CSS can retint it —
    // so this is a background accent shown behind the glyph, the same role
    // Category/Label's own `color` field already plays.
    color: fields.color || '#adb5bd',
    currency: fields.currency || 'TWD',
    initialBalance: fields.initialBalance || 0,
    creditLimit: fields.kind === 'credit_card' ? (fields.creditLimit || 0) : null,
    // A brokerage (證券交割) account settles trades in exactly one market —
    // real settlement accounts work this way (a TW securities account and a
    // 複委託 US account are never the same account number) — and carries its
    // own fee/tax rates, since a real discount is a private arrangement
    // with that specific account's broker, not a market-wide constant.
    market: isBrokerage ? fields.market : null,
    feeRate: isBrokerage ? Number(fields.feeRate) || 0 : null,
    stockTaxRate: isBrokerage ? Number(fields.stockTaxRate) || 0 : null,
    etfTaxRate: isBrokerage ? Number(fields.etfTaxRate) || 0 : null,
    // A loan account's type and annual rate (a fraction, like the brokerage
    // rates); the rate is unused for 質押, which prices each stock itself.
    loanType: isLoan ? fields.loanType || 'other' : null,
    loanRate: isLoan ? Number(fields.loanRate) || 0 : null,
    // An installment loan (everything but 質押) is repaid in equal monthly
    // payments: how many installments are left, how many have been paid,
    // the next due date, and the account they are paid from. 質押 keeps its
    // terms on each pledged stock instead, so these stay empty for it.
    loanInstallments: isLoan && fields.loanType !== 'pledge' ? Number(fields.loanInstallments) || 0 : null,
    loanPaidInstallments: isLoan && fields.loanType !== 'pledge' ? Number(fields.loanPaidInstallments) || 0 : null,
    loanNextDue: isLoan && fields.loanType !== 'pledge' ? fields.loanNextDue || null : null,
    loanPayFromAccountId: isLoan && fields.loanType !== 'pledge' ? fields.loanPayFromAccountId || null : null,
    sortOrder: fields.sortOrder ?? 0,
    isArchived: false,
    isDefault: fields.isDefault ?? false,
    updatedAt: nowIso(),
  };
}

function newCategory(fields) {
  const isExpense = fields.kind === 'expense';
  return {
    id: uuid(),
    name: fields.name,
    kind: fields.kind, // expense | income
    icon: fields.icon || '❔',
    color: fields.color || '#adb5bd',
    // A standing monthly cap, income categories don't carry one. null means
    // "no budget set" rather than a cap of zero.
    budgetLimit: isExpense ? (fields.budgetLimit || null) : null,
    budgetWarningThreshold: isExpense ? (fields.budgetWarningThreshold ?? 0.8) : null,
    sortOrder: fields.sortOrder ?? 0,
    isArchived: false,
    updatedAt: nowIso(),
  };
}

function newLabel(name, color, icon, sortOrder) {
  return {
    id: uuid(), name, color: color || '#6d6875', icon: icon || '🏷️',
    sortOrder: sortOrder ?? 0, isArchived: false, updatedAt: nowIso(),
  };
}

function labelIcon(label) {
  return label.icon || '🏷️';
}

function newTransaction(fields) {
  return {
    id: uuid(),
    date: fields.date, // 'YYYY-MM-DD'
    type: fields.type, // expense | income | transfer
    amount: Math.abs(fields.amount),
    accountId: fields.accountId,
    toAccountId: fields.type === 'transfer' ? fields.toAccountId : null,
    categoryId: fields.type === 'transfer' ? null : fields.categoryId,
    note: fields.note || '',
    // Set only when generated by a recurring rule (store.js's
    // generateDueForOne) — lets the ledger and the year-view chart tell a
    // recurring-generated row apart from one entered by hand, without
    // otherwise changing how it behaves (still freely editable/deletable).
    recurringId: fields.recurringId || null,
    // Likewise for a monthly installment of a loan (store.js's
    // generateLoanInstallments): both its principal transfer and its interest
    // expense carry the loan's id, so a payment can be recognised, grouped
    // and counted as fixed spending.
    loanId: fields.loanId || null,
    isDeleted: false,
    updatedAt: nowIso(),
  };
}

// Groups an already-filtered (single day, one type) transaction list by
// category, for the 記帳 day panel — ordered the same way the 分類 tab's own
// drag-sort list reads (category.sortOrder), a deleted category's orphaned
// transactions grouped last under "(未分類)" rather than dropped. The
// caller decides what to do with a group that turns out to hold only one
// transaction (typically: skip the group chrome and just show that row).
function groupTransactionsByCategory(transactions, categories) {
  const groups = [];
  const byKey = new Map();
  for (const t of transactions) {
    const key = t.categoryId || '__none__';
    let group = byKey.get(key);
    if (!group) {
      group = { categoryId: t.categoryId, category: categories.find((c) => c.id === t.categoryId) || null, items: [], total: 0 };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(t);
    group.total += t.amount;
  }
  return groups.sort((a, b) => {
    const ao = a.category ? a.category.sortOrder : Infinity;
    const bo = b.category ? b.category.sortOrder : Infinity;
    return ao - bo;
  });
}

// An account's balance is never stored — it is always the initial balance
// plus every live transaction that touches it. One owner, no drift between
// a stored number and what the transaction log actually says.
// Every transaction below is scored as if money were flowing through a cash
// account: a charge leaves, a transfer in arrives. A credit card's stored
// balance is what is owed rather than what is held, so the same events move
// it the opposite way — a charge is money the cash-style math treats as
// leaving that actually means the card owes more, and a bill payment (a
// transfer *into* the card) the math treats as arriving that actually means
// it owes less. So `delta` is computed once, cash-style, and only the sign
// it is applied with differs by account kind.
// `investments` defaults to [] so every existing caller (and every earlier
// unit-style check) that only ever passed transactions keeps working
// unchanged — a 證券交割 account simply has no trades to fold in until one
// is actually passed.
function accountBalance(account, transactions, investments = []) {
  let delta = 0;
  for (const t of transactions) {
    if (t.isDeleted) continue;
    if (t.type === 'expense' && t.accountId === account.id) delta -= t.amount;
    else if (t.type === 'income' && t.accountId === account.id) delta += t.amount;
    else if (t.type === 'transfer') {
      if (t.accountId === account.id) delta -= t.amount;
      if (t.toAccountId === account.id) delta += t.amount;
    }
  }
  // A trade settled through this account moves its cash exactly the way an
  // expense/income transaction would: a buy's net cost leaves, a sell's net
  // proceeds arrive. Same sign rule, just sourced from the investments
  // store instead of the transactions store. Gated on the account still
  // being a brokerage account — an account's kind can be edited after the
  // fact, and a trade recorded back when it was 證券交割 should stop being
  // folded into the balance once it's something else (e.g. 信用卡), rather
  // than silently going on affecting a balance its own kind no longer
  // explains, sign-flipped on top of that if it's now a credit card.
  if (account.kind === 'brokerage') {
    for (const inv of investments) {
      if (inv.isDeleted || inv.accountId !== account.id) continue;
      const { net } = investmentAmounts(inv);
      delta += inv.action === 'buy' ? -net : net;
    }
  }
  return isLiabilityKind(account.kind) ? account.initialBalance - delta : account.initialBalance + delta;
}

// Shared by monthlySummary and yearlySummary: income/expense/net and a
// spend-by-category breakdown over an already-filtered transaction list.
// One owner for "how a period's numbers add up" so a month and a year never
// answer that question two different ways.
function summarizePeriod(periodTransactions, categories) {
  let income = 0;
  let expense = 0;
  const byExpenseCategory = new Map();
  const byIncomeCategory = new Map();
  for (const t of periodTransactions) {
    if (t.type === 'income') {
      income += t.amount;
      if (t.categoryId) {
        byIncomeCategory.set(t.categoryId, (byIncomeCategory.get(t.categoryId) || 0) + t.amount);
      }
      continue;
    }
    expense += t.amount;
    if (t.categoryId) {
      byExpenseCategory.set(t.categoryId, (byExpenseCategory.get(t.categoryId) || 0) + t.amount);
    }
  }
  const buildBreakdown = (byCategory) => [...byCategory.entries()]
    .map(([categoryId, amount]) => ({
      category: categories.find((c) => c.id === categoryId),
      amount,
    }))
    .filter((row) => row.category)
    .sort((a, b) => b.amount - a.amount);
  return {
    income,
    expense,
    net: income - expense,
    categoryBreakdown: buildBreakdown(byExpenseCategory),
    incomeCategoryBreakdown: buildBreakdown(byIncomeCategory),
  };
}

// Monthly income/expense/net, and a per-category breakdown, for one
// 'YYYY-MM' month. Transfers move money between accounts but are not
// income or expense, so they are excluded here by construction.
function monthlySummary(transactions, categories, yearMonth) {
  const inMonth = transactions.filter(
    (t) => !t.isDeleted && t.date.startsWith(yearMonth) && t.type !== 'transfer'
  );
  return summarizePeriod(inMonth, categories);
}

// Same shape as monthlySummary, for one 'YYYY' year.
function yearlySummary(transactions, categories, year) {
  const inYear = transactions.filter(
    (t) => !t.isDeleted && t.date.startsWith(String(year)) && t.type !== 'transfer'
  );
  return summarizePeriod(inYear, categories);
}

// Factory defaults offered when a new 證券交割 account is created — a
// starting point the account's own form fields stay free to correct, not a
// locked constant. TW brokerage commission is capped by the Securities
// Broker Management Regulations at 0.1425% of the trade amount, but the
// discount an actual broker gives is a private arrangement between broker
// and client, so these are the undiscounted ceiling. TW transaction tax
// (Securities Transaction Tax Act) is sell-side only: 0.3% of an ordinary
// stock, 0.1% of an ETF. US trades here default to the operator's own
// 複委託 (sub-brokerage) plan — 0.08% flat, no minimum — which is a
// brokerage plan, not a government rate, and the US side has no
// transaction-tax equivalent at all.
const FEE_RATES = { TW: 0.001425, US: 0.0008 };
const TW_STOCK_TAX_RATE = 0.003;
const TW_ETF_TAX_RATE = 0.001;

function defaultRatesFor(market) {
  return {
    feeRate: FEE_RATES[market] || 0,
    stockTaxRate: market === 'TW' ? TW_STOCK_TAX_RATE : 0,
    etfTaxRate: market === 'TW' ? TW_ETF_TAX_RATE : 0,
  };
}

function isTaiwanEtfTicker(ticker) {
  return /^00/.test((ticker || '').trim());
}

// Fee/tax auto-fill now reads the settlement account's own configured
// rates rather than a hardcoded market table — the account is where a
// real discount or plan actually lives (docs: PLAN discussion with the
// operator, 2026-09). No account selected yet means nothing to suggest.
function suggestedFee(account, price, quantity) {
  if (!account) return 0;
  return Math.round(price * quantity * (account.feeRate || 0));
}

// Only a TW account's sells carry a transaction tax.
function suggestedTax(account, action, ticker, price, quantity) {
  if (!account || account.market !== 'TW' || action !== 'sell') return 0;
  const rate = isTaiwanEtfTicker(ticker) ? (account.etfTaxRate || 0) : (account.stockTaxRate || 0);
  return Math.round(price * quantity * rate);
}

function newInvestment(fields) {
  return {
    id: uuid(),
    date: fields.date, // 'YYYY-MM-DD'
    accountId: fields.accountId, // the 證券交割 account this trade settled through
    market: fields.market, // 'TW' | 'US' — copied from the account at entry time
    action: fields.action, // 'buy' | 'sell'
    ticker: fields.ticker,
    price: Number(fields.price),
    quantity: Number(fields.quantity),
    fee: Number(fields.fee) || 0,
    tax: Number(fields.tax) || 0,
    note: fields.note || '',
    isDeleted: false,
    updatedAt: nowIso(),
  };
}

// A buy's net cost adds the fee; a sell's net proceeds subtract the fee and
// the transaction tax (TW sells only, in practice — the field is just left
// at 0 for a market that doesn't have one, cheaper than a market-specific
// branch here).
function investmentAmounts(investment) {
  const gross = investment.price * investment.quantity;
  const net = investment.action === 'buy' ? gross + investment.fee : gross - investment.fee - investment.tax;
  return { gross, net };
}

// Per-day buy/sell totals for one 'YYYY-MM' month, keyed by day number,
// across both markets — the calendar cell shows the combined figure, the
// day panel below is what splits it into 台股/美股.
function dailyInvestmentTotals(investments, yearMonth) {
  const byDay = new Map();
  for (const inv of investments) {
    if (inv.isDeleted || !inv.date.startsWith(yearMonth)) continue;
    const day = Number(inv.date.slice(8, 10));
    const row = byDay.get(day) || { buy: 0, sell: 0 };
    const { net } = investmentAmounts(inv);
    if (inv.action === 'buy') row.buy += net;
    else row.sell += net;
    byDay.set(day, row);
  }
  return byDay;
}

// Groups an already-filtered (single day, one market) investment list by
// ticker, for the 投資 day panel — the equivalent of
// groupTransactionsByCategory above, just keyed on ticker since a trade has
// no category of its own. No dollar total here: a group can mix buy and
// sell, and netting those into one signed figure would quietly hide that
// money actually moved both ways, so the caller shows a plain trade count
// instead (see InvestmentTickerGroupList).
function groupInvestmentsByTicker(investments) {
  const groups = [];
  const byTicker = new Map();
  for (const inv of investments) {
    let group = byTicker.get(inv.ticker);
    if (!group) {
      group = { ticker: inv.ticker, items: [] };
      byTicker.set(inv.ticker, group);
      groups.push(group);
    }
    group.items.push(inv);
  }
  return groups.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

// One row per market+ticker ever traded: current quantity held, its moving
// average cost, and realised P&L. This is the standard moving-average-cost
// method (the same one the operator's own spreadsheet used): a buy adds to
// the pool at its own cost; a sell removes shares from the pool *at the
// average cost prevailing at that moment* and banks the difference between
// what it actually sold for and that cost as realised P&L. The average only
// moves on a buy — a sell shrinks the pool proportionally without changing
// the average, which is why processing order (oldest first) matters.
//
// This has no notion of a current market price, so there is no unrealised
// P&L or current value here — only what buying and selling actually did.
function holdingsSummary(investments) {
  const byKey = new Map();
  for (const inv of investments) {
    if (inv.isDeleted) continue;
    const key = `${inv.market}:${inv.ticker}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(inv);
  }

  const holdings = [];
  for (const [key, list] of byKey) {
    const [market, ticker] = key.split(':');
    const ordered = list
      .slice()
      .sort((a, b) => (a.date === b.date ? a.updatedAt.localeCompare(b.updatedAt) : a.date < b.date ? -1 : 1));

    let quantity = 0;
    let costBasis = 0;
    let realizedPL = 0;

    for (const inv of ordered) {
      const { net } = investmentAmounts(inv);
      if (inv.action === 'buy') {
        quantity += inv.quantity;
        costBasis += net;
      } else {
        const avgCost = quantity > 0 ? costBasis / quantity : 0;
        const soldCostBasis = avgCost * inv.quantity;
        realizedPL += net - soldCostBasis;
        costBasis -= soldCostBasis;
        quantity -= inv.quantity;
        if (Math.abs(quantity) < 1e-9) { quantity = 0; costBasis = 0; } // clear float drift on a full exit
      }
    }

    holdings.push({
      market,
      ticker,
      quantity,
      avgCost: quantity > 0 ? costBasis / quantity : 0,
      costBasis,
      realizedPL,
    });
  }

  return holdings.sort((a, b) => (a.market === b.market ? a.ticker.localeCompare(b.ticker) : a.market.localeCompare(b.market)));
}

// A ticker has no colour of its own the way a category does, so this cycles
// a fixed palette by position — stable across renders since holdingsSummary
// always returns holdings in the same (market, ticker) sorted order.
const TICKER_PALETTE = [
  '#3d5a80', '#e07a5f', '#588157', '#8d6a9f', '#c1666b', '#5c9ead',
  '#f4a261', '#264653', '#2a9d8f', '#e09f3e', '#6d6875', '#457b9d',
];

// Share of one market's currently-held portfolio, by cost basis — the only
// "amount" this app actually has for a holding without a live market price.
// A fully exited position (quantity 0) held no place in the portfolio at
// all, not a 0% slice, so it is left out rather than shown empty.
function portfolioBreakdown(holdings) {
  return holdings
    .filter((h) => h.quantity > 0 && h.costBasis > 0)
    .map((h, i) => ({
      category: { name: h.ticker, color: TICKER_PALETTE[i % TICKER_PALETTE.length] },
      amount: h.costBasis,
    }))
    .sort((a, b) => b.amount - a.amount);
}

// Income/expense for each of the `monthCount` months ending at (and
// including) `endYearMonth`, oldest first — what a trend chart plots along
// its x-axis. Self-contained rather than built from monthlySummary, since a
// trend has no use for that function's category breakdown and no reason to
// hand it a fake categories array just to get one.
function monthlyTrend(transactions, endYearMonth, monthCount) {
  const [endYear, endMonth] = endYearMonth.split('-').map(Number);
  const months = [];
  for (let i = monthCount - 1; i >= 0; i--) {
    let y = endYear;
    let m = endMonth - i;
    while (m < 1) { m += 12; y -= 1; }
    months.push({ year: y, month: m, yearMonth: `${y}-${String(m).padStart(2, '0')}`, income: 0, expense: 0 });
  }
  const byMonth = new Map(months.map((row) => [row.yearMonth, row]));
  for (const t of transactions) {
    if (t.isDeleted || t.type === 'transfer') continue;
    const row = byMonth.get(t.date.slice(0, 7));
    if (!row) continue;
    if (t.type === 'income') row.income += t.amount;
    else row.expense += t.amount;
  }
  for (const row of months) row.net = row.income - row.expense;
  return months;
}

// Spend grouped by label rather than by category, over an already-filtered
// (period-scoped, expense-only) transaction list. Unlike a category, a
// transaction can carry several labels, so this is deliberately not drawn
// as a pie/donut anywhere it is used: the rows do not partition the total,
// they overlap by construction, and a ring implies otherwise.
function labelBreakdown(expenseTransactions, transactionLabels, labels) {
  const byLabel = new Map();
  for (const t of expenseTransactions) {
    const labelIds = transactionLabels.filter((tl) => tl.transactionId === t.id).map((tl) => tl.labelId);
    for (const labelId of labelIds) {
      byLabel.set(labelId, (byLabel.get(labelId) || 0) + t.amount);
    }
  }
  return [...byLabel.entries()]
    .map(([labelId, amount]) => ({ label: labels.find((l) => l.id === labelId), amount }))
    .filter((row) => row.label)
    .sort((a, b) => b.amount - a.amount);
}

// Lays out an income/expense/net trend as SVG-ready geometry over a fixed
// 300x100 viewBox — shared by the dashboard's 6-month chart and the yearly
// overview's 12-month chart, so both read the same shape off one function
// rather than keeping their own copies of the same arithmetic.
//
// Bars (income/expense, always >= 0) and the net line (which can dip
// negative) share one coordinate space: minValue drops below 0 only when
// some month's net actually did, so the baseline sits at the very bottom
// in the common case and only rises to make room once a month needs it.
function buildTrendChart(months) {
  const values = months.flatMap((m) => [m.income, m.expense, m.net]);
  const maxValue = Math.max(1, ...values);
  const minValue = Math.min(0, ...values);
  const range = maxValue - minValue || 1;
  const colWidth = 300 / months.length;
  const barWidth = colWidth * 0.28;
  const y = (v) => 100 - ((v - minValue) / range) * 100;
  const baselineY = y(0);
  const bars = months.map((m, i) => {
    const colCenter = colWidth * i + colWidth / 2;
    const expenseY = y(m.expense);
    const incomeY = y(m.income);
    return {
      yearMonth: m.yearMonth,
      month: m.month,
      expenseX: colCenter - barWidth - 2,
      expenseY: Math.min(expenseY, baselineY),
      expenseH: Math.abs(baselineY - expenseY),
      incomeX: colCenter + 2,
      incomeY: Math.min(incomeY, baselineY),
      incomeH: Math.abs(baselineY - incomeY),
      netX: colCenter,
      netY: y(m.net),
    };
  });
  return { bars, barWidth, baselineY, netPoints: bars.map((b) => `${b.netX},${b.netY}`).join(' ') };
}

// A ring built from stacked circle strokes: each row gets a dash whose
// length is its share of the circle's circumference, offset by however much
// the segments before it already used. The caller rotates the group -90deg
// so the first segment starts at 12 o'clock instead of 3.
function buildDonutSegments(categoryBreakdown) {
  const total = categoryBreakdown.reduce((s, row) => s + row.amount, 0);
  if (total <= 0) return [];
  const circumference = 2 * Math.PI * 40;
  let offset = 0;
  return categoryBreakdown.map((row) => {
    const dash = (row.amount / total) * circumference;
    const seg = { color: row.category.color, dash, gap: circumference - dash, dashOffset: -offset };
    offset += dash;
    return seg;
  });
}

// One row per expense category that actually has a budget set, spent-so-far
// looked up from the same categoryBreakdown the donut chart already uses (0
// if the category had no transactions this period at all, since it should
// still show up empty rather than disappear). Sorted worst-first so the
// category closest to (or over) its cap is what the reader sees first.
function budgetProgress(categories, categoryBreakdown) {
  const spentByCategory = new Map(categoryBreakdown.map((row) => [row.category.id, row.amount]));
  return categories
    .filter((c) => c.kind === 'expense' && !c.isArchived && c.budgetLimit > 0)
    .map((c) => {
      const spent = spentByCategory.get(c.id) || 0;
      const ratio = spent / c.budgetLimit;
      const warningThreshold = c.budgetWarningThreshold ?? 0.8;
      const status = ratio >= 1 ? 'over' : ratio >= warningThreshold ? 'warning' : 'ok';
      return { category: c, spent, limit: c.budgetLimit, ratio, status };
    })
    .sort((a, b) => b.ratio - a.ratio);
}

// A small hand-rolled evaluator for the calculator amount input — no eval()
// or Function(), since a stray unbalanced token should fail closed (return
// null) rather than ever reach JS execution. Standard precedence (×÷ before
// +−), left to right within a precedence level. Returns null on anything it
// can't parse as a clean expression.
function evaluateExpression(expr) {
  let cleaned = String(expr).replace(/×/g, '*').replace(/÷/g, '/').trim();
  cleaned = cleaned.replace(/[+\-*/]+$/, ''); // a trailing operator is dropped, not an error
  if (!cleaned || !/^[0-9+\-*/.]+$/.test(cleaned)) return null;

  const tokens = cleaned.match(/(\d+\.?\d*|\.\d+|[+\-*/])/g);
  if (!tokens || tokens.length === 0 || /[+\-*/]/.test(tokens[0])) return null;

  const pass1 = [tokens[0]];
  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === '*' || tok === '/') {
      const prev = parseFloat(pass1.pop());
      const next = parseFloat(tokens[++i]);
      if (Number.isNaN(prev) || Number.isNaN(next)) return null;
      pass1.push(String(tok === '*' ? prev * next : prev / next));
    } else {
      pass1.push(tok);
    }
  }

  let result = parseFloat(pass1[0]);
  if (Number.isNaN(result)) return null;
  for (let i = 1; i < pass1.length; i += 2) {
    const val = parseFloat(pass1[i + 1]);
    if (Number.isNaN(val)) return null;
    result = pass1[i] === '+' ? result + val : result - val;
  }
  return result;
}

// Per-day expense/income totals for one 'YYYY-MM' month, keyed by day number
// (1-31). Drives the calendar view's per-cell amount without the view doing
// its own filtering/aggregation.
function dailyTotals(transactions, yearMonth) {
  const byDay = new Map();
  for (const t of transactions) {
    if (t.isDeleted || t.type === 'transfer' || !t.date.startsWith(yearMonth)) continue;
    const day = Number(t.date.slice(8, 10));
    const row = byDay.get(day) || { expense: 0, income: 0 };
    if (t.type === 'expense') row.expense += t.amount;
    else row.income += t.amount;
    byDay.set(day, row);
  }
  return byDay;
}

// Cost basis of the shares one 證券交割 account currently holds — its own
// trades only, run through the same moving-average-cost holdingsSummary as
// the 投資總覽 screen. Valued at cost rather than market price because this
// app has no live quote source; it is what keeps a buy from looking like a
// loss (cash down by X, holdings up by X) until a market value exists.
// A position that went net-negative (sold here what was bought through
// another account) counts as 0 rather than a negative asset.
function accountHoldingsCost(account, investments) {
  if (account.kind !== 'brokerage') return 0;
  const own = investments.filter((i) => i.accountId === account.id);
  return holdingsSummary(own)
    .filter((h) => h.quantity > 0)
    .reduce((sum, h) => sum + h.costBasis, 0);
}

function daysBetween(fromDate, toDate) {
  const [fy, fm, fd] = fromDate.split('-').map(Number);
  const [ty, tm, td] = toDate.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

// One installment of an equal-payment (本息平均攤還) loan: with `remaining`
// installments left on `balance` at an annual `rate`, interest is the
// balance x rate/12, and the fixed payment is what amortises the balance to
// zero over the remaining installments; principal is the rest. Working it
// out from the *current* balance and remaining count each month means an
// extra repayment simply lowers the following payments, with no schedule to
// rebuild. The last installment clears whatever is left.
function installmentBreakdown(balance, annualRate, remaining) {
  const owed = Math.max(0, balance);
  if (remaining <= 0 || owed === 0) return { interest: 0, principal: owed, payment: owed };
  const r = (annualRate || 0) / 12;
  const interest = Math.round(owed * r);
  if (remaining === 1) return { interest, principal: owed, payment: owed + interest };
  const payment = r > 0 ? (owed * r) / (1 - Math.pow(1 + r, -remaining)) : owed / remaining;
  const principal = Math.min(owed, Math.max(0, Math.round(payment - interest)));
  return { interest, principal, payment: principal + interest };
}

// One block of shares put up as collateral, and the borrowing made against
// it: every pledged stock is its own small loan with its own amount, rate,
// maturity and extensions (brokers price each stock differently). Quantity
// locks those shares out of what the sell form allows until the pledge is
// released; `amount` is what is currently borrowed against them, and
// interest is settled (and interestFrom reset) whenever amount changes or
// the terms are extended, so it never needs integrating over a changing balance.
function newPledge(fields) {
  return {
    id: uuid(),
    loanAccountId: fields.loanAccountId,
    accountId: fields.accountId, // the 證券交割 account holding the shares
    market: fields.market,
    ticker: fields.ticker,
    quantity: Number(fields.quantity),
    date: fields.date,
    note: fields.note || '',
    amount: Number(fields.amount) || 0,
    rate: Number(fields.rate) || 0, // annual, a fraction like every other rate
    interestFrom: fields.interestFrom || fields.date,
    maturity: fields.maturity || null,
    extensions: Number(fields.extensions) || 0,
    maxExtensions: Number(fields.maxExtensions) || 0,
    isReleased: false,
    releasedDate: null,
    updatedAt: nowIso(),
  };
}

// Interest one pledge has accrued from interestFrom up to (not including)
// asOfDate: amount x annual rate x days / 365, rounded.
function pledgeAccruedInterest(pledge, asOfDate) {
  if (!pledge.amount || !pledge.rate || !pledge.interestFrom || asOfDate <= pledge.interestFrom) return 0;
  return Math.round((pledge.amount * pledge.rate * daysBetween(pledge.interestFrom, asOfDate)) / 365);
}

// Directory entries whose company name matches free text an operator once
// typed into the 標的 field ("台積電", "Apple") — best first: exact name, then
// names starting with it, names containing it, and finally names the text
// itself contains. Used to offer a code for trades recorded before the field
// had a directory behind it; the operator confirms, nothing is applied here.
function suggestTickerCodes(directory, text) {
  const q = String(text || '').trim().toLowerCase();
  if (!q) return [];
  const found = [];
  for (const entry of directory) {
    const name = entry.name.toLowerCase();
    let rank;
    if (name === q) rank = 0;
    else if (name.startsWith(q)) rank = 1;
    else if (q.length >= 2 && name.includes(q)) rank = 2;
    else if (name.length >= 2 && q.includes(name)) rank = 3;
    else continue;
    found.push({ code: entry.code, name: entry.name, rank });
  }
  return found.sort((a, b) => a.rank - b.rank || a.name.length - b.name.length).slice(0, 6);
}

// Shares of one market+ticker currently held (moving-average pool, so a sell
// only counts once the buys before it do), optionally narrowed to one
// account, optionally ignoring one trade — the sell form passes the trade it
// is editing so that trade's own quantity isn't counted against itself.
function heldQuantityOf(investments, { market, ticker, accountId, excludeId }) {
  const list = investments.filter(
    (i) => i.market === market && i.ticker === ticker && (!accountId || i.accountId === accountId) && i.id !== excludeId
  );
  const h = holdingsSummary(list).find((x) => x.market === market && x.ticker === ticker);
  return h ? Math.max(0, h.quantity) : 0;
}

// Shares of one market+ticker locked by active (unreleased) pledges,
// optionally narrowed to one holding account or one loan.
function pledgedQuantityOf(pledges, { market, ticker, accountId, loanAccountId }) {
  return pledges
    .filter(
      (p) =>
        !p.isReleased &&
        p.market === market &&
        p.ticker === ticker &&
        (!accountId || p.accountId === accountId) &&
        (!loanAccountId || p.loanAccountId === loanAccountId)
    )
    .reduce((sum, p) => sum + p.quantity, 0);
}

// Net worth as of a cutoff date: the same accountBalance() math, just fed
// transactions/investments pre-filtered to "on or before that date" instead
// of the full history. Every account (including an archived one) is scored
// so a month before an account was archived still reflects what it held —
// only a truly *deleted* account has no record left to score at all.
function netWorthAsOf(accounts, transactions, investments, cutoffDate) {
  const scopedTx = transactions.filter((t) => t.date <= cutoffDate);
  const scopedInv = investments.filter((i) => i.date <= cutoffDate);
  return accounts.reduce((sum, a) => {
    // Models.accountBalance, not the bare name: every plain <script> here
    // shares one global scope, and store.js declares its own top-level
    // `function accountBalance(account)` (a single-arg wrapper over
    // state.transactions) that loads after this file and clobbers the
    // global `accountBalance` binding. Going through Models.* pins this
    // call to the function this file itself defined, captured into
    // window.Models before store.js ever runs.
    const balance = Models.accountBalance(a, scopedTx, scopedInv);
    // Same "debt reads negative" convention dashboard.js's displayBalance uses.
    const signed = isLiabilityKind(a.kind) ? -balance : balance;
    return sum + signed + Models.accountHoldingsCost(a, scopedInv);
  }, 0);
}

// Net worth at the end of each of `monthCount` months ending at (and
// including) `endYearMonth`, oldest first — the net-worth counterpart to
// monthlyTrend above, sharing its same month-list construction.
function netWorthTrend(accounts, transactions, investments, endYearMonth, monthCount) {
  const [endYear, endMonth] = endYearMonth.split('-').map(Number);
  const months = [];
  for (let i = monthCount - 1; i >= 0; i--) {
    let y = endYear;
    let m = endMonth - i;
    while (m < 1) { m += 12; y -= 1; }
    const lastDay = new Date(y, m, 0).getDate();
    const cutoff = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    months.push({
      year: y,
      month: m,
      yearMonth: `${y}-${String(m).padStart(2, '0')}`,
      netWorth: netWorthAsOf(accounts, transactions, investments, cutoff),
    });
  }
  return months;
}

// Lays out a net-worth-only line over the same 300x100 viewBox
// buildTrendChart uses, for visual consistency with the income/expense
// chart it sits next to. Unlike that chart, the baseline is *not* forced to
// 0 — net worth is usually a large number far from 0, so pinning the
// baseline there would flatten the line into something barely readable.
// Points are spread edge-to-edge across the width rather than centered in
// per-month columns, since there are no bars here to make room for.
function buildNetWorthChart(months) {
  const values = months.map((m) => m.netWorth);
  const maxValue = Math.max(...values);
  const minValue = Math.min(...values);
  const range = maxValue - minValue || 1;
  const stepX = months.length > 1 ? 300 / (months.length - 1) : 0;
  const y = (v) => 100 - ((v - minValue) / range) * 100;
  const dots = months.map((m, i) => ({ x: i * stepX, y: y(m.netWorth), yearMonth: m.yearMonth, month: m.month }));
  return { points: dots.map((d) => `${d.x},${d.y}`).join(' '), dots };
}

// One row per monthly recurring rule (rent, subscriptions, salary, ...):
// what fields a generated transaction should copy, and the schedule
// (anchorDay + nextDueDate cursor) that decides when the next one is due.
// A rule always starts counting from the month it's created in — the first
// occurrence lands on anchorDay within *this* month (even if that day has
// already passed, so it catches up immediately instead of silently skipping
// to next month), then every month after that. anchorDay itself never
// drifts, even when a short month forces that month's occurrence earlier
// (see addMonthClamped) — the rule stays anchored to "the 31st" rather than
// sliding to "whatever day the last occurrence landed on".
function newRecurring(fields) {
  const today = nowIso().slice(0, 10);
  const anchorDay = Number(fields.anchorDay);
  const [y, m] = today.slice(0, 7).split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstDay = Math.min(anchorDay, daysInMonth);
  return {
    id: uuid(),
    type: fields.type, // expense | income | transfer
    amount: Math.abs(fields.amount),
    accountId: fields.accountId,
    toAccountId: fields.type === 'transfer' ? fields.toAccountId : null,
    categoryId: fields.type === 'transfer' ? null : fields.categoryId,
    note: fields.note || '',
    // Spread into a plain array — a reactive Vue proxy (fields.labelNames
    // straight from a form's data()) fails IndexedDB's structured clone.
    labelNames: [...(fields.labelNames || [])],
    anchorDay,
    nextDueDate: `${y}-${String(m).padStart(2, '0')}-${String(firstDay).padStart(2, '0')}`,
    // How many more times this rule should fire — null means unlimited.
    // Decremented by dueOccurrences each time it generates one.
    remainingOccurrences: fields.occurrenceCount ? Number(fields.occurrenceCount) : null,
    isArchived: false,
    updatedAt: nowIso(),
  };
}

// One calendar month after dateStr, same day-of-month as anchorDay unless
// the target month is too short for it (e.g. anchorDay 31 in February),
// in which case it clamps to that month's actual last day.
function addMonthClamped(dateStr, anchorDay) {
  const [y, m] = dateStr.slice(0, 7).split('-').map(Number);
  let ny = y;
  let nm = m + 1;
  if (nm > 12) { nm = 1; ny += 1; }
  const daysInMonth = new Date(ny, nm, 0).getDate();
  const day = Math.min(anchorDay, daysInMonth);
  return `${ny}-${String(nm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Every occurrence of a recurring rule that is due (on or before todayStr)
// but hasn't been generated yet, capped by its own remainingOccurrences
// (null = unlimited), plus the nextDueDate and remainingOccurrences the
// rule should carry forward afterward. The 60-period (5-year) guard is a
// pure safety net against a corrupted nextDueDate ever looping forever —
// not a real-world limit an operator should ever hit.
function dueOccurrences(recurring, todayStr) {
  const dates = [];
  let cursor = recurring.nextDueDate;
  let remaining = recurring.remainingOccurrences == null ? null : recurring.remainingOccurrences;
  let guard = 0;
  while (cursor <= todayStr && (remaining == null || remaining > 0) && guard < 60) {
    dates.push(cursor);
    if (remaining != null) remaining -= 1;
    cursor = addMonthClamped(cursor, recurring.anchorDay);
    guard++;
  }
  return { dates, nextDueDate: cursor, remainingOccurrences: remaining };
}

// Actual fixed spending per month of one 'YYYY' year, Jan–Dec — what the
// year view's 固定支出 chart plots, in two parts: `amount`, the expense
// transactions a recurring rule generated (recurringId), and `loanAmount`,
// everything paid on loan installments (loanId — principal *and* interest,
// since this is cash going out, not the income statement). Both read the
// ledger, so it is real history (a rule created mid-year has zero before it
// existed) rather than today's configuration projected backward.
function monthlyFixedExpense(transactions, year) {
  const months = [];
  for (let m = 1; m <= 12; m++) {
    months.push({ month: m, yearMonth: `${year}-${String(m).padStart(2, '0')}`, amount: 0, loanAmount: 0 });
  }
  const byMonth = new Map(months.map((row) => [row.yearMonth, row]));
  for (const t of transactions) {
    if (t.isDeleted) continue;
    const row = byMonth.get(t.date.slice(0, 7));
    if (!row) continue;
    if (t.loanId) row.loanAmount += t.amount;
    else if (t.type === 'expense' && t.recurringId) row.amount += t.amount;
  }
  return months;
}

// Stacked-bar geometry over the same 300x100 viewBox the other dashboard
// charts use: rule spending at the bottom of each month's bar, loan payments
// stacked on top. Every value is >= 0, so the baseline is the bottom edge.
function buildFixedExpenseChart(months) {
  const maxValue = Math.max(1, ...months.map((m) => m.amount + m.loanAmount));
  const colWidth = 300 / months.length;
  const barWidth = colWidth * 0.5;
  const bars = months.map((m, i) => {
    const recurringH = (m.amount / maxValue) * 100;
    const loanH = (m.loanAmount / maxValue) * 100;
    return {
      month: m.month,
      x: colWidth * i + (colWidth - barWidth) / 2,
      width: barWidth,
      recurring: { y: 100 - recurringH, height: recurringH },
      loan: { y: 100 - recurringH - loanH, height: loanH },
    };
  });
  return { bars };
}

// Splits a day's (or any) transaction list into loan installment payments
// and everything else. An installment is stored as two rows sharing a loan
// and a date — the principal transfer and the interest expense — which read
// as one payment, so they are folded together here: principal, interest and
// the total paid, with the underlying rows kept for editing.
function splitLoanPayments(transactions) {
  const others = [];
  const byKey = new Map();
  const payments = [];
  for (const t of transactions) {
    if (!t.loanId) { others.push(t); continue; }
    const key = t.loanId + '|' + t.date;
    let p = byKey.get(key);
    if (!p) {
      p = { key, loanId: t.loanId, date: t.date, principal: 0, interest: 0, total: 0, label: '', items: [] };
      byKey.set(key, p);
      payments.push(p);
    }
    if (t.type === 'transfer') p.principal += t.amount;
    else p.interest += t.amount;
    p.total += t.amount;
    p.items.push(t);
    // The principal row's note is "<loan> 第 n/N 期 本金"; failing that, the
    // interest row's is "<loan> 第 n/N 期 利息 ...".
    const note = t.note || '';
    if (t.type === 'transfer' && note.endsWith(' 本金')) p.label = note.slice(0, -' 本金'.length);
    else if (!p.label && note.includes(' 利息 ')) p.label = note.split(' 利息 ')[0];
  }
  for (const p of payments) p.items.sort((a, b) => (a.type === 'transfer' ? -1 : 1) - (b.type === 'transfer' ? -1 : 1));
  return { payments, others };
}

// A plain, versioned snapshot of every store — one shape both the export
// button and (whenever a restore path is built) an eventual import both
// read, so the two never quietly disagree about what a backup contains.
function buildBackup(tables) {
  return {
    version: 1,
    exportedAt: nowIso(),
    data: {
      accounts: tables.accounts,
      categories: tables.categories,
      labels: tables.labels,
      transactions: tables.transactions,
      transactionLabels: tables.transactionLabels,
      investments: tables.investments,
      recurringTransactions: tables.recurringTransactions,
      pledges: tables.pledges,
    },
  };
}

window.Models = {
  uuid,
  nowIso,
  localToday,
  SEED_CATEGORIES,
  buildBackup,
  newAccount,
  accountIcon,
  newCategory,
  newLabel,
  labelIcon,
  newTransaction,
  accountBalance,
  monthlySummary,
  yearlySummary,
  monthlyTrend,
  buildTrendChart,
  buildDonutSegments,
  labelBreakdown,
  dailyTotals,
  newInvestment,
  defaultRatesFor,
  isTaiwanEtfTicker,
  suggestedFee,
  suggestedTax,
  investmentAmounts,
  dailyInvestmentTotals,
  holdingsSummary,
  budgetProgress,
  evaluateExpression,
  portfolioBreakdown,
  netWorthTrend,
  accountHoldingsCost,
  installmentBreakdown,
  addMonthClamped,
  newPledge,
  pledgeAccruedInterest,
  LOAN_TYPE_LABELS,
  isPledgeLoan,
  suggestTickerCodes,
  heldQuantityOf,
  pledgedQuantityOf,
  isLiabilityKind,
  isTransferOnlyKind,
  buildNetWorthChart,
  newRecurring,
  dueOccurrences,
  monthlyFixedExpense,
  buildFixedExpenseChart,
  splitLoanPayments,
  groupTransactionsByCategory,
  groupInvestmentsByTicker,
};
