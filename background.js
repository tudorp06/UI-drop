chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.action === "takeScreenshot") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.captureVisibleTab(
        tabs[0].windowId,
        { format: "jpeg", quality: 92 },
        (dataUrl) => {
          if (chrome.runtime.lastError) sendResponse({ error: chrome.runtime.lastError.message });
          else sendResponse({ screenshot: dataUrl });
        }
      );
    });
    return true;
  }

  if (message.action === "openWithPrompt") {
    openAndInject(message).catch(err => console.warn('UIDrop: open failed', err));
    return false;
  }
});

// Map each target to the URL pattern we search for in existing tabs
const TARGET_PATTERNS = {
  claude:   '*://claude.ai/*',
  chatgpt:  '*://chatgpt.com/*',
  gemini:   '*://gemini.google.com/*',
  lovable:  '*://lovable.dev/*',
  manus:    '*://manus.im/*',
};

async function findExistingTab(target) {
  const pattern = TARGET_PATTERNS[target];
  if (!pattern) return null;
  const tabs = await chrome.tabs.query({ url: pattern });
  // Prefer an already-active tab, otherwise take the most recently used one
  return tabs.find(t => t.active) || tabs[tabs.length - 1] || null;
}

async function openAndInject({ target, url, prompt, screenshot, skillFile, slug }) {
  // Reuse an existing tab for this AI tool if one is already open —
  // no need to spam the user with extra tabs every single snap.
  let tab = await findExistingTab(target);

  if (tab) {
    // Navigate to a fresh conversation so the inject doesn't land mid-thread
    const freshUrl = target === 'claude'  ? 'https://claude.ai/new'
                   : target === 'chatgpt' ? 'https://chatgpt.com/'
                   : url;
    await chrome.tabs.update(tab.id, { url: freshUrl, active: true });
    // Bring the tab's window to front
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    tab = await chrome.tabs.create({ url });
  }

  await waitForTabComplete(tab.id);
  await new Promise(r => setTimeout(r, 2500));

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectPromptIntoEditor,
      args: [prompt, screenshot, target, skillFile || null, slug || 'snap']
    });
    console.log('UIDrop: inject result', result?.result);
  } catch (e) {
    console.warn('UIDrop: executeScript failed', e);
  }
}

function waitForTabComplete(tabId) {
  return new Promise(resolve => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function injectPromptIntoEditor(text, imageDataUrl, target, skillFile, slug) {

  // ── 1. Find the editor ──────────────────────────────────────
  const selectors = target === 'claude'
    ? ['div.ProseMirror[contenteditable="true"]',
       'div[contenteditable="true"][role="textbox"]']
    : target === 'gemini'
    ? ['div.ql-editor[contenteditable="true"]',
       'rich-textarea div[contenteditable="true"]',
       'div[contenteditable="true"][aria-label]',
       'div[contenteditable="true"]']
    : (target === 'lovable' || target === 'manus')
    ? ['textarea[placeholder]', 'textarea', 'div[contenteditable="true"]']
    : ['#prompt-textarea[contenteditable="true"]',
       'div.ProseMirror[contenteditable="true"]',
       'div[contenteditable="true"][role="textbox"]',
       'textarea'];

  let editor = null;
  for (let i = 0; i < 30 && !editor; i++) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetWidth > 100 && el.offsetHeight > 20) { editor = el; break; }
    }
    if (!editor) await new Promise(r => setTimeout(r, 200));
  }

  if (!editor) {
    console.warn('[UIDrop] Editor not found after 6s');
    return { success: false, reason: 'no-editor' };
  }

  // ── 2. Insert TEXT ─────────────────────────────────────────
  // RULE: text must NEVER touch the clipboard or a paste event.
  // Paste events can fire multiple times on some editors when both
  // the event AND the clipboard are read. execCommand('insertText')
  // writes directly into the editor's document — no clipboard, no
  // secondary paste path possible.
  editor.focus();

  if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
    // Native textarea/input: React-safe prototype setter
    const proto  = editor.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(editor, text);
    editor.dispatchEvent(new Event('input',  { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    // contenteditable (ProseMirror / Lexical etc.)
    // Place cursor at the end, then insert via execCommand.
    // execCommand is "deprecated" but still works in all browsers for
    // injected scripts. It does NOT touch the clipboard.
    try {
      const sel = window.getSelection();
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel.addRange(range);
      document.execCommand('insertText', false, text);
    } catch (e) {
      console.warn('[UIDrop] execCommand failed', e);
    }
  }

  // Brief pause so the editor can settle
  await new Promise(r => setTimeout(r, 400));

  // ── 3. Attach system.md FILE (if skill mode) ──────────────
  // Creates a real .md file and attaches it as a document —
  // Claude reads it as context, much richer than pasting text.
  if (skillFile && skillFile.content && skillFile.filename) {
    try {
      const mdBlob = new Blob([skillFile.content], { type: 'text/plain' });
      const mdFileObj = new File([mdBlob], skillFile.filename, { type: 'text/plain' });

      // Single paste — ClipboardEvent works on Claude + ChatGPT.
      // No file input fallback: that caused the file to attach twice.
      const dtMd = new DataTransfer();
      dtMd.items.add(mdFileObj);
      editor.focus();
      editor.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true, cancelable: true, clipboardData: dtMd
      }));
      await new Promise(r => setTimeout(r, 800));
    } catch (e) {
      console.warn('[UIDrop] .md file attach failed', e);
    }
  }

  // ── 4. Attach SCREENSHOT ───────────────────────────────────
  // The saved dataURL is JPEG (smaller storage) — but we re-encode to
  // true PNG via canvas before attaching so the .png filename / MIME
  // match the actual bytes. Lossless re-encode: same pixels, just PNG-wrapped.
  // Pasted via ClipboardEvent (image only, no text) — no clipboard pollution,
  // no download dialog, no double-text bug.
  if (imageDataUrl) {
    try {
      // Step 1: load source into an Image (works for both JPEG and PNG dataURLs)
      const pngDataUrl = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width  = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = false;  // preserve pixel-for-pixel quality
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));  // re-encode as real PNG
        };
        img.onerror = () => reject(new Error('image decode failed'));
        img.src = imageDataUrl;
      });

      // Step 2: dataURL → Blob → File (now truly PNG)
      const res  = await fetch(pngDataUrl);
      const blob = await res.blob();

      // Step 3: meaningful filename — e.g. uidrop-stripe-1717689600000.png
      const safeSlug = (slug || 'snap').replace(/[^a-z0-9-]+/gi, '-').slice(0, 40) || 'snap';
      const filename = `uidrop-${safeSlug}-${Date.now()}.png`;
      const file = new File([blob], filename, { type: 'image/png' });

      // Step 4: paste it (image-only DataTransfer — no text)
      const dt = new DataTransfer();
      dt.items.add(file);
      editor.focus();
      editor.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true, cancelable: true, clipboardData: dt
      }));
      await new Promise(r => setTimeout(r, 1200));
    } catch (e) {
      console.warn('[UIDrop] image attach failed', e);
    }
  }

  return { success: true };
}
