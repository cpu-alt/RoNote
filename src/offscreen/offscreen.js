import { playToneInPage, CUSTOM_MAX_MS } from '../common/tones.js';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'ronote:play-sound') return;
  if (msg.data) {
    // Un son importe : on ne repond qu'une fois la lecture vraiment partie,
    // pour que le service worker puisse se rabattre sur un son integre.
    const a = new Audio(msg.data);
    a.volume = Math.max(0, Math.min(1, Number(msg.volume) || 0.6));
    a.play().then(() => {
      setTimeout(() => a.pause(), CUSTOM_MAX_MS);
      sendResponse({ ok: true });
    }, () => sendResponse({ ok: false }));
    return true;
  }
  const ok = playToneInPage(msg.sound, msg.volume);
  sendResponse({ ok });
  return true;
});
