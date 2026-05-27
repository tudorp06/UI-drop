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

  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    console.warn('[UIDrop] Could not write to clipboard:', e);
  }

  const selectors = target === 'claude'
    ? [
        'div.ProseMirror[contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'fieldset div[contenteditable="true"]',
        'div[contenteditable="true"]'
      ]
    : [
        '#prompt-textarea[contenteditable="true"]',
        'div.ProseMirror[contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]'
      ];

  let editor = null;
  for (let i = 0; i < 30 && !editor; i++) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.getBoundingClientRect().width > 100 && el.getBoundingClientRect().height > 20) {
        editor = el;
        break;
      }
    }
    if (!editor) await new Promise(r => setTimeout(r, 200));
  }

  if (!editor) {
    console.warn('[UIDrop] Editor not found after 6s — text is in clipboard, press Ctrl+V');
    return { success: false, reason: 'no-editor', clipboardOK: true };
  }

  editor.focus();
  try {
    const sel = window.getSelection();
    sel.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    sel.addRange(range);
  } catch (e) {}

  let inserted = false;
  try {
    inserted = document.execCommand('insertText', false, text);
  } catch (e) {}

  if (!inserted) {
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      editor.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true, cancelable: true, clipboardData: dt
      }));
      inserted = true;
    } catch (e) {}
  }

  if (imageDataUrl) {
    try {
      const res = await fetch(imageDataUrl);
      const blob = await res.blob();
      const file = new File([blob], 'uidrop-screenshot.png', { type: 'image/png' });

      // Try pasting the image up to 3 times with delays.
      // Claude/ChatGPT editors sometimes need extra time to accept image pastes
      // even after the text editor is ready.
      let imageInserted = false;
      for (let attempt = 0; attempt < 3 && !imageInserted; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 800));
        try {
          const dt = new DataTransfer();
          dt.items.add(file);
          editor.focus();
          const ev = new ClipboardEvent('paste', {
            bubbles: true, cancelable: true, clipboardData: dt
          });
          const accepted = editor.dispatchEvent(ev);
          // Check if an image preview appeared (Claude adds img or figure elements)
          await new Promise(r => setTimeout(r, 300));
          const hasImage = editor.closest('form')?.querySelector('img[src^="blob:"], img[src^="data:"], [data-testid*="image"], [data-testid*="file"]');
          if (hasImage) imageInserted = true;
        } catch (e) {
          console.warn(`[UIDrop] paste-event image attempt ${attempt + 1} failed`, e);
        }
      }

      // Fallback: find a visible file input and set files on it.
      if (!imageInserted) {
        const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
        const imageInput = fileInputs.find(i => !i.accept || /image|\*/.test(i.accept)) || fileInputs[0];
        if (imageInput) {
          const dt = new DataTransfer();
          dt.items.add(file);
          imageInput.files = dt.files;
          imageInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    } catch (e) {
      console.warn('[UIDrop] image attach failed', e);
    }
  }

  return { success: true, inserted, clipboardOK: true };
}
