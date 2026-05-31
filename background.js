// ── ExtensionPay ──────────────────────────────────────────────
// Download ExtPay.js from https://extensionpay.com and place it
// in the extension root folder alongside this file.
importScripts('ExtPay.js');
const extpay = ExtPay('uidrop'); // ← replace 'uidrop' with your ExtensionPay app name
extpay.startBackground();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.action === "takeScreenshot") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.captureVisibleTab(
        tabs[0].windowId,
        { format: "png", quality: 90 },
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

async function openAndInject({ target, url, prompt, screenshot }) {
  const tab = await chrome.tabs.create({ url });

  await waitForTabComplete(tab.id);
  await new Promise(r => setTimeout(r, 2500));

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectPromptIntoEditor,
      args: [prompt, screenshot, target]
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

async function injectPromptIntoEditor(text, imageDataUrl, target) {

  // ── 1. Find the editor ──────────────────────────────────────
  const selectors = target === 'claude'
    ? ['div.ProseMirror[contenteditable="true"]',
       'div[contenteditable="true"][role="textbox"]']
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

  // Brief pause so the editor can settle before we attach the image
  await new Promise(r => setTimeout(r, 400));

  // ── 3. Attach SCREENSHOT ───────────────────────────────────
  // Completely separate from the text step — a paste event whose
  // clipboardData contains ONLY the image file, no text at all.
  // Because there is no text in the DataTransfer, no editor can
  // accidentally insert a second copy of the brief.
  if (imageDataUrl) {
    try {
      const res  = await fetch(imageDataUrl);
      const blob = await res.blob();
      const file = new File([blob], 'uidrop-screenshot.png', { type: 'image/png' });
      const dt   = new DataTransfer();
      dt.items.add(file);   // image only — intentionally no text entry
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
