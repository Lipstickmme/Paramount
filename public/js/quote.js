'use strict';

/**
 * The rate request form. Numbers are sent as numbers rather than form strings,
 * so the server does not have to guess what an empty box meant.
 */
(function () {
  const { $, wireForm, EMAIL_RE } = window.PARAMOUNT || {};
  const form = document.getElementById('quote-form');
  if (!form || !wireForm) return;

  wireForm(form, {
    url: '/api/quotes',
    success: 'Thank you. A lane specialist will come back to you with rates and transit times.',
    collect: (f) => {
      const values = Object.fromEntries(new FormData(f).entries());
      ['weightKg', 'pieces'].forEach((key) => {
        values[key] = values[key] === '' ? null : Number(values[key]);
      });
      return values;
    },
    validate: (v) => {
      const errors = {};
      if (!v.name || String(v.name).trim().length < 2) errors.name = 'Please enter your name.';
      if (!EMAIL_RE.test(v.email || '')) errors.email = 'Please enter a valid email address.';
      if (!v.mode) errors.mode = 'Choose a service.';
      if (!v.origin || String(v.origin).trim().length < 2) errors.origin = 'Where does the cargo start?';
      if (!v.destination || String(v.destination).trim().length < 2) errors.destination = 'Where is it going?';
      return errors;
    },
  });

  // A service chosen on /services carries over, so the form opens on the right
  // mode instead of making the visitor choose twice.
  const mode = new URLSearchParams(window.location.search).get('mode');
  if (mode) {
    const select = document.getElementById('q-mode');
    if (select && Array.from(select.options).some((o) => o.value === mode)) select.value = mode;
  }
})();
