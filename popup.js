const snapBtn        = document.getElementById('snapBtn');
const statusBadge    = document.getElementById('statusBadge');
const screenshotArea = document.getElementById('screenshotArea');
const schemaBox      = document.getElementById('schemaBox');
const schemaBody     = document.getElementById('schemaBody');
const schemaSite     = document.getElementById('schemaSite');
const schemaSummary  = document.getElementById('schemaSummary');
const btnClaude      = document.getElementById('btnClaude');
const btnCursor      = document.getElementById('btnCursor');
const btnChatGPT     = document.getElementById('btnChatGPT');
const btnCopy        = document.getElementById('btnCopy');
const dragHint       = document.getElementById('dragHint');

let finalPrompt = '';

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

        finalPrompt = buildFinalPrompt(schema);

        chrome.storage.session.set({
            lastSnap: {
                screenshot: screenshotResponse.screenshot,
                schema,
                siteName: tokens.siteName,
                finalPrompt,
                timestamp: Date.now()
            }
        });

        setStatus('ready', false);
        snapBtn.disabled = false;
        snapBtn.innerHTML = snapButtonInnerHTML('Snap again');

    } catch (err) {
        console.error('UIDrop error:', err);
        setStatus('error', false);
        snapBtn.disabled = false;
        snapBtn.textContent = 'Try again';
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
        tokens.colorsWithWeights || []
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
        cardStyle:       formatCard(c.card, palette),
        inputStyle:      formatInput(c.input, palette),
        linkStyle:       formatLink(c.link),
        shadowScale:     tokens.shadowScale || [],
        borderColor:     tokens.borderColor || null,
        iconStroke:      tokens.iconStroke || null,
        gradients:       (tokens.gradients || []).slice(0, 2)
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
function derivePalette(colors, isDark, components, interactiveColors, colorsWithWeights) {
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
    // The most-USED neutral color in the right luminance range wins.
    // Using frequency-ordered `hexes` (not luminance-sorted) means we pick
    // the actual dominant background, not the absolute lightest/darkest pixel
    // that might be a single nav bar or shadow edge.
    const isNeutral = h => saturation(h) < 0.18;
    const lightNeutrals = hexes.filter(h => isNeutral(h) && luminance(h) > 0.82);
    const darkNeutrals  = hexes.filter(h => isNeutral(h) && luminance(h) < 0.20);
    const midNeutrals   = hexes.filter(h => isNeutral(h) && luminance(h) >= 0.25 && luminance(h) <= 0.75);

    let surface, elevated, text;
    if (isDark) {
        surface = darkNeutrals[0] || darkest;
        elevated = darkNeutrals.find(c => c !== surface && luminance(c) > luminance(surface) + 0.03);
        if (!elevated && components?.card?.bg && components.card.bg !== surface && isNeutral(components.card.bg)) {
            elevated = components.card.bg;
        }
        if (!elevated || elevated === surface) elevated = shift(surface, +0.08);
        text = lightNeutrals[0] || lightest;
    } else {
        surface = lightNeutrals[0] || lightest;
        elevated = lightNeutrals.find(c => c !== surface && luminance(c) < luminance(surface) - 0.01);
        if (!elevated && components?.card?.bg && components.card.bg !== surface && isNeutral(components.card.bg)) {
            elevated = components.card.bg;
        }
        if (!elevated || elevated === surface) elevated = shift(surface, -0.05);
        text = darkNeutrals[0] || darkest;
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
        .map(r => parseInt(r) || 0)
        .filter(Boolean);
    const maxRadius = radii.length ? Math.max(...radii) : 8;

    if (maxRadius >= 20) tags.push('rounded');
    else if (maxRadius <= 2) tags.push('sharp');
    else if (maxRadius >= 12) tags.push('soft');
    else tags.push('modern');

    return tags.slice(0, 3).join(' · ');
}

// ── Radius / spacing summaries ──
function deriveRadius(c) {
    const r = [
        c.button?.radius && `${c.button.radius} buttons`,
        c.card?.radius   && `${c.card.radius} cards`,
        c.input?.radius  && `${c.input.radius} inputs`
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
    return scale.length ? scale.join(' / ') : '4 / 8 / 16 / 24 / 32';
}

// ── Component formatters ──
function formatButton(b, palette) {
    if (!b) return `${palette.primary} bg, white text, 8px radius, 10px 16px padding, 600 weight`;
    const parts = [];
    if (b.bg)         parts.push(`${b.bg} bg`);
    if (b.color)      parts.push(`${b.color} text`);
    if (b.radius)     parts.push(`${b.radius} radius`);
    if (b.padding)    parts.push(`${b.padding} padding`);
    if (b.fontWeight) parts.push(`${b.fontWeight} weight`);
    return parts.join(', ') || 'default button';
}

function formatCard(c, palette) {
    if (!c) return `white bg, 1px subtle border, 12px radius, 24px padding`;
    const parts = [];
    if (c.bg)      parts.push(`${c.bg} bg`);
    if (c.border)  parts.push(c.border);
    if (c.radius)  parts.push(`${c.radius} radius`);
    if (c.padding) parts.push(`${c.padding} padding`);
    if (c.shadow)  parts.push(`shadow ${c.shadow}`);
    return parts.join(', ') || 'default card';
}

function formatInput(i, palette) {
    if (!i) return `white bg, 1px subtle border, 6px radius, 8px 12px padding`;
    const parts = [];
    if (i.bg)      parts.push(`${i.bg} bg`);
    if (i.border)  parts.push(i.border);
    if (i.radius)  parts.push(`${i.radius} radius`);
    if (i.padding) parts.push(`${i.padding} padding`);
    return parts.join(', ') || 'default input';
}

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
        `Vibe: ${schema.vibe}`,
        ``,
        `Palette: ${palette}`
    ];
    if (monochromeNote) parts.push(``, monochromeNote);
    parts.push(
        ``,
        `Typography:`,
        `• Heading — ${schema.headingFont}`,
        `• Body — ${schema.bodyFont}`,
        `• Type scale — ${schema.typeScale}`,
        ``,
        `Tokens:`,
        `• Radius — ${schema.radius}`,
        `• Spacing scale — ${schema.spacingScale}`
    );

    if (schema.borderColor) parts.push(`• Border color — ${schema.borderColor}`);
    if (schema.iconStroke)  parts.push(`• Icons — ${schema.iconStroke}`);

    if (Array.isArray(schema.shadowScale) && schema.shadowScale.length) {
        parts.push('', 'Elevation (shadow scale, low → high):');
        schema.shadowScale.forEach((s, i) => {
            const tier = ['subtle', 'medium', 'strong'][i] || 'extra';
            parts.push(`• ${tier} — ${s}`);
        });
    }

    parts.push('', 'Components:');
    parts.push(`• Button — ${schema.buttonStyle}`);
    parts.push(`• Card — ${schema.cardStyle}`);
    parts.push(`• Input — ${schema.inputStyle}`);
    if (schema.linkStyle) parts.push(`• Link — ${schema.linkStyle}`);

    if (Array.isArray(schema.gradients) && schema.gradients.length) {
        parts.push('', 'Gradients (use as brand moments — hero text, CTAs, accents):');
        schema.gradients.forEach(stops => {
            if (Array.isArray(stops) && stops.length >= 2) {
                parts.push(`• ${stops.join(' → ')}`);
            }
        });
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

    const essence = [
        'vibe',
        'primaryColor',
        'accentColor',
        'surfaceColor',
        'headingFont',
        'bodyFont',
        'buttonStyle'
    ];

    const allRelevantKeys = [
        'vibe',
        'primaryColor', 'accentColor', 'surfaceColor', 'elevatedSurface', 'textColor', 'mutedText',
        'headingFont', 'bodyFont', 'typeScale',
        'radius', 'spacingScale',
        'borderColor', 'iconStroke', 'shadowScale',
        'buttonStyle', 'cardStyle', 'inputStyle', 'linkStyle',
        'gradients'
    ];

    let shown = 0;
    essence.forEach(key => {
        const val = schema[key];
        if (val === undefined || val === null || val === '') return;
        appendSchemaLine(prettyKey(key), String(val));
        shown++;
    });

    const totalInBrief = allRelevantKeys.filter(k => {
        const v = schema[k];
        if (Array.isArray(v)) return v.length > 0;
        return v !== undefined && v !== null && v !== '';
    }).length;
    const moreCount = Math.max(0, totalInBrief - shown);

    if (moreCount > 0) {
        const more = document.createElement('div');
        more.className = 'schema-more';
        more.textContent = `+${moreCount} more tokens in the full brief →`;
        schemaBody.appendChild(more);
    }

    schemaSummary.style.display = 'none';
    schemaBox.classList.remove('hidden');
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
        finalPrompt = lastSnap.finalPrompt || '';

        snapBtn.innerHTML = snapButtonInnerHTML('Snap again');
        setStatus('ready', false);
    } catch (e) {
        console.warn('UIDrop: could not restore last snap', e);
    }
}

btnClaude.addEventListener('click', async () => {
    if (!finalPrompt) return showNoSnapWarning();
    const screenshot = await getCurrentScreenshot();
    chrome.runtime.sendMessage({
        action: 'openWithPrompt',
        target: 'claude',
        url: 'https://claude.ai/new',
        prompt: finalPrompt,
        screenshot
    });
});

btnChatGPT.addEventListener('click', async () => {
    if (!finalPrompt) return showNoSnapWarning();
    const screenshot = await getCurrentScreenshot();
    chrome.runtime.sendMessage({
        action: 'openWithPrompt',
        target: 'chatgpt',
        url: 'https://chatgpt.com/',
        prompt: finalPrompt,
        screenshot
    });
});

btnCursor.addEventListener('click', async () => {
    if (!finalPrompt) return showNoSnapWarning();
    await copyTextAndImage(btnCursor, 'Copied!');
});

btnCopy.addEventListener('click', async () => {
    if (!finalPrompt) return showNoSnapWarning();
    await copyTextAndImage(btnCopy, '✓ Copied!');
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
