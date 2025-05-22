/**
 * Patched wrapper to add an `onDraw` hook to SmoothieChart without touching the
 * original source. Load this **after** smoothie.js but **before** your script.js.
 */
;(function(){
  // Retry until smoothie is loaded
  function patchOnDraw() {
    if (typeof SmoothieChart === 'undefined' || !SmoothieChart.prototype.start) {
      return setTimeout(patchOnDraw, 50);
    }

    // Keep the original start()
    const _origStart = SmoothieChart.prototype.start;

    // Override start() to wrap render()
    SmoothieChart.prototype.start = function(){
      // Bind original render
      const chart = this;
      const origRender = chart.render.bind(chart);

      // Override render: call original, then onDraw()
      chart.render = function(canvas, time){
        origRender(canvas, time);
        if (typeof chart.options.onDraw === 'function') {
          try {
            chart.options.onDraw(chart);
          } catch(err) {
            console.error('onDraw error:', err);
          }
        }
      };

      // Now call the real start loop
      _origStart.call(chart);
    };

    console.log('✅ SmoothieChart patched for onDraw hook');
  }

  patchOnDraw();
})();
