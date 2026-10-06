// Every donut in the app draws through here. Slices come from
// Models.buildDonutSegments (which leaves a thin gap between them, so two
// similar colours never run together), and one slice can be "focused" —
// tapped here or on its legend row — staying at full colour while the rest
// fade, so which slice is which never depends on telling colours apart.
const DonutChart = {
  props: {
    segments: { type: Array, required: true },
    focus: { type: Number, default: null }, // index into segments, or null
  },
  emits: ['focus'],
  template: `
    <svg viewBox="0 0 100 100" class="donut-chart">
      <circle v-if="segments.length === 0" cx="50" cy="50" r="40" fill="none" stroke="var(--line)" stroke-width="14" />
      <circle
        v-for="(seg, i) in segments" :key="i"
        cx="50" cy="50" r="40" fill="none"
        :stroke="seg.color" stroke-width="14"
        :stroke-dasharray="seg.dash + ' ' + seg.gap"
        :stroke-dashoffset="seg.dashOffset"
        transform="rotate(-90 50 50)"
        class="donut-segment" :class="{ dimmed: focus !== null && focus !== i, expected: seg.expected }"
        @click="$emit('focus', i)"
      />
    </svg>
  `,
};

// The focus state behind DonutChart, for a view with several donuts: one
// focused index per chart (named by the caller), toggled from the slice or
// its legend row. Rows and segments share an order (buildDonutSegments maps
// the rows one to one), so the legend's own index is the slice's.
const DonutFocusMixin = {
  data() {
    return { donutFocus: {} };
  },
  methods: {
    toggleDonutFocus(chart, i) {
      this.donutFocus = { ...this.donutFocus, [chart]: this.donutFocus[chart] === i ? null : i };
    },
    // null once the list no longer reaches that far (a shorter month, say).
    donutFocusIndex(chart, segments) {
      const i = this.donutFocus[chart];
      return i != null && i < segments.length ? i : null;
    },
    donutLegendClass(chart, segments, i) {
      const focus = this.donutFocusIndex(chart, segments);
      if (focus === null) return {};
      return { 'donut-focused': focus === i, 'donut-dimmed': focus !== i };
    },
    clearDonutFocus() {
      this.donutFocus = {};
    },
  },
};
