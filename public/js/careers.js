'use strict';

(function () {
  const M = window.MERKEL; if (!M) return;
  const wrap = document.getElementById('roles');
  if (!wrap) return;
  const esc = M.esc;
  const FALLBACK = [
    { id: 'senior-structural', title: 'Senior Structural Engineer', team: 'Structural', location: 'Studio', type: 'Full time', summary: 'Lead the structural design of tall buildings and long-span structures from concept through to site.' },
    { id: 'bridge-engineer', title: 'Bridge Engineer', team: 'Civil & Infrastructure', location: 'Site based', type: 'Full time', summary: 'Design bridges and marine structures for demanding wind and durability requirements.' }
  ];

  const role = (r) => `
    <div class="role" data-reveal>
      <div>
        <div class="team">${esc(r.team)}</div>
        <h3>${esc(r.title)}</h3>
        <p class="role-sum">${esc(r.summary)}</p>
      </div>
      <div class="role-meta">${esc(r.location)}<br>${esc(r.type)}</div>
      <a class="apply" href="/apply?role=${encodeURIComponent(r.id)}">Apply <span class="arw">&rsaquo;</span></a>
    </div>`;

  (async () => {
    let roles = FALLBACK;
    try { const d = await M.fetchJSON('/api/careers'); roles = d.roles || FALLBACK; } catch (e) {}
    wrap.innerHTML = roles.map(role).join('');
    M.observeReveals();
  })();
})();
