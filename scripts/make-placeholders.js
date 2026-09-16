'use strict';

/**
 * Generates the placeholder artwork the site ships with.
 *
 * Every image on the site is a slot (see src/data/images.json): the build uses
 * the real photograph if one has been dropped into public/assets/img/, and one
 * of these SVGs until then. They are generated rather than hand-drawn so the
 * whole set stays on one palette, weighs a few kilobytes, and can be regenerated
 * after a brand change with `node scripts/make-placeholders.js`.
 *
 * Dropping in real photography does NOT mean editing this file — it means
 * adding, say, public/assets/img/hero-1.jpg and rebuilding.
 */

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'assets', 'img');

/* Brand navy, with the logo's oxide red as the one warm note. These stand in
   for photographs, so they are quiet on purpose: a placeholder that shouts is
   harder to notice you have not replaced. */
const PALETTES = {
  deep: ['#0a1830', '#0c1f3d', '#5f8cb8'],
  dusk: ['#091426', '#14294a', '#4d7fae'],
  steel: ['#0b1b33', '#173154', '#6f9cc4'],
  ember: ['#0e1526', '#2a1f28', '#a3583f'],
  sea: ['#071526', '#0d2138', '#4f93c4'],
};

/** A dense field of freight-manifest ticks, so the plate is never flat. */
function grid(id, tint) {
  return `
    <pattern id="${id}" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M48 0H0v48" fill="none" stroke="${tint}" stroke-opacity=".12" stroke-width="1"/>
      <circle cx="0" cy="0" r="1.4" fill="${tint}" fill-opacity=".3"/>
    </pattern>`;
}

/**
 * One plate: gradient ground, grid, a route arc and a caption.
 * @param {{w,h,palette,label,kicker,glyph}} spec
 */
function plate({ w = 1600, h = 1000, palette = 'deep', label = '', kicker = '', glyph = 'route' }) {
  const [c0, c1, accent] = PALETTES[palette] || PALETTES.deep;
  const cx = w / 2;
  const cy = h / 2;

  const glyphs = {
    route: `
      <path d="M${w * 0.12} ${h * 0.72} Q ${cx} ${h * 0.18} ${w * 0.88} ${h * 0.55}"
            fill="none" stroke="${accent}" stroke-opacity=".85" stroke-width="3" stroke-dasharray="14 10"/>
      <circle cx="${w * 0.12}" cy="${h * 0.72}" r="13" fill="${accent}"/>
      <circle cx="${w * 0.88}" cy="${h * 0.55}" r="13" fill="none" stroke="${accent}" stroke-width="3"/>
      <circle cx="${cx}" cy="${h * 0.353}" r="7" fill="#fff" fill-opacity=".9"/>`,
    box: `
      <g transform="translate(${cx} ${cy - 40})" stroke="${accent}" stroke-width="3" fill="none">
        <path d="M-150 -70 L0 -140 L150 -70 L0 0 Z" fill="${accent}" fill-opacity=".14"/>
        <path d="M-150 -70 V90 L0 160 V0 Z" fill="${accent}" fill-opacity=".07"/>
        <path d="M150 -70 V90 L0 160" />
      </g>`,
    wave: `
      <g fill="none" stroke="${accent}" stroke-width="3" stroke-opacity=".7">
        <path d="M0 ${cy + 60} q ${w / 8} -60 ${w / 4} 0 t ${w / 4} 0 t ${w / 4} 0 t ${w / 4} 0"/>
        <path d="M0 ${cy + 120} q ${w / 8} -60 ${w / 4} 0 t ${w / 4} 0 t ${w / 4} 0 t ${w / 4} 0" stroke-opacity=".4"/>
      </g>`,
    ship: `
      <g transform="translate(${cx} ${cy})" fill="none" stroke="${accent}" stroke-width="3" stroke-linejoin="round" stroke-opacity=".85">
        <path d="M-210 40 L-180 -10 L150 -10 L210 40 Z" fill="${accent}" fill-opacity=".12"/>
        <path d="M-150 -10 V-70 H-40 L-10 -10"/>
        <path d="M-120 -70 V-100"/>
        <rect x="10" y="-52" width="52" height="42" fill="${accent}" fill-opacity=".18"/>
        <rect x="72" y="-52" width="52" height="42" fill="${accent}" fill-opacity=".1"/>
        <path d="M-240 60 q 40 -18 80 0 t 80 0 t 80 0 t 80 0 t 80 0" stroke-opacity=".45"/>
      </g>`,
    globe: `
      <g fill="none" stroke="${accent}" stroke-width="2.5" stroke-opacity=".75" transform="translate(${cx} ${cy})">
        <circle r="230"/><ellipse rx="230" ry="90"/><ellipse rx="230" ry="170"/>
        <ellipse rx="90" ry="230"/><ellipse rx="170" ry="230"/>
        <line x1="-230" y1="0" x2="230" y2="0"/>
      </g>`,
  };

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${label || 'Paramount Shipping placeholder'}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c0}"/>
      <stop offset="1" stop-color="${c1}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.7" cy="0.25" r="0.8">
      <stop offset="0" stop-color="${accent}" stop-opacity=".3"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    ${grid('grid', accent)}
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <rect width="${w}" height="${h}" fill="url(#grid)"/>
  <rect width="${w}" height="${h}" fill="url(#glow)"/>
  ${glyphs[glyph] || glyphs.route}
  <g font-family="'Space Grotesk',Inter,system-ui,sans-serif" fill="#f8fafc">
    ${kicker ? `<text x="64" y="${h - 96}" font-size="22" letter-spacing="6" fill="${accent}" opacity=".95">${kicker.toUpperCase()}</text>` : ''}
    ${label ? `<text x="64" y="${h - 44}" font-size="44" font-weight="600" opacity=".92">${label}</text>` : ''}
  </g>
  <rect x="1" y="1" width="${w - 2}" height="${h - 2}" fill="none" stroke="${accent}" stroke-opacity=".22" stroke-width="2"/>
</svg>
`;
}

const SET = [
  ['ph-hero-1.svg', { palette: 'deep', kicker: 'Placeholder', label: 'Container ship at first light', glyph: 'ship', w: 1920, h: 1080 }],
  ['ph-hero-2.svg', { palette: 'dusk', kicker: 'Placeholder', label: 'Terminal at blue hour', glyph: 'wave', w: 1920, h: 1080 }],
  ['ph-hero-3.svg', { palette: 'sea', kicker: 'Placeholder', label: 'Bridge wing, looking forward', glyph: 'route', w: 1920, h: 1080 }],
  ['ph-underlay.svg', { palette: 'deep', glyph: 'globe', w: 1920, h: 1200 }],
  ['ph-network.svg', { palette: 'sea', kicker: 'Placeholder', label: 'Global network', glyph: 'globe' }],
  ['ph-about.svg', { palette: 'steel', kicker: 'Placeholder', label: 'Operations desk', glyph: 'route' }],
  ['ph-control.svg', { palette: 'dusk', kicker: 'Placeholder', label: 'Live exception desk', glyph: 'route' }],
  ['ph-leadership.svg', { palette: 'steel', kicker: 'Placeholder', label: 'Group Chief Executive', glyph: 'box', w: 1200, h: 1400 }],
  ['ph-careers.svg', { palette: 'ember', kicker: 'Placeholder', label: 'Working at Paramount', glyph: 'box' }],
  ['ph-contact.svg', { palette: 'deep', kicker: 'Placeholder', label: 'Rotterdam desk', glyph: 'route' }],
  ['ph-warehouse.svg', { palette: 'steel', kicker: 'Placeholder', label: 'Bonded warehousing', glyph: 'box' }],
  ['ph-air.svg', { palette: 'dusk', kicker: 'Air freight', label: 'Placeholder artwork', glyph: 'route', w: 1200, h: 900 }],
  ['ph-ocean.svg', { palette: 'sea', kicker: 'Ocean freight', label: 'Placeholder artwork', glyph: 'ship', w: 1200, h: 900 }],
  ['ph-road.svg', { palette: 'steel', kicker: 'Road haulage', label: 'Placeholder artwork', glyph: 'box', w: 1200, h: 900 }],
  ['ph-rail.svg', { palette: 'deep', kicker: 'Rail freight', label: 'Placeholder artwork', glyph: 'route', w: 1200, h: 900 }],
  ['ph-express.svg', { palette: 'ember', kicker: 'Express courier', label: 'Placeholder artwork', glyph: 'box', w: 1200, h: 900 }],
  ['ph-og.svg', { palette: 'deep', kicker: 'Paramount Shipping', label: 'Track every consignment', glyph: 'globe', w: 1200, h: 630 }],
];

fs.mkdirSync(OUT, { recursive: true });
SET.forEach(([name, spec]) => {
  fs.writeFileSync(path.join(OUT, name), plate(spec), 'utf8');
});
console.log(`[placeholders] wrote ${SET.length} files to public/assets/img`);
