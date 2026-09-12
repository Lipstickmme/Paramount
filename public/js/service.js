'use strict';

/**
 * Service detail page.
 *
 * The id comes from the path (/services/air-freight), so one built page serves
 * all six. Content is fetched from /api/services/:id; a service that no longer
 * exists gets an honest message rather than an empty layout.
 */
(function () {
  const { $, $$, esc, fetchJSON } = window.PARAMOUNT || {};
  const root = document.querySelector('[data-service-detail]');
  if (!root || !fetchJSON) return;

  const id = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() || '');
  const set = (key, html) => {
    const node = root.querySelector(`[data-svc="${key}"]`);
    if (node) node.innerHTML = html;
  };

  const check =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>';

  (async () => {
    try {
      const svc = await fetchJSON(`/api/services/${encodeURIComponent(id)}`);

      document.title = `${svc.title} | Paramount Logistics`;
      set('title', esc(svc.title));
      set('code', `${esc(svc.code)} · ${esc(svc.tagline)}`);
      set('heading', esc(svc.title));
      set('summary', esc(svc.summary));
      set('detail', esc(svc.detail || svc.summary));
      set('capabilities', (svc.capabilities || []).map((c) => `<li>${check}<span>${esc(c)}</span></li>`).join(''));
      set(
        'metrics',
        (svc.metrics || [])
          .map((m) => `<div class="stat"><b>${esc(m.value)}</b><span>${esc(m.label)}</span></div>`)
          .join('')
      );

      const image = root.querySelector('[data-svc="image"]');
      if (image) image.alt = svc.title;

      const { services } = await fetchJSON('/api/services');
      set(
        'others',
        services
          .filter((s) => s.id !== svc.id)
          .slice(0, 3)
          .map(
            (s, i) => `
        <article class="card tilt step" data-tilt data-reveal style="--delay:${i * 60}ms">
          <span class="n">${esc(s.code)}</span>
          <h3>${esc(s.title)}</h3>
          <p>${esc(s.summary)}</p>
          <a class="link" href="/services/${esc(s.id)}">Explore <span class="arw">&rsaquo;</span></a>
        </article>`
          )
          .join('')
      );

      if (window.PARAMOUNT_OBSERVE) window.PARAMOUNT_OBSERVE(root);
    } catch (err) {
      set('heading', 'That service is not one of ours');
      set(
        'summary',
        'The link may be out of date. <a class="link" href="/services">See every service we run</a>.'
      );
    }
  })();
})();
