import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { pageDetail, samePageOffers, analyzePage, addKnownInstances } from '../src/common/page-trade.js';
import { analyze, netRobux } from '../src/common/analysis.js';

const page = { tradeId: '42', sides: [
  { userIds: [2], items: [{ assetId: 20 }] },
  { userIds: [1], items: [{ assetId: 10 }] }
] };
const detail = pageDetail(page, 1);
assert.equal(detail.offers[1].user.id, 1);
assert.equal(pageDetail(page, 3), null);
assert.equal(pageDetail({ sides: [page.sides[0], page.sides[0]] }, 2), null);
assert.equal(pageDetail({ sides: [{ ...page.sides[0], userIds: [1, 2] }, page.sides[1]] }, 1), null);
assert.equal(pageDetail({ sides: [{ ...page.sides[0], items: [{ assetId: -1 }] }, page.sides[1]] }, 1), null);
const captured = { offers: detail.offers.map((o, i) => ({ ...o, robux: 100,
  userAssets: o.userAssets.map(a => ({ ...a, recentAveragePrice: i ? 100 : 90 })) })) };
assert.equal(samePageOffers(detail, captured), true);
assert.equal(samePageOffers(detail, { offers: [captured.offers[0], captured.offers[0]] }), false);
assert.equal(samePageOffers(detail, { offers: captured.offers.map(o => ({ ...o, userAssets: [] })) }), false);
const a = analyze({ ...captured, offers: captured.offers.map(o => ({ ...o, robux: 0 })) }, 1);
assert.equal(a.deltaRap, -10);
assert.equal(a.pctRap, -10);
assert.equal(a.hasValues, false);
assert.deepEqual([1, 2, 5, 10].map(netRobux), [0, 1, 3, 7], 'Robux tax always produces whole Robux');
const labeled = { sides: [
  { role: 'get', items: [{assetId:20,rap:900}], userIds: [], rapTotal: 1336, robux:436,robuxNet:true },
  { role: 'give', items: [{assetId:10,rap:1000}], userIds: [], rapTotal:1000 }
] };
const ld = pageDetail(labeled, null);
assert.equal(ld.mine, 1, 'headings determine ownership, never column order');
const la = analyzePage(labeled, ld, {ready:true,assets:{10:['a','',1,1200],20:['b','',1,1400]}});
assert.equal(la.deltaRap, 336);
assert.equal(la.deltaValue, 636, 'net Robux are added once');
assert.equal(la.valueAvailable, true);
assert.equal(analyzePage(labeled,ld,null).rapAvailable, true);
assert.equal(analyzePage(labeled,ld,null).valueAvailable, false);
const withIds = { offers: ld.offers.map((o, index) => ({ ...o, userAssets: o.userAssets.map(i => ({ ...i, id: 900 + index, serialNumber: 123 + index })) })) };
const identity = analyzePage(labeled, ld, null, withIds);
assert.equal(identity.pageItems[0][0].instances[0].uaid, 900, 'UAIDs retain displayed side order');
assert.equal(identity.pageItems[1][0].instances[0].serial, 124);
const noSerialDetails = { offers: withIds.offers.map(o => ({ ...o, userAssets: o.userAssets.map(i => ({ ...i, serialNumber: null })) })) };
assert.equal(analyzePage(labeled, ld, null, noSerialDetails).pageItems[0][0].matchedUaid, 900, 'copy ID available without serial from matched trade');
assert.equal(analyzePage(labeled, ld, null).pageItems[0][0].matchedUaid, null, 'no guessed copy without matched trade');
const independentHistory = addKnownInstances(analyzePage(labeled, ld, null), [noSerialDetails]);
assert.equal(independentHistory.pageItems[0][0].matchedUaid, '900', 'unserialed copy resolved without user identity or capturedForPage');
const differentCopy = {offers:noSerialDetails.offers.map(o=>({...o,userAssets:o.userAssets.map(i=>({...i,id:i.id+10}))}))};
addKnownInstances(independentHistory, [noSerialDetails,differentCopy]);
assert.equal(independentHistory.pageItems[0][0].matchedUaid, null, 'identical baskets with different copies remain ambiguous');
const withoutOwners = analyzePage(labeled, ld, null);
addKnownInstances(withoutOwners, withIds.offers.map(o => ({ offers: [o] })));
assert.equal(withoutOwners.pageItems[0][0].instances[0].uaid, '900', 'serial history does not require complete offer matching');
assert.equal(withoutOwners.pageItems[1][0].instances[0].serial, '124');
const conflict = { offers: [{ userAssets: [{ assetId: 20, id: 901, serialNumber: 123 }] }] };
addKnownInstances(withoutOwners, [withIds, conflict]);
assert.equal(withoutOwners.pageItems[0][0].instances.length, 0, 'conflicting copy IDs are never guessed');

// Exercise the real content script: delayed requests, SPA navigation, rerenders.
class Node {
  constructor() {
    this.attrs = new Map(); this.listeners = new Map();
    this.children = []; this.dataset = {}; this.isConnected = true;
    const properties = new Map();
    this.style = { setProperty: (k,v,p) => properties.set(k,[v,p]),
      getPropertyValue: k => properties.get(k)?.[0] || '',
      getPropertyPriority: k => properties.get(k)?.[1] || '', removeProperty: k => properties.delete(k) };
  }
  get nextElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this)+1]; }
  get previousElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this)-1]; }
  get firstElementChild() { return this.children[0]; }
  get lastElementChild() { return this.children.at(-1); }
  append(...nodes) { for (const n of nodes) { n.parentElement = this; this.children.push(n); } }
  after(n) { const i = this.parentElement.children.indexOf(this); n.parentElement = this.parentElement; this.parentElement.children.splice(i + 1, 0, n); }
  prepend(...nodes) { for (const n of [...nodes].reverse()) { n.parentElement = this; this.children.unshift(n); } }
  contains(n) { return this === n || this.children.some(c => c.contains(n)); }
  getBoundingClientRect() { return { left: 0, right: 100, top: 0, bottom: 20, width: 100, height: 20 }; }
  insertBefore(n, anchor) { if(n.parentElement) n.parentElement.children = n.parentElement.children.filter(c => c !== n); n.parentElement = this; this.children.splice(this.children.indexOf(anchor), 0, n); }
  remove() { this.isConnected = false; if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(c => c !== this); }
  before(n) { this.parentElement.insertBefore(n, this); }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.get(k) ?? null; }
  removeAttribute(k) { this.attrs.delete(k); }
  addEventListener(k, fn) { this.listeners.set(k, fn); }
  removeEventListener(k) { this.listeners.delete(k); }
  attachShadow() { this.shadow = new Node(); return this.shadow; }
}
const parent = new Node(), left = new Node(), right = new Node();
const leftPrice = new Node(), rightPrice = new Node();
left.append(leftPrice); right.append(rightPrice);
const divider = new Node(); divider.className = 'trade-divider'; divider.style.setProperty('display','block','');
parent.append(left, divider, right);
const timers = [], requests = [], docListeners = {}, globalListeners = {};
let shown = { ...page, ok: true, sides: page.sides.map((s, i) => ({ ...s, root: i ? right : left,
  items: s.items.map(item=>({...item,card:i?right:left,priceEl:i?rightPrice:leftPrice})) })) };
a.pageItems = [[{assetId:20,value:5000}],[{assetId:10,value:4000}]];
const context = vm.createContext({
  console, Intl, Date, navigator: { language: 'fr' },
  location: { pathname: '/trades', href: 'https://www.roblox.com/trades' },
  document: { documentElement: { lang: 'fr' }, body: new Node(), hidden: false,
    createElement: () => new Node(), addEventListener: (type, fn) => { docListeners[type] = fn; } },
  chrome: { runtime: { id: 'test', getURL: path => 'chrome-extension://test/' + path,
    sendMessage: msg => new Promise(resolve => requests.push({ msg, resolve })) } },
  RoNoteDom: { readTradePage: () => shown, signatureOf: p => p.tradeId + ':' + p.sides.map(s => s.robux || 0).join(','), plain: p => p,
    phaseOf: t => /would have/i.test(t) ? 'inactive' : /gave|received/i.test(t) ? 'done' : t ? 'open' : '' },
  MutationObserver: class { observe() {} disconnect() {} }, addEventListener(type, fn) { globalListeners[type] = fn; },
  getComputedStyle: () => ({ overflowX: 'visible', overflowY: 'visible', display: 'block', flexDirection: 'row' }),
  setTimeout: fn => { timers.push(fn); return timers.length; }, setInterval: fn => { context.poll = fn; return 1; },
  clearTimeout: () => {}, clearInterval: () => {}
});
vm.runInContext(readFileSync(new URL('../src/content/trade-delta.js', import.meta.url), 'utf8'), context);
const flush = async () => { while (timers.length) timers.shift()(); await new Promise(r => setImmediate(r)); };
const host = () => parent.children.find(n => n.dataset.rn === 'delta');
await flush();
assert.equal(requests.length, 1);
const stableHost = host();
assert.equal(parent.children.indexOf(stableHost), 1, 'bars sit between both offers');
assert.equal(stableHost.nextElementSibling, divider, 'bars occupy the actual divider slot');
assert.equal(divider.style.getPropertyValue('display'), 'none', 'Roblox div separator is hidden');
shown = { ...shown, tradeId: '43' };
context.location.href += '?tradeId=43';
context.poll(); await flush();
assert.equal(requests.length, 2);
assert.equal(host(), stableHost, 'selection reuses the same bar');
assert.equal(divider.style.getPropertyValue('display'), 'none', 'divider remains hidden after selection');
requests[0].resolve({ analysis: a }); await flush();
assert.equal(host()._row.children[0].children[1].textContent, 'RAP · —');
requests[1].resolve({ analysis: a }); await flush();
assert.equal(host()._row.children[0].children[1].textContent, '−10 (−10%)');
assert.equal(host()._row.children[1].children[1].textContent, 'Value · —');
assert.equal(left.children[1].shadow.children[1].children[0].textContent,'','Value uses a small Robux icon instead of a label');
assert.equal(left.children[1].shadow.children[1].children[1].textContent,'5000','value sits below the matching RAP row');
assert.equal(right.children[1].shadow.children[1].children[1].textContent,'4000','opposite offer retains its own value');
shown.sides[0].items[0].rap = 1234;
a.pageItems[0][0] = { assetId: 20, value: null, noValue: true };
docListeners.scroll(); await flush();
assert.equal(left.children[1].shadow.children[1].children[1].textContent, '1234', 'unvalued item displays current page RAP');
a.pageItems[0][0] = { assetId: 20, value: 5000 };
docListeners.scroll(); await flush();
assert.equal(left.children[1].shadow.children[1].children[1].textContent, '5000', 'published value takes priority over RAP');
context.poll(); await flush();
assert.equal(requests.length, 2, 'unchanged trade does not refetch');
assert.equal(left.children.length,2,'no duplicate item labels');
shown = { ...shown, sides: shown.sides.map((s, i) => i ? { ...s, robux: 5 } : s) };
docListeners.input({ target: { matches: selector => selector === 'input' } }); await flush();
assert.equal(requests.length,3,'editing Robux recalculates immediately');
requests[2].resolve({ analysis: a }); await flush();
// Roblox can rebuild totals without changing the trade's data or signature.
const totalRows = [new Node(), new Node()], totalLabels = [new Node(), new Node()];
for (const [i, side] of shown.sides.entries()) {
  totalRows[i].append(totalLabels[i]); side.root.append(totalRows[i]); side.totalLabel = totalLabels[i];
}
a.valueAvailable = true; a.pageTotals = [5000, 4000];
docListeners.scroll(); await flush();
assert.equal(totalRows[0].nextElementSibling?.dataset.rn, 'total-value', 'totals restored on unchanged trade');
assert.equal(totalRows[0].nextElementSibling.children[1].children[1].textContent, '5000');
totalRows[0].nextElementSibling.remove();
docListeners.scroll(); await flush();
assert.equal(totalRows[0].nextElementSibling?.dataset.rn, 'total-value', 'removed total reattached without refetch');
const heading = new Node();
parent.append(heading); shown.tradeHeading = heading; shown.partnerId = 123;
docListeners.scroll(); await flush();
const bar = () => heading.children[0];
assert.equal(bar().dataset.rn, 'trade-tools', 'icons grouped in one bar inside the heading');
assert.match(bar().style.cssText, /position:absolute/, 'icons pinned to a fixed place in the heading');
assert.match(heading.style.getPropertyValue('padding-right'), /px$/, 'room reserved for the icons');
assert.equal(bar().children[1].href, 'https://www.rolimons.com/player/123', 'profile shortcut works outside composer');
assert.equal(bar().children[0].dataset.rn, 'serial-toggle', 'privacy button precedes profile link');
// Trade Flex only for a completed trade, read from the offer headings.
context.RoNoteFlex = { open() {}, close() {} };
docListeners.scroll(); await flush();
assert.equal(bar().children.length, 2, 'no Flex button on a pending trade');
shown.sides[0].heading = { textContent: 'Items you gave' }; shown.sides[1].heading = { textContent: 'Items you received' };
docListeners.scroll(); await flush();
assert.equal(bar().children[0]?.dataset.rn, 'trade-flex', 'Flex button on a completed trade, first so the others never move');
assert.deepEqual(bar().children.map(c => c.dataset.rn), ['trade-flex', 'serial-toggle', 'rolimons-profile']);
shown.sides[0].heading = { textContent: 'Items you would have given' };
docListeners.scroll(); await flush();
assert.equal(bar().children.length, 2, 'Flex button removed on a trade that fell through');
delete shown.sides[0].heading; delete shown.sides[1].heading; delete context.RoNoteFlex;
const serial = new Node(); serial.textContent = '#123'; serial.closest = () => null;
const serialLeaf = new Node(); serialLeaf.textContent = '#123'; serialLeaf.closest = () => null;
serial.append(serialLeaf);
serial.querySelector = selector => selector === 'button' ? null : new Node(); // image star inside badge
left.querySelectorAll = selector => selector === '*' || selector.includes('serial') ? [serialLeaf] : [];
a.pageItems[0][0].instances = [{ uaid: 99999, serial: 123 }];
const opened = []; context.window = { open: (...args) => opened.push(args) };
docListeners.scroll(); await flush();
bar().children[0].listeners.get('click')();
assert.equal(serial.style.filter, 'blur(5px)', 'privacy toggle blurs serial');
assert.equal(bar().children[0].getAttribute('aria-pressed'), 'true');
serial.listeners.get('click')({ preventDefault() {}, stopImmediatePropagation() {} });
assert.equal(opened[0][0], 'https://www.rolimons.com/uaid/99999', 'serial opens matching copy');
bar().children[0].listeners.get('click')();
assert.equal(serial.style.filter, undefined, 'second click restores serial');
serial.textContent = serialLeaf.textContent = '#456'; docListeners.scroll(); await flush();
serial.listeners.get('click')({ preventDefault() {}, stopImmediatePropagation() {} });
assert.equal(opened.length, 1, 'different serial must not open the wrong copy');
globalListeners['ronote:detail-ready'](); await flush();
const nextAnalysis = { ...a, pageItems: [[{ ...a.pageItems[0][0], instances: [{ serial: 456, uaid: 88888 }] }], a.pageItems[1]] };
requests.at(-1).resolve({ analysis: nextAnalysis }); await flush();
serial.listeners.get('click')({ preventDefault() {}, stopImmediatePropagation() {} });
assert.equal(opened.at(-1)[0], 'https://www.rolimons.com/uaid/88888', 'next trade refreshes history on reused badge without URL navigation');
serial.textContent = serialLeaf.textContent = '';
left.querySelectorAll = selector => selector === '*' || selector.includes('serial') ? [serial] : [];
shown.tradeId = '';
globalListeners['ronote:detail-ready'](); await flush();
requests.at(-1).resolve({analysis:{...a,pageItems:[[{...a.pageItems[0][0],matchedUaid:77777,instances:[]}],a.pageItems[1]]}}); await flush();
serial.listeners.get('click')({preventDefault(){},stopImmediatePropagation(){}});
assert.equal(opened.at(-1)[0], 'https://www.rolimons.com/uaid/77777', 'star without serial works without a trade ID in URL');
let prevented = false, stopped = false;
docListeners.click({ composedPath: () => [serial, left], preventDefault(){prevented=true;}, stopImmediatePropagation(){stopped=true;} });
assert.ok(prevented && stopped, 'capture handler blocks enclosing catalog link');
assert.equal(opened.at(-1)[0], 'https://www.rolimons.com/uaid/77777');
assert.equal(serial.style.pointerEvents, 'auto', 'badge receives clicks over the thumbnail');
delete left.querySelectorAll;
a.get.rap = a.give.rap + 1000000;
docListeners.input({target:{matches:()=>true}}); await flush();
requests.at(-1).resolve({analysis:a}); await flush();
assert.match(host().shadow.children[1].children[0].children[1].textContent, /1,000,000/);
shown.partnerId = 456;
docListeners.scroll(); await flush();
assert.equal(heading.children.length, 1, 'still a single icon bar after switching player');
assert.equal(bar().children.length, 2, 'one privacy button and profile shortcut after switching player');
assert.equal(bar().children[1].href, 'https://www.rolimons.com/player/456');
for (const row of totalRows) row.remove();
const residualLine = new Node();
residualLine.getBoundingClientRect = () => ({ left: 0, right: 100, top: 24, bottom: 25, width: 100, height: 1 });
host().after(residualLine);
docListeners.scroll(); await flush();
assert.equal(residualLine.style.getPropertyValue('display'), 'none', 'plain one-pixel line below calculator is hidden');
// An incomplete answer (catalogue still loading) is asked again within
// seconds: waiting a minute left the banner grey until the page was reloaded.
shown = { ...shown, sides: shown.sides.map((s, i) => i ? { ...s, robux: 7 } : s) };
docListeners.input({ target: { matches: () => true } }); await flush();
const sent = requests.length;
requests.at(-1).resolve({ analysis: { ...a, valueAvailable: false, valueMissing: 'catalog' } }); await flush();
context.poll(); await flush();
assert.equal(requests.length, sent, 'incomplete answer is not re-asked on the spot');
await new Promise(r => setTimeout(r, 1600));
context.poll(); await flush();
assert.equal(requests.length, sent + 1, 'incomplete answer re-asked after 1.5 s, not a minute');
requests.at(-1).resolve({ analysis: a }); await flush();
// Extension reloaded while the tab stays open: this copy is cut off from it.
// It must clean the page and stop, instead of throwing on every chrome.* call.
assert.ok(host(), 'bars shown before the reload');
delete context.chrome.runtime.id;
const beforeReload = requests.length;
context.poll(); await flush();
assert.equal(host(), undefined, 'orphaned script removes its bars');
assert.equal(left.children.length, 1, 'orphaned script removes item values');
assert.equal(divider.style.getPropertyValue('display'), 'block', 'orphaned script restores the separator');
docListeners.scroll(); context.poll(); await flush();
assert.equal(requests.length, beforeReload, 'orphaned script sends nothing more');
context.chrome.runtime.id = 'test';
context.location.pathname = '/home'; context.location.href = 'https://www.roblox.com/home';
context.poll(); await flush();
assert.equal(host(), undefined, 'navigation removes the bars');
assert.equal(left.children.length,1,'navigation removes item values');
assert.equal(divider.style.getPropertyValue('display'), 'block', 'original separator restored on navigation');
assert.equal(residualLine.style.getPropertyValue('display'), '', 'extra separator restored on navigation');
console.log('Page trade: headings, site totals, net Robux, stable middle placement, stale responses and navigation passed.');
