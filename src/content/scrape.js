/**
 * Lit le trade affiche sur la page roblox.com/trades et l'envoie au service
 * worker, qui s'en sert de REPLI quand l'API refuse (403) le detail d'un trade
 * contenant un bundle. Ce qui est a l'ecran est alors la source la plus sure,
 * quelle que soit la maniere dont la page l'a obtenu.
 *
 * La lecture elle-meme est dans `content/tradedom.js`, un lecteur a part
 * pour qu'elle reste testable seule. Ce fichier est declare APRES lui
 * dans le manifeste et le trouve dans le monde isole, sans rien charger — la
 * politique de securite de Roblox refuse le scheme `chrome-extension:`.
 */
(() => {
  // Rien au niveau global : voir content/relay.js. Un `const` de trop ici et
  // c'est ce fichier qui disparait, en silence.
  const B = globalThis.browser ?? globalThis.chrome;
  const dom = globalThis.RoNoteDom;
  if (!dom) {
    console.warn('[RoNote] lecture de la page indisponible : content/tradedom.js non chargé');
    return;
  }

  // Pose sur tout roblox.com (l'application est monopage), actif seulement la
  // ou il y a un trade a lire.
  const onTradesPage = () => /^\/trades(?:[/?#]|$)/i.test(location.pathname);

  let lastSent = '';

  function publish() {
    if (!onTradesPage()) return;
    let page;
    try { page = dom.readTradePage(); } catch { return; }
    if (!page.ok || (!page.tradeId && !page.handle)) return;

    const sig = dom.signatureOf(page);
    if (sig === lastSent) return;               // rien de neuf a envoyer
    lastSent = sig;

    const flat = dom.plain(page);
    const trade = {
      tradeId: flat.tradeId,
      handle: flat.handle,
      // Les identifiants de profil accompagnent les colonnes : c'est le
      // service worker, qui seul connait le compte connecte, qui tranche
      // laquelle est la mienne. La position ne le dit pas.
      give: flat.sides[0].items,
      get: flat.sides[1].items,
      userIds: flat.sides.map(s => s.userIds),
      at: Date.now()
    };
    try { B.runtime.sendMessage({ type: 'ronote:scraped-trade', trade }); } catch { /* ignore */ }
  }

  let timer = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(publish, 400); };

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();
