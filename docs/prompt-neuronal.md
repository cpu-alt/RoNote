# Prompt à coller dans le chat Claude côté Neuronal

Copie tout ce qui est entre les deux lignes.

---

Tu travailles sur le site **neuronal.live** (le réseau Neuronal : la carte des
traders Roblox et le bot qui la remplit). L'extension navigateur **RoNote**
(dépôt public : https://github.com/cpu-alt/RoNote) vient d'ajouter une option
« Contribuer au réseau Neuronal ». Les utilisateurs qui l'activent envoient au site
la présence de leur compte et leurs trades Roblox terminés, avec les objets exacts
et **les Robux**. Ton travail : tout le côté site.

**Lis d'abord ces deux fichiers, ils font foi :**

1. Le cahier des charges complet :
   https://raw.githubusercontent.com/cpu-alt/RoNote/neuronal-contribution/docs/brief-neuronal.md
2. Le code qui envoie les données (pour voir le format exact et comment
   l'extension réagit à chaque code HTTP) : fonctions `tradeReport` et
   `shareWithNeuronal` dans
   https://raw.githubusercontent.com/cpu-alt/RoNote/neuronal-contribution/src/background/neuronal.js

(Si la branche `neuronal-contribution` n'existe plus, remplace-la par `main` dans
les liens.)

**En résumé, il faut :**

1. **Deux routes** : `POST /ext/v1/presence` et `POST /ext/v1/trades`. Elles
   reçoivent du JSON, sans cookie, avec l'en-tête `X-RoNote`. Il faut le CORS pour
   les origines `chrome-extension://` et `moz-extension://`, un schéma strict, une
   limite de débit (429, jamais de ban) et une taille max. **Le format est fixe** :
   l'extension est déjà codée, c'est le serveur qui s'adapte.
2. **Vérifier avant de croire** : il n'y a aucune authentification, donc un trade
   reçu est une simple déclaration. Confirme-le avec tes scans d'inventaire (les
   `uaid` doivent être passés d'un joueur à l'autre autour de la date `seen`), ou
   quand les deux participants envoient le même trade. N'affiche les Robux que sur
   un trade confirmé. Un compte ne devient « utilisateur RoNote » qu'après au moins
   un trade confirmé.
3. **Fusionner** chaque trade confirmé avec le trade que tu avais déduit. La clé est
   l'`id` du trade Roblox. Le contenu exact et les Robux remplacent ta déduction.
4. **Routes de lecture** `GET /ext/v1/player/{id}` et `GET /ext/v1/item/{id}` :
   - ajoute `"ronote": true` sur un joueur RoNote vérifié ;
   - dans chaque trade de `recent`, ajoute `"gave_robux"` et `"got_robux"` (entiers,
     0 par défaut) et `"via_ronote": true` quand le trade est confirmé par RoNote ;
   - vide le cache de lecture d'un joueur quand un de ses trades arrive.
5. **Carte `/network`** :
   - un **cadre bleu `#3d8eff`** autour des joueurs RoNote, avec une légende ;
   - les trades confirmés en trait net, avec les Robux au survol ;
   - si possible, un filtre « seulement les utilisateurs RoNote ».
6. **Une nouvelle page `neuronal.live/ronote`** qui présente l'extension, dans le
   style du site (gris neutres, un seul bleu, aplats, police Onest) :
   - un en-tête avec les boutons Chrome Web Store / Firefox (des liens provisoires
     pour l'instant) et Discord ;
   - les fonctionnalités ;
   - une section « RoNote × Neuronal » ;
   - les compteurs en direct, via `GET /ext/v1/stats` → `{ "users_7d", "trades" }` ;
   - ce qui est envoyé, et rien d'autre ;
   - une FAQ, dont « comment me retirer de la carte ».
7. **Un moyen de supprimer ses données** sur demande.

Commence par regarder comment le site et le bot sont organisés : où la route
`/ext/v1` existe déjà, comment les trades sont déduits et stockés, comment la carte
est rendue. Propose-moi ensuite un plan avant de coder. Pour tester, l'extension
appelle `https://neuronal.live/ext/v1/` en production : dis-moi si tu veux une
adresse de staging, et je la mettrai dans `src/common/defaults.js` (`NEURONAL.api`).

---
