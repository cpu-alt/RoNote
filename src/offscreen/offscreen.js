import { playToneInPage } from '../common/tones.js';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'ronote:play-sound') return;
  const ok = playToneInPage(msg.sound, msg.volume);
  sendResponse({ ok });
  return true;
});
