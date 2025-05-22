/**
 * Adds an onDraw hook to SmoothieChart.
 * Must be loaded *after* smoothie.js, but *before* script.js.
 */
;(function(){
  function patchOnDraw() {
    if (typeof SmoothieChart === 'undefined' || !SmoothieChart.prototype.start) {
      return setTimeout(patchOnDraw, 50);
    }

    const _origStart = SmoothieChart.prototype.start;

    SmoothieChart.prototype.start = function() {
      // wrap this.render
      const chart = this;
      const origRender = chart.render.bind(chart);

      chart.render = function(canvas, time) {
        origRender(canvas, time);
        if (typeof chart.options.onDraw === 'function') {
          try {
            chart.options.onDraw(chart);
          } catch (err) {
            console.error('🛑 onDraw error:', err);
          }
        }
      };

      // call the real start() to kick off rAF loop
      _origStart.call(chart);
    };

    console.log('✅ SmoothieChart patched for onDraw');
  }

  patchOnDraw();
})();
