// Shared press-and-drag reordering behavior for management lists (accounts,
// categories). Built on Pointer Events so the same code drives mouse drag
// and iPhone touch drag alike — the HTML5 drag-and-drop API never fires for
// touch on iOS Safari, which is the primary device this app targets.
//
// A list opts in by rendering a drag handle that calls startDrag on
// pointerdown, gives each row `data-drag-list` and `data-drag-id`, adds
// `dragMark(listId, id)` to the row's classes (the drop indicator), and
// implements `persistOrder(listId, items)` to write the new order back through
// the Store.
//
// Design rule: nothing in the DOM moves while a drag is on. The rows stay where
// they are, a line marks where the dragged row would land, and the list is
// re-ordered once, on release. An earlier version re-ordered the rows live,
// which moved the dragged handle's DOM node; the browser then dropped the
// handle's pointer capture (the drag froze) and the workaround of re-taking
// the capture crashed iPhone Safari's page process. So there is no pointer
// capture at all: the drag listens on `window`, and touch pointers are already
// delivered to the element they started on and bubble up to it.
//
// Auto-scroll: once the pointer has moved, within EDGE_ZONE px of the top of the
// screen (or of the bottom, above the phone's tab bar) the page scrolls, faster
// the closer to the edge, so a row can be carried past what fits on screen.
const EDGE_ZONE = 70;
const EDGE_MAX_SPEED = 16; // px per tick, at the very edge

// How much of the screen's bottom the tab bar covers (0 on desktop, where it is
// a sidebar and not a bar along the bottom).
function bottomBarHeight() {
  const bar = document.querySelector('.tab-bar');
  if (!bar) return 0;
  const r = bar.getBoundingClientRect();
  return r.width > window.innerWidth * 0.6 && r.top > window.innerHeight / 2 ? window.innerHeight - r.top : 0;
}

function edgeScrollSpeed(y, barHeight) {
  const bottomEdge = window.innerHeight - barHeight - EDGE_ZONE;
  if (y < EDGE_ZONE) return -Math.ceil(EDGE_MAX_SPEED * Math.min(1, (EDGE_ZONE - y) / EDGE_ZONE));
  if (y > bottomEdge) return Math.ceil(EDGE_MAX_SPEED * Math.min(1, (y - bottomEdge) / EDGE_ZONE));
  return 0;
}

const DragSortMixin = {
  data() {
    return {
      dragListId: null,
      dragItems: null, // the list as it was when the drag began; never re-ordered mid-drag
      dragId: null,
      dragFromIndex: null,
      dragOverIndex: null, // where the dragged row would land
    };
  },
  beforeUnmount() {
    this.endDragListeners();
  },
  methods: {
    startDrag(listId, items, index, event) {
      event.preventDefault();
      this.endDragListeners(); // never leave a previous drag's listeners behind
      this.dragListId = listId;
      this.dragItems = items.slice();
      this.dragId = items[index].id;
      this.dragFromIndex = index;
      this.dragOverIndex = index;

      const pointerId = event.pointerId;
      const onMove = (e) => { if (e.pointerId === pointerId) this.onDragMove(e); };
      const onUp = (e) => { if (e.pointerId === pointerId) this.onDragEnd(); };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      this._dragListeners = { onMove, onUp };
      this._dragPointer = null; // set by the first move: a mere press never scrolls
      this._dragBarHeight = bottomBarHeight();
    },
    // Ticks (~60 a second) once the pointer has moved. It may then be held still
    // at the edge (no move events), so it scrolls from the last known position and
    // re-checks which row is under it. A plain timer, not requestAnimationFrame:
    // it needs nothing painted to keep going.
    startAutoScroll() {
      const step = () => {
        if (this.dragFromIndex === null) { this._scrollTimer = null; return; }
        const p = this._dragPointer;
        const dy = p ? edgeScrollSpeed(p.y, this._dragBarHeight) : 0;
        if (dy !== 0) {
          const before = window.scrollY;
          window.scrollBy(0, dy);
          if (window.scrollY !== before) this.onDragMove({ clientX: p.x, clientY: p.y });
        }
        this._scrollTimer = setTimeout(step, 16);
      };
      this._scrollTimer = setTimeout(step, 16);
    },
    endDragListeners() {
      clearTimeout(this._scrollTimer);
      this._scrollTimer = null;
      const l = this._dragListeners;
      if (!l) return;
      window.removeEventListener('pointermove', l.onMove);
      window.removeEventListener('pointerup', l.onUp);
      window.removeEventListener('pointercancel', l.onUp);
      this._dragListeners = null;
    },
    onDragMove(event) {
      if (this.dragFromIndex === null) return;
      this._dragPointer = { x: event.clientX, y: event.clientY };
      if (this._scrollTimer == null) this.startAutoScroll();
      // A finger held at the very edge, or on the tab bar, is over no row: look
      // at the nearest point of the visible page instead so the marker keeps following.
      const hitY = Math.min(Math.max(event.clientY, 1), window.innerHeight - this._dragBarHeight - 1);
      const el = document.elementFromPoint(event.clientX, hitY);
      const rowEl = el ? el.closest('[data-drag-id]') : null;
      if (!rowEl || rowEl.dataset.dragList !== this.dragListId) return;
      const overIndex = this.dragItems.findIndex((it) => it.id === rowEl.dataset.dragId);
      if (overIndex === -1 || overIndex === this.dragOverIndex) return;
      this.dragOverIndex = overIndex;
    },
    // Re-orders once, here. Pressing the handle without moving (or dropping the
    // row where it started) changes nothing, so nothing is written — a write is
    // a sync to Google.
    async onDragEnd() {
      if (this.dragFromIndex === null) return;
      this.endDragListeners();
      const listId = this.dragListId;
      const from = this.dragFromIndex;
      const to = this.dragOverIndex;
      const base = this.dragItems;
      // Marked over straight away, so a second release event (the handle's own
      // handler and the window's both fire) can't save the order twice.
      this.dragFromIndex = null;
      try {
        if (to !== from) {
          const items = base.slice();
          const [moved] = items.splice(from, 1);
          items.splice(to, 0, moved);
          await this.persistOrder(listId, items);
        }
      } finally {
        // Even if saving failed the list must not stay marked as mid-drag.
        this.dragListId = null;
        this.dragItems = null;
        this.dragId = null;
        this.dragOverIndex = null;
      }
    },
    // The drop indicator: a line above the target row when dragging up, below it
    // when dragging down. Add the result to the row's classes.
    dragMark(listId, id) {
      if (this.dragFromIndex === null || this.dragListId !== listId || this.dragOverIndex === this.dragFromIndex) return '';
      const idx = this.dragItems.findIndex((it) => it.id === id);
      if (idx !== this.dragOverIndex) return '';
      return this.dragOverIndex < this.dragFromIndex ? 'drag-before' : 'drag-after';
    },
    // Rows are never re-ordered mid-drag, so a list always renders its own order.
    displayList(listId, baseItems) {
      return baseItems;
    },
  },
};
