const CategoriesView = {
  components: { IconPickerField },
  mixins: [DragSortMixin],
  data() {
    return {
      editingId: null,
      form: this.blankForm(),
      labelEditingId: null,
      labelForm: this.blankLabelForm(),
    };
  },
  computed: {
    expenseCategories() {
      return Store.state.categories
        .filter((c) => c.kind === 'expense')
        .sort((a, b) => a.sortOrder - b.sortOrder);
    },
    incomeCategories() {
      return Store.state.categories
        .filter((c) => c.kind === 'income')
        .sort((a, b) => a.sortOrder - b.sortOrder);
    },
    labels() {
      return Store.state.labels.slice().sort((a, b) => a.sortOrder - b.sortOrder);
    },
  },
  methods: {
    blankForm() {
      return { name: '', kind: 'expense', icon: '❔', color: '#adb5bd', budgetLimit: '', budgetWarningThreshold: 80 };
    },
    openNew(kind) {
      this.editingId = 'new';
      this.form = { ...this.blankForm(), kind };
    },
    openEdit(category) {
      this.editingId = category.id;
      this.form = {
        name: category.name,
        kind: category.kind,
        icon: category.icon,
        color: category.color,
        budgetLimit: category.budgetLimit || '',
        budgetWarningThreshold: Math.round((category.budgetWarningThreshold ?? 0.8) * 100),
      };
    },
    cancel() {
      this.editingId = null;
    },
    async save() {
      if (!this.form.name.trim()) return;
      const fields = {
        name: this.form.name.trim(),
        kind: this.form.kind,
        icon: this.form.icon || '❔',
        color: this.form.color,
        budgetLimit: this.form.kind === 'expense' ? (Number(this.form.budgetLimit) || null) : null,
        budgetWarningThreshold: this.form.kind === 'expense' ? (Number(this.form.budgetWarningThreshold) || 80) / 100 : null,
      };
      if (this.editingId === 'new') {
        await Store.addCategory(fields);
      } else {
        await Store.updateCategory(this.editingId, fields);
      }
      this.editingId = null;
    },
    async toggleArchive(category) {
      await Store.setCategoryArchived(category.id, !category.isArchived);
    },
    async deleteCategory(category) {
      const count = Store.state.transactions.filter((t) => !t.isDeleted && t.categoryId === category.id).length;
      const msg = count > 0
        ? `這個分類還有 ${count} 筆交易紀錄,刪除後這些紀錄會顯示為「未分類」,且無法復原。確定要刪除嗎？`
        : '確定要刪除這個分類嗎？此操作無法復原。';
      if (!confirm(msg)) return;
      await Store.deleteCategory(category.id);
    },
    // sortOrder is counted separately per kind/list (Store.addCategory,
    // Store.findOrCreateLabel), so renumbering the dragged list's items to
    // 0..n-1 never touches another list's order.
    async persistOrder(listId, items) {
      const update = listId === 'labels' ? Store.updateLabel : Store.updateCategory;
      await Promise.all(items.map((item, i) => update(item.id, { sortOrder: i })));
    },

    // --- Labels: a separate management block, not a Category kind. Labels
    // stay freeform/multi-select by design (docs discussion), this just
    // gives them the same "manage, don't retype" surface as categories.
    blankLabelForm() {
      return { name: '', color: '#6d6875', icon: '🏷️' };
    },
    openNewLabel() {
      this.labelEditingId = 'new';
      this.labelForm = this.blankLabelForm();
    },
    openEditLabel(label) {
      this.labelEditingId = label.id;
      this.labelForm = { name: label.name, color: label.color, icon: Models.labelIcon(label) };
    },
    cancelLabel() {
      this.labelEditingId = null;
    },
    async saveLabel() {
      const name = this.labelForm.name.trim();
      if (!name) return;
      if (this.labelEditingId === 'new') {
        await Store.findOrCreateLabel(name, this.labelForm.color, this.labelForm.icon);
      } else {
        await Store.updateLabel(this.labelEditingId, { name, color: this.labelForm.color, icon: this.labelForm.icon });
      }
      this.labelEditingId = null;
    },
    async toggleLabelArchive(label) {
      await Store.setLabelArchived(label.id, !label.isArchived);
    },
    async deleteLabel(label) {
      const count = Store.state.transactionLabels.filter((tl) => tl.labelId === label.id).length;
      const msg = count > 0
        ? `這個標籤還套用在 ${count} 筆交易上,刪除後這些交易會失去這個標籤,且無法復原。確定要刪除嗎？`
        : '確定要刪除這個標籤嗎？此操作無法復原。';
      if (!confirm(msg)) return;
      await Store.deleteLabel(label.id);
    },
  },
  template: `
    <div class="view">
      <div class="view-header"><h2>分類</h2></div>

      <div class="panel-grid">
      <section class="panel">
        <div class="view-header"><h3>支出分類</h3><button class="primary" @click="openNew('expense')">+ 新增</button></div>
        <div
          v-for="(c, i) in displayList('expense', expenseCategories)" :key="c.id"
          class="list-row" :class="{ archived: c.isArchived, dragging: dragId === c.id }"
          data-drag-list="expense" :data-drag-row="i"
        >
          <span class="drag-handle"
            @pointerdown="startDrag('expense', expenseCategories, i, $event)"
            @pointermove="onDragMove" @pointerup="onDragEnd" @pointercancel="onDragEnd"
          >⠿</span>
          <div class="list-row-main">
            <span class="icon-badge" :style="{ background: (c.color || '#adb5bd') + '30' }">{{ c.icon }}</span>
            <span class="list-row-title">{{ c.name }}</span>
            <div v-if="c.budgetLimit" class="list-row-sub">預算 {{ c.budgetLimit.toLocaleString('zh-TW') }} / 月</div>
          </div>
          <div class="list-row-actions">
            <button @click="openEdit(c)">編輯</button>
            <button @click="toggleArchive(c)">{{ c.isArchived ? '取消封存' : '封存' }}</button>
            <button class="danger" @click="deleteCategory(c)">刪除</button>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="view-header"><h3>收入分類</h3><button class="primary" @click="openNew('income')">+ 新增</button></div>
        <div
          v-for="(c, i) in displayList('income', incomeCategories)" :key="c.id"
          class="list-row" :class="{ archived: c.isArchived, dragging: dragId === c.id }"
          data-drag-list="income" :data-drag-row="i"
        >
          <span class="drag-handle"
            @pointerdown="startDrag('income', incomeCategories, i, $event)"
            @pointermove="onDragMove" @pointerup="onDragEnd" @pointercancel="onDragEnd"
          >⠿</span>
          <div class="list-row-main">
            <span class="icon-badge" :style="{ background: (c.color || '#adb5bd') + '30' }">{{ c.icon }}</span>
            <span class="list-row-title">{{ c.name }}</span>
          </div>
          <div class="list-row-actions">
            <button @click="openEdit(c)">編輯</button>
            <button @click="toggleArchive(c)">{{ c.isArchived ? '取消封存' : '封存' }}</button>
            <button class="danger" @click="deleteCategory(c)">刪除</button>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="view-header"><h3>標籤</h3><button class="primary" @click="openNewLabel">+ 新增</button></div>
        <p class="muted" style="margin: -4px 0 10px;">記帳時可以多選</p>
        <div
          v-for="(l, i) in displayList('labels', labels)" :key="l.id"
          class="list-row" :class="{ archived: l.isArchived, dragging: dragId === l.id }"
          data-drag-list="labels" :data-drag-row="i"
        >
          <span class="drag-handle"
            @pointerdown="startDrag('labels', labels, i, $event)"
            @pointermove="onDragMove" @pointerup="onDragEnd" @pointercancel="onDragEnd"
          >⠿</span>
          <div class="list-row-main">
            <span class="icon-badge" :style="{ background: (l.color || '#6d6875') + '30' }">{{ l.icon || '🏷️' }}</span>
            <span class="list-row-title">{{ l.name }}</span>
          </div>
          <div class="list-row-actions">
            <button @click="openEditLabel(l)">編輯</button>
            <button @click="toggleLabelArchive(l)">{{ l.isArchived ? '取消封存' : '封存' }}</button>
            <button class="danger" @click="deleteLabel(l)">刪除</button>
          </div>
        </div>
        <div v-if="labels.length === 0" class="empty">還沒有標籤</div>
      </section>
      </div>

      <div v-if="editingId" class="modal-backdrop" @click.self="cancel">
        <div class="modal">
          <h3>{{ editingId === 'new' ? '新增分類' : '編輯分類' }}</h3>
          <div class="modal-body">
            <label>名稱 <input v-model="form.name" /></label>
            <label>圖示 <IconPickerField v-model="form.icon" /></label>
            <label>顏色 <input type="color" v-model="form.color" /></label>
            <template v-if="form.kind === 'expense'">
              <label>月度預算(留空表示不設定) <input type="number" min="0" v-model="form.budgetLimit" placeholder="不設定" /></label>
              <label v-if="form.budgetLimit">警示門檻(%,花到這個比例會標黃)
                <input type="number" min="1" max="100" v-model.number="form.budgetWarningThreshold" />
              </label>
            </template>
          </div>
          <div class="modal-actions">
            <button @click="cancel">取消</button>
            <button class="primary" @click="save">儲存</button>
          </div>
        </div>
      </div>

      <div v-if="labelEditingId" class="modal-backdrop" @click.self="cancelLabel">
        <div class="modal">
          <h3>{{ labelEditingId === 'new' ? '新增標籤' : '編輯標籤' }}</h3>
          <div class="modal-body">
            <label>名稱 <input v-model="labelForm.name" placeholder="例如：固定支出" /></label>
            <label>圖示 <IconPickerField v-model="labelForm.icon" /></label>
            <label>顏色 <input type="color" v-model="labelForm.color" /></label>
          </div>
          <div class="modal-actions">
            <button @click="cancelLabel">取消</button>
            <button class="primary" @click="saveLabel">儲存</button>
          </div>
        </div>
      </div>
    </div>
  `,
};
