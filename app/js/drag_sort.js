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
//
// Re-ordering re-renders the rows, which moves the dragged handle's DOM node,
// and the browser then drops the handle's pointer capture — after which its
// pointermove/pointerup never arrive. So the drag also listens on `window`
// (a release anywhere still ends it and saves the order) and takes the
// capture back whenever it is lost while the pointer is still down. The
// handlers a list puts on the handle stay harmless: both are idempotent.
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
  beforeUnmount() {
    this.endDragListeners();
  },
  methods: {
    startDrag(listId, items, index, event) {
      event.preventDefault();
      this.dragListId = listId;
      this.dragItems = items.slice();
      this.dragId = items[index].id;
      this.dragFromIndex = index;
      this.dragOverIndex = index;

      this.endDragListeners(); // never leave a previous drag's listeners behind
      const handle = event.currentTarget;
      const pointerId = event.pointerId;
      const takeCapture = () => {
        if (this.dragFromIndex === null || !handle.isConnected) return;
        try {
          if (!handle.hasPointerCapture(pointerId)) handle.setPointerCapture(pointerId);
        } catch (err) { /* the pointer is already gone */ }
      };
      const onMove = (e) => { if (e.pointerId === pointerId) this.onDragMove(e); };
      const onUp = (e) => { if (e.pointerId === pointerId) this.onDragEnd(); };
      takeCapture();
      handle.addEventListener('lostpointercapture', takeCapture);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      this._dragListeners = { handle, takeCapture, onMove, onUp };
    },
    endDragListeners() {
      const l = this._dragListeners;
      if (!l) return;
      l.handle.removeEventListener('lostpointercapture', l.takeCapture);
      window.removeEventListener('pointermove', l.onMove);
      window.removeEventListener('pointerup', l.onUp);
      window.removeEventListener('pointercancel', l.onUp);
      this._dragListeners = null;
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
      this.endDragListeners();
      const listId = this.dragListId;
      const items = this.dragItems;
      // Marked over straight away, so a second release event (the handle's own
      // handler and the window's both fire) can't save the order twice.
      this.dragFromIndex = null;
      try {
        await this.persistOrder(listId, items);
      } finally {
        // Even if saving failed the list must not stay frozen in its preview.
        this.dragListId = null;
        this.dragItems = null;
        this.dragId = null;
        this.dragOverIndex = null;
      }
    },
    displayList(listId, baseItems) {
      return this.dragListId === listId ? this.dragItems : baseItems;
    },
  },
};
