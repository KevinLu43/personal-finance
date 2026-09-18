// Shared press-and-drag reordering behavior for management lists (accounts,
// categories). Built on Pointer Events so the same code drives mouse drag
// and iPhone touch drag alike — the HTML5 drag-and-drop API never fires for
// touch on iOS Safari, which is the primary device this app targets.
//
// A list opts in by rendering a drag handle that calls startDrag on
// pointerdown and forwards pointermove/pointerup to onDragMove/onDragEnd,
// gives each row a `data-drag-list`/`data-drag-row` pair so the handle can
// hit-test which row it's hovering over, renders `displayList(listId, base)`
// instead of the raw array, and implements `persistOrder(listId, items)` to
// write the new order back through the Store.
const DragSortMixin = {
  data() {
    return {
      dragListId: null,
      dragItems: null,
      dragId: null,
      dragFromIndex: null,
      dragOverIndex: null,
    };
  },
  methods: {
    startDrag(listId, items, index, event) {
      event.preventDefault();
      this.dragListId = listId;
      this.dragItems = items.slice();
      this.dragId = items[index].id;
      this.dragFromIndex = index;
      this.dragOverIndex = index;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onDragMove(event) {
      if (this.dragFromIndex === null) return;
      const el = document.elementFromPoint(event.clientX, event.clientY);
      const rowEl = el ? el.closest('[data-drag-row]') : null;
      if (!rowEl || rowEl.dataset.dragList !== this.dragListId) return;
      const overIndex = Number(rowEl.dataset.dragRow);
      if (Number.isNaN(overIndex) || overIndex === this.dragOverIndex) return;
      const items = this.dragItems.slice();
      const [moved] = items.splice(this.dragOverIndex, 1);
      items.splice(overIndex, 0, moved);
      this.dragItems = items;
      this.dragOverIndex = overIndex;
    },
    // Persist before clearing the live-preview array, so the list never
    // snaps back to the pre-drag order for the moment it takes the Store
    // write to land.
    async onDragEnd() {
      if (this.dragFromIndex === null) return;
      const listId = this.dragListId;
      const items = this.dragItems;
      await this.persistOrder(listId, items);
      this.dragListId = null;
      this.dragItems = null;
      this.dragId = null;
      this.dragFromIndex = null;
      this.dragOverIndex = null;
    },
    displayList(listId, baseItems) {
      return this.dragListId === listId ? this.dragItems : baseItems;
    },
  },
};
