export function fixPlayoffTableLabels() {
  // Only execute on pages that contain #playoffTable
  if (!document.querySelector('#playoffTable')) return;

  function updateReport() {
    const wrapper = document.querySelector('.report-wrapper');
    if (!wrapper) return;

    wrapper.innerHTML = wrapper.innerHTML.replace(/AllPlay-Win %/gi, 'All-Play Pct');
  }

  // Wait until full page load (MFL injects content late)
  window.addEventListener('load', () => {
    // Slight delay ensures MFL finishes rendering .report-wrapper
    setTimeout(updateReport, 100);
  });
}