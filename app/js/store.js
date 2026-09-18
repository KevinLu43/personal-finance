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
});

async function loadAll() {
  const [accounts, categories, labels, transactions, transactionLabels, investments, recurringTransactions] = await Promise.all([
    Db.getAll('accounts'),
    Db.getAll('categories'),
    Db.getAll('labels'),
    Db.getAll('transactions'),
    Db.getAll('transactionLabels'),
    Db.getAll('investments'),
    Db.getAll('recurringTransactions'),
  ]);
  state.accounts = accounts;
  state.categories = categories;
  state.labels = labels;
  state.transactions = transactions;
  state.transactionLabels = transactionLabels;
  state.investments = investments;
  state.recurringTransactions = recurringTransactions;
  await migrateLabelSortOrder();
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

async function init() {
  await seedIfEmpty();
  await loadAll();
  await generateDueRecurringTransactions();
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
  if (!target) return;
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
async function deleteAccount(id) {
  await Db.remove('accounts', id);
  const idx = state.accounts.findIndex((a) => a.id === id);
  if (idx !== -1) state.accounts.splice(idx, 1);
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
  const today = Models.nowIso().slice(0, 10);
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

function monthlyRecurringExpense(year) {
  return Models.monthlyRecurringExpense(state.transactions, year);
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
  monthlySummary,
  yearlySummary,
  monthlyTrend,
  netWorthTrend,
  monthlyRecurringExpense,
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
