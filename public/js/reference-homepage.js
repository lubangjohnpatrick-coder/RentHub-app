/* Reference homepage interaction refinements. */
(() => {
  if (!window.Root) return;
  const oldHome = Root.viewHome ? Root.viewHome.bind(Root) : null;
  Root.viewHome = async function () {
    if (oldHome) await oldHome();
    const note = document.querySelector('.grh-adventure-note');
    if (note) note.innerHTML = 'Your Next Adventure<br><b>Starts Here.</b>';
    const fields = document.querySelectorAll('.grh-search-field');
    if (fields[1]) {
      fields[1].querySelector('label').textContent = 'Categories';
      const input = fields[1].querySelector('input');
      if (input) input.placeholder = 'All categories';
    }
    if (fields[2]) fields[2].querySelector('label').textContent = 'Rental Dates / Radius';
    const button = document.querySelector('.grh-search-button span');
    if (button) button.textContent = 'Search Rentals';
  };
})();
