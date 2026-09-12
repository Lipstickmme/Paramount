'use strict';

/* The services index. Each discipline is a row that opens its own page. */
(function () {
  const M = window.MERKEL; if (!M) return;
  const wrap = document.getElementById('service-index');
  if (!wrap) return;
  const esc = M.esc;

  const row = (s) => `
    <a class="service-row" href="/services/${esc(s.id)}" data-reveal>
      <div class="service-row-media"><img src="${esc(s.image)}" alt="" loading="lazy" decoding="async" /></div>
      <div class="service-row-body">
        <span class="code">${esc(s.code)}</span>
        <h2>${esc(s.title)}</h2>
        <p>${esc(s.summary)}</p>
        <ul>${(s.capabilities || []).slice(0, 4).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
      </div>
      <span class="service-row-go" aria-hidden="true">&rsaquo;</span>
    </a>`;

  (async () => {
    let services = [];
    try { const d = await M.fetchJSON('/api/services'); services = d.services || []; } catch (e) {}
    if (!services.length) {
      wrap.innerHTML = '<p class="admin-empty">Services are loading from the API. Refresh in a moment.</p>';
      return;
    }
    wrap.innerHTML = services.map(row).join('');
    M.observeReveals();
  })();
})();
