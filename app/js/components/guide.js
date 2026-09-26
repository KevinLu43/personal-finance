// First-run guide: a short walkthrough shown once to someone with an empty
// ledger, and reopenable from the 帳戶 page. Whether it has been seen is kept
// per browser (localStorage); it only auto-opens when there are also no
// accounts and no transactions yet, so signing in on a second device that
// already has data never shows it.

const GUIDE_SEEN_KEY = 'pf_guide_seen';

// `Guide.open` is the one switch: RootApp renders the modal from it, and
// anything (the 帳戶 page's button) opens the guide by setting it.
window.Guide = Vue.reactive({ open: false });

function guideSeen() {
  try { return localStorage.getItem(GUIDE_SEEN_KEY) === '1'; } catch (e) { return false; }
}

function markGuideSeen() {
  try { localStorage.setItem(GUIDE_SEEN_KEY, '1'); } catch (e) { /* shows again next time; harmless */ }
}

// Called once the ledger has loaded.
function maybeShowGuide() {
  if (guideSeen()) return;
  if (Store.state.accounts.length === 0 && Store.state.transactions.length === 0) window.Guide.open = true;
}

const WelcomeGuide = {
  emits: ['close'],
  data() {
    return { step: 0 };
  },
  computed: {
    isLocal() {
      return !!window.SyncInfo && window.SyncInfo.mode === 'local';
    },
    feedbackUrl() {
      return (window.APP_CONFIG && window.APP_CONFIG.feedbackUrl) || '';
    },
    steps() {
      return [
        {
          icon: '👋',
          title: '歡迎使用個人財務',
          points: [
            '記帳與投資紀錄工具,手機和電腦開同一個網址就能用。',
            this.isLocal
              ? '你現在是「本機試玩」模式:資料只存在這個瀏覽器裡,清除瀏覽器資料就會消失。想長期使用、跨裝置同步,請改用 Google 登入。'
              : '你的資料存在你自己 Google 雲端硬碟裡一份叫「個人財務資料」的試算表,開發者看不到任何一筆紀錄。',
          ],
        },
        {
          icon: '💳',
          title: '第一步:建立帳戶',
          points: [
            '到底部的「帳戶」分頁,新增你會用到的帳戶:現金、銀行、信用卡…',
            '「初始餘額」填你現在的餘額,之後餘額會依你的記帳自動計算。',
            '有股票就再新增一個「證券交割」帳戶;有貸款也可以在這裡新增。',
          ],
        },
        {
          icon: '✏️',
          title: '開始記帳',
          points: [
            '到「記帳」分頁按「+ 新增」,選支出、收入或轉帳。',
            '分類已經預設好,可以到「分類」分頁調整、排序,也能新增「標籤」(例如旅行、請客),跨分類統計。',
            '「總覽」分頁會顯示每月收支、淨值趨勢和預算。',
          ],
        },
        {
          icon: '📈',
          title: '投資與備份(選用)',
          points: [
            '「投資」分頁記錄買賣與股利,「投資總覽」看持股、已實現損益與股利。需要先建立證券交割帳戶。',
            '「帳戶」分頁最下面可以匯出備份檔,建議定期備份。',
            '手機可以用瀏覽器的「加入主畫面」,之後一鍵開啟。',
          ],
        },
      ];
    },
    current() {
      return this.steps[this.step];
    },
    isLast() {
      return this.step === this.steps.length - 1;
    },
  },
  methods: {
    next() {
      if (!this.isLast) this.step += 1;
    },
    prev() {
      if (this.step > 0) this.step -= 1;
    },
    finish() {
      markGuideSeen();
      this.$emit('close');
    },
  },
  template: `
    <div class="modal-backdrop" @click.self="finish">
      <div class="modal guide">
        <div class="guide-dots" aria-hidden="true">
          <span v-for="(s, i) in steps" :key="i" class="guide-dot" :class="{ on: i === step }"></span>
        </div>
        <div class="modal-body">
          <div class="guide-icon">{{ current.icon }}</div>
          <h3 class="guide-title">{{ current.title }}</h3>
          <ul class="guide-points">
            <li v-for="(p, i) in current.points" :key="i">{{ p }}</li>
          </ul>
          <p v-if="isLast" class="guide-links">
            <a href="privacy.html" target="_blank" rel="noopener">隱私權說明</a>
            <a v-if="feedbackUrl" :href="feedbackUrl" target="_blank" rel="noopener">意見回饋</a>
          </p>
        </div>
        <div class="modal-actions with-delete">
          <button @click="finish">{{ isLast ? '關閉' : '略過' }}</button>
          <div class="modal-actions-right">
            <button v-if="step > 0" @click="prev">上一步</button>
            <button v-if="!isLast" class="primary" @click="next">下一步</button>
            <button v-else class="primary" @click="finish">開始使用</button>
          </div>
        </div>
      </div>
    </div>
  `,
};
