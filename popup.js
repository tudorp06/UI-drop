const snapBtn        = document.getElementById('snapBtn');
const statusBadge    = document.getElementById('statusBadge');
const screenshotArea = document.getElementById('screenshotArea');
const schemaBox      = document.getElementById('schemaBox');
const schemaBody     = document.getElementById('schemaBody');
const schemaSite     = document.getElementById('schemaSite');
const schemaSummary  = null; // removed in redesign
const btnClaude      = document.getElementById('btnClaude');
const btnCursor      = document.getElementById('btnCursor');
const btnChatGPT     = document.getElementById('btnChatGPT');
const btnLovable     = document.getElementById('btnLovable');
const btnManus       = document.getElementById('btnManus');
const btnCopy        = document.getElementById('btnCopy');
const dragHint       = document.getElementById('dragHint');
const btnLibrary     = document.getElementById('btnLibrary');

let finalPrompt = '';
let briefPrompt = '';
let skillMarkdown = '';
let snappedSiteName = '';
let formatMode = 'brief';   // 'brief' | 'skill'

// ── ExtensionPay ──────────────────────────────────────────────
const extpay = ExtPay('uidrop'); // ← same app name as background.js

// ── Open the Snap Library — gated behind payment ──
btnLibrary.addEventListener('click', async () => {
    let user;
    try { user = await extpay.getUser(); } catch (e) { user = { paid: false }; }

    if (user.paid) {
        chrome.tabs.create({ url: chrome.runtime.getURL('library.html') });
    } else {
        extpay.openPaymentPage();
    }
});

// ── Reflect payment state on the library button ──────────────
(async () => {
    let user;
    try { user = await extpay.getUser(); } catch (e) { user = { paid: false }; }
    if (!user.paid) {
        const badge = btnLibrary.querySelector('.library-badge');
        if (badge) {
            badge.innerHTML = `
                <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                  <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                Unlock`;
        }
        btnLibrary.classList.add('library-btn-locked');
    }
})();

(async function init() {
    document.getElementById('setupView')?.classList.add('hidden');
    document.getElementById('mainView')?.classList.remove('hidden');
    await restoreLastSnap();
})();

snapBtn.addEventListener('click', performSnap);

async function performSnap() {
    setStatus('snapping…', true);
    snapBtn.disabled = true;
    snapBtn.textContent = 'Snapping…';

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
        });

        const screenshotResponse = await chrome.runtime.sendMessage({ action: 'takeScreenshot' });
        if (screenshotResponse.error) throw new Error(screenshotResponse.error);

        screenshotArea.innerHTML = `
            <img src="${screenshotResponse.screenshot}"
                 alt="Page screenshot"
                 draggable="true"
                 style="width:100%;height:100%;object-fit:cover;display:block;cursor:grab;" />
        `;
        // Pre-convert screenshot to a File so drag-and-drop transfers real
        // image data, not just a data URL string. Claude/Cursor/ChatGPT editors
        // need actual file data in the drag transfer to accept image drops.
        let screenshotFile = null;
        try {
            const res = await fetch(screenshotResponse.screenshot);
            const blob = await res.blob();
            screenshotFile = new File([blob], 'uidrop-screenshot.png', { type: 'image/png' });
        } catch (err) {
            console.warn('UIDrop: could not pre-convert screenshot for drag', err);
        }
        screenshotArea.querySelector('img').addEventListener('dragstart', e => {
            if (screenshotFile) {
                e.dataTransfer.items.add(screenshotFile);
                e.dataTransfer.effectAllowed = 'copy';
            } else {
                e.dataTransfer.setData('text/uri-list', screenshotResponse.screenshot);
            }
        });
        dragHint?.classList.remove('hidden');

        const cssResponse = await chrome.tabs.sendMessage(tab.id, { action: 'scrapeCSS' });
        if (!cssResponse?.tokens) throw new Error('Could not read page CSS');

        const tokens = cssResponse.tokens;
        schemaSite.textContent = tokens.siteName;

        const schema = buildDesignSystem(tokens);

        renderSchema(schema, tokens.siteName);

        briefPrompt    = buildFinalPrompt(schema);
        skillMarkdown  = buildSkillMarkdown(schema, tokens.siteName);
        snappedSiteName = tokens.siteName;
        finalPrompt = (formatMode === 'skill') ? skillMarkdown : briefPrompt;

        // Save to persistent history (non-blocking)
        saveSnapToHistory(schema, tokens, screenshotResponse.screenshot).catch(() => {});

        chrome.storage.session.set({
            lastSnap: {
                screenshot: screenshotResponse.screenshot,
                schema,
                siteName: tokens.siteName,
                finalPrompt: briefPrompt,
                skillMarkdown,
                timestamp: Date.now()
            }
        });

        setStatus('ready', false);
        snapBtn.disabled = false;
        snapBtn.innerHTML = snapButtonInnerHTML('Snap again');

    } catch (err) {
        console.error('UIDrop error:', err);
        snapBtn.disabled = false;

        const msg = err?.message || '';
        if (msg.includes('cannot be scripted') || msg.includes('extensions gallery') || msg.includes('chrome://') || msg.includes('Cannot access')) {
            setStatus('error', false);
            snapBtn.innerHTML = snapButtonInnerHTML("Can't snap this page");
            snapBtn.title = "Chrome system pages and the Extensions store can't be snapped. Try on any regular website.";
        } else {
            setStatus('error', false);
            snapBtn.textContent = 'Try again';
        }
    }
}

// ── DERIVE DESIGN SYSTEM FROM RAW TOKENS ──────────────────────
// Pure JavaScript heuristics — no AI, no async, ~1ms. Output is a
// 15-key flat schema describing the page's design language.
function buildDesignSystem(tokens) {
    const palette = derivePalette(
        tokens.colors || [],
        tokens.isDark,
        tokens.components,
        tokens.interactiveColors || [],
        tokens.colorsWithWeights || [],
        tokens.pageBg || null
    );
    const fonts   = tokens.fonts   || [];
    const sizes   = tokens.fontSizes || [];
    const c       = tokens.components || {};

    const headingFont = cleanFont(fonts[0]) || 'inherit';
    const bodyFont    = cleanFont(fonts[1] || fonts[0]) || 'inherit';
    // sizes is [hero, mid, body] — body is the LAST entry, not sizes[1] (mid)
    const bodySize    = sizes[2] || sizes[1] || sizes[0] || '16px';

    return {
        vibe:            deriveVibe(palette, tokens),
        primaryColor:    palette.primary,
        accentColor:     palette.accent,
        surfaceColor:    palette.surface,
        elevatedSurface: palette.elevated,
        textColor:       palette.text,
        mutedText:       palette.muted,
        headingFont:     `${headingFont} 700`,
        bodyFont:        formatBodyFont(bodyFont, bodySize, tokens.bodyLineHeight),
        typeScale:       sizes.slice(0, 3).join(' / ') || '32px / 20px / 16px',
        radius:          deriveRadius(c),
        spacingScale:    deriveSpacing(c),
        buttonStyle:     formatButton(c.button, palette),
        cardStyle:       formatCard(c.card, palette, tokens.isDark),
        inputStyle:      formatInput(c.input, palette, tokens.isDark),
        linkStyle:       formatLink(c.link),
        shadowScale:          tokens.shadowScale || [],
        borderColor:          tokens.borderColor || null,
        iconStroke:           tokens.iconStroke || null,
        gradients:            (tokens.gradients || []).slice(0, 2),
        cssVars:              tokens.cssVars             || null,
        typographyHierarchy:  tokens.typographyHierarchy || null,
        motion:               tokens.motion              || null,
        breakpoints:          tokens.breakpoints         || [],
        layoutGrid:            tokens.layoutGrid           || null,
        spacingScale:          tokens.spacingScale         || null,
        focusStyles:           tokens.focusStyles          || null,
        hoverBehaviour:        tokens.hoverBehaviour       || null,
        pageStructure:         tokens.pageStructure        || null,
        zIndexScale:           tokens.zIndexScale          || null,
        activeStates:          tokens.activeStates         || null,
        responsiveComponents:  tokens.responsiveComponents || null,
        // ── Phase 1: depth signals (used by .md/Brief, popup UI untouched) ──
        framework:             tokens.framework            || null,
        radiusVocabulary:      tokens.radiusVocabulary     || null,
        rhythm:                tokens.rhythm               || null
    };
}

// Body font with line-height baked in: "Inter 16px 400, 1.5 line-height"
function formatBodyFont(font, size, lineHeight) {
    let s = `${font} ${size} 400`;
    if (lineHeight) s += `, ${lineHeight} line-height`;
    return s;
}

// Link styling: color + decoration treatment
function formatLink(l) {
    if (!l) return null;
    const parts = [];
    if (l.color) parts.push(l.color);
    return parts.length ? parts.join(', ') : null;
}

// ── Palette derivation ──
// Input `colors` arrives FREQUENCY-SORTED from content.js (most-used first).
// 1. Primary = the most-used color that is meaningfully saturated.
//    This ensures we pick something the page actually displays often,
//    not a one-off icon color or a Tailwind preset that exists in CSS but is unused.
// 2. Accent = saturated color with largest hue delta from primary.
// 3. Surface/elevated/text/muted from neutral high-frequency colors.
// 4. Force surface ≠ elevated by synthesizing a shift when needed.
function derivePalette(colors, isDark, components, interactiveColors, colorsWithWeights, pageBg) {
    const hexes = (colors || []).filter(isHex).map(h => h.toUpperCase());
    if (!hexes.length) return defaultPalette(isDark);

    const byLuminance = [...hexes].sort((a, b) => luminance(b) - luminance(a));
    const lightest = byLuminance[0];
    const darkest  = byLuminance[byLuminance.length - 1];

    // Frequency-ordered saturated candidates (preserves the input order from content.js)
    const saturated = hexes
        .filter(h => saturation(h) > 0.25 && luminance(h) > 0.08 && luminance(h) < 0.95);

    // ── MONOCHROME DETECTION ──
    // Compare the strongest saturated color's weight vs the dominant neutral.
    // If the saturated signal is weak relative to neutrals, the page is
    // effectively monochrome and forcing a "primary" produces nonsense
    // (status indicators, avatar colors, embedded mockup pixels winning by
    // default). Honestly report no chromatic primary in that case.
    //
    // A site is monochrome iff NO real button has a chromatic background.
    // Brand identity lives on CTAs — if every button is neutral (black/white/
    // gray), the design is genuinely monochromatic regardless of stray
    // chromatic pixels elsewhere (status dots, customer logos, illustrations).
    const interactiveSaturated = (interactiveColors || [])
        .filter(isHex)
        .map(h => h.toUpperCase())
        .filter(h => saturation(h) > 0.30 && luminance(h) > 0.08 && luminance(h) < 0.92);

    const isMonochrome = interactiveSaturated.length === 0;

    const primary = (() => {
        if (isMonochrome) return null;
        if (interactiveSaturated.length) return interactiveSaturated[0];
        if (!saturated.length) {
            return hexes.find(h => h !== lightest && h !== darkest) || hexes[0];
        }
        return saturated.slice(0, 10).sort((a, b) => saturation(b) - saturation(a))[0];
    })();
    const primaryHue = primary ? hue(primary) : 0;

    // ACCENT: pick the SECOND chromatic CTA color (button bg) with sufficient
    // hue distance from primary. If only one chromatic CTA exists, there is no
    // accent — the brand is mono-hue, and we shift primary for visual variety
    // rather than inventing one from random page colors (customer logos,
    // illustrations, hero artwork). This keeps accent honest.
    const accent = (() => {
        if (isMonochrome || !primary) {
            return isDark ? lightest : darkest;
        }
        const otherCTAs = interactiveSaturated
            .filter(c => c !== primary)
            .map(c => ({ color: c, delta: hueDelta(hue(c), primaryHue) }))
            .filter(c => c.delta >= 25);
        if (otherCTAs.length) {
            return otherCTAs.sort((a, b) => b.delta - a.delta)[0].color;
        }
        return shift(primary, isDark ? +0.20 : -0.20);
    })();

    // ── Surface, elevated, text — must be NEUTRAL (low saturation) ──
    const isNeutral = h => saturation(h) < 0.18;
    // lightNeutrals threshold lowered from 0.82 → 0.65 so tinted page backgrounds
    // (dusty rose, lavender, cream) qualify as surface candidates.
    const lightNeutrals     = hexes.filter(h => isNeutral(h) && luminance(h) > 0.65);
    // veryLightNeutrals (> 0.82) reserved for text role in dark mode — avoids mid-grays.
    const veryLightNeutrals = hexes.filter(h => isNeutral(h) && luminance(h) > 0.82);
    const darkNeutrals      = hexes.filter(h => isNeutral(h) && luminance(h) < 0.20);
    const midNeutrals       = hexes.filter(h => isNeutral(h) && luminance(h) >= 0.25 && luminance(h) <= 0.75);

    let surface, elevated, text;
    if (isDark) {
        surface  = darkNeutrals[0] || darkest;
        elevated = darkNeutrals.find(c => c !== surface && luminance(c) > luminance(surface) + 0.03);
        if (!elevated && components?.card?.bg && components.card.bg !== surface && isNeutral(components.card.bg)) {
            elevated = components.card.bg;
        }
        if (!elevated || elevated === surface) elevated = shift(surface, +0.08);
        // In dark mode, text must be light — guard against oxide-style failure where
        // lightest colour in the pool is still dark (no white elements found).
        text = veryLightNeutrals[0] || lightest;
        if (luminance(text) < 0.50) text = '#FFFFFF';
        // Ensure elevated is actually LIGHTER than surface (a3icp: #000 elevated, #080808 surface)
        if (luminance(elevated) <= luminance(surface)) elevated = shift(surface, +0.08);
    } else {
        surface  = lightNeutrals[0] || lightest;
        elevated = lightNeutrals.find(c => c !== surface && luminance(c) < luminance(surface) - 0.01);
        if (!elevated && components?.card?.bg && components.card.bg !== surface && isNeutral(components.card.bg)) {
            elevated = components.card.bg;
        }
        if (!elevated || elevated === surface) elevated = shift(surface, -0.05);
        text = darkNeutrals[0] || darkest;
        // Ensure elevated is actually DARKER than surface in light mode
        if (luminance(elevated) >= luminance(surface)) elevated = shift(surface, -0.05);
    }

    // ── Surface anchoring: if we know the real page background (html/body), use it. ──
    // Frequency ordering can place white card/panel elements before the actual tinted
    // page bg (kriss dusty-rose, lusion lavender, pika cream, family cream).
    // The actual html/body bg IS the surface by definition — anchor to it.
    if (pageBg && isHex(pageBg)) {
        const pgHex = pageBg.toUpperCase();
        if (isNeutral(pgHex)) {
            const pgLum = luminance(pgHex);
            if (!isDark && pgLum > 0.40) surface = pgHex;
            if (isDark  && pgLum < 0.50) surface = pgHex;
        }
    }

    // ── Muted: must be neutral AND mid-luminance ──
    let muted = midNeutrals[0];
    if (!muted || muted === text) {
        muted = shift(text, isDark ? -0.42 : +0.42);
    }

    return { primary, accent, surface, elevated, text, muted };
}

function defaultPalette(isDark) {
    return isDark
        ? { primary:'#5B8DEF', accent:'#FF6B2B', surface:'#0B0F1C', elevated:'#161B2E', text:'#EEF1FB', muted:'#7A82A3' }
        : { primary:'#0070F3', accent:'#000000', surface:'#FFFFFF', elevated:'#F6F9FC', text:'#0A0A0A', muted:'#6B7280' };
}

// ── Vibe = 3 adjective tags computed from palette + radius + dark-mode ──
function deriveVibe(palette, tokens) {
    const tags = [];

    if (tokens.isDark) tags.push('dark');
    else tags.push('light');

    // Monochrome detection: palette.primary will be null when derivePalette
    // determined the page has no real chromatic brand color.
    if (!palette.primary) {
        tags.push('monochrome');
    } else {
        const primSat = saturation(palette.primary);
        if (primSat > 0.6) tags.push('vibrant');
        else if (primSat < 0.18) tags.push('monochrome');
        else tags.push('balanced');
    }

    const radii = [tokens.components?.button?.radius, tokens.components?.card?.radius]
        .map(r => { const n = parseInt(r) || 0; return n >= 100 ? 50 : n; }) // clamp pill values
        .filter(Boolean);
    const maxRadius = radii.length ? Math.max(...radii) : 8;

    if (maxRadius >= 20) tags.push('rounded');
    else if (maxRadius <= 2) tags.push('sharp');
    else if (maxRadius >= 12) tags.push('soft');
    else tags.push('modern');

    return tags.slice(0, 3).join(' · ');
}

// ── Radius / spacing summaries ──
// 999px / 9999px are the "pill" trick — display as "pill" not a literal number
function humanRadius(r) {
    if (!r) return null;
    const px = parseFloat(r);
    if (px >= 100) return 'pill';
    return r;
}

function deriveRadius(c) {
    const r = [
        c.button?.radius && `${humanRadius(c.button.radius)} buttons`,
        c.card?.radius   && `${humanRadius(c.card.radius)} cards`,
        c.input?.radius  && `${humanRadius(c.input.radius)} inputs`
    ].filter(Boolean);
    return r.length ? r.join(', ') : '8px';
}

function deriveSpacing(c) {
    const values = new Set();
    [c.button?.padding, c.card?.padding, c.input?.padding].forEach(p => {
        if (!p) return;
        p.split(/\s+/).forEach(v => {
            const n = parseInt(v);
            if (n > 0 && n <= 64) values.add(n);
        });
    });
    const scale = [...values].sort((a, b) => a - b);
    if (!scale.length) return '4 / 8 / 16 / 24 / 32';

    // Extend a sparse scale with geometric neighbours so it always reads as
    // a rhythm rather than a single arbitrary value.
    if (scale.length === 1) {
        const base = scale[0];
        const half = Math.round(base / 2);
        const dbl  = Math.round(base * 2);
        const candidates = [half > 0 ? half : null, base, dbl <= 64 ? dbl : null]
            .filter(Boolean);
        return [...new Set(candidates)].sort((a, b) => a - b).join(' / ');
    }
    return scale.join(' / ');
}

// ── Component formatters ──
function formatButton(b, palette) {
    if (!b) return `${palette.primary || '#000000'} bg, white text, 8px radius, 10px 16px padding, 600 weight`;
    const parts = [];
    // If the captured button has a transparent bg, fall back to palette.primary —
    // ghost/outlined buttons ARE the primary CTA on some sites (liveblocks, ssense).
    if (b.bg)               parts.push(`${b.bg} bg`);
    else if (palette.primary) parts.push(`${palette.primary} bg`);
    if (b.color)      parts.push(`${b.color} text`);
    if (b.radius)     parts.push(`${b.radius} radius`);
    if (b.padding)    parts.push(`${b.padding} padding`);
    if (b.fontWeight) parts.push(`${b.fontWeight} weight`);
    return parts.join(', ') || 'default button';
}

function formatCard(c, palette, isDark) {
    if (!c) return isDark
        ? `dark surface bg, subtle border, 12px radius, 24px padding`
        : `white bg, 1px subtle border, 12px radius, 24px padding`;
    const parts = [];
    if (c.bg)      parts.push(`${c.bg} bg`);
    if (c.border)  parts.push(c.border);
    if (c.radius)  parts.push(`${c.radius} radius`);
    if (c.padding) parts.push(`${c.padding} padding`);
    if (c.shadow)  parts.push(`shadow ${c.shadow}`);
    return parts.join(', ') || 'default card';
}

function formatInput(i, palette, isDark) {
    if (!i) return isDark
        ? `dark surface bg, 1px subtle border, 6px radius, 8px 12px padding`
        : `white bg, 1px subtle border, 6px radius, 8px 12px padding`;
    const parts = [];
    if (i.bg)      parts.push(`${i.bg} bg`);
    if (i.border)  parts.push(i.border);
    if (i.radius)  parts.push(`${i.radius} radius`);
    if (i.padding) parts.push(`${i.padding} padding`);
    return parts.join(', ') || 'default input';
}

// buildSkillMarkdown now lives in skill-markdown.js (loaded as a separate
// script in popup.html + library.html so both contexts share one implementation).

function buildFinalPrompt(schema) {
    const paletteParts = [];
    if (schema.primaryColor) paletteParts.push(`${schema.primaryColor} primary`);
    paletteParts.push(`${schema.accentColor} accent`);
    paletteParts.push(`${schema.surfaceColor} surface`);
    paletteParts.push(`${schema.elevatedSurface} elevated`);
    paletteParts.push(`${schema.textColor} text`);
    paletteParts.push(`${schema.mutedText} muted`);
    const palette = paletteParts.join(', ');
    const monochromeNote = schema.primaryColor
        ? null
        : 'This page has no chromatic primary — it is a monochrome design. The brand language lives in surface contrast and typography.';

    const parts = [
        `This is a design system extracted from a webpage I find inspiring. I want to build my own site/app UI inspired by this design pattern. Do not copy or replicate brand assets, logos, or identity — use these tokens as a foundation to create something original for me. Match the design language, not the brand:`,
        ``,
        `Vibe: ${schema.vibe}`
    ];
    if (schema.framework) parts.push(`Built with: ${schema.framework}`);
    if (Array.isArray(schema.rhythm) && schema.rhythm.length) {
        parts.push(`Rhythm: ${schema.rhythm.join(' · ')}`);
    }
    parts.push(``, `Palette: ${palette}`);
    if (monochromeNote) parts.push(``, monochromeNote);

    // ── Typography ─────────────────────────────────────────────
    parts.push(``, `Typography:`);
    const th = schema.typographyHierarchy;
    if (th && Object.keys(th).length) {
        // Per-level detail when available — much richer than a single heading/body line
        const roleLabel = { h1:'H1', h2:'H2', h3:'H3', h4:'H4', body:'Body', code:'Code', caption:'Caption' };
        Object.entries(th).forEach(([role, t]) => {
            let line = `• ${roleLabel[role] || role} — ${t.family} ${t.size} ${t.weight}`;
            if (t.lineHeight)    line += `, ${t.lineHeight} line-height`;
            if (t.letterSpacing) line += `, ${t.letterSpacing} tracking`;
            parts.push(line);
        });
        parts.push(`• Type scale — ${schema.typeScale}`);
    } else {
        // Fallback to the single-level summary
        parts.push(
            `• Heading — ${schema.headingFont}`,
            `• Body — ${schema.bodyFont}`,
            `• Type scale — ${schema.typeScale}`
        );
    }

    // ── Design tokens ──────────────────────────────────────────
    parts.push(``, `Tokens:`);
    parts.push(`• Radius — ${schema.radius}`);
    if (schema.radiusVocabulary && Object.keys(schema.radiusVocabulary).length) {
        const vocab = Object.entries(schema.radiusVocabulary).map(([k, v]) => `${k}:${v}`).join(', ');
        parts.push(`• Radius vocabulary — ${vocab}`);
    }

    // Use CSS-var radius scale if richer than the component-derived summary
    if (schema.cssVars?.radii && Object.keys(schema.cssVars.radii).length) {
        const rEntries = Object.entries(schema.cssVars.radii).slice(0, 8);
        parts.push(`• Radius tokens — ${rEntries.map(([k, v]) => `${k.replace('--', '')}: ${v}`).join(', ')}`);
    }

    parts.push(`• Spacing scale — ${schema.spacingScale}`);

    // CSS-var spacing gives named steps (--spacing-4, --spacing-8 etc.)
    if (schema.cssVars?.spacing && Object.keys(schema.cssVars.spacing).length) {
        const sEntries = Object.entries(schema.cssVars.spacing).slice(0, 10);
        parts.push(`• Spacing tokens — ${sEntries.map(([k, v]) => `${k.replace('--', '')}: ${v}`).join(', ')}`);
    }

    if (schema.borderColor) parts.push(`• Border color — ${schema.borderColor}`);
    if (schema.iconStroke)  parts.push(`• Icons — ${schema.iconStroke}`);

    // ── Named color tokens from CSS custom properties ──────────
    if (schema.cssVars?.colors && Object.keys(schema.cssVars.colors).length) {
        parts.push(``, `Named color tokens (from CSS custom properties):`);
        Object.entries(schema.cssVars.colors).slice(0, 24).forEach(([k, v]) => {
            parts.push(`• ${k}: ${v}`);
        });
    }

    // ── Elevation ──────────────────────────────────────────────
    if (Array.isArray(schema.shadowScale) && schema.shadowScale.length) {
        parts.push('', 'Elevation (shadow scale, low → high):');
        schema.shadowScale.forEach((s, i) => {
            const tier = ['subtle', 'medium', 'strong'][i] || 'extra';
            parts.push(`• ${tier} — ${s}`);
        });
    }
    if (schema.cssVars?.shadows && Object.keys(schema.cssVars.shadows).length) {
        if (!schema.shadowScale?.length) parts.push('', 'Elevation tokens:');
        Object.entries(schema.cssVars.shadows).slice(0, 6).forEach(([k, v]) => {
            parts.push(`• ${k.replace('--', '')}: ${v}`);
        });
    }

    // ── Motion ─────────────────────────────────────────────────
    const motionVars = schema.cssVars?.motion;
    const motionComputed = schema.motion;
    if (motionVars && Object.keys(motionVars).length) {
        parts.push('', 'Motion tokens:');
        Object.entries(motionVars).slice(0, 8).forEach(([k, v]) => {
            parts.push(`• ${k.replace('--', '')}: ${v}`);
        });
    } else if (motionComputed) {
        parts.push('', 'Motion:');
        parts.push(`• Durations — ${motionComputed.durations.join(', ')}`);
        if (motionComputed.easings.length) {
            parts.push(`• Easing — ${motionComputed.easings.join(', ')}`);
        }
    }

    // ── Components ─────────────────────────────────────────────
    parts.push('', 'Components:');
    parts.push(`• Button — ${schema.buttonStyle}`);
    parts.push(`• Card — ${schema.cardStyle}`);
    parts.push(`• Input — ${schema.inputStyle}`);
    if (schema.linkStyle) parts.push(`• Link — ${schema.linkStyle}`);

    // ── Gradients ──────────────────────────────────────────────
    if (Array.isArray(schema.gradients) && schema.gradients.length) {
        parts.push('', 'Gradients (use as brand moments — hero text, CTAs, accents):');
        schema.gradients.forEach(stops => {
            if (Array.isArray(stops) && stops.length >= 2) {
                parts.push(`• ${stops.join(' → ')}`);
            }
        });
    }

    // ── Responsive breakpoints ─────────────────────────────────
    if (Array.isArray(schema.breakpoints) && schema.breakpoints.length) {
        parts.push('', `Responsive breakpoints: ${schema.breakpoints.map(b => `${b}px`).join(', ')}`);
    }

    // ── Layout grid ────────────────────────────────────────────
    if (schema.layoutGrid?.maxWidth || schema.layoutGrid?.gutter) {
        const lg = schema.layoutGrid;
        const parts2 = [];
        if (lg.maxWidth) parts2.push(`max-width ${lg.maxWidth}`);
        if (lg.gutter)   parts2.push(`${lg.gutter} gutter`);
        parts.push('', `Layout grid: ${parts2.join(', ')}`);
    }

    // ── Full spacing scale ─────────────────────────────────────
    if (Array.isArray(schema.spacingScale) && schema.spacingScale.length >= 3) {
        parts.push(`Spacing scale: ${schema.spacingScale.map(n => `${n}px`).join(' / ')}`);
    }

    // ── Focus ring ─────────────────────────────────────────────
    if (schema.focusStyles) {
        const f = schema.focusStyles;
        const fParts = [];
        if (f.outline)       fParts.push(f.outline);
        if (f.outlineOffset) fParts.push(`${f.outlineOffset} offset`);
        if (f.boxShadow)     fParts.push(`shadow: ${f.boxShadow}`);
        if (fParts.length) parts.push(`Focus ring: ${fParts.join(', ')}`);
    }

    // ── Interaction states ─────────────────────────────────────
    const hasInteraction = schema.hoverBehaviour || schema.activeStates || schema.focusStyles;
    if (hasInteraction) {
        parts.push('', 'Interaction states:');
        if (schema.hoverBehaviour) {
            const h = schema.hoverBehaviour;
            const hp = [];
            if (h.transform) hp.push(h.transform);
            if (h.shadow)    hp.push(`shadow ${h.shadow}`);
            if (h.opacity !== undefined) hp.push(`opacity ${h.opacity}`);
            if (hp.length) parts.push(`• hover — ${hp.join(', ')}`);
        }
        if (schema.activeStates) {
            const a = schema.activeStates;
            const ap = [];
            if (a.transform) ap.push(a.transform);
            if (a.scale)     ap.push(`scale ${a.scale}`);
            if (a.opacity !== undefined) ap.push(`opacity ${a.opacity}`);
            if (ap.length) parts.push(`• active — ${ap.join(', ')}`);
        }
        if (schema.focusStyles) {
            const f = schema.focusStyles;
            const fp = [];
            if (f.outline)       fp.push(f.outline);
            if (f.outlineOffset) fp.push(`${f.outlineOffset} offset`);
            if (f.boxShadow)     fp.push(`shadow ${f.boxShadow}`);
            if (fp.length) parts.push(`• focus — ${fp.join(', ')}`);
        }
    }

    // ── Z-index layers ─────────────────────────────────────────
    if (Array.isArray(schema.zIndexScale) && schema.zIndexScale.length) {
        parts.push('', `Z-index layers: ${schema.zIndexScale.map(l => `${l.role}: ${l.z}`).join(' → ')}`);
    }

    // ── Responsive component changes ───────────────────────────
    if (schema.responsiveComponents) {
        parts.push('', 'Responsive component changes:');
        Object.entries(schema.responsiveComponents)
            .sort(([a], [b]) => parseInt(b) - parseInt(a))
            .slice(0, 4)
            .forEach(([bp, rules]) => {
                rules.slice(0, 3).forEach(({ selector, changes }) => {
                    const c = Object.entries(changes).map(([k, v]) => `${k}: ${v}`).join(', ');
                    parts.push(`• at ${bp}px — ${selector} → ${c}`);
                });
            });
    }

    // ── Page structure ─────────────────────────────────────────
    if (Array.isArray(schema.pageStructure) && schema.pageStructure.length) {
        parts.push('', `Page structure: ${schema.pageStructure.join(' → ')}`);
        parts.push(`(Reproduce this section order when building a full-page layout.)`);
    }

    parts.push(
        ``,
        `Attach the screenshot from this page as a visual reference — match its hierarchy, density, and overall feel, not just the raw values. Where this brief leaves something underspecified (hover states, focus rings, dark-mode variants), infer sensible defaults consistent with the vibe and palette above.`,
        ``,
        `This is for my personal project — I'm drawing inspiration from this design pattern to build my own UI. Create something original that follows these design principles without copying the source brand.`,
        ``,
        `— captured by UIDrop`
    );

    return parts.join('\n');
}

function renderSchema(schema, siteName) {
    schemaBody.innerHTML = '';

    // ── HEADER ──
    document.getElementById('schemaSite').textContent = siteName || '';
    const vibeEl = document.getElementById('schemaVibe');
    const modeEl = document.getElementById('schemaMode');
    if (vibeEl) vibeEl.textContent = schema.vibe || '';
    if (modeEl) modeEl.textContent = schema.isDark ? '🌙 Dark' : '☀️ Light';

    // ── PALETTE — token rows with color dots ──
    const paletteColors = [
        { label: 'primary',  hex: schema.primaryColor },
        { label: 'accent',   hex: schema.accentColor },
        { label: 'surface',  hex: schema.surfaceColor },
        { label: 'text',     hex: schema.textColor },
        { label: 'muted',    hex: schema.mutedText },
    ].filter(c => c.hex && isHex(c.hex));

    if (paletteColors.length) {
        const sec = makeDsSection('Palette');
        paletteColors.forEach(({ label, hex }) => sec.appendChild(makeTokenRow(hex, label, hex)));
        schemaBody.appendChild(sec);
    }

    // ── TYPOGRAPHY ──
    const typoRows = [
        schema.headingFont && { label: 'heading', val: schema.headingFont },
        schema.bodyFont    && { label: 'body',    val: schema.bodyFont },
        schema.typeScale   && { label: 'scale',   val: schema.typeScale },
    ].filter(Boolean);

    if (typoRows.length) {
        const sec = makeDsSection('Typography');
        typoRows.forEach(({ label, val }) => sec.appendChild(makeTokenRow(null, label, val, true)));
        schemaBody.appendChild(sec);
    }

    // ── TOKENS ──
    const tokenRows = [
        schema.radius       && { label: 'radius',  val: schema.radius },
        schema.shadowScale  && { label: 'shadow',  val: schema.shadowScale },
        schema.spacingScale && { label: 'spacing', val: schema.spacingScale },
        schema.borderColor  && { label: 'border',  val: schema.borderColor, hex: schema.borderColor },
    ].filter(Boolean);

    if (tokenRows.length) {
        const sec = makeDsSection('Tokens');
        tokenRows.forEach(({ label, val, hex }) => sec.appendChild(makeTokenRow(hex && isHex(hex) ? hex : null, label, val)));
        schemaBody.appendChild(sec);
    }

    // ── MORE — count what's still hidden (components, gradients, etc.) ──
    const extras = [
        schema.buttonStyle, schema.cardStyle, schema.inputStyle,
        schema.linkStyle, schema.iconStroke,
        Array.isArray(schema.gradients) && schema.gradients.length ? schema.gradients : null,
        schema.elevatedSurface,
    ].filter(Boolean).length;

    if (extras > 0) {
        const more = document.createElement('div');
        more.className = 'schema-more';
        more.textContent = `+${extras} more tokens in full brief`;
        schemaBody.appendChild(more);
    }

    schemaBox.classList.remove('hidden');
}

function makeDsSection(label) {
    const sec = document.createElement('div');
    sec.className = 'ds-section';
    const head = document.createElement('div');
    head.className = 'ds-section-label';
    head.textContent = label;
    sec.appendChild(head);
    return sec;
}

function makeTokenRow(hex, key, val, isText = false) {
    const row = document.createElement('div');
    row.className = 'ds-token-row';
    const dot = document.createElement('div');
    dot.className = hex ? 'ds-token-dot' : 'ds-token-dot empty';
    if (hex) dot.style.background = hex;
    const keyEl = document.createElement('span');
    keyEl.className = 'ds-token-key';
    keyEl.textContent = key;
    const valEl = document.createElement('span');
    valEl.className = isText ? 'ds-token-val text' : 'ds-token-val';
    valEl.textContent = String(val);
    row.appendChild(dot);
    row.appendChild(keyEl);
    row.appendChild(valEl);
    return row;
}

function prettyKey(k) {
    const map = {
        primaryColor: 'primary', accentColor: 'accent',
        surfaceColor: 'surface', elevatedSurface: 'elevated',
        textColor: 'text', mutedText: 'muted',
        headingFont: 'heading', bodyFont: 'body',
        typeScale: 'scale', spacingScale: 'spacing',
        buttonStyle: 'button', cardStyle: 'card', inputStyle: 'input'
    };
    return map[k] || k;
}

function appendSchemaLine(key, value) {
    const isColor = value.startsWith('#') && /^#[0-9a-fA-F]{3,8}$/.test(value);
    const line = document.createElement('div');
    line.className = 'schema-line';
    line.innerHTML = `
        <span class="sk">${escapeHtml(key)}</span>
        <span class="sp">→</span>
        <span class="sv ${isColor ? 'num' : 'str'}">${
            isColor
                ? `<span class="sv-swatch" style="background:${escapeHtml(value)}"></span>${escapeHtml(value)}`
                : escapeHtml(value)
        }</span>
    `;
    schemaBody.appendChild(line);
}

async function restoreLastSnap() {
    try {
        const { lastSnap } = await chrome.storage.session.get('lastSnap');
        if (!lastSnap) return;
        if (Date.now() - lastSnap.timestamp > 60 * 60 * 1000) {
            chrome.storage.session.remove('lastSnap');
            return;
        }

        screenshotArea.innerHTML = `
            <img src="${lastSnap.screenshot}"
                 alt="Page screenshot"
                 draggable="true"
                 style="width:100%;height:100%;object-fit:cover;display:block;cursor:grab;" />
        `;
        dragHint?.classList.remove('hidden');
        screenshotArea.querySelector('img').addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/uri-list', lastSnap.screenshot);
            e.dataTransfer.setData('text/plain', lastSnap.screenshot);
        });
        schemaSite.textContent = lastSnap.siteName || '';
        renderSchema(lastSnap.schema || {}, lastSnap.siteName);
        briefPrompt    = lastSnap.finalPrompt || '';
        skillMarkdown  = lastSnap.skillMarkdown || (lastSnap.schema ? buildSkillMarkdown(lastSnap.schema, lastSnap.siteName) : '');
        snappedSiteName = lastSnap.siteName || '';
        finalPrompt    = (formatMode === 'skill') ? skillMarkdown : briefPrompt;

        snapBtn.innerHTML = snapButtonInnerHTML('Snap again');
        setStatus('ready', false);
    } catch (e) {
        console.warn('UIDrop: could not restore last snap', e);
    }
}

// ── Build the payload depending on whether user chose Prompt or system.md ──
// In 'brief' mode: prompt = full text brief, no skillFile.
// In 'skill' mode: prompt = short instruction, skillFile = the .md as a real file.
function buildSendPayload() {
    if (formatMode !== 'skill' || !skillMarkdown) {
        return { prompt: finalPrompt, skillFile: null };
    }
    const slug = (snappedSiteName || 'site')
        .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'site';
    const shortPrompt = `Here is the design system for ${snappedSiteName || 'this site'} as a .md file.\n` +
        `Use these tokens to build a similar UI — don't copy the design, build something original with the same feel.`;
    return {
        prompt: shortPrompt,
        skillFile: { content: skillMarkdown, filename: `${slug}-design-system.md` }
    };
}

btnClaude.addEventListener('click', async () => {
    if (!briefPrompt && !skillMarkdown) return showNoSnapWarning();
    const screenshot = await getCurrentScreenshot();
    const payload = buildSendPayload();
    chrome.runtime.sendMessage({
        action: 'openWithPrompt', target: 'claude',
        url: 'https://claude.ai/new',
        prompt: payload.prompt, screenshot, skillFile: payload.skillFile
    });
});

btnChatGPT.addEventListener('click', async () => {
    if (!briefPrompt && !skillMarkdown) return showNoSnapWarning();
    const screenshot = await getCurrentScreenshot();
    const payload = buildSendPayload();
    chrome.runtime.sendMessage({
        action: 'openWithPrompt', target: 'chatgpt',
        url: 'https://chatgpt.com/',
        prompt: payload.prompt, screenshot, skillFile: payload.skillFile
    });
});

btnCursor.addEventListener('click', async () => {
    if (!finalPrompt) return showNoSnapWarning();
    await copyTextAndImage(btnCursor, 'Copied!');
});

btnLovable.addEventListener('click', async () => {
    if (!briefPrompt && !skillMarkdown) return showNoSnapWarning();
    const screenshot = await getCurrentScreenshot();
    const payload = buildSendPayload();
    chrome.runtime.sendMessage({
        action: 'openWithPrompt', target: 'lovable',
        url: 'https://lovable.dev/',
        prompt: payload.prompt, screenshot, skillFile: payload.skillFile
    });
});

btnManus.addEventListener('click', async () => {
    if (!briefPrompt && !skillMarkdown) return showNoSnapWarning();
    const screenshot = await getCurrentScreenshot();
    const payload = buildSendPayload();
    chrome.runtime.sendMessage({
        action: 'openWithPrompt', target: 'manus',
        url: 'https://manus.im/',
        prompt: payload.prompt, screenshot, skillFile: payload.skillFile
    });
});

btnCopy.addEventListener('click', async () => {
    if (!finalPrompt) return showNoSnapWarning();
    await copyTextAndImage(btnCopy, '✓ Copied!');
});

// ── Format toggle: Brief ↔ Skill .md ──────────────────────────
document.querySelectorAll('#formatToggle .fmt-opt').forEach(btn => {
    btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (mode === formatMode) return;
        formatMode = mode;
        document.querySelectorAll('#formatToggle .fmt-opt').forEach(b => {
            const active = b.dataset.mode === mode;
            b.classList.toggle('fmt-active', active);
            b.setAttribute('aria-selected', String(active));
        });
        // Swap the active prompt so Send/Copy buttons use the right format
        finalPrompt = (mode === 'skill') ? skillMarkdown : briefPrompt;
    });
});


async function copyTextAndImage(btn, successLabel) {
    try {
        await navigator.clipboard.writeText(finalPrompt);
        flashCopied(btn, successLabel);
    } catch (e) {
        console.warn('UIDrop: clipboard write failed', e);
        flashCopied(btn, 'Failed');
    }
}

async function getCurrentScreenshot() {
    try {
        const { lastSnap } = await chrome.storage.session.get('lastSnap');
        return lastSnap?.screenshot || null;
    } catch { return null; }
}

function setStatus(text, isActive) {
    const label = statusBadge.querySelector('.badge-text');
    if (label) label.textContent = text;
    else statusBadge.textContent = text;
    statusBadge.classList.toggle('active', !!isActive);
}

function flashCopied(button, message) {
    const original = button.innerHTML;
    button.textContent = message;
    button.classList.add('copied');
    setTimeout(() => {
        button.innerHTML = original;
        button.classList.remove('copied');
    }, 2000);
}

function showNoSnapWarning() {
    setStatus('snap first!', true);
    setTimeout(() => setStatus('ready', false), 2000);
}

function snapButtonInnerHTML(label) {
    return `
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
            <rect x="3" y="4" width="14" height="13" rx="2" stroke="white" stroke-width="1.6"/>
            <path d="M7 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" stroke="white" stroke-width="1.6" stroke-linecap="round"/>
            <circle cx="7.5" cy="11" r="1.4" fill="white"/>
            <circle cx="10" cy="11" r="1.4" fill="white" opacity="0.7"/>
            <circle cx="12.5" cy="11" r="1.4" fill="white" opacity="0.4"/>
        </svg>
        ${label}
    `;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[c]));
}

// ── Color math helpers used by derivePalette / deriveVibe ──
function isHex(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c); }

function luminance(hex) {
    if (!isHex(hex)) return 0;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function saturation(hex) {
    if (!isHex(hex)) return 0;
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === 0) return 0;
    return (max - min) / max;
}

function cleanFont(f) {
    if (!f) return null;
    return String(f).split(',')[0].trim().replace(/['"]/g, '');
}

function rgbFromHex(hex) {
    return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16)
    ];
}

function hue(hex) {
    if (!isHex(hex)) return 0;
    const [r8, g8, b8] = rgbFromHex(hex);
    const r = r8 / 255, g = g8 / 255, b = b8 / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max === min) return 0;
    const d = max - min;
    let h;
    switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4; break;
    }
    return h * 60;
}

function hueDelta(h1, h2) {
    const d = Math.abs(h1 - h2);
    return Math.min(d, 360 - d);
}

// Lighten (+) or darken (-) a hex by amount in [-1, 1]. Used to synthesize
// elevated-surface or accent-variant when the palette doesn't supply one.
function shift(hex, amount) {
    if (!isHex(hex)) return hex;
    const [r, g, b] = rgbFromHex(hex);
    const adj = (v) => {
        if (amount >= 0) return Math.round(v + (255 - v) * amount);
        return Math.round(v * (1 + amount));
    };
    const out = [adj(r), adj(g), adj(b)]
        .map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
        .join('');
    return '#' + out.toUpperCase();
}

// ── SNAP HISTORY ──────────────────────────────────────────────────────────────

// Compress full screenshot to a thumbnail for storage.
// 720×450 @ 72% JPEG ≈ 45-60KB per snap → 50 snaps ≈ 2.5MB total.
// Large enough to look sharp in the detail view (max 780px wide panel)
// without blowing up storage budget meaningfully.
async function compressThumbnail(dataUrl) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 720; canvas.height = 450;
            const ctx = canvas.getContext('2d');
            // Centre-crop to fill the canvas (16:10 ratio)
            const srcAspect = img.width / img.height;
            const dstAspect = 720 / 450;
            let sx = 0, sy = 0, sw = img.width, sh = img.height;
            if (srcAspect > dstAspect) {
                sw = img.height * dstAspect;
                sx = (img.width - sw) / 2;
            } else {
                sh = img.width / dstAspect;
                sy = (img.height - sh) / 2;
            }
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 720, 450);
            resolve(canvas.toDataURL('image/jpeg', 0.72));
        };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
    });
}

async function saveSnapToHistory(schema, tokens, screenshot) {
    const thumbnail = await compressThumbnail(screenshot);
    const recommendation = recommendUseCase(schema);

    const snap = {
        id:             `snap_${Date.now()}`,
        timestamp:      Date.now(),
        siteName:       tokens.siteName || '',
        pageTitle:      tokens.pageTitle || '',
        thumbnail,
        schema,
        finalPrompt,
        recommendation  // array of { type, score }
    };

    const { snapHistory = [] } = await chrome.storage.local.get('snapHistory');
    const updated = [snap, ...snapHistory].slice(0, 50);   // keep 50 most recent
    await chrome.storage.local.set({ snapHistory: updated });
}

// ── USE-CASE RECOMMENDATION ENGINE ───────────────────────────────────────────
// Pure deterministic heuristics — no AI. Analyses palette, vibe, radius,
// typography, and gradients to suggest what kind of product/site this design
// language is best suited for.
function recommendUseCase(schema) {
    const scores = new Map();
    const add = (cat, pts) => scores.set(cat, (scores.get(cat) || 0) + pts);

    const isDark        = schema.vibe?.includes('dark');
    const isMonochrome  = !schema.primaryColor;
    const isVibrant     = schema.vibe?.includes('vibrant');
    const isRounded     = schema.vibe?.includes('rounded');
    const isSharp       = schema.vibe?.includes('sharp');
    const primary       = schema.primaryColor;
    const heading       = (schema.headingFont || '').toLowerCase();

    // ── Hue-based signals ──
    if (primary && isHex(primary)) {
        const h = hue(primary);
        const s = saturation(primary);

        if (h >= 200 && h <= 265) { add('B2B SaaS', 4); add('Productivity Tool', 3); add('Developer Tool', 2); }
        if (h >= 100 && h <= 165) { add('E-Commerce', 3); add('Fintech', 3); add('Health & Wellness', 2); }
        if (h <= 18 || h >= 345)  { add('Entertainment', 2); add('Food & Lifestyle', 2); add('Marketing Site', 2); }
        if (h > 18 && h <= 55)    { add('Consumer App', 3); add('Marketplace', 2); add('Creative Tool', 2); }
        if (h > 55 && h <= 100)   { add('E-Commerce', 2); add('Health & Wellness', 2); add('Sustainability', 1); }
        if (h > 260 && h <= 310)  { add('AI Product', 4); add('Creative Tool', 3); add('Crypto / Web3', 2); }
        if (h > 310 && h < 345)   { add('Consumer App', 3); add('Fashion / Lifestyle', 2); add('AI Product', 2); }
        if (h > 165 && h < 200)   { add('Developer Tool', 3); add('AI Product', 2); add('B2B SaaS', 2); }

        if (s > 0.75)             { add('Consumer App', 2); add('Gaming / Entertainment', 1); }
        if (s > 0.3 && s < 0.6)  { add('B2B SaaS', 1); add('Productivity Tool', 1); }
    }

    // ── Dark / light mode ──
    if (isDark)       { add('Developer Tool', 3); add('Gaming / Entertainment', 2); add('Crypto / Web3', 2); add('AI Product', 1); }
    if (!isDark && !isMonochrome) { add('B2B SaaS', 1); add('Consumer App', 1); }

    // ── Monochrome ──
    if (isMonochrome) { add('Agency / Portfolio', 5); add('Editorial / Media', 3); add('Luxury Brand', 3); add('Developer Tool', 1); }

    // ── Shape language ──
    if (isRounded)    { add('Consumer App', 2); add('B2B SaaS', 1); add('Health & Wellness', 1); }
    if (isSharp)      { add('Developer Tool', 2); add('Agency / Portfolio', 2); add('Editorial / Media', 1); }

    // ── Typography ──
    if (/mono|code|geist|jetbrains|fira|cascadia/i.test(heading))        { add('Developer Tool', 4); }
    if (/serif|times|bradford|literata|editorial|display/i.test(heading)) { add('Editorial / Media', 3); add('Agency / Portfolio', 2); add('Luxury Brand', 1); }

    // ── Gradients ──
    if ((schema.gradients?.length || 0) > 0 && isVibrant) { add('AI Product', 2); add('Consumer App', 2); add('Gaming / Entertainment', 1); }

    // ── Type scale size ──
    const heroSize = parseInt((schema.typeScale || '').split('/')[0]) || 0;
    if (heroSize >= 80)  { add('Marketing Site', 2); add('Agency / Portfolio', 1); }
    if (heroSize >= 140) { add('Agency / Portfolio', 2); add('Gaming / Entertainment', 1); }

    // ── Shadow depth ──
    const shadowDepth = schema.shadowScale?.length || 0;
    if (shadowDepth >= 2) { add('B2B SaaS', 1); add('E-Commerce', 1); }

    return [...scores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([type, score]) => ({ type, score }));
}
