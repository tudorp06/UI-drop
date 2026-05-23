// ============================================================
// UIDrop — content.js
// Runs INSIDE the visited page. Scrapes design tokens AND
// component-level styles. Pulls colors from rendered interactive
// elements (buttons, links, CTAs) and gradients, not just CSS rules.
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'scrapeCSS') {
    sendResponse({ tokens: scrapeDesignTokens() });
    return true;
  }
});

// Fonts that are system-fallback noise, not design choices
const SYSTEM_FONTS = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'inherit', 'initial', 'unset', 'revert',
  'system-ui', '-apple-system', 'BlinkMacSystemFont',
  '-apple-system-body', '-apple-system-headline', '-apple-system-subheadline',
  '-apple-system-caption1', '-apple-system-caption2', '-apple-system-footnote',
  '-apple-system-callout', '-apple-system-title1', '-apple-system-title2', '-apple-system-title3',
  'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded',
  'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'
]);

function scrapeDesignTokens() {

  const body    = document.body;
  const heading = document.querySelector('h1, h2') || body;
  const para    = document.querySelector('p')      || body;
  const nav     = document.querySelector('nav, header') || body;

  const bodyStyle    = getComputedStyle(body);
  const headingStyle = getComputedStyle(heading);
  const paraStyle    = getComputedStyle(para);
  const navStyle     = getComputedStyle(nav);

  // ── FONTS ──
  // Walk each font stack and skip leading system-fallback entries so
  // we report the actual design intent.
  const fonts = [
    pickIntentFont(headingStyle.fontFamily),
    pickIntentFont(paraStyle.fontFamily),
    pickIntentFont(bodyStyle.fontFamily)
  ].filter(Boolean);
  const uniqueFonts = [...new Set(fonts)].slice(0, 4);

  // ── COLORS ──
  // CRITICAL: only count colors actually APPLIED to rendered elements
  // (via getComputedStyle). Do NOT scrape hex codes from stylesheet rule
  // text — frameworks like Tailwind/Bootstrap ship hundreds of unused
  // color hexes in their CSS, and those would pollute the palette with
  // colors nothing on the page actually displays.
  //
  // We use a frequency Map so "primary" can be the most-USED brand color,
  // not just the most saturated one (which might be a single tiny icon).
  const colorCounts = new Map();
  // Separate stream for colors that appear on INTERACTIVE SURFACES
  // (button backgrounds, saturated link bgs). These represent brand identity.
  const interactiveColors = new Map();

  const bump = (c, weight = 1) => {
    const hex = colorOrNull(c);
    if (hex) colorCounts.set(hex, (colorCounts.get(hex) || 0) + weight);
  };
  // Track the LARGEST single button per color, not aggregate frequency.
  // Brand primary lives on one prominent CTA — not spread across many small
  // elements. Picking by max-area-per-color generalizes across all sites:
  // it lets a single hero button beat a hundred scattered link-sized chips.
  const bumpInteractive = (hex, weight) => {
    if (!hex) return;
    const current = interactiveColors.get(hex) || 0;
    if (weight > current) interactiveColors.set(hex, weight);
  };

  // Structural colors (always count, they're foundational)
  bump(bodyStyle.backgroundColor, 5);
  bump(bodyStyle.color, 5);
  bump(navStyle.backgroundColor, 3);
  bump(navStyle.color, 3);
  bump(headingStyle.color, 3);

  scrapeInteractiveColors(colorCounts, bump, bumpInteractive);
  scrapeSvgColors(colorCounts, bump);
  scrapeSaturatedColors(colorCounts, bump);

  // Gradients applied to actual rendered elements (not just CSS rule text)
  const gradientStops = scrapeUsedGradients();

  // ── COMPONENT SCRAPING ──
  // Buttons: prefer the primary CTA (saturated background) over the first
  // visible button in DOM order. Sites typically have several button styles
  // (primary/secondary/ghost) — the one with a filled saturated bg represents
  // the design system's primary action, which is what we want to report.
  const button = scrapePreferredButton();

  const card = scrapeComponent(
    '[class*="card" i], article, [class*="panel" i], [class*="tile" i]',
    el => {
      if (!isVisible(el)) return false;
      // Real cards are bounded width — not full-width hero sections
      if (el.offsetWidth < 120 || el.offsetWidth > 720) return false;
      if (el.offsetHeight < 60 || el.offsetHeight > 900) return false;
      // Real cards have a visual container — bg, border, or shadow
      const s = getComputedStyle(el);
      const hasBg = s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent';
      const hasBorder = s.borderTopWidth !== '0px' && s.borderTopStyle !== 'none';
      const hasShadow = s.boxShadow && s.boxShadow !== 'none';
      return hasBg || hasBorder || hasShadow;
    }
  );

  const input = scrapeComponent(
    'input[type="text"], input[type="email"], input[type="search"], input:not([type]), textarea',
    el => isVisible(el)
  );

  const link = scrapeComponent(
    'a:not(.btn):not([class*="button"]):not([role="button"])',
    el => isVisible(el) && (el.textContent?.trim().length || 0) > 0
  );

  // Promote component colors back into the palette pool so they're
  // available when we derive surface/elevated roles
  [button, card, input, link].forEach(c => {
    if (!c) return;
    [c.bg, c.color].forEach(v => v && bump(v, 2));
  });

  // ── TYPE SCALE ──
  // Count font-size frequency across many elements, then pick
  // hero (largest), body (most common), and a mid-point that exists.
  const typeScale = deriveTypeScale();

  // ── LINE-HEIGHT (body text "feel" — tight vs breathy) ──
  const bodyLineHeight = normalizeLineHeight(paraStyle.lineHeight, paraStyle.fontSize);

  // ── SHADOW ELEVATION SCALE (depth language) ──
  const shadowScale = scrapeShadowScale();

  // ── DOMINANT BORDER COLOR (neutral hairlines used across the page) ──
  const borderColor = scrapeDominantBorderColor();

  // ── ICON STROKE WIDTH (sets the whole visual weight of UI iconography) ──
  const iconStroke = scrapeIconStrokeWidth();

  // Sort by frequency (most-used first). Downstream code treats earlier
  // colors as more important when picking primary / accent.
  const sortedByWeight = [...colorCounts.entries()].sort((a, b) => b[1] - a[1]);
  const colorsByUse = sortedByWeight.map(([hex]) => hex).slice(0, 40);
  // Expose weights too — derivePalette uses these to detect monochrome
  // sites (where the strongest saturated color is dwarfed by neutrals).
  const colorsWithWeights = sortedByWeight.slice(0, 40);

  const interactiveByUse = [...interactiveColors.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([hex]) => hex)
    .slice(0, 12);

  return {
    fonts:             uniqueFonts,
    colors:            colorsByUse,
    colorsWithWeights,
    interactiveColors: interactiveByUse,
    gradients:         gradientStops.slice(0, 4),
    fontSizes:         typeScale,
    bodyLineHeight,
    shadowScale,
    borderColor,
    iconStroke,
    isDark:            detectPageIsDark(),
    siteName:          window.location.hostname.replace('www.', ''),
    pageTitle:         document.title,
    components:        { button, card, input, link }
  };
}

// Class-name-like words sometimes leak into font stacks as bare identifiers
// (e.g. font-family: "Source Sans Pro", Topnav, sans-serif). They're never
// real fonts, just CSS-author hints. Strip them from the candidate name.
const NOT_FONT_WORDS = new Set([
  'topnav', 'sidenav', 'sidebar', 'header', 'footer', 'main', 'content',
  'container', 'wrapper', 'banner', 'menu', 'nav', 'navigation',
  'card', 'panel', 'section', 'page', 'body', 'heading'
]);

// ── Skip system-fallback fonts at the head of a stack, return the intent ──
// Also strip class-name-like suffixes baked into custom font names
// (e.g. "Source Sans Pro Topnav" → "Source Sans Pro").
function pickIntentFont(stack) {
  if (!stack) return null;
  const tokens = stack.split(',').map(f => f.trim().replace(/['"]/g, ''));
  for (const t of tokens) {
    if (!SYSTEM_FONTS.has(t)) {
      const cleaned = stripNonFontWords(t);
      if (cleaned) return cleaned;
    }
  }
  return null;
}

function stripNonFontWords(name) {
  const words = name.split(/\s+/).filter(w => !NOT_FONT_WORDS.has(w.toLowerCase()));
  return words.join(' ').trim();
}

// ── Sweep interactive elements for their rendered brand colors ──
function scrapeInteractiveColors(colorCounts, bump, bumpInteractive) {
  // Use ONLY semantically-interactive selectors. The previous list included
  // [class*="primary"], [class*="accent"], [class*="cta"], [class*="btn"]
  // — which matches any element whose class contains those substrings,
  // including non-interactive utility classes like "accent-yellow" or
  // "primary-text" on spans, dots, and status badges. That polluted the
  // brand-color signal on sites with CSS-module or utility-first naming.
  const selectors = [
    'button:not([disabled])',
    'a[href]',
    '[role="button"]',
    'input[type="submit"]',
    'input[type="button"]'
  ];
  const seen = new Set();
  selectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      if (seen.has(el) || !isVisible(el)) return;
      seen.add(el);
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const weight = Math.max(1, Math.round(Math.sqrt(r.width * r.height) / 20));
      bump(s.backgroundColor, weight);
      bump(s.color, weight);
      bump(s.borderTopColor, 1);

      // Record SATURATED background colors of interactive elements separately.
      // These are the strongest signal for "brand color" we can find on a page,
      // because by definition they're filled surfaces a user is meant to click.
      // Tiny elements skipped (icons, dots) — we want real button-sized areas.
      if (r.width >= 60 && r.height >= 28) {
        const bgHex = colorOrNull(s.backgroundColor);
        if (bgHex && isHexSaturated(bgHex, 0.30)) {
          bumpInteractive(bgHex, weight);
        }
      }
    });
  });
}

// ── SVG fill/stroke colors (where modern brand colors often hide) ──
function scrapeSvgColors(colorCounts, bump) {
  let count = 0;
  document.querySelectorAll('svg, svg *').forEach(el => {
    if (count >= 200) return;
    if (!isVisible(el)) return;
    count++;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const weight = Math.max(1, Math.round(Math.sqrt(r.width * r.height) / 30));
    bump(s.fill, weight);
    bump(s.stroke, 1);
  });
}

// ── Aggressive sweep: every visible decent-sized element. Weight by area
//    so a 200×60 button beats a 16×16 icon for "most-used color".
function scrapeSaturatedColors(colorCounts, bumpSweep) {
  let sampled = 0;
  const all = document.querySelectorAll('*');
  for (let i = 0; i < all.length && sampled < 800; i++) {
    const el = all[i];
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 16 || r.height < 16) continue;
    sampled++;
    const weight = Math.max(1, Math.round(Math.sqrt(r.width * r.height) / 40));

    const s = getComputedStyle(el);
    [s.backgroundColor, s.color, s.borderTopColor, s.outlineColor].forEach(c => {
      const hex = colorOrNull(c);
      if (hex && isHexSaturated(hex, 0.25)) {
        bumpSweep(c, weight);
      }
    });
  }
}

// ── Normalize line-height: returns ratio like "1.5" or null ──
// Computed `lineHeight` is either "normal", an absolute px value, or unitless ratio.
// We always want the unitless ratio for design briefs.
function normalizeLineHeight(lineHeight, fontSize) {
  if (!lineHeight || lineHeight === 'normal') return null;
  const lhPx = parseFloat(lineHeight);
  const fsPx = parseFloat(fontSize);
  if (!lhPx || !fsPx) return null;
  const ratio = lhPx / fsPx;
  if (ratio < 0.9 || ratio > 2.5) return null;
  return ratio.toFixed(2).replace(/\.?0+$/, '');
}

// ── Shadow elevation scale ──
// Walk likely "elevated" containers (cards, modals, popovers, headers),
// dedupe their box-shadows, return the top 3 most-used distinct values.
// This gives the AI the page's depth language, not just one shadow.
function scrapeShadowScale() {
  const candidates = document.querySelectorAll(
    '[class*="card" i], [class*="modal" i], [class*="dialog" i], ' +
    '[class*="popover" i], [class*="tooltip" i], [class*="dropdown" i], ' +
    '[class*="menu" i], [class*="panel" i], header, nav, aside'
  );
  const counts = new Map();
  candidates.forEach(el => {
    if (!isVisible(el)) return;
    const sh = getComputedStyle(el).boxShadow;
    if (!sh || sh === 'none') return;
    const compressed = compressShadow(sh);
    counts.set(compressed, (counts.get(compressed) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([s]) => s);
}

// ── Dominant neutral border color used as page-wide hairlines ──
function scrapeDominantBorderColor() {
  const counts = new Map();
  let sampled = 0;
  const all = document.querySelectorAll('*');
  for (let i = 0; i < all.length && sampled < 600; i++) {
    const el = all[i];
    if (!isVisible(el)) continue;
    const s = getComputedStyle(el);
    if (s.borderTopStyle === 'none' || s.borderTopWidth === '0px') continue;
    sampled++;
    const hex = colorOrNull(s.borderTopColor);
    if (!hex) continue;
    if (saturationOfHex(hex) >= 0.20) continue;  // brand-colored borders excluded
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  if (!counts.size) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

// ── Most-used icon stroke-width (sets visual weight of UI iconography) ──
function scrapeIconStrokeWidth() {
  const widths = new Map();
  document.querySelectorAll('svg').forEach(svg => {
    if (!isVisible(svg)) return;
    const r = svg.getBoundingClientRect();
    if (r.width < 12 || r.width > 32) return;  // icon-sized only
    const candidates = [
      svg.getAttribute('stroke-width'),
      getComputedStyle(svg).strokeWidth,
      svg.querySelector('[stroke-width]')?.getAttribute('stroke-width')
    ].filter(Boolean);
    for (const c of candidates) {
      const num = parseFloat(c);
      if (num > 0 && num <= 4) {
        widths.set(num, (widths.get(num) || 0) + 1);
        break;
      }
    }
  });
  if (!widths.size) return null;
  const [n] = [...widths.entries()].sort((a, b) => b[1] - a[1])[0];
  return `${n}px stroke`;
}

// ── Scrape gradients that are ACTUALLY APPLIED to rendered elements ──
// Only walk visible elements whose backgroundImage is a gradient. This
// excludes gradient definitions that exist in CSS but nothing on the page uses.
function scrapeUsedGradients() {
  const stops = [];
  const seen = new Set();
  let sampled = 0;
  const all = document.querySelectorAll('*');
  for (let i = 0; i < all.length && sampled < 400 && stops.length < 4; i++) {
    const el = all[i];
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 20) continue;

    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || !bg.includes('gradient(')) continue;
    if (seen.has(bg)) continue;
    seen.add(bg);
    sampled++;

    const parsed = extractGradientStops(bg);
    if (parsed.length >= 2 && gradientHasMeaningfulSpread(parsed)) {
      stops.push(parsed.slice(0, 3));
    }
  }
  return stops;
}

// Reject "gradients" that are two near-identical near-white (or near-black)
// shades — they're not brand moments, just subtle surface treatments.
function gradientHasMeaningfulSpread(stops) {
  if (stops.length < 2) return false;
  for (let i = 0; i < stops.length - 1; i++) {
    if (colorDistance(stops[i], stops[i + 1]) > 30) return true;
  }
  return false;
}

function colorDistance(hex1, hex2) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex1) || !/^#[0-9a-fA-F]{6}$/.test(hex2)) return 0;
  const r1 = parseInt(hex1.slice(1, 3), 16), g1 = parseInt(hex1.slice(3, 5), 16), b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16), g2 = parseInt(hex2.slice(3, 5), 16), b2 = parseInt(hex2.slice(5, 7), 16);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

// ── Extract gradient stops as ordered list of hex/rgba colors ──
function extractGradientStops(gradientStr) {
  const out = [];
  const hex = gradientStr.match(/#[0-9a-fA-F]{6}/g) || [];
  hex.forEach(h => out.push(h.toUpperCase()));
  const rgbs = gradientStr.match(/rgba?\([^)]+\)/g) || [];
  rgbs.forEach(rgb => {
    const h = rgbToHex(rgb);
    if (h) out.push(h);
  });
  return [...new Set(out)];
}

function isHexSaturated(hex, threshold) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return false;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return false;
  return (max - min) / max > threshold;
}

// ── Type scale by frequency + clustering ──
// Cluster sizes that are within ~15% of each other (16 and 17 are the same
// design step, not two separate ones). Pick scale steps from distinct clusters.
function deriveTypeScale() {
  const counts = new Map();
  const els = document.querySelectorAll('h1, h2, h3, h4, p, span, div, li, a, button');
  let sampled = 0;
  for (const el of els) {
    if (sampled >= 400) break;
    if (!isVisible(el)) continue;
    const size = parseInt(getComputedStyle(el).fontSize);
    if (size >= 10 && size <= 200) {
      counts.set(size, (counts.get(size) || 0) + 1);
      sampled++;
    }
  }
  if (!counts.size) return [];

  // Build clusters: walk sizes ascending; a new size joins the last cluster
  // if it's within 15% of the cluster's max, else starts a new cluster.
  const ascending = [...counts.keys()].sort((a, b) => a - b);
  const clusters = [];
  for (const size of ascending) {
    const last = clusters[clusters.length - 1];
    if (!last || (size - last.max) / last.max > 0.15) {
      clusters.push({ min: size, max: size, count: counts.get(size), rep: size });
    } else {
      last.max = size;
      last.count += counts.get(size);
      // Cluster representative = most-used size in the cluster
      if (counts.get(size) > (counts.get(last.rep) || 0)) last.rep = size;
    }
  }

  // Body = heaviest cluster representative, but clamp to a plausible
  // body range (10–22px). Hero text is never "body" even if it's the
  // most repeated cluster on a thin landing page.
  const bodyCandidates = clusters.filter(c => c.rep >= 10 && c.rep <= 22);
  const bodyCluster = bodyCandidates.length
    ? bodyCandidates.reduce((a, b) => a.count > b.count ? a : b)
    : clusters.reduce((a, b) => a.count > b.count ? a : b);
  // Hero = largest cluster
  const heroCluster = clusters[clusters.length - 1];
  // Mid = heaviest cluster strictly between body × 1.25 and hero × 0.75
  const midCluster = clusters
    .filter(c => c !== bodyCluster && c !== heroCluster
                 && c.rep > bodyCluster.rep * 1.25
                 && c.rep < heroCluster.rep * 0.75)
    .reduce((a, b) => !a || b.count > a.count ? b : a, null);

  const body = bodyCluster.rep;
  const hero = heroCluster.rep;
  // Geometric midpoint when no real cluster exists between them
  const mid = midCluster ? midCluster.rep : Math.round(Math.sqrt(body * hero));

  // If body == hero (single-cluster page) just return what we have
  if (body === hero) return [`${hero}px`];
  return [`${hero}px`, `${mid}px`, `${body}px`];
}

// ── Specialized button picker: prefer a primary CTA with a saturated bg ──
function scrapePreferredButton() {
  const candidates = Array.from(document.querySelectorAll(
    'button:not([disabled]):not([aria-hidden="true"]), a.btn, a[class*="button"], [role="button"]'
  )).filter(el => isVisible(el) && el.offsetWidth >= 60 && el.offsetWidth <= 400 && el.offsetHeight >= 28);

  if (!candidates.length) return null;

  // First choice: a button with a SATURATED background — that's a primary CTA
  const ranked = candidates
    .map(el => {
      const s = getComputedStyle(el);
      const bgHex = colorOrNull(s.backgroundColor);
      const sat = bgHex && /^#[0-9a-fA-F]{6}$/.test(bgHex) ? saturationOfHex(bgHex) : 0;
      return { el, sat, area: el.offsetWidth * el.offsetHeight };
    })
    .filter(c => c.sat > 0.30)
    .sort((a, b) => (b.sat * b.area) - (a.sat * a.area));

  const pick = ranked[0]?.el || candidates[0];
  return readComponentStyles(pick);
}

function saturationOfHex(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function readComponentStyles(el) {
  const s = getComputedStyle(el);
  return {
    bg:            colorOrNull(s.backgroundColor),
    color:         colorOrNull(s.color),
    border:        simplifyBorder(s.borderTopWidth, s.borderTopStyle, s.borderTopColor),
    radius:        s.borderRadius === '0px' ? null : s.borderRadius,
    padding:       compressBox(s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft),
    fontSize:      s.fontSize,
    fontWeight:    s.fontWeight,
    textTransform: s.textTransform !== 'none' ? s.textTransform : null,
    shadow:        s.boxShadow !== 'none' ? compressShadow(s.boxShadow) : null
  };
}

// ── Generic component scraper (used for card, input, link) ──
function scrapeComponent(selector, filter) {
  const candidates = Array.from(document.querySelectorAll(selector));
  const valid = candidates.filter(c => {
    try { return filter ? filter(c) : true; } catch { return false; }
  });
  // Pick the largest by area — real components (cards, inputs) are bigger than decorative chips
  const el = valid.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight))[0]
    || candidates[0];

  if (!el) return null;
  const s = getComputedStyle(el);

  return {
    bg:            colorOrNull(s.backgroundColor),
    color:         colorOrNull(s.color),
    border:        simplifyBorder(s.borderTopWidth, s.borderTopStyle, s.borderTopColor),
    radius:        s.borderRadius === '0px' ? null : s.borderRadius,
    padding:       compressBox(s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft),
    fontSize:      s.fontSize,
    fontWeight:    s.fontWeight,
    textTransform: s.textTransform !== 'none' ? s.textTransform : null,
    shadow:        s.boxShadow !== 'none' ? compressShadow(s.boxShadow) : null
  };
}

// ── Helpers ──
function isVisible(el) {
  const s = getComputedStyle(el);
  return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetWidth > 0 && el.offsetHeight > 0;
}

function colorOrNull(c) {
  if (!c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent') return null;
  return rgbToHex(c);
}

function simplifyBorder(w, style, color) {
  if (w === '0px' || style === 'none') return null;
  return `${w} ${style} ${colorOrNull(color) || color}`;
}

function compressBox(t, r, b, l) {
  if (t === r && r === b && b === l) return t;
  if (t === b && l === r) return `${t} ${r}`;
  return `${t} ${r} ${b} ${l}`;
}

function compressShadow(s) {
  return s.split(/,(?![^()]*\))/)[0].trim();
}

function rgbToHex(rgb) {
  if (!rgb) return null;
  if (rgb.startsWith('#')) return rgb.toUpperCase();
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) return null;
  const [r, g, b] = m.map(Number);
  if (m[3] !== undefined && Number(m[3]) === 0) return null;  // fully transparent
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function isColorDark(rgb) {
  if (!rgb) return false;
  const m = rgb.match(/\d+/g);
  if (!m) return false;
  const [r, g, b] = m.map(Number);
  return ((0.299 * r + 0.587 * g + 0.114 * b) / 255) < 0.5;
}

// ── Robust dark-mode detection ──
// `body.backgroundColor` is often `rgba(0,0,0,0)` (transparent), which naïvely
// reads as "dark" because 0,0,0 luminance = 0. Instead: sample several
// structural elements, walk up through transparent ancestors to find the real
// rendered surface, and tally area-weighted votes for light vs dark.
function detectPageIsDark() {
  // The page background is what fills the viewport everywhere a child doesn't
  // paint over it. That defines the page mode — not hero illustrations,
  // absolutely-positioned dark sections, or chromatic decoration on top.
  // Trust the rendered <html>/<body> background first; decoration is decoration.
  const htmlBgDark = isOpaqueBgDark(getComputedStyle(document.documentElement).backgroundColor);
  if (htmlBgDark !== null) return htmlBgDark;
  const bodyBgDark = isOpaqueBgDark(getComputedStyle(document.body).backgroundColor);
  if (bodyBgDark !== null) return bodyBgDark;

  // Both html and body are transparent — walk up from <main> to find any opaque bg.
  const main = document.querySelector('main, [role="main"], #main, .main, #content, .content');
  if (main) {
    const rgb = walkUpForBackground(main);
    if (rgb) {
      return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 <= 0.5;
    }
  }
  return false;
}

// True if color is opaque AND dark; false if opaque AND light; null if transparent.
function isOpaqueBgDark(c) {
  if (!c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent') return null;
  const m = c.match(/[\d.]+/g);
  if (!m || m.length < 3) return null;
  const alpha = m[3] !== undefined ? Number(m[3]) : 1;
  if (alpha < 0.5) return null;
  const luma = (0.299 * Number(m[0]) + 0.587 * Number(m[1]) + 0.114 * Number(m[2])) / 255;
  return luma <= 0.5;
}

// Walk up parent chain until a non-transparent backgroundColor is found.
// Returns [r, g, b] or null.
function walkUpForBackground(el) {
  let node = el;
  while (node && node !== document) {
    const c = getComputedStyle(node).backgroundColor;
    if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') {
      const m = c.match(/[\d.]+/g);
      if (m && m.length >= 3 && (m[3] === undefined || Number(m[3]) > 0.5)) {
        return [Number(m[0]), Number(m[1]), Number(m[2])];
      }
    }
    node = node.parentElement;
  }
  return null;
}
