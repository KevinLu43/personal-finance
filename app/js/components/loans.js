// Helpers shared by the loan and pledge dialogs (pledges.js). A 質押 loan's
// interest is settled per pledged stock; every other loan is repaid in monthly
// installments booked automatically by Store.generateLoanInstallments, so
// there is no loan-level repay/extend dialog any more.

// Accounts interest can be paid from: anything a regular expense could be
// charged to, so not a brokerage or another loan.
function loanPayableAccounts() {
  return Store.activeAccounts().filter((a) => !Models.isTransferOnlyKind(a.kind));
}

function loanToday() {
  return Models.localToday();
}
