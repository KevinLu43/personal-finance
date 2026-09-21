const RootApp = {
  data() {
    return { tab: 'dashboard' };
  },
  computed: {
    ready() {
      return Store.state.ready;
    },
  },
  async mounted() {
    await Store.init();
    // Coming back to the app (a tab left open overnight, a PWA resumed from the
    // background) books anything that fell due in the meantime.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Store.state.ready) Store.bookDueItems();
    });
  },
  components: {
    DashboardView,
    TransactionsView,
    InvestmentsView,
    InvestmentOverviewView,
    AccountsView,
    CategoriesView,
  },
  template: `
    <div v-if="!ready" class="loading">載入中…</div>
    <div v-else class="app-shell">
      <main class="app-main">
        <DashboardView v-if="tab === 'dashboard'" />
        <TransactionsView v-else-if="tab === 'transactions'" />
        <InvestmentsView v-else-if="tab === 'investments'" />
        <InvestmentOverviewView v-else-if="tab === 'investmentOverview'" />
        <AccountsView v-else-if="tab === 'accounts'" />
        <CategoriesView v-else-if="tab === 'categories'" />
      </main>
      <nav class="tab-bar">
        <div class="sidebar-title">個人財務</div>
        <button :class="{ active: tab === 'dashboard' }" @click="tab = 'dashboard'"><span class="tab-icon">📊</span>總覽</button>
        <button :class="{ active: tab === 'transactions' }" @click="tab = 'transactions'"><span class="tab-icon">✏️</span>記帳</button>
        <button :class="{ active: tab === 'investments' }" @click="tab = 'investments'"><span class="tab-icon">📈</span>投資</button>
        <button :class="{ active: tab === 'investmentOverview' }" @click="tab = 'investmentOverview'"><span class="tab-icon">💹</span>投資總覽</button>
        <button :class="{ active: tab === 'accounts' }" @click="tab = 'accounts'"><span class="tab-icon">💳</span>帳戶</button>
        <button :class="{ active: tab === 'categories' }" @click="tab = 'categories'"><span class="tab-icon">🏷️</span>分類</button>
      </nav>
    </div>
  `,
};

Vue.createApp(RootApp).mount('#app');
