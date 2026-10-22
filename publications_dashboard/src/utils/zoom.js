/**
 * Wheel zoom for charts where a bare wheel keeps scrolling the page and
 * Ctrl/⌘ + wheel zooms.
 *
 * d3 multiplies a ctrl-wheel by ten, on the assumption that ctrl means a
 * trackpad pinch and pinches arrive in tiny increments. Here ctrl is *also*
 * how a mouse asks to zoom, and one 100px notch through that multiplier lands
 * on the scale limit in a single turn. So the boost is kept only for what a
 * pinch actually sends: pixel deltas, small ones. A line-mode wheel (Firefox
 * reports ±3) is small too, hence the deltaMode test.
 *
 * @param {WheelEvent} event
 * @returns {number} The zoom's log2 change, for `d3.zoom().wheelDelta`.
 */
export function wheelDelta(event) {
    const unit = event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002;
    const pinching = event.deltaMode === 0 && Math.abs(event.deltaY) < 50;
    return -event.deltaY * unit * (pinching ? 10 : 1);
}
