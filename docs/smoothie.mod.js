/**
 * Patched wrapper to add `onDraw` hook to SmoothieChart without modifying original source.
 * Load this script after loading the official smoothie.js.
 */

(function() {
  // Wait until SmoothieChart is available
  function patchOnDraw() {
    if (typeof SmoothieChart === 'undefined' || !SmoothieChart.prototype.render) {
      // retry shortly
      return setTimeout(patchOnDraw, 100);
    }

    // Monkey-patch render()
    const origRender = SmoothieChart.prototype.render;
    SmoothieChart.prototype.render = function(canvas, time) {
      // call original render
      origRender.call(this, canvas, time);

      // then fire onDraw hook if defined
      const opts = this.options;
      if (opts && typeof opts.onDraw === 'function') {
        opts.onDraw({
          chart: this,
          chartWidth: canvas.width,
          chartHeight: canvas.height,
          options: opts
        });
      }
    };

    console.log('✅ SmoothieChart.prototype.render patched to support onDraw');
  }

  patchOnDraw();
})();
