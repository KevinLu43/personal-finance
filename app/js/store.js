// The single app-wide state owner. Every screen reads from this and calls
// its methods to change anything — no screen talks to Db.js directly. This
// mirrors the reference project's "one provider" rule: state fragmented
// across many small stores is harder to keep consistent than one place that
// owns accounts + categories + labels + transactions together.

const { reactive } = Vue;

const state = reactive({
  ready: false,
  accounts: [],
  categories: [],
  labels: [],
  transactions: [],
  transactionLabels: [],
  investments: [],
  recurringTransactions: [],
  pledges: [],
});

async function loadAll() {
  const [accounts, categories, labels, transactions, transactionLabels, investments, recurringTransactions, pledges] = await Promise.all([
    Db.getAll('accounts'),
    Db.getAll('categories'),
    Db.getAll('labels'),
    Db.getAll('transactions'),
    Db.getAll('transactionLabels'),
    Db.getAll('investments'),
    Db.getAll('recurringTransactions'),
    Db.getAll('pledges'),
  ]);
  state.accounts = accounts;
  state.categories = categories;
  state.labels = labels;
  state.transactions = transactions;
  state.transactionLabels = transactionLabels;
  state.investments = investments;
  state.recurringTransactions = recurringTransactions;
  state.pledges = pledges;
  await migrateLabelSortOrder();
  await migrateLoanTypes();
  await purgeOrphanLoanRecords();
}

// Loans deleted before deleteAccount learned to take a loan's records with it
// left them behind: installment payments and interest still tagged with a loan
// that no longer exists, plus the borrow transfer that kept inflating the
// receiving account. Any loan id found on a live transaction that matches no
// account is such a leftover, so those transactions — and the transfers that
// point at the same missing id — are soft-deleted here. Nothing can create new
// orphans any more, so this settles once and is then a no-op.
async function purgeOrphanLoanRecords() {
  const known = new Set(state.accounts.map((a) => a.id));
  const orphanIds = new Set();
  for (const t of state.transactions) {
    if (t.isDeleted) continue;
    for (const id of [t.loanId, t.loanRefId]) if (id && !known.has(id)) orphanIds.add(id);
  }
  if (orphanIds.size === 0) return;
  const doomed = state.transactions.filter(
    (t) => !t.isDeleted && [t.loanId, t.loanRefId, t.accountId, t.toAccountId].some((id) => id && orphanIds.has(id))
  );
  for (const t of doomed) await deleteTransaction(t.id);
}

// One-time upgrade for loans and pledges written before loan types and
// per-stock terms existed. A loan that already has pledges was a 質押 loan;
// any other was a plain one. A legacy pledge carried no amount, so it starts
// at 0 (the list flags it) and inherits the loan's old rate/maturity/extension
// cap for the operator to correct. Safe to run again: it only touches records
// that still lack the new fields.
async function migrateLoanTypes() {
  for (let i = 0; i < state.accounts.length; i++) {
    const a = state.accounts[i];
    if (a.kind !== 'loan' || a.loanType) continue;
    const updated = { ...a, loanType: state.pledges.some((p) => p.loanAccountId === a.id) ? 'pledge' : 'other' };
    await Db.put('accounts', updated);
    state.accounts[i] = updated;
  }
  for (let i = 0; i < state.pledges.length; i++) {
    const p = state.pledges[i];
    if (p.amount !== undefined) continue;
    const loan = state.accounts.find((a) => a.id === p.loanAccountId);
    const updated = {
      ...p,
      amount: 0,
      rate: (loan && loan.loanRate) || 0,
      interestFrom: (loan && loan.loanInterestFrom) || p.date,
      maturity: (loan && loan.loanMaturity) || null,
      extensions: 0,
      maxExtensions: (loan && loan.loanMaxExtensions) || 0,
    };
    await Db.put('pledges', updated);
    state.pledges[i] = updated;
  }
}

// One-time upgrade for labels written before sortOrder existed (they sorted
// alphabetically then) — assigns each a sortOrder so the drag list has
// something to persist against, without disturbing labels that already have one.
async function migrateLabelSortOrder() {
  const toPersist = [];
  state.labels.forEach((l, i) => {
    if (l.sortOrder == null) {
      l.sortOrder = i;
      // Db.put clones for IndexedDB, which chokes on a reactive proxy —
      // spread into a plain object first, same as every other update here.
      toPersist.push({ ...l });
    }
  });
  await Promise.all(toPersist.map((l) => Db.put('labels', l)));
}

async function seedIfEmpty() {
  const count = await Db.countAll('categories');
  if (count > 0) return;
  let order = 0;
  for (const seed of Models.SEED_CATEGORIES) {
    await Db.put('categories', Models.newCategory({ ...seed, sortOrder: order++ }));
  }
}

// Books whatever has come due since the last time it ran: recurring rules and
// loan installments. Idempotent, so it is safe to call whenever the app comes
// back to the foreground — a phone PWA can stay open for days, and without
// this a payment due today wouldn't appear until the next cold start.
async function bookDueItems() {
  await generateDueRecurringTransactions();
  await generateDueLoanInstallments();
}

async function init() {
  await seedIfEmpty();
  await loadAll();
  await bookDueItems();
  state.ready = true;
}

// --- Accounts ---

async function addAccount(fields) {
  const account = Models.newAccount({ ...fields, sortOrder: state.accounts.length });
  await Db.put('accounts', account);
  state.accounts.push(account);
  return account;
}

async function updateAccount(id, fields) {
  const idx = state.accounts.findIndex((a) => a.id === id);
  if (idx === -1) return;
  const updated = { ...state.accounts[idx], ...fields, updatedAt: Models.nowIso() };
  await Db.put('accounts', updated);
  state.accounts[idx] = updated;
}

async function setAccountArchived(id, isArchived) {
  await updateAccount(id, { isArchived });
}

// One default for 記帳 (cash/bank/credit_card — everything the regular
// transaction and 固定支出 forms pick from) and, independently, one default
// for 交易 (brokerage — what the investment form picks from), since the two
// forms never draw from the same pool of accounts anyway. Only other
// accounts on the *same* side of that split get cleared, so marking a
// brokerage account default doesn't silently knock out the cash account
// default an operator already set for everyday spending, and vice versa.
async function setDefaultAccount(id) {
  const target = state.accounts.find((a) => a.id === id);
  if (!target || target.kind === 'loan') return; // a loan is never a default account
  const isBrokerage = target.kind === 'brokerage';
  await Promise.all(
    state.accounts
      .filter((a) => a.isDefault && a.id !== id && (a.kind === 'brokerage') === isBrokerage)
      .map((a) => updateAccount(a.id, { isDefault: false }))
  );
  await updateAccount(id, { isDefault: true });
}

// A real delete, unlike everything soft-deleted elsewhere in this file — the
// account row itself is gone. Transactions and investments that already
// referenced it keep their accountId as-is and fall back to "(已刪除帳戶)"
// wherever that's rendered, rather than being deleted or rewritten.
//
// A loan is the exception. Its records are not history of something that
// still exists: the borrow is a transfer *into* another account, so leaving
// it behind would keep that account's balance (and net worth) inflated by
// money owed to nothing, and its installments would go on counting as fixed
// spending under a nameless "貸款". So deleting a loan also removes everything
// booked on its behalf — see loanRelatedTransactions.
async function deleteAccount(id) {
  const doomed = state.accounts.find((a) => a.id === id);
  if (doomed && doomed.kind === 'loan') {
    for (const t of loanRelatedTransactions(id)) await deleteTransaction(t.id);
    // A pledge with no loan behind it locks shares for nothing either.
    for (const p of state.pledges.filter((x) => x.loanAccountId === id)) await Db.remove('pledges', p.id);
    state.pledges = state.pledges.filter((x) => x.loanAccountId !== id);
  }
  await Db.remove('accounts', id);
  const idx = state.accounts.findIndex((a) => a.id === id);
  if (idx !== -1) state.accounts.splice(idx, 1);
}

// Every live transaction that exists because of one loan: transfers into or
// out of it (borrowing, repaying principal, installment principal) and the
// interest booked for it, whether by installments or a pledged stock.
function loanRelatedTransactions(loanId) {
  return state.transactions.filter(
    (t) => !t.isDeleted && (t.accountId === loanId || t.toAccountId === loanId || t.loanId === loanId || t.loanRefId === loanId)
  );
}

// --- Loans (質押借款) ---
// Borrowing and repaying principal are ordinary transfers to/from the loan
// account; only interest needs anything special, and it is settled in one
// go — as an expense on the account chosen at that moment — when the loan is
// repaid or extended.

async function ensureInterestCategory() {
  const existing = state.categories.find((c) => c.kind === 'expense' && c.name === '利息');
  if (existing) return existing;
  return addCategory({ name: '利息', kind: 'expense', icon: '💸', color: '#9c6644' });
}

// Books one interest payment as an expense on the chosen account. Shared by
// a whole loan's settlement and by a single pledged stock's, which differ
// only in how the amount is worked out and how the note names it.
async function bookInterest(label, interest, fromDate, toDate, payFromAccountId, { loanId, loanRefId } = {}) {
  if (interest <= 0) return;
  const category = await ensureInterestCategory();
  await addTransaction({
    date: toDate,
    type: 'expense',
    amount: interest,
    accountId: payFromAccountId,
    categoryId: category.id,
    note: `${label} 利息 ${fromDate} ~ ${toDate}`,
    loanId,
    loanRefId,
  });
}

// A loan that isn't 質押 is repaid in monthly installments. Each one that has
// come due (on or before today) is booked automatically: the principal as a
// transfer from the paying account into the loan, and the interest as an
// expense on that account — the same two ledger entries a hand-made repayment
// would be. The amounts are worked out from the loan's current balance and
// the installments still to go (Models.installmentBreakdown), so an extra
// repayment made by transfer just makes the following payments smaller.
async function generateLoanInstallments(loanId) {
  let loan = state.accounts.find((a) => a.id === loanId);
  if (!loan || loan.kind !== 'loan' || loan.loanType === 'pledge') return;
  if (!loan.loanInstallments || !loan.loanNextDue || !loan.loanPayFromAccountId) return;
  if (!state.accounts.some((a) => a.id === loan.loanPayFromAccountId)) return;
  const today = Models.localToday();
  const anchorDay = Number(loan.loanNextDue.slice(8, 10));
  let guard = 0;
  while (loan.loanPaidInstallments < loan.loanInstallments && loan.loanNextDue <= today && guard < 600) {
    const due = loan.loanNextDue;
    const balance = Models.accountBalance(loan, state.transactions.filter((t) => t.date <= due), []);
    if (balance <= 0) {
      // Nothing owed. Before any payment that just means the money hasn't been
      // borrowed yet, so leave the installments unspent rather than burn them
      // at zero; after payments it means the loan was paid off early, so the
      // remaining installments are done.
      if (loan.loanPaidInstallments > 0) await updateAccount(loan.id, { loanPaidInstallments: loan.loanInstallments });
      break;
    }
    const remaining = loan.loanInstallments - loan.loanPaidInstallments;
    const { interest, principal } = Models.installmentBreakdown(balance, loan.loanRate, remaining);
    const label = `${loan.name} 第 ${loan.loanPaidInstallments + 1}/${loan.loanInstallments} 期`;
    if (principal > 0) {
      await addTransaction({
        date: due,
        type: 'transfer',
        amount: principal,
        accountId: loan.loanPayFromAccountId,
        toAccountId: loan.id,
        note: `${label} 本金`,
        loanId: loan.id,
        loanRefId: loan.id,
      });
    }
    await bookInterest(label, interest, due, due, loan.loanPayFromAccountId, { loanId: loan.id, loanRefId: loan.id });
    await updateAccount(loan.id, {
      loanPaidInstallments: loan.loanPaidInstallments + 1,
      loanNextDue: Models.addMonthClamped(due, anchorDay),
    });
    loan = state.accounts.find((a) => a.id === loanId);
    guard++;
  }
}

async function generateDueLoanInstallments() {
  for (const a of state.accounts.filter((x) => x.kind === 'loan' && x.loanType !== 'pledge')) {
    await generateLoanInstallments(a.id);
  }
}

// Rewrites a ticker on every trade and pledge of one market — for trades
// recorded under a company name before codes were suggested. updatedAt is
// left alone on purpose: holdingsSummary orders same-day trades by it, so
// bumping it would silently reshuffle a buy and a sell dated the same day.
async function renameTicker(market, fromTicker, toTicker) {
  for (let i = 0; i < state.investments.length; i++) {
    const inv = state.investments[i];
    if (inv.market !== market || inv.ticker !== fromTicker) continue;
    const updated = { ...inv, ticker: toTicker };
    await Db.put('investments', updated);
    state.investments[i] = updated;
  }
  for (let i = 0; i < state.pledges.length; i++) {
    const p = state.pledges[i];
    if (p.market !== market || p.ticker !== fromTicker) continue;
    const updated = { ...p, ticker: toTicker };
    await Db.put('pledges', updated);
    state.pledges[i] = updated;
  }
}

// --- Pledges (shares locked as collateral against a loan) ---

// What a holding account can still pledge: what it holds of that ticker
// minus what it already has pledged (to any loan).
function freeQuantityInAccount(accountId, market, ticker) {
  return (
    Models.heldQuantityOf(state.investments, { market, ticker, accountId }) -
    Models.pledgedQuantityOf(state.pledges, { market, ticker, accountId })
  );
}

// Pledging a stock is also borrowing against it: the pledge records the
// amount, rate and maturity, and when an amount is given the money is booked
// as a transfer from the loan account into the chosen receiving account, so
// the loan's owed balance (accountBalance) stays the one source of truth.
async function addPledge(fields) {
  const account = state.accounts.find((a) => a.id === fields.accountId);
  if (!account || account.kind !== 'brokerage') return null;
  const market = account.market;
  if (Number(fields.quantity) <= 0 || Number(fields.quantity) > freeQuantityInAccount(account.id, market, fields.ticker) + 1e-9) return null;
  const pledge = Models.newPledge({ ...fields, market });
  await Db.put('pledges', pledge);
  state.pledges.push(pledge);
  if (pledge.amount > 0 && fields.receiveAccountId) {
    await addTransaction({
      date: pledge.date,
      type: 'transfer',
      amount: pledge.amount,
      accountId: pledge.loanAccountId,
      toAccountId: fields.receiveAccountId,
      note: `質押 ${pledge.ticker} 借款`,
    });
  }
  return pledge;
}

async function updatePledge(id, fields) {
  const idx = state.pledges.findIndex((p) => p.id === id);
  if (idx === -1) return;
  const updated = { ...state.pledges[idx], ...fields, updatedAt: Models.nowIso() };
  await Db.put('pledges', updated);
  state.pledges[idx] = updated;
}

// Extending one pledged stock settles the interest at its old rate, then
// counts from the extension date at the newly entered rate.
async function extendPledge(id, { date, newMaturity, newRate, payFromAccountId }) {
  const p = state.pledges.find((x) => x.id === id);
  if (!p || p.isReleased || p.extensions >= p.maxExtensions) return;
  const loan = state.accounts.find((a) => a.id === p.loanAccountId);
  await bookInterest(`${loan ? loan.name : '質押借款'} ${p.ticker}`, Models.pledgeAccruedInterest(p, date), p.interestFrom, date, payFromAccountId, { loanRefId: p.loanAccountId });
  await updatePledge(id, { rate: newRate, maturity: newMaturity, extensions: p.extensions + 1, interestFrom: date });
}

// Repays some or all of what one pledged stock borrowed: interest first, then
// the principal as a transfer back into the loan. Paying it all off releases
// the stock (its shares become sellable again).
async function repayPledge(id, { date, amount, fromAccountId }) {
  const p = state.pledges.find((x) => x.id === id);
  if (!p || p.isReleased) return;
  const loan = state.accounts.find((a) => a.id === p.loanAccountId);
  const label = `${loan ? loan.name : '質押借款'} ${p.ticker}`;
  await bookInterest(label, Models.pledgeAccruedInterest(p, date), p.interestFrom, date, fromAccountId, { loanRefId: p.loanAccountId });
  const pay = Math.min(Number(amount) || 0, p.amount);
  if (pay > 0) {
    await addTransaction({ date, type: 'transfer', amount: pay, accountId: fromAccountId, toAccountId: p.loanAccountId, note: `${label} 還款` });
  }
  const remaining = p.amount - pay;
  await updatePledge(id, {
    amount: remaining,
    interestFrom: date,
    ...(remaining <= 0 ? { isReleased: true, releasedDate: date } : {}),
  });
}

async function releasePledge(id, date) {
  const idx = state.pledges.findIndex((p) => p.id === id);
  if (idx === -1) return;
  const updated = { ...state.pledges[idx], isReleased: true, releasedDate: date || Models.nowIso().slice(0, 10), updatedAt: Models.nowIso() };
  await Db.put('pledges', updated);
  state.pledges[idx] = updated;
}

// What the sell form may sell: everything held in the market for that
// ticker, less what any active pledge has locked. excludeInvestmentId is
// the trade being edited, so its own quantity isn't counted against itself.
function sellableQuantity(market, ticker, excludeInvestmentId) {
  return (
    Models.heldQuantityOf(state.investments, { market, ticker, excludeId: excludeInvestmentId }) -
    Models.pledgedQuantityOf(state.pledges, { market, ticker })
  );
}

function pledgedQuantity(market, ticker) {
  return Models.pledgedQuantityOf(state.pledges, { market, ticker });
}

// --- Categories ---

async function addCategory(fields) {
  const category = Models.newCategory({
    ...fields,
    sortOrder: state.categories.filter((c) => c.kind === fields.kind).length,
  });
  await Db.put('categories', category);
  state.categories.push(category);
  return category;
}

async function updateCategory(id, fields) {
  const idx = state.categories.findIndex((c) => c.id === id);
  if (idx === -1) return;
  const updated = { ...state.categories[idx], ...fields, updatedAt: Models.nowIso() };
  await Db.put('categories', updated);
  state.categories[idx] = updated;
}

async function setCategoryArchived(id, isArchived) {
  await updateCategory(id, { isArchived });
}

// A real delete — a transaction that already used this category keeps its
// categoryId as-is and reads as "(未分類)" wherever that's rendered, the
// same fallback an already-deleted account gets.
async function deleteCategory(id) {
  await Db.remove('categories', id);
  const idx = state.categories.findIndex((c) => c.id === id);
  if (idx !== -1) state.categories.splice(idx, 1);
}

// --- Labels (created on the fly while tagging a transaction) ---

async function findOrCreateLabel(name, color, icon) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const existing = state.labels.find((l) => l.name === trimmed);
  if (existing) return existing;
  const label = Models.newLabel(trimmed, color, icon, state.labels.length);
  await Db.put('labels', label);
  state.labels.push(label);
  return label;
}

async function updateLabel(id, fields) {
  const idx = state.labels.findIndex((l) => l.id === id);
  if (idx === -1) return;
  const updated = { ...state.labels[idx], ...fields, updatedAt: Models.nowIso() };
  await Db.put('labels', updated);
  state.labels[idx] = updated;
}

async function setLabelArchived(id, isArchived) {
  await updateLabel(id, { isArchived });
}

// A real delete, plus its join rows — unlike a deleted account or category
// (kept as a dangling id that a lookup falls back to a placeholder for), a
// transaction's set of labels is a list it can just as well shrink by one,
// so the stale links are removed rather than left pointing at nothing.
async function deleteLabel(id) {
  await Db.remove('labels', id);
  const idx = state.labels.findIndex((l) => l.id === id);
  if (idx !== -1) state.labels.splice(idx, 1);

  const links = state.transactionLabels.filter((tl) => tl.labelId === id);
  for (const link of links) await Db.remove('transactionLabels', link.id);
  state.transactionLabels = state.transactionLabels.filter((tl) => tl.labelId !== id);
}

function activeLabels() {
  return state.labels.filter((l) => !l.isArchived).sort((a, b) => a.sortOrder - b.sortOrder);
}

// --- Transactions ---

async function addTransaction(fields, labelNames = []) {
  const transaction = Models.newTransaction(fields);
  await Db.put('transactions', transaction);
  state.transactions.push(transaction);
  await setTransactionLabels(transaction.id, labelNames);
  return transaction;
}

async function updateTransaction(id, fields, labelNames = null) {
  const idx = state.transactions.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const updated = { ...state.transactions[idx], ...fields, updatedAt: Models.nowIso() };
  await Db.put('transactions', updated);
  state.transactions[idx] = updated;
  if (labelNames !== null) await setTransactionLabels(id, labelNames);
}

async function deleteTransaction(id) {
  // Soft delete: the row stays (and stays valid for anything that already
  // referenced it) but disappears from every list and total.
  await updateTransaction(id, { isDeleted: true });
}

async function setTransactionLabels(transactionId, labelNames) {
  const existingLinks = state.transactionLabels.filter((tl) => tl.transactionId === transactionId);
  for (const link of existingLinks) {
    await Db.remove('transactionLabels', link.id);
  }
  state.transactionLabels = state.transactionLabels.filter((tl) => tl.transactionId !== transactionId);

  for (const name of labelNames) {
    const label = await findOrCreateLabel(name);
    if (!label) continue;
    const link = { id: Models.uuid(), transactionId, labelId: label.id };
    await Db.put('transactionLabels', link);
    state.transactionLabels.push(link);
  }
}

function labelsForTransaction(transactionId) {
  const labelIds = state.transactionLabels
    .filter((tl) => tl.transactionId === transactionId)
    .map((tl) => tl.labelId);
  return state.labels.filter((l) => labelIds.includes(l.id));
}

// --- Investments (buy/sell trades, TW or US market) ---

async function addInvestment(fields) {
  const investment = Models.newInvestment(fields);
  await Db.put('investments', investment);
  state.investments.push(investment);
  return investment;
}

async function updateInvestment(id, fields) {
  const idx = state.investments.findIndex((i) => i.id === id);
  if (idx === -1) return;
  const updated = { ...state.investments[idx], ...fields, updatedAt: Models.nowIso() };
  await Db.put('investments', updated);
  state.investments[idx] = updated;
}

async function deleteInvestment(id) {
  await updateInvestment(id, { isDeleted: true });
}

function dailyInvestmentTotals(yearMonth) {
  return Models.dailyInvestmentTotals(state.investments, yearMonth);
}

// --- Recurring transactions (monthly rent/subscriptions/salary/...) ---

async function addRecurring(fields) {
  const recurring = Models.newRecurring(fields);
  await Db.put('recurringTransactions', recurring);
  state.recurringTransactions.push(recurring);
  // If the chosen start date is already on or before today, generate that
  // occurrence right away rather than making the operator reload the app.
  await generateDueForOne(recurring);
  return recurring;
}

async function updateRecurring(id, fields) {
  const idx = state.recurringTransactions.findIndex((r) => r.id === id);
  if (idx === -1) return;
  const updated = { ...state.recurringTransactions[idx], ...fields, updatedAt: Models.nowIso() };
  // recurringTransactions is the one store with an array field (labelNames)
  // directly on the record — spreading state.recurringTransactions[idx]
  // only shallow-copies it, so a call that doesn't itself override
  // labelNames (e.g. just bumping nextDueDate) would otherwise carry over
  // the reactive proxy array underneath, which Db.put's structured clone
  // can't handle. Re-flatten it every time, cheap and always correct.
  updated.labelNames = [...(updated.labelNames || [])];
  await Db.put('recurringTransactions', updated);
  state.recurringTransactions[idx] = updated;
}

async function setRecurringArchived(id, isArchived) {
  await updateRecurring(id, { isArchived });
  if (!isArchived) {
    // Catch up on whatever occurrences were missed while it was paused.
    const r = state.recurringTransactions.find((x) => x.id === id);
    if (r) await generateDueForOne(r);
  }
}

async function deleteRecurring(id) {
  await Db.remove('recurringTransactions', id);
  const idx = state.recurringTransactions.findIndex((r) => r.id === id);
  if (idx !== -1) state.recurringTransactions.splice(idx, 1);
}

// Generates every occurrence of one recurring rule that is due but hasn't
// been created yet, through the same addTransaction used everywhere else —
// a generated row is a normal transaction, editable/deletable on its own.
// It does carry a recurringId back to the rule (Models.newTransaction),
// purely for the ledger/年度總覽 chart to tell it apart from a hand-entered
// one — deleting the rule later still leaves the transaction untouched.
async function generateDueForOne(r) {
  if (r.isArchived) return;
  const today = Models.localToday();
  const { dates, nextDueDate, remainingOccurrences } = Models.dueOccurrences(r, today);
  if (dates.length === 0) return;
  for (const date of dates) {
    await addTransaction(
      {
        date,
        type: r.type,
        amount: r.amount,
        accountId: r.accountId,
        toAccountId: r.toAccountId,
        categoryId: r.categoryId,
        note: r.note,
        recurringId: r.id,
      },
      r.labelNames || []
    );
  }
  const fields = { nextDueDate, remainingOccurrences };
  // Ran out of occurrences — archive it so it reads as done rather than
  // sitting in the active list forever generating nothing.
  if (remainingOccurrences === 0) fields.isArchived = true;
  await updateRecurring(r.id, fields);
}

async function generateDueRecurringTransactions() {
  for (const r of state.recurringTransactions) {
    await generateDueForOne(r);
  }
}

// --- Derived views ---

function activeAccounts() {
  return state.accounts.filter((a) => !a.isArchived).sort((a, b) => a.sortOrder - b.sortOrder);
}

function activeCategories(kind) {
  return state.categories
    .filter((c) => !c.isArchived && c.kind === kind)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function accountBalance(account) {
  return Models.accountBalance(account, state.transactions, state.investments);
}

function pledgeAccruedInterest(pledge, asOfDate) {
  return Models.pledgeAccruedInterest(pledge, asOfDate);
}

function accountHoldingsCost(account) {
  return Models.accountHoldingsCost(account, state.investments);
}

function monthlySummary(yearMonth) {
  return Models.monthlySummary(state.transactions, state.categories, yearMonth);
}

function yearlySummary(year) {
  return Models.yearlySummary(state.transactions, state.categories, year);
}

function monthlyTrend(endYearMonth, monthCount) {
  return Models.monthlyTrend(state.transactions, endYearMonth, monthCount);
}

function netWorthTrend(endYearMonth, monthCount) {
  return Models.netWorthTrend(state.accounts, state.transactions, state.investments, endYearMonth, monthCount);
}

function monthlyFixedExpense(year) {
  return Models.monthlyFixedExpense(state.transactions, year);
}

function dailyTotals(yearMonth) {
  return Models.dailyTotals(state.transactions, yearMonth);
}

function exportBackupData() {
  return Models.buildBackup(state);
}

window.Store = {
  state,
  init,
  exportBackupData,
  addAccount,
  updateAccount,
  setAccountArchived,
  setDefaultAccount,
  deleteAccount,
  addCategory,
  updateCategory,
  setCategoryArchived,
  deleteCategory,
  findOrCreateLabel,
  updateLabel,
  setLabelArchived,
  deleteLabel,
  activeLabels,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  labelsForTransaction,
  activeAccounts,
  activeCategories,
  accountBalance,
  accountHoldingsCost,
  generateLoanInstallments,
  loanRelatedTransactions,
  bookDueItems,
  renameTicker,
  freeQuantityInAccount,
  addPledge,
  updatePledge,
  extendPledge,
  repayPledge,
  pledgeAccruedInterest,
  releasePledge,
  sellableQuantity,
  pledgedQuantity,
  monthlySummary,
  yearlySummary,
  monthlyTrend,
  netWorthTrend,
  monthlyFixedExpense,
  dailyTotals,
  addInvestment,
  updateInvestment,
  deleteInvestment,
  dailyInvestmentTotals,
  addRecurring,
  updateRecurring,
  setRecurringArchived,
  deleteRecurring,
};
