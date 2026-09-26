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
// Auto-scroll while dragging: within EDGE_ZONE px of the top of the screen (or
// of the bottom, above the phone's tab bar) the page scrolls, faster the closer
// to the edge, so a row can be carried past what fits on screen.
const EDGE_ZONE = 70;
const EDGE_MAX_SPEED = 16; // px per frame, at the very edge

// How much of the screen's bottom the tab bar covers (0 on desktop, where it is
// a sidebar and not a bar along the bottom).
function bottomBarHeight() {
  const bar = document.querySelector('.tab-bar');
  if (!bar) return 0;
  const r = bar.getBoundingClientRect();
  return r.width > window.innerWidth * 0.6 && r.top > window.innerHeight / 2 ? window.innerHeight - r.top : 0;
}

function edgeScrollSpeed(y) {
  const bottomEdge = window.innerHeight - bottomBarHeight() - EDGE_ZONE;
  if (y < EDGE_ZONE) return -Math.ceil(EDGE_MAX_SPEED * Math.min(1, (EDGE_ZONE - y) / EDGE_ZONE));
  if (y > bottomEdge) return Math.ceil(EDGE_MAX_SPEED * Math.min(1, (y - bottomEdge) / EDGE_ZONE));
  return 0;
}

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
      this._dragStartIds = items.map((it) => it.id); // to tell a real re-order from a mere tap
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
      this._dragPointer = { x: event.clientX, y: event.clientY };
      // Browsers keep the page from visibly jumping when content moves ("scroll
      // anchoring"); each re-order here would then cancel part of an upward
      // auto-scroll. Off for the length of the drag.
      document.documentElement.style.overflowAnchor = 'none';
      this.startAutoScroll();
    },
    // Ticks (~60 a second) while a drag is on. The pointer may be held still
    // at the edge (no move events), so it scrolls from the last known
    // position, then re-checks which row is now under it. A plain timer, not
    // requestAnimationFrame: it needs nothing painted to keep going.
    startAutoScroll() {
      const step = () => {
        if (this.dragFromIndex === null) { this._scrollTimer = null; return; }
        const p = this._dragPointer;
        const dy = p ? edgeScrollSpeed(p.y) : 0;
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
      document.documentElement.style.overflowAnchor = '';
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
      this._dragPointer = { x: event.clientX, y: event.clientY };
      // A finger held at the very edge, or on the tab bar, is over no row: look
      // at the nearest point of the visible page instead so the row keeps following.
      const hitY = Math.min(Math.max(event.clientY, 1), window.innerHeight - bottomBarHeight() - 1);
      const el = document.elementFromPoint(event.clientX, hitY);
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
        // Pressing the handle without moving (or dropping it back where it was)
        // changes nothing, so nothing is written — a write means a sync to Google.
        const changed = items.some((it, i) => it.id !== this._dragStartIds[i]);
        if (changed) await this.persistOrder(listId, items);
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
