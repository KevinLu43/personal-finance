// What the 帳戶 page needs to show about the Google connection (which sheet,
// how to sign out) without reaching into RootApp. RootApp fills it in.
window.SyncInfo = Vue.reactive({ mode: 'local', sheetUrl: '', signOut: null });

const RootApp = {
  data() {
    return {
      tab: 'dashboard',
      // boot -> (login -> connecting ->) ready. `mode` is 'google' when a Client
      // ID is configured (data lives in the operator's Google Sheet) or 'local'
      // (this browser's IndexedDB, the way the app always worked).
      phase: 'boot',
      mode: 'local',
      loginError: '',
      syncState: 'idle',
      syncMessage: '',
      syncNeedsAuth: false,
      lastRefresh: 0,
      sheetUrl: '',
    };
  },
  computed: {
    ready() {
      return this.phase === 'ready' && Store.state.ready;
    },
    syncLabel() {
      if (this.syncState === 'syncing') return '同步中…';
      if (this.syncState === 'error') return this.syncNeedsAuth ? '登入已過期' : '同步失敗';
      return '已同步';
    },
  },
  async mounted() {
    const cfg = window.APP_CONFIG || {};
    const forceLocal = new URLSearchParams(location.search).has('local');
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('beforeunload', (e) => {
      if (this.sdb && this.sdb.isDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    if (!cfg.googleClientId || forceLocal) {
      this.mode = 'local';
      await Store.init();
      this.phase = 'ready';
      return;
    }
    this.mode = 'google';
    SyncInfo.mode = 'google';
    SyncInfo.signOut = () => this.signOut();
    try {
      await GoogleApi.init(cfg.googleClientId);
    } catch (err) {
      this.loginError = err.message;
      this.phase = 'login';
      return;
    }
    if (GoogleApi.isRemembered()) await this.connectGoogle(false);
    else this.phase = 'login';
  },
  methods: {
    // interactive = true comes straight from the login button's click, so the
    // browser lets Google's popup open; false is the quiet re-connect on load.
    async connectGoogle(interactive) {
      const cfg = window.APP_CONFIG;
      this.phase = 'connecting';
      this.loginError = '';
      try {
        if (interactive) await GoogleApi.signIn();
        else await GoogleApi.trySilent();
        const sdb = SheetsDb.create({ transport: GoogleApi.transport, name: cfg.spreadsheetName });
        // The type round-trip check only needs to pass once per device.
        const checkedKey = 'pf_sheet_verified';
        let verified = false;
        try { verified = localStorage.getItem(checkedKey) === '1'; } catch (e) { /* re-check each time */ }
        await sdb.connect({ verify: !verified });
        try { localStorage.setItem(checkedKey, '1'); } catch (e) { /* ignore */ }
        sdb.onStatus((st) => {
          this.syncState = st.state;
          this.syncMessage = st.message;
          this.syncNeedsAuth = !!st.needsAuth;
        });
        this.sdb = sdb;
        window.Db = sdb;
        await Store.init();
        this.sheetUrl = GoogleApi.sheetUrl() || '';
        SyncInfo.sheetUrl = this.sheetUrl;
        this.lastRefresh = Date.now();
        this.phase = 'ready';
      } catch (err) {
        this.phase = 'login';
        // A quiet attempt that simply needs the operator to click isn't an error.
        if (interactive || !err.needsAuth) this.loginError = err.message;
      }
    },
    async reauth() {
      try {
        await GoogleApi.signIn();
        await this.sdb.resume();
      } catch (err) {
        this.syncState = 'error';
        this.syncMessage = err.message;
        this.syncNeedsAuth = !!err.needsAuth;
      }
    },
    async retrySync() {
      try { await this.sdb.resume(); } catch (err) { /* the status pill shows it */ }
    },
    signOut() {
      if (this.sdb && this.sdb.isDirty() && !confirm('還有資料尚未同步到 Google,登出後會遺失。確定要登出嗎?')) return;
      GoogleApi.signOut();
      location.reload();
    },
    async onVisibility() {
      if (!Store.state.ready) return;
      if (this.mode !== 'google') {
        // Coming back to the app (a tab left open overnight, a PWA resumed from
        // the background) books anything that fell due in the meantime.
        if (document.visibilityState === 'visible') Store.bookDueItems();
        return;
      }
      if (!this.sdb) return;
      if (document.visibilityState === 'hidden') {
        this.sdb.flush().catch(() => {});
        return;
      }
      // Back in front: pull in what another device changed meanwhile.
      if (Date.now() - this.lastRefresh < 20000) return;
      this.lastRefresh = Date.now();
      try {
        await this.sdb.refresh();
        await Store.reloadFromDb();
      } catch (err) {
        this.syncState = 'error';
        this.syncMessage = err.message;
        this.syncNeedsAuth = !!err.needsAuth;
      }
    },
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
    <div v-if="phase === 'login'" class="login-screen">
      <div class="login-card">
        <div class="login-title">個人財務</div>
        <p class="login-note">資料存放在你自己的 Google 試算表,登入後即可在任何裝置使用。</p>
        <button class="primary login-btn" @click="connectGoogle(true)">使用 Google 登入</button>
        <p v-if="loginError" class="login-error">{{ loginError }}</p>
      </div>
    </div>
    <div v-else-if="!ready" class="loading">{{ phase === 'connecting' ? '連線到 Google 試算表…' : '載入中…' }}</div>
    <div v-else class="app-shell">
      <main class="app-main">
        <div v-if="mode === 'google'" class="sync-status" :class="syncState" :title="syncMessage">
          <template v-if="syncState === 'error'">
            <span>{{ syncLabel }}:{{ syncMessage }}</span>
            <button v-if="syncNeedsAuth" @click="reauth">重新登入</button>
            <button v-else @click="retrySync">重試</button>
          </template>
          <span v-else>{{ syncLabel }}</span>
        </div>
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
