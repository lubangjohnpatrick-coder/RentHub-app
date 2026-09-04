/* Reference homepage interaction refinements. */
(() => {
  if (!window.Root) return;
  const oldHome = Root.viewHome ? Root.viewHome.bind(Root) : null;

  Root.viewHome = async function () {
    if (oldHome) await oldHome();

    const note = document.querySelector('.grh-adventure-note');
    if (note) note.innerHTML = 'Your Next Adventure<br><b>Starts Here.</b>';

    /* Keep labels truthful to the controls that actually exist.
       The second field is free-text search; the third is radius, not a date picker. */
    const qLabel = document.querySelector('label[for="launch-q"]');
    if (qLabel) qLabel.textContent = 'What do you need?';
    const radiusLabel = document.querySelector('label[for="launch-radius"]');
    if (radiusLabel) radiusLabel.textContent = 'Search radius';

    const button = document.querySelector('.grh-search-button span:last-child');
    if (button) button.textContent = 'Search Rentals';
  };
})();
