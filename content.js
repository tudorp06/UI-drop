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
      const s = getComputedStyle(el);
      // Reject layout containers: real cards don't have > 60px vertical padding.
      // Alistair-style hero sections report padding like "156.8px 0" which is clearly a section.
      if (parseFloat(s.paddingTop) > 60 || parseFloat(s.paddingBottom) > 60) return false;
      // Real cards have a visual container — bg, border, or shadow
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
    el => isVisible(el)
       && (el.textContent?.trim().length || 0) > 2
       && !el.querySelector('img, canvas, video, picture, iframe')
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

  // Expose the actual computed page background so derivePalette can anchor
  // surface to it rather than relying solely on frequency ordering.
  // Kriss (dusty rose), Lusion (lavender), Pika (cream) all have tinted bgs
  // that lose to white card elements in frequency but ARE the real surface.
  const htmlBg = colorOrNull(getComputedStyle(document.documentElement).backgroundColor);
  const bodyBgRaw = colorOrNull(bodyStyle.backgroundColor);
  const pageBg = htmlBg || bodyBgRaw || null;

  // ── Deep extraction layers ───────────────────────────────────
  const cssVars             = scrapeCSSVariables();
  const typographyHierarchy = scrapeTypographyHierarchy();
  const motion              = scrapeMotionTokens();
  const breakpoints         = scrapeBreakpoints();

  // ── Extension-exclusive layers ───────────────────────────────
  // These require live browser access — no static scraper can do them.

  // Actual rendered layout geometry: max content width + dominant gutter.
  // Derived from getBoundingClientRect() on containers, not from CSS text.
  const layoutGrid          = scrapeLayoutGrid();

  // Complete spacing scale from every rendered gap/padding/margin on the
  // page — clustered into a clean design-system rhythm (e.g. 4/8/12/16/24/32).
  const spacingScale        = scrapeFullSpacingScale();

  // Focus ring styles captured by programmatically focusing real form
  // elements and reading their computed outline/shadow AFTER focus —
  // impossible without a live browser with DOM access.
  const focusStyles         = scrapeFocusRing();

  // Hover behaviour read from CSS rule text for :hover selectors on
  // interactive elements — extracts transforms, shadow deltas, opacity changes.
  const hoverBehaviour      = scrapeHoverBehaviour();

  // Page structure: which section types exist and in what order.
  const pageStructure       = scrapePageStructure();

  // Z-index stacking layers with semantic roles (nav/dropdown/modal etc.)
  const zIndexScale         = scrapeZIndexScale();

  // :active state transforms/opacity from CSS rules — completes the
  // interaction state picture alongside hover and focus.
  const activeStates        = scrapeActiveStates();

  // How components change inside @media rules at specific breakpoints.
  // E.g. "button goes full-width at 600px, font-size drops to 14px".
  const responsiveComponents = scrapeResponsiveComponents();

  // ── Phase 1: depth signals that don't copy the competitor ──
  // Framework detection (Tailwind / Material / shadcn / etc.) — single string
  const framework         = detectFramework();
  // Per-component radius vocabulary — what shape each component uses
  const radiusVocabulary  = scrapeRadiusVocabulary();
  // Design rhythm insights — pattern descriptors, not raw values
  const rhythm            = scrapeRhythm(spacingScale, button?.radius, shadowScale, bodyLineHeight, radiusVocabulary);

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
    pageBg,
    cssVars,
    typographyHierarchy,
    motion,
    breakpoints,
    layoutGrid,
    spacingScale,
    focusStyles,
    hoverBehaviour,
    pageStructure,
    zIndexScale,
    activeStates,
    responsiveComponents,
    framework,
    radiusVocabulary,
    rhythm,
    siteName:          window.location.hostname.replace('www.', ''),
    pageTitle:         document.title,
    components:        { button, card, input, link }
  };
}

// Class-name-like words and font-variant suffixes that leak into font names.
// "Source Sans Pro Topnav" → "Source Sans Pro"
// "Inter Variable" → "Inter", "geistNumbers" → "Geist"
const NOT_FONT_WORDS = new Set([
  'topnav', 'sidenav', 'sidebar', 'header', 'footer', 'main', 'content',
  'container', 'wrapper', 'banner', 'menu', 'nav', 'navigation',
  'card', 'panel', 'section', 'page', 'body', 'heading',
  // Font variant/axis descriptors that leak into family names
  'variable', 'numbers', 'display', 'caption', 'mono', 'condensed',
  'expanded', 'narrow', 'wide', 'fallback'
]);

// ── Skip system-fallback fonts at the head of a stack, return the intent ──
function pickIntentFont(stack) {
  if (!stack) return null;
  const tokens = stack.split(',').map(f => f.trim().replace(/['"]/g, ''));
  for (const t of tokens) {
    // Next.js mangles font-family strings: "__Inter_f367f3", "__Inter_Fallback_abc"
    // Extract the real name: strip the __ prefix and the _hash/_Fallback suffixes.
    if (/^__[A-Za-z]/.test(t)) {
      const realName = t
        .replace(/^__/, '')
        .replace(/_Fallback(?:_[a-f0-9]+)?$/i, '')
        .replace(/_[a-f0-9]{4,}$/i, '')
        .trim();
      if (realName && !SYSTEM_FONTS.has(realName)) return realName;
      continue;
    }
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

      // Record SATURATED colors of interactive elements separately.
      // These are the strongest signal for "brand color" we can find on a page.
      //
      // Primary signal: filled button backgrounds (strongest — user clicks a colored surface).
      // Secondary signal: gradient backgrounds on interactive elements.
      //   Many modern sites (Chronos, Stripe hero, etc.) use gradients as their
      //   primary brand surface — on CTAs, hero text, charts, logos. A gradient on
      //   a button is MORE "primary" than most flat colors because it's a deliberate
      //   brand moment. Extract its stops and promote them as interactive colors.
      // Tertiary signal: saturated TEXT color or BORDER color on interactive elements.
      if (r.width >= 60 && r.height >= 28) {
        const bgHex = colorOrNull(s.backgroundColor);
        if (bgHex && isHexSaturated(bgHex, 0.30)) {
          // Skip <a> elements wrapping media (thumbnails, illustrations, logos).
          const isMediaWrapper = el.tagName === 'A' &&
            !!el.querySelector('img, canvas, video, picture, iframe, svg[width][height]');
          if (!isMediaWrapper) {
            // Skip semi-transparent overlays — they're UI chrome, not brand identity.
            // Only rgba() colors carry an alpha channel; rgb() is always fully opaque.
            // IMPORTANT: do NOT run the alpha regex on rgb() strings — the regex
            // matches the last number before ")", which on "rgb(255, 100, 0)" is the
            // blue channel (0), not alpha. That would falsely exclude solid orange/red/green CTAs.
            // Threshold 0.9: excludes frosted-glass overlays like Linear's rgba(…, 0.85)
            // nav highlights while keeping essentially-solid brand buttons (alpha 0.9–1.0).
            const rawBg = s.backgroundColor;
            const alpha = rawBg.startsWith('rgba(')
              ? parseFloat(rawBg.match(/,\s*([\d.]+)\s*\)/)?.[1] ?? '1')
              : 1;
            if (alpha >= 0.9) {
              bumpInteractive(bgHex, weight);
            }
          }
        }

        // Gradient backgrounds on interactive elements — extract stops and promote.
        const bgImg = s.backgroundImage;
        if (bgImg && bgImg.includes('gradient(')) {
          const gStops = extractGradientStops(bgImg);
          gStops.forEach(stopHex => {
            if (isHexSaturated(stopHex, 0.25)) {
              bumpInteractive(stopHex, weight);
            }
          });
        }

        // Text color — only for styled button-like elements (has border OR button padding).
        // Plain <a> text links (blue underlined links on editorial sites) must NOT pollute
        // the brand-color signal — they're everywhere and would beat the actual CTA color.
        const textHex = colorOrNull(s.color);
        if (textHex && isHexSaturated(textHex, 0.35)) {
          const hasBorder = s.borderTopStyle !== 'none' && s.borderTopWidth !== '0px';
          const hasButtonPad = parseFloat(s.paddingTop) >= 4 && parseFloat(s.paddingLeft) >= 8;
          if (hasBorder || hasButtonPad) {
            bumpInteractive(textHex, Math.max(1, Math.floor(weight / 2)));
          }
        }
      }
      // Border accent on interactive elements — catches active nav indicators
      // (e.g. Render's purple left-border on active sidebar item).
      // Only borderLeft and borderBottom — common positions for active state indicators.
      // Size gate: only elements large enough to be real nav items or CTAs.
      // Tiny icon links (social icons, inline anchors) can have colored borders
      // without being a brand signal — excluding them prevents false positives on
      // monochrome sites.
      if (r.width >= 60 && r.height >= 20) {
        const borderHex = colorOrNull(s.borderLeftColor) || colorOrNull(s.borderBottomColor);
        if (borderHex && isHexSaturated(borderHex, 0.35)) {
          bumpInteractive(borderHex, 1);
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
    // color(display-p3 ...) / color(srgb ...) are wide-gamut formats that
    // our parser can't handle — skip them to avoid malformed shadow entries.
    if (sh.includes('color(display-p3') || sh.includes('color(srgb')) return;
    const compressed = compressShadow(sh);
    counts.set(compressed, (counts.get(compressed) || 0) + 1);
  });
  // Sort shadows by visual weight (low → high), not frequency.
  // Visual weight = blur-radius × opacity. This ensures "subtle" is actually
  // the lightest shadow and "strong" is the heaviest, regardless of which
  // appears most often in the DOM.
  return [...counts.keys()]
    .map(s => ({ shadow: s, weight: shadowVisualWeight(s) }))
    .filter(s => s.weight > 0)  // drop transparent / zero-blur non-shadows
    .sort((a, b) => a.weight - b.weight)
    .slice(0, 3)
    .map(s => s.shadow);
}

// Estimate visual weight of a box-shadow string.
// Parses "rgba(r,g,b,a) Xpx Ypx Zpx Wpx" and returns blur × opacity.
// Higher = visually stronger shadow.
function shadowVisualWeight(shadow) {
  const alphaMatch = shadow.match(/[\d.]+\s*\)/g);
  let alpha = 1;
  if (alphaMatch) {
    const last = parseFloat(alphaMatch[alphaMatch.length - 1]);
    if (last >= 0 && last <= 1) alpha = last;
  }
  // Extract numeric px values after the color — [offsetX, offsetY, blur, spread]
  const pxValues = shadow.replace(/rgba?\([^)]+\)/g, '').match(/[\d.]+/g) || [];
  const blur = parseFloat(pxValues[2]) || 0;
  const spread = parseFloat(pxValues[3]) || 0;
  return (blur + spread) * alpha;
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
    // Near-white (#F0+) and near-black (#10-) are not real hairline border colors —
    // they're text, backgrounds, or decorative dots misread as borders.
    const lum = (parseInt(hex.slice(1,3),16)*0.299 + parseInt(hex.slice(3,5),16)*0.587 + parseInt(hex.slice(5,7),16)*0.114) / 255;
    if (lum > 0.90 || lum < 0.05) continue;
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
  const seenCSS = new Set();       // dedup by raw CSS string (exact same gradient)
  const seenStops = new Set();     // dedup by parsed stop colors (same colors, different syntax)
  let sampled = 0;
  const all = document.querySelectorAll('*');
  for (let i = 0; i < all.length && sampled < 400 && stops.length < 4; i++) {
    const el = all[i];
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 20) continue;

    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || !bg.includes('gradient(')) continue;
    if (seenCSS.has(bg)) continue;
    seenCSS.add(bg);
    sampled++;

    const parsed = extractGradientStops(bg);
    if (parsed.length >= 2 && gradientHasMeaningfulSpread(parsed)) {
      // Second dedup layer: two different CSS gradient strings can produce
      // the same stop colors (vendor prefix differences, angle differences).
      const stopKey = [...parsed.slice(0, 3)].sort().join(',');  // order-independent dedup
      if (seenStops.has(stopKey)) continue;
      seenStops.add(stopKey);
      stops.push(parsed.slice(0, 3));
    }
  }
  return stops;
}

// Reject gradients that are:
// 1. Near-identical stops (subtle surface treatments, not brand moments)
// 2. All-dark stops (dark-to-dark background texture, not a brand color)
function gradientHasMeaningfulSpread(stops) {
  if (stops.length < 2) return false;
  // Must have meaningful color distance between at least one pair of adjacent stops
  let hasSpread = false;
  for (let i = 0; i < stops.length - 1; i++) {
    if (colorDistance(stops[i], stops[i + 1]) > 30) { hasSpread = true; break; }
  }
  if (!hasSpread) return false;
  // At least one stop must have visible luminance OR saturation.
  // Pure dark-to-dark gradients (like #011C42 → #14376E) are background textures, not brand moments.
  return stops.some(hex => {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return false;
    const r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
    const lum = 0.299*r + 0.587*g + 0.114*b;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    const sat = max === 0 ? 0 : (max - min) / max;
    return lum > 0.15 || sat > 0.20;
  });
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

  // Second choice: a button with a SATURATED TEXT color (brand-colored label).
  // Sites like Yahoo use purple text on neutral bg for their primary CTA.
  // These rank below filled-bg buttons but above the DOM-order fallback.
  let pick = ranked[0]?.el;
  if (!pick) {
    const textRanked = candidates
      .map(el => {
        const s = getComputedStyle(el);
        const textHex = colorOrNull(s.color);
        const sat = textHex && /^#[0-9a-fA-F]{6}$/.test(textHex) ? saturationOfHex(textHex) : 0;
        return { el, sat, area: el.offsetWidth * el.offsetHeight };
      })
      .filter(c => c.sat > 0.35)
      .sort((a, b) => (b.sat * b.area) - (a.sat * a.area));
    pick = textRanked[0]?.el;
  }
  // Third choice: any styled button (has solid bg or border) sorted by area.
  // Catches black/white CTAs and ghost buttons that ARE the primary action.
  if (!pick) {
    const anyStyled = candidates
      .map(el => {
        const s = getComputedStyle(el);
        const hasBg = !!colorOrNull(s.backgroundColor);
        const hasBorder = s.borderTopStyle !== 'none' && s.borderTopWidth !== '0px';
        return { el, hasBg, hasBorder, area: el.offsetWidth * el.offsetHeight };
      })
      .filter(c => c.hasBg || c.hasBorder)
      .sort((a, b) => b.area - a.area);
    pick = anyStyled[0]?.el;
  }
  if (!pick) pick = candidates[0];
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
  // Omit padding when both vertical sides are 0 — the element uses a fixed
  // height rather than padding for its size, so the value is misleading.
  const ptPx = parseFloat(s.paddingTop)  || 0;
  const pbPx = parseFloat(s.paddingBottom) || 0;
  const padding = (ptPx === 0 && pbPx === 0)
    ? null
    : compressBox(s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft);
  // Only report shadow if it has real visual weight (filters rgba(0,0,0,0) 0 0 0 0)
  const rawShadow = s.boxShadow;
  const shadow = (rawShadow && rawShadow !== 'none' &&
                  !rawShadow.includes('color(display-p3') &&
                  shadowVisualWeight(compressShadow(rawShadow)) > 0)
    ? compressShadow(rawShadow)
    : null;
  return {
    bg:            colorOrNull(s.backgroundColor),
    color:         colorOrNull(s.color),
    border:        simplifyBorder(s.borderTopWidth, s.borderTopStyle, s.borderTopColor),
    radius:        s.borderRadius === '0px' ? null : s.borderRadius,
    padding,
    fontSize:      s.fontSize,
    fontWeight:    s.fontWeight,
    textTransform: s.textTransform !== 'none' ? s.textTransform : null,
    shadow
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

  const ptPx = parseFloat(s.paddingTop)    || 0;
  const pbPx = parseFloat(s.paddingBottom) || 0;
  const padding = (ptPx === 0 && pbPx === 0)
    ? null
    : compressBox(s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft);
  const rawShadow = s.boxShadow;
  const shadow = (rawShadow && rawShadow !== 'none' &&
                  !rawShadow.includes('color(display-p3') &&
                  shadowVisualWeight(compressShadow(rawShadow)) > 0)
    ? compressShadow(rawShadow)
    : null;
  return {
    bg:            colorOrNull(s.backgroundColor),
    color:         colorOrNull(s.color),
    border:        simplifyBorder(s.borderTopWidth, s.borderTopStyle, s.borderTopColor),
    radius:        s.borderRadius === '0px' ? null : s.borderRadius,
    padding,
    fontSize:      s.fontSize,
    fontWeight:    s.fontWeight,
    textTransform: s.textTransform !== 'none' ? s.textTransform : null,
    shadow
  };
}

// ── Layout grid from rendered geometry ────────────────────────
function scrapeLayoutGrid() {
  const vw = window.innerWidth;

  // Max content width: widest container that isn't full-viewport
  let maxW = 0;
  document.querySelectorAll('main, [class*="container" i], [class*="wrapper" i], [class*="inner" i]').forEach(el => {
    if (!isVisible(el)) return;
    const w = el.getBoundingClientRect().width;
    if (w > 320 && w < vw - 4) maxW = Math.max(maxW, w);
  });

  // Dominant gutter: read getComputedStyle().gap directly — reliable across
  // both grid and flex, no sibling-position arithmetic needed.
  const gutters = new Map();
  let sampled = 0;
  for (const el of document.querySelectorAll('*')) {
    if (sampled > 600) break;
    if (!isVisible(el)) continue;
    const s = getComputedStyle(el);
    if (s.display !== 'flex' && s.display !== 'grid') continue;
    sampled++;
    // columnGap is the horizontal gutter — what layouts call "gutter"
    const g = parseFloat(s.columnGap || s.gap);
    if (g > 0 && g < 120) gutters.set(Math.round(g), (gutters.get(Math.round(g)) || 0) + 1);
  }

  const topGutter = [...gutters.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    maxWidth: maxW > 0 ? `${Math.round(maxW)}px` : null,
    gutter:   topGutter ? `${topGutter[0]}px` : null,
  };
}

// ── Full spacing scale from rendered layout ────────────────────
// Collects every gap/padding value rendered on the page, clusters values
// that are close together (within 2px), keeps only values that appear
// multiple times across the design, returns as a sorted scale.
function scrapeFullSpacingScale() {
  const raw = new Map();
  let sampled = 0;

  for (const el of document.querySelectorAll('*')) {
    if (sampled > 800) break;
    if (!isVisible(el)) continue;
    sampled++;
    const s = getComputedStyle(el);

    const collect = v => {
      const n = parseFloat(v);
      if (n > 0 && n <= 128) raw.set(n, (raw.get(n) || 0) + 1);
    };

    collect(s.gap); collect(s.rowGap); collect(s.columnGap);
    collect(s.paddingTop); collect(s.paddingRight);
    collect(s.paddingBottom); collect(s.paddingLeft);
    collect(s.marginTop); collect(s.marginBottom);
  }

  // Filtering rules:
  // - Skip < 4px: hairlines and sub-pixel offsets, not intentional spacing steps
  // - Round to nearest 4px grid (Tailwind, MUI, Chakra all use 4px base)
  // - Require ≥6 occurrences: eliminates one-off margins and browser defaults
  // - Cap at 10 values for a clean readable scale
  const scale = [];
  const seen = new Set();
  [...raw.entries()]
    .filter(([n, count]) => n >= 4 && count >= 6)
    .sort(([a], [b]) => a - b)
    .forEach(([n]) => {
      const rounded = Math.round(n / 4) * 4;
      if (!seen.has(rounded)) { seen.add(rounded); scale.push(rounded); }
    });

  return scale.length >= 3 ? scale.slice(0, 10) : null;
}

// ── Focus ring — programmatic focus + stylesheet fallback ─────
// Primary: physically focuses elements and reads computed style delta.
// Fallback: reads :focus/:focus-visible rules from stylesheets for sites
// that use `:focus-visible` (which doesn't trigger on programmatic focus).
function scrapeFocusRing() {
  // ── Primary: programmatic focus ──────────────────────────────
  const candidates = [
    ...document.querySelectorAll('input:not([type="hidden"]), textarea, button:not([disabled])')
  ].filter(isVisible);

  for (const el of candidates) {
    const before = {
      outline:       getComputedStyle(el).outline,
      outlineOffset: getComputedStyle(el).outlineOffset,
      boxShadow:     getComputedStyle(el).boxShadow,
    };
    try {
      el.focus({ preventScroll: true });
      const after = {
        outline:       getComputedStyle(el).outline,
        outlineOffset: getComputedStyle(el).outlineOffset,
        boxShadow:     getComputedStyle(el).boxShadow,
      };
      const outlineChanged = after.outline   !== before.outline   && after.outline   !== 'none';
      const shadowChanged  = after.boxShadow !== before.boxShadow && after.boxShadow !== 'none';
      if (outlineChanged || shadowChanged) {
        const result = {};
        if (outlineChanged)              result.outline       = after.outline;
        if (after.outlineOffset !== '0px') result.outlineOffset = after.outlineOffset;
        if (shadowChanged)               result.boxShadow     = compressShadow(after.boxShadow);
        return result;
      }
    } finally {
      el.blur(); // always restore, even if an error occurs
    }
  }

  // ── Fallback: read :focus-visible / :focus CSS rules ─────────
  // Most modern sites suppress the default outline and add a custom
  // :focus-visible ring — this doesn't trigger on programmatic focus
  // so we must read it from the stylesheet directly.
  const result = {};
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSStyleRule)) continue;
        const sel = rule.selectorText || '';
        if (!sel.includes(':focus')) continue;
        const s = rule.style;
        const outline  = s.getPropertyValue('outline');
        const offset   = s.getPropertyValue('outline-offset');
        const shadow   = s.getPropertyValue('box-shadow');
        if (outline && outline !== 'none') result.outline = outline;
        if (offset && offset !== '0px')   result.outlineOffset = offset;
        if (shadow && shadow !== 'none')   result.boxShadow = compressShadow(shadow);
        if (Object.keys(result).length)    return result;
      }
    } catch (_) {}
  }
  return Object.keys(result).length ? result : null;
}

// ── Hover behaviour from CSS rule text ────────────────────────
// Reads :hover rules from accessible stylesheets for interactive elements
// and extracts the visual changes: transforms, shadow deltas, opacity.
// Returns a human-readable summary of how interactive elements behave.
function scrapeHoverBehaviour() {
  const transforms  = [];
  const shadows     = [];
  const opacities   = [];
  const transitions = [];

  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSStyleRule)) continue;
        const sel = rule.selectorText || '';
        // Only hover rules on interactive-ish selectors
        if (!sel.includes(':hover')) continue;
        if (!/button|\.btn|a\b|role.*button|\[class.*btn/i.test(sel)) continue;

        const s = rule.style;
        const transform  = s.getPropertyValue('transform');
        const shadow     = s.getPropertyValue('box-shadow');
        const opacity    = s.getPropertyValue('opacity');
        const transition = s.getPropertyValue('transition');

        if (transform  && transform  !== 'none')  transforms.push(transform);
        if (shadow     && shadow     !== 'none')   shadows.push(shadow);
        if (opacity    && opacity    !== '')        opacities.push(parseFloat(opacity));
        if (transition && transition !== 'none')   transitions.push(transition);
      }
    } catch (_) {}
  }

  if (!transforms.length && !shadows.length) return null;

  const result = {};
  if (transforms.length) result.transform  = [...new Set(transforms)][0];
  if (shadows.length)    result.shadow      = compressShadow([...new Set(shadows)][0]);
  if (opacities.length)  result.opacity     = Math.min(...opacities);
  return result;
}

// ── Page structure / content architecture ─────────────────────
// Identifies the sequence of section types on the page by inspecting
// content patterns: CTA buttons, pricing keywords, form elements,
// testimonial signals, feature lists. Returns an ordered section map.
// This tells the AI the PAGE LAYOUT, not just the visual tokens.
function scrapePageStructure() {
  const sectionSels = 'section, [class*="section" i], main > div, main > article, body > div';
  const els = [...document.querySelectorAll(sectionSels)].filter(el => {
    if (!isVisible(el)) return false;
    const r = el.getBoundingClientRect();
    return r.width > window.innerWidth * 0.5 && r.height > 80;
  });

  // Dedupe nested sections — skip if parent already in the list
  const deduped = els.filter(el =>
    !els.some(other => other !== el && other.contains(el))
  );

  const classify = el => {
    // Slice textContent to avoid slow string ops on giant sections
    const text = (el.textContent || '').slice(0, 2000).toLowerCase();
    const cls  = (el.className  || '').toLowerCase();
    // Use offsetTop (distance from document top) NOT getBoundingClientRect().top
    // (which is viewport-relative and breaks if the user scrolled before snapping)
    const isFirstSection = el.offsetTop < 300;
    const hasCTA        = !!el.querySelector('a[class*="btn" i], button:not([type="submit"]), [role="button"]');
    const hasForm       = !!el.querySelector('form, input:not([type="hidden"])');
    const hasHeading    = !!el.querySelector('h1, h2, h3');
    const hasList       = !!el.querySelector('ul, ol');
    const priceSignal   = /\$|€|£|price|plan|month|year|free|tier|paid/.test(text);
    const testimonial   = /said|quote|review|testimonial|customer|loved|trust/.test(cls + text);
    const faq           = /faq|frequen|question|answer/.test(cls + text);
    const stats         = /\d+[k%+]/.test(text) && text.length < 400;

    if (isFirstSection)           return 'hero';
    if (priceSignal)              return 'pricing';
    if (testimonial)              return 'testimonials';
    if (faq)                      return 'faq';
    if (stats && !hasHeading)     return 'social-proof';
    if (hasForm && !hasHeading)   return 'newsletter';
    if (hasForm)                  return 'contact';
    if (hasCTA && !hasHeading && !hasList) return 'cta';
    if (hasHeading && hasList)    return 'features';
    if (hasHeading)               return 'section';
    return null;
  };

  const sections = deduped
    .map(classify)
    .filter(Boolean)
    .slice(0, 10);

  // Dedupe consecutive identical types
  const compressed = sections.filter((s, i) => s !== sections[i - 1]);

  return compressed.length >= 2 ? compressed : null;
}

// ── Z-index stacking layers ───────────────────────────────────
// Walks all positioned elements, reads computed z-index, guesses the
// semantic role from class names and position type, returns a sorted
// layer map. Reveals the layering vocabulary of the design system.
function scrapeZIndexScale() {
  const layers = new Map();

  document.querySelectorAll('*').forEach(el => {
    const s = getComputedStyle(el);
    if (s.position === 'static') return;
    const z = parseInt(s.zIndex);
    if (isNaN(z) || z <= 0) return;

    const cls = (el.className || '').toString().toLowerCase();
    const tag = el.tagName.toLowerCase();
    let role = 'element';
    if (/modal|dialog|overlay|lightbox/.test(cls) || tag === 'dialog') role = 'modal';
    else if (/tooltip|tip|popover/.test(cls))    role = 'tooltip';
    else if (/dropdown|menu|select/.test(cls))   role = 'dropdown';
    else if (s.position === 'fixed' || /sticky|fixed|header|topbar|navbar/.test(cls)) role = 'nav';
    else if (/toast|snack|notif|alert|banner/.test(cls)) role = 'notification';
    else if (/backdrop|scrim/.test(cls))         role = 'backdrop';

    // Keep the highest z per role
    if (!layers.has(role) || layers.get(role) < z) layers.set(role, z);
  });

  if (!layers.size) return null;

  return [...layers.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([role, z]) => ({ role, z }));
}

// ── Active state styles ───────────────────────────────────────
// Reads :active CSS rules for interactive selectors — extracts the
// micro-feedback moment (scale down, opacity drop, shadow collapse).
// Paired with hover + focus this completes the full interaction model.
function scrapeActiveStates() {
  const result = {};

  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSStyleRule)) continue;
        const sel = rule.selectorText || '';
        if (!sel.includes(':active')) continue;
        if (!/button|\.btn|a\b|role.*button/i.test(sel)) continue;

        const s = rule.style;
        const transform = s.getPropertyValue('transform');
        const opacity   = s.getPropertyValue('opacity');
        const shadow    = s.getPropertyValue('box-shadow');
        const scale     = s.getPropertyValue('scale');

        if (transform && transform !== 'none') result.transform = transform;
        if (scale     && scale     !== 'none') result.scale     = scale;
        if (opacity   && opacity   !== '')     result.opacity   = parseFloat(opacity);
        if (shadow    && shadow    !== 'none') result.boxShadow = compressShadow(shadow);

        if (Object.keys(result).length) return result;
      }
    } catch (_) {}
  }

  return Object.keys(result).length ? result : null;
}

// ── Responsive component behaviour ───────────────────────────
// Walks every @media rule in accessible stylesheets looking for
// component-targeting rules (button, input, card etc.) — extracts
// which properties change at which breakpoint.
// Returns: { "768": [{ selector, changes }], "600": [...] }
function scrapeResponsiveComponents() {
  const result = {};
  const componentPattern = /button|\.btn|input|textarea|form|\.card|nav\b|header\b/i;

  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSMediaRule)) continue;
        const mediaText = rule.conditionText || rule.media?.mediaText || '';
        const maxW = mediaText.match(/max-width:\s*(\d+)px/)?.[1];
        if (!maxW) continue;

        for (const inner of rule.cssRules) {
          if (!(inner instanceof CSSStyleRule)) continue;
          const sel = inner.selectorText || '';
          if (!componentPattern.test(sel)) continue;

          const s = inner.style;
          const changes = {};
          ['font-size','padding','width','display','flex-direction',
           'border-radius','gap','height','min-height'].forEach(prop => {
            const v = s.getPropertyValue(prop);
            if (v) changes[prop] = v;
          });

          if (!Object.keys(changes).length) continue;
          if (!result[maxW]) result[maxW] = [];
          // Trim selector for readability
          const shortSel = sel.replace(/\s+/g,' ').slice(0, 48);
          result[maxW].push({ selector: shortSel, changes });
        }
      }
    } catch (_) {}
  }

  return Object.keys(result).length ? result : null;
}

// ── CSS custom property extraction ────────────────────────────
// Reads declared --variables from :root / html rules in every accessible
// stylesheet, resolves their computed values (so var() references resolve),
// then buckets them by semantic category based on naming patterns.
// Cross-origin stylesheets are silently skipped.
function scrapeCSSVariables() {
  const computed = getComputedStyle(document.documentElement);
  const raw = {};

  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSStyleRule)) continue;
        const sel = (rule.selectorText || '').trim();
        // Only pull from the global scope where design tokens live
        if (sel !== ':root' && sel !== 'html' && sel !== '*' &&
            sel !== 'html,:root' && sel !== ':root,html') continue;
        for (let i = 0; i < rule.style.length; i++) {
          const prop = rule.style[i];
          if (!prop.startsWith('--')) continue;
          const val = computed.getPropertyValue(prop).trim();
          if (val) raw[prop] = val;
        }
      }
    } catch (_) {
      // Cross-origin stylesheet — skip
    }
  }

  if (!Object.keys(raw).length) return null;

  const colors = {}, spacing = {}, radii = {}, fonts = {}, motion = {}, shadows = {};

  for (const [key, val] of Object.entries(raw)) {
    const k = key.toLowerCase();
    const isColorValue = /^#[0-9a-f]{3,8}$/i.test(val) || /^rgba?\(/.test(val) ||
                         /^hsla?\(/.test(val) || /^color\(/.test(val);

    if (isColorValue ||
        /color|bg(?!-image)|background|text|border|fill|stroke|surface|primary|secondary|accent|muted|dim|brand|foreground|ring/.test(k)) {
      colors[key] = val;
    } else if (/shadow|elevation/.test(k)) {
      shadows[key] = val;
    } else if (/radius|rounded|corner/.test(k)) {
      radii[key] = val;
    } else if (/font|typeface|family/.test(k) && !/size|weight|height/.test(k)) {
      fonts[key] = val;
    } else if (/duration|ease|timing|motion|transition|animation|speed|delay/.test(k)) {
      motion[key] = val;
    } else if (/spacing|space|gap|size|padding|margin/.test(k)) {
      spacing[key] = val;
    }
  }

  // Only return categories that have actual content
  const result = {};
  if (Object.keys(colors).length)  result.colors  = colors;
  if (Object.keys(spacing).length) result.spacing  = spacing;
  if (Object.keys(radii).length)   result.radii    = radii;
  if (Object.keys(fonts).length)   result.fonts    = fonts;
  if (Object.keys(motion).length)  result.motion   = motion;
  if (Object.keys(shadows).length) result.shadows  = shadows;

  return Object.keys(result).length ? result : null;
}

// ── Per-heading-level typography ───────────────────────────────
// Samples each structural level individually. For headings we pick
// the element with the LARGEST rendered font-size (most prominent
// display heading), not just the first in DOM order. For body we
// require substantial text content to avoid nav/label noise.
function scrapeTypographyHierarchy() {
  const result = {};

  // Pick the largest (most prominent) visible heading at each level.
  // Falls back to ARIA role headings if semantic elements are missing.
  const headingLevels = [
    { sels: ['h1', '[role="heading"][aria-level="1"]'], role: 'h1' },
    { sels: ['h2', '[role="heading"][aria-level="2"]'], role: 'h2' },
    { sels: ['h3', '[role="heading"][aria-level="3"]'], role: 'h3' },
    { sels: ['h4', '[role="heading"][aria-level="4"]'], role: 'h4' },
  ];

  for (const { sels, role } of headingLevels) {
    let best = null, bestSize = 0;
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        if (!isVisible(el) || (el.textContent?.trim().length || 0) < 2) continue;
        const size = parseFloat(getComputedStyle(el).fontSize) || 0;
        if (size > bestSize) { best = el; bestSize = size; }
      }
    }
    if (!best) continue;
    const s = getComputedStyle(best);
    const family = pickIntentFont(s.fontFamily);
    if (!family) continue;
    result[role] = {
      family,
      size:          s.fontSize,                   // exact px from browser (e.g. "44.415px")
      weight:        s.fontWeight,
      lineHeight:    normalizeLineHeight(s.lineHeight, s.fontSize) || null,
      letterSpacing: (s.letterSpacing && s.letterSpacing !== 'normal' && s.letterSpacing !== '0px')
                       ? s.letterSpacing : null,
    };
  }

  // Body: longest <p> with real content — avoids nav labels and short captions.
  const bodyEl = [...document.querySelectorAll('p, [class*="body" i], article')]
    .filter(e => isVisible(e) && (e.textContent?.trim().length || 0) > 40)
    .sort((a, b) => (b.textContent?.length || 0) - (a.textContent?.length || 0))[0];
  if (bodyEl) {
    const s = getComputedStyle(bodyEl);
    const family = pickIntentFont(s.fontFamily);
    if (family) {
      result['body'] = {
        family,
        size:    s.fontSize,
        weight:  s.fontWeight,
        lineHeight: normalizeLineHeight(s.lineHeight, s.fontSize) || null,
        letterSpacing: null,
      };
    }
  }

  // Code: only if a meaningful code element exists.
  const codeEl = [...document.querySelectorAll('code, pre')]
    .find(e => isVisible(e) && (e.textContent?.trim().length || 0) > 3);
  if (codeEl) {
    const s = getComputedStyle(codeEl);
    const family = pickIntentFont(s.fontFamily);
    if (family) {
      result['code'] = { family, size: s.fontSize, weight: s.fontWeight, lineHeight: null, letterSpacing: null };
    }
  }

  return Object.keys(result).length ? result : null;
}

// ── Motion tokens ──────────────────────────────────────────────
// Walk interactive elements and collect transition-duration and
// timing-function values. Returns most-frequent durations + easings.
function scrapeMotionTokens() {
  const durations = new Map();
  const easings   = new Map();

  document.querySelectorAll(
    'button, a[href], [role="button"], input, [class*="card" i], nav a'
  ).forEach(el => {
    if (!isVisible(el)) return;
    const s = getComputedStyle(el);

    (s.transitionDuration || '').split(',').map(v => v.trim()).forEach(d => {
      if (d && d !== '0s') durations.set(d, (durations.get(d) || 0) + 1);
    });
    (s.transitionTimingFunction || '').split(',').map(v => v.trim()).forEach(e => {
      // Skip the browser default "ease" — only report deliberate choices
      if (e && e !== 'ease' && e !== 'initial') easings.set(e, (easings.get(e) || 0) + 1);
    });
  });

  const topDurations = [...durations.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d).slice(0, 4);
  const topEasings   = [...easings.entries()].sort((a, b) => b[1] - a[1]).map(([e]) => e).slice(0, 2);

  return topDurations.length ? { durations: topDurations, easings: topEasings } : null;
}

// ── Responsive breakpoints ─────────────────────────────────────
// Iterate CSSMediaRule entries in every accessible stylesheet and
// extract px values from min-width / max-width conditions.
function scrapeBreakpoints() {
  const bps = new Set();

  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSMediaRule)) continue;
        const text = rule.conditionText || rule.media?.mediaText || '';
        for (const m of text.matchAll(/(?:max|min)-width:\s*(\d+(?:\.\d+)?)px/g)) {
          bps.add(parseInt(m[1]));
        }
      }
    } catch (_) {
      // Cross-origin — skip
    }
  }

  return [...bps].sort((a, b) => a - b).slice(0, 8);
}

// ── Framework detection ─────────────────────────────────────────
// Pattern-matches CSS variable naming + class name prefixes against
// known frameworks. Returns the framework name or null.
// Deterministic, ~5ms, no DOM mutation.
function detectFramework() {
  // 1. CSS variable prefixes (from :root) — strongest signal
  const rootStyle = getComputedStyle(document.documentElement);
  const cssVarFingerprint = (() => {
    const found = new Set();
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules || []) {
          if (rule.selectorText !== ':root' && rule.selectorText !== 'html') continue;
          for (const prop of rule.style || []) {
            if (prop.startsWith('--')) found.add(prop);
          }
        }
      } catch (_) { /* cross-origin */ }
    }
    return found;
  })();

  const hasVar = (prefix) => [...cssVarFingerprint].some(v => v.startsWith(prefix));

  if (hasVar('--tw-') || hasVar('--tailwind-')) return 'Tailwind CSS';
  if (hasVar('--radix-'))                         return 'Radix UI';
  if (hasVar('--mantine-'))                       return 'Mantine';
  if (hasVar('--chakra-'))                        return 'Chakra UI';
  if (hasVar('--mui-') || hasVar('--material-'))  return 'Material UI';
  if (hasVar('--bs-'))                            return 'Bootstrap';
  if (hasVar('--ant-'))                           return 'Ant Design';
  if (hasVar('--nextui-'))                        return 'NextUI';
  if (hasVar('--shadcn-'))                        return 'shadcn/ui';

  // 2. Class-name prefix scan on a sample of elements
  let countMui = 0, countAnt = 0, countChakra = 0, countMantine = 0, countShadcn = 0;
  const sample = document.querySelectorAll('button, a, div, span');
  let scanned = 0;
  for (const el of sample) {
    if (scanned++ > 400) break;
    const cls = el.className;
    if (typeof cls !== 'string') continue;
    if (cls.includes('Mui') || cls.startsWith('Mui-')) countMui++;
    if (cls.includes('ant-')) countAnt++;
    if (cls.includes('chakra-')) countChakra++;
    if (cls.includes('mantine-')) countMantine++;
    // shadcn typically pairs Tailwind + HSL-named tokens — heuristic check
    if (el.hasAttribute('data-state') || el.hasAttribute('data-orientation')) countShadcn++;
  }
  if (countMui     >= 5) return 'Material UI';
  if (countAnt     >= 5) return 'Ant Design';
  if (countChakra  >= 5) return 'Chakra UI';
  if (countMantine >= 5) return 'Mantine';

  // 3. shadcn check — uses CSS vars named --background, --foreground etc as HSL
  if (rootStyle.getPropertyValue('--background').trim() &&
      rootStyle.getPropertyValue('--foreground').trim() &&
      rootStyle.getPropertyValue('--primary').trim()) {
    return 'shadcn/ui';
  }

  // 4. Radix data-state pattern (used by shadcn/headlessui/radix directly)
  if (countShadcn >= 3) return 'Radix UI';

  return null;
}

// ── Radius vocabulary ──────────────────────────────────────────
// Reads the radius value off each major component class and returns
// a semantic mapping. Different from `radius` (the brief summary) —
// this gives the AI which radius goes with which component type.
function scrapeRadiusVocabulary() {
  const vocab = {};

  const sampleRadius = (selector, key) => {
    for (const el of document.querySelectorAll(selector)) {
      if (!isVisible(el)) continue;
      const r = parseFloat(getComputedStyle(el).borderTopLeftRadius);
      if (r > 0) {
        vocab[key] = r >= 100 ? 'pill' : `${Math.round(r)}px`;
        return;
      }
    }
  };

  sampleRadius('button, [role="button"]',                'button');
  sampleRadius('[class*="card" i], article',              'card');
  sampleRadius('input[type="text"], input[type="email"], input:not([type]), textarea', 'input');
  sampleRadius('[class*="chip" i], [class*="tag" i], [class*="badge" i], [class*="pill" i]', 'chip');

  return Object.keys(vocab).length ? vocab : null;
}

// ── Design rhythm insights ─────────────────────────────────────
// Detects high-level patterns the AI cares about — grid base, pill
// usage, soft vs sharp vocabulary. Pattern not raw numbers.
function scrapeRhythm(spacingScale, buttonRadius, shadowScale, bodyLineHeight, radiusVocabulary) {
  const signals = [];

  // 1. Grid base — GCD of spacing values (common values: 4, 6, 8)
  if (Array.isArray(spacingScale) && spacingScale.length >= 3) {
    const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
    const base = spacingScale.reduce(gcd);
    if (base >= 2 && base <= 16) signals.push(`${base}px grid`);
  }

  // 2. Pill detection
  if (radiusVocabulary?.button === 'pill') signals.push('pill buttons');

  // 3. Radius vocabulary descriptor
  const radii = Object.values(radiusVocabulary || {})
    .map(v => v === 'pill' ? 999 : parseFloat(v))
    .filter(n => n > 0);
  if (radii.length) {
    const avg = radii.reduce((s, n) => s + Math.min(n, 50), 0) / radii.length;
    if (avg < 4)       signals.push('sharp corners');
    else if (avg < 10) signals.push('subtly rounded');
    else if (avg < 24) signals.push('soft corners');
    else               signals.push('very rounded');
  }

  // 4. Line-height descriptor
  if (bodyLineHeight) {
    const lh = parseFloat(bodyLineHeight);
    if (lh && lh >= 1.6)      signals.push(`generous line-height (${lh})`);
    else if (lh && lh <= 1.3) signals.push(`tight line-height (${lh})`);
  }

  // 5. Elevation language
  if (Array.isArray(shadowScale) && shadowScale.length) {
    signals.push(shadowScale.length >= 3 ? 'layered elevation' : 'soft elevation');
  } else {
    signals.push('flat (no shadows)');
  }

  return signals.length ? signals : null;
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
  if (rgb.startsWith('#')) {
    // Must be exactly 6 hex chars — 7-char malformed values (#0000104) from
    // CSS custom properties or browser quirks would produce wrong colors.
    if (/^#[0-9a-fA-F]{6}$/.test(rgb)) return rgb.toUpperCase();
    // Expand shorthand 3-char hex
    if (/^#[0-9a-fA-F]{3}$/.test(rgb)) {
      const [,a,b,c] = rgb;
      return `#${a}${a}${b}${b}${c}${c}`.toUpperCase();
    }
    return null; // malformed (wrong length)
  }
  // [\d.]+ not \d+ — needed to capture decimal alpha values like rgba(0,0,0,0.6)
  // With \d+ only, "0.6" splits into "0" and "6", reading alpha as 0 (fully transparent).
  const m = rgb.match(/[\d.]+/g);
  if (!m || m.length < 3) return null;
  const [r, g, b] = m.map(Number);
  if (m[3] !== undefined && Number(m[3]) < 0.5) return null;  // transparent or semi-transparent
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
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
  // Trust html/body background first — it's the authoritative page canvas.
  const htmlBgDark = isOpaqueBgDark(getComputedStyle(document.documentElement).backgroundColor);
  if (htmlBgDark !== null) return htmlBgDark;
  const bodyBgDark = isOpaqueBgDark(getComputedStyle(document.body).backgroundColor);
  if (bodyBgDark !== null) return bodyBgDark;

  // html + body both transparent — common pattern: body:white but a dark full-viewport
  // section (Darkroom, Windsurf, Zentry). Sample major structural elements and check
  // which ones cover ≥ 25% of the viewport; trust the first one with an opaque bg.
  const vw = window.innerWidth, vh = window.innerHeight;
  const vpArea = vw * vh;
  const structural = [
    ...document.querySelectorAll(
      'body > section, body > div, body > main, body > header, ' +
      '[class*="hero" i], [class*="banner" i], [id*="hero" i], main > *:first-child'
    )
  ].slice(0, 24);
  for (const el of structural) {
    const r = el.getBoundingClientRect();
    const ow = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const oh = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    if ((ow * oh) / vpArea < 0.25) continue;
    const bgResult = isOpaqueBgDark(getComputedStyle(el).backgroundColor);
    if (bgResult !== null) return bgResult;
  }

  // Final fallback: walk up from <main>.
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
