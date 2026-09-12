'use strict';

/**
 * The application form. Roles come from the same API the careers page uses, and
 * the one named in ?role= is preselected so the apply link carries over.
 */
(function () {
  const { wireForm, EMAIL_RE, fetchJSON, esc } = window.PARAMOUNT || {};
  const form = document.getElementById('apply-form');
  if (!form || !wireForm) return;

  const select = document.getElementById('a-role');
  const lede = document.getElementById('apply-lede');

  wireForm(form, {
    url: '/api/applications',
    success: 'Thank you. Your application is with our people team.',
    validate: (v) => {
      const errors = {};
      if (!v.name || v.name.trim().length < 2) errors.name = 'Please enter your name.';
      if (!EMAIL_RE.test(v.email || '')) errors.email = 'Please enter a valid email address.';
      if (!v.message || v.message.trim().length < 20) errors.message = 'Tell us a little more (20+ characters).';
      return errors;
    },
  });

  const wanted = new URLSearchParams(window.location.search).get('role');
  if (select && wanted && Array.from(select.options).some((o) => o.value === wanted)) {
    select.value = wanted;
  }

  // The standfirst names the role being applied for, so the page confirms the
  // link was followed correctly before anyone starts typing.
  function describe() {
    if (!select || !lede) return;
    const id = select.value;
    if (!id) {
      lede.textContent = 'Tell us what you have run and where it got hard. A person on the team reads every application.';
      return;
    }
    fetchJSON('/api/careers')
      .then(({ roles }) => {
        const role = (roles || []).find((r) => r.id === id);
        if (role) lede.textContent = `${role.title} — ${role.team}, ${role.location}. ${role.summary}`;
      })
      .catch(() => {});
  }

  if (select) select.addEventListener('change', describe);
  describe();
})();
