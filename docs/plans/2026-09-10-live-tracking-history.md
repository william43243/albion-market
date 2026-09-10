# Live Tracking dans l’historique — Plan d’implémentation

> **Pour Hermes :** exécuter ce plan avec validation TDD et revue indépendante avant tout commit.

**Objectif :** Ajouter dans l’onglet Historique un mode `Live tracking` qui interroge AODP une seule fois toutes les 5 secondes pour toutes les villes sélectionnées, puis superpose les observations live horodatées au graphique comparatif.

**Architecture :** Conserver intactes les sélections existantes (item(s), villes, période, échelle, qualité) et le bouton `Comparer`. Ajouter un état de session live indépendant de l’historique chargé. Les appels live utiliseront l’endpoint AODP `prices`, avec les villes regroupées dans une seule URL et les items regroupés lorsque la limite d’URL le permet. Le modèle de graphique distinguera les observations nouvelles des polls sans changement ; ces derniers produiront un segment horizontal pointillé dans la couleur de la ville.

**Stack :** React Native / TypeScript, `react-native-chart-kit`, `react-native-svg`, tests `node:test` via `tsx`.

---

## Décisions techniques

- **Limites AODP vérifiées le 2026-09-10 :** 180 requêtes par minute et 300 requêtes par 5 minutes. À 1 requête toutes les 5 secondes, la session consomme 12/minute et 60/5 minutes, donc reste sous les limites documentées.
- **Cadences proposées :** `5 secondes`, `1 minute`, `5 minutes`. Le défaut sera **1 minute** : assez réactif pour suivre une session, beaucoup plus lisible et moins générateur de trafic que 5 secondes. Le mode 5 secondes reste disponible pour les joueurs qui veulent observer chaque changement dès qu’AODP en publie un.
- **Budget réseau par cadence et par session :** 5 s = 12 appels/minute et 60/5 minutes ; 1 min = 1 appel/minute et 5/5 minutes ; 5 min = 1 appel/5 minutes. Chaque cadence respecte les limites AODP de 180/minute et 300/5 minutes.
- **Lisibilité :** les données brutes restent dédupliquées par timestamp. En cadence 5 s, le graphique ne doit pas devenir illisible à cause de 120 points identiques : les polls sans nouveau timestamp deviennent des segments pointillés compressibles/agrégés visuellement, sans perdre l’information du nombre de polls ni de la dernière fraîcheur. Les observations avec nouveau timestamp restent toutes conservées.
- **Endpoint live :** `GET /api/v2/stats/prices/{itemList}.json`, car l’historique AODP ne crée pas nécessairement une nouvelle observation toutes les 5 secondes. Le timestamp de l’observation retournée sert à détecter la nouveauté.
- **Métrique affichée en live :** `sell_price_min`, cohérente avec un prix de vente observable. Une réponse sans prix observé valide produit un état `unknown/no-data`, pas un zéro inventé.
- **Détection :** une observation est nouvelle si son timestamp de prix est plus récent que le dernier timestamp connu de la série. Même timestamp = pas de donnée nouvelle, même si le poll HTTP a réussi.
- **Pas de requêtes concurrentes :** si un poll dépasse 5 secondes, le tick suivant est ignoré ; il ne démarre pas un second appel parallèle.
- **Arrêt fail-safe :** arrêter le polling lors de la désactivation, du changement d’item/ville/serveur/qualité, du démontage de l’écran ou d’une erreur bloquante. Aucun timer orphelin.
- **Graphique :** conserver les boutons de sélection et leur comportement. Ajouter seulement un bouton de contrôle `LIVE TRACKING` et un indicateur d’état. Les segments live sans nouvelle donnée doivent être rendus avec `strokeDasharray`, dans la couleur de la ville ; ne pas utiliser de zéro ou de valeur répétée comme faux point historique.
- **URL AODP :** respecter la limite documentée de 4096 caractères. Pour une sélection dépassant cette limite, découper en chunks, mais une sélection normale d’un item et des villes choisies doit rester une requête par tick. Le plan prévoit un garde-fou explicite plutôt qu’une URL silencieusement tronquée.

**Sources :**
- https://www.albion-online-data.com/api/ — limites API, limite URL 4096 caractères, recommandation gzip.
- https://www.albion-online-data.com/client-faq — contexte des limites côté AODP.

---

## Tâche 1 : Formaliser le modèle de données live

**Objectif :** Créer des fonctions pures qui transforment les réponses `PriceData` en points live et classifient chaque poll.

**Fichiers :**
- Créer : `lib/liveTracking.ts`
- Tester : `tests/liveTracking.test.ts`

**Étapes :**

1. Écrire les tests pour :
   - une observation valide `sell_price_min` devient un point avec timestamp AODP ;
   - `0001-01-01T00:00:00` et prix nul sont rejetés ;
   - timestamp plus récent = `new-data` ;
   - même timestamp = `no-new-data` ;
   - réponse absente/invalide = `no-data` sans valeur zéro ;
   - les clés incluent `item_id`, ville et qualité pour isoler les séries.
2. Exécuter `npm test -- tests/liveTracking.test.ts` et constater l’échec initial.
3. Implémenter les types et fonctions pures, sans timer ni dépendance React.
4. Exécuter le test ciblé puis `npm test`.

---

## Tâche 2 : Ajouter une requête AODP groupée pour les prix live

**Objectif :** Exposer une fonction API qui interroge toutes les villes sélectionnées dans un seul appel logique.

**Fichiers :**
- Modifier : `lib/api.ts`
- Tester : `tests/api.test.ts` ou `tests/liveTracking.test.ts`

**Étapes :**

1. Écrire un test avec `globalThis.fetch` mocké vérifiant :
   - une seule URL pour plusieurs villes ;
   - `locations` contient exactement les villes sélectionnées ;
   - `qualities` et serveur sont conservés ;
   - les entrées retournées sont filtrées par item, ville et qualité ;
   - un HTTP non-2xx lève une erreur.
2. Exécuter le test et vérifier l’échec initial.
3. Ajouter une fonction du type `fetchCurrentPricesBatch` réutilisable par le live tracking, avec déduplication et garde-fou de longueur d’URL.
4. Ne pas modifier le comportement des sélecteurs ni casser le cache existant ; le cache live doit être désactivé ou avoir une clé/TTL compatible avec le polling afin de ne pas masquer le contrôle de fraîcheur.
5. Exécuter les tests ciblés, puis `npm test` et `npm run typecheck`.

---

## Tâche 3 : Construire un contrôleur de session live sans chevauchement

**Objectif :** Encapsuler le polling 5 secondes et son cycle de vie de manière testable.

**Fichiers :**
- Créer : `lib/liveTrackingController.ts`
- Tester : `tests/liveTrackingController.test.ts`

**Étapes :**

1. Écrire les tests avec horloge/fetch contrôlés pour :
   - premier tick immédiat à l’activation ;
   - intervalle de 5 000 ms ;
   - une seule invocation fetch par tick, avec toutes les villes ;
   - tick ignoré pendant une requête en cours ;
   - arrêt qui empêche tout tick ultérieur ;
   - erreur réseau qui conserve les données déjà affichées et expose l’état d’erreur ;
   - changement de configuration qui invalide les résultats d’une ancienne requête.
2. Exécuter le test et constater l’échec initial.
3. Implémenter le contrôleur avec `start`, `stop`, `pollNow`, verrou `inFlight` et génération de requête.
4. Exécuter les tests ciblés puis toute la suite.

---

## Tâche 4 : Préparer le modèle de graphique avec segments pointillés

**Objectif :** Produire un modèle de séries qui distingue visuellement les nouveaux points des intervalles sans mise à jour.

**Fichiers :**
- Modifier ou créer : `lib/liveChart.ts`
- Tester : `tests/liveChart.test.ts`

**Étapes :**

1. Écrire les tests pour :
   - insertion chronologique des points ;
   - conservation de la dernière valeur connue pendant un poll sans donnée nouvelle ;
   - segment `dashed` horizontal avec la couleur exacte de la ville ;
   - plusieurs villes indépendantes ;
   - suppression/déduplication d’un timestamp identique ;
   - absence de ligne si aucune valeur valide n’a jamais été reçue.
2. Exécuter les tests et constater l’échec initial.
3. Implémenter un modèle indépendant du rendu, avec `timestamp`, `value`, `status`, `city`, `color`.
4. Adapter le rendu : utiliser `strokeDasharray` de `react-native-svg`/`react-native-chart-kit` pour les segments concernés. Si `LineChart` ne permet pas des styles mixtes dans un même dataset, rendre la ligne historique/normale et les segments pointillés via un overlay SVG calculé à partir des mêmes bornes X/Y.
5. Exécuter tests, typecheck et vérification visuelle sur émulateur/appareil si disponible.

---

## Tâche 5 : Intégrer le bouton Live Tracking dans `HistoryScreen`

**Objectif :** Ajouter le contrôle live sans changer les boutons de sélection existants.

**Fichiers :**
- Modifier : `screens/HistoryScreen.tsx`
- Modifier : `lib/i18n.ts`
- Éventuellement modifier : `constants/theme.ts`

**Étapes :**

1. Écrire/adapter les tests d’intégration ou les tests de modèle pour :
   - activation impossible sans item et ville ;
   - activation immédiate après sélection valide ;
   - désactivation explicite ;
   - changement de sélection qui arrête et réinitialise la session ;
   - le bouton `Comparer`, les boutons de villes, période, échelle, qualité et sélection d’items restent présents et inchangés.
2. Ajouter les traductions FR/EN/ES : `liveTracking`, `liveTrackingOn`, `liveTrackingOff`, `liveWaiting`, `newData`, `noNewData`, `lastPoll`, `stopLiveTracking`, erreur de rate limit.
3. Ajouter le bouton `Live tracking` près du bouton `Comparer`, sans modifier les composants ou handlers de sélection.
4. Afficher un état compact : actif/inactif, dernier poll, fraîcheur du dernier timestamp AODP, et nombre de séries suivies.
5. Brancher le contrôleur sur la configuration courante `selectedItems`, `selectedCities`, `server`, `quality`.
6. Fusionner proprement les données historiques et live dans le modèle du graphique, sans remplacer les statistiques historiques par les polls de 5 secondes.
7. Nettoyer le contrôleur dans l’effet de démontage et lors de toute modification de configuration.
8. Exécuter `npm test`, `npm run typecheck`, puis vérifier le rendu Android/Web selon les plateformes supportées.

---

## Tâche 6 : Ajouter le sélecteur de cadence et préserver la lisibilité

**Objectif :** Permettre de choisir 5 secondes, 1 minute ou 5 minutes sans toucher aux sélecteurs de données existants.

**Fichiers :**
- Créer : `components/LivePollingSelector.tsx` ou intégrer un contrôle local dédié
- Modifier : `screens/HistoryScreen.tsx`
- Modifier : `lib/i18n.ts`
- Modifier : `lib/liveTrackingController.ts`
- Modifier : `lib/liveChart.ts`
- Tester : `tests/liveTrackingController.test.ts`, `tests/liveChart.test.ts`

**Étapes :**

1. Écrire les tests vérifiant les délais exacts : 5 000 ms, 60 000 ms et 300 000 ms.
2. Tester que le défaut est 60 000 ms et que le changement de cadence arrête l’ancien timer avant de démarrer le nouveau.
3. Tester le budget d’appels calculé pour chaque option : 12/minute, 1/minute et 1/5 minutes.
4. Ajouter un contrôle visuel compact `Fréquence : 5 s / 1 min / 5 min` à proximité du bouton Live tracking ; ne modifier aucun bouton de sélection d’item, de ville, de période, d’échelle ou de qualité.
5. Afficher une indication discrète en mode 5 secondes : données brutes dédupliquées, affichage condensé pour la lisibilité.
6. Implémenter la décimation visuelle des polls sans nouveau timestamp : conserver le compteur et l’état de l’intervalle, mais ne pas dessiner 120 points identiques superposés.
7. Exécuter les tests ciblés, `npm test` et `npm run typecheck`.

---

## Tâche 7 : Garde-fous réseau et UX

**Objectif :** Éviter les abus d’API et rendre les états ambigus explicites.

**Fichiers :**
- Modifier : `lib/api.ts`
- Modifier : `lib/liveTrackingController.ts`
- Modifier : `screens/HistoryScreen.tsx`
- Tester : `tests/liveTrackingController.test.ts`

**Étapes :**

1. Ajouter un backoff temporaire sur HTTP 429/5xx, sans lancer de requêtes parallèles ni contourner les limites.
2. Après erreur 429, suspendre la session et afficher une action de reprise manuelle plutôt que continuer à marteler l’API.
3. Ajouter une protection contre une configuration vide et une URL dépassant 4096 caractères.
4. Vérifier que le polling consomme bien 1 appel logique par cycle, jamais 1 appel par ville.
5. Tester les scénarios 429, timeout, arrêt, reprise et changement d’item.

---

## Tâche 8 : Validation finale et revue adverse

**Objectif :** Prouver que la fonctionnalité fonctionne sans régression.

**Commandes :**

```bash
npm test
npm run typecheck
python tools/automation/issue8_regression_checks.py
```

**Vérifications manuelles :**

- sélectionner un item et plusieurs villes ;
- charger l’historique avec `Comparer` ;
- activer `Live tracking` ;
- confirmer une seule requête groupée par cycle dans les logs réseau ;
- confirmer le timestamp de chaque nouvelle observation ;
- confirmer une ligne horizontale pointillée de la bonne couleur lorsqu’AODP renvoie le même timestamp ;
- changer de ville/item/qualité/serveur et confirmer l’arrêt de l’ancienne session ;
- désactiver le tracking et confirmer l’absence de requête ultérieure ;
- vérifier les trois langues ;
- vérifier qu’aucun bouton de sélection n’a été modifié.

Avant commit, faire une revue indépendante du diff avec les contrôles sécurité et logique. Ne pas committer les changements locaux préexistants non liés à cette fonctionnalité.

## Critères d’acceptation

- [ ] Un bouton `Live tracking` est visible dans l’onglet Historique.
- [ ] Les boutons de sélection existants n’ont pas changé de comportement.
- [ ] Une session active envoie au maximum un appel groupé toutes les 5 secondes.
- [ ] Toutes les villes sélectionnées sont incluses dans l’appel groupé.
- [ ] Le rythme reste sous les limites AODP documentées : 12 appels/minute et 60 appels/5 minutes au maximum.
- [ ] Les points nouveaux sont ajoutés avec leur timestamp AODP réel.
- [ ] Un timestamp inchangé produit un segment horizontal pointillé dans la couleur de la ville.
- [ ] Aucune donnée manquante n’est transformée en zéro ou en faux timestamp.
- [ ] Le polling s’arrête proprement et ne crée aucune requête concurrente.
- [ ] Les erreurs 429/5xx, timeouts et données invalides sont visibles et fail-safe.
- [ ] Tests et typecheck passent.
