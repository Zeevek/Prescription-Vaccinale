# Prescription vaccinale — aide à la prescription à l'officine

Application web autonome (un seul `index.html`, JavaScript natif, sans dépendance ni CDN, hors ligne) qui guide le pharmacien d'officine de l'entretien pré-vaccinal jusqu'à l'ordonnance et l'attestation de vaccination.

## Parcours

1. **Patient** — lecture du **Datamatrix INS** d'un document de santé (douchette ou caméra) qui remplit nom et prénoms de naissance, sexe, date de naissance et NIR ; sinon saisie de l'identité (nom, prénoms, sexe, date de naissance → âge), données AM facultatives (NIR, rang, organisme) pour le bon de prise en charge, médecin traitant et consentement à la transmission.
2. **Entretien pré-vaccinal** — reprise de la fiche de recueil : immunosuppresseurs, corticothérapie > 10 mg/j > 14 j, anticoagulants, immunodépression, grossesse (terme en SA), projet de grossesse, allaitement, anaphylaxie vaccinale, allergies (œuf, gélatine, aminosides, PEG, polysorbate 80, levure), fièvre, infection aiguë, Guillain-Barré post-vaccinal, vaccin vivant < 4 semaines, contexte de voyage. Toutes les questions doivent être renseignées.
3. **Profil & antécédents** — facteurs de risque (pathologies, immunité, entourage, mode de vie, profession) et antécédents par valence.
4. **Recommandations** — pour chaque valence : recommandé / peut être proposé / à différer / orienter / contre-indiqué / schéma en cours / à jour, avec motif, schéma, prochaine échéance, prise en charge et référence. Choix de la spécialité (filtrée par âge AMM et allergènes), de la voie (SC proposée sous anticoagulant si le RCP l'autorise) et du rang de dose. Dérogation possible pour un vaccin « à jour / en cours / non indiqué » avec justification écrite, reportée sur la fiche d'entretien.
   Pour chaque vaccin, l'acte se choisit : **Délivrance + injection** à l'officine, ou **Délivrance seule** (injection par un autre professionnel habilité). Les deux peuvent coexister sur la même ordonnance.
5. **Ordonnance** — vérifications bloquantes (officine, pharmacien formé et déclaré à l'Ordre, RPPS à 11 chiffres, identité, entretien complet, attestation d'entretien et de consentement) puis impression de l'ordonnance (un seul exemplaire, numérisé ensuite dans le dossier patient) et de la fiche d'entretien. Chaque ligne précise « + Acte d'injection par le pharmacien » ou « Délivrance seule » avec les conseils de conservation.
6. **Délivrance & vaccination** — **scan du Datamatrix** de la boîte (douchette ou caméra) : produit, lot et péremption remplis automatiquement, blocage si périmé, alerte si la boîte ne correspond pas à la spécialité prescrite. Pour les vaccins injectés : voie, site, date/heure, vaccinateur, cases DMP / carnet / ordonnancier / médecin traitant, attestation, message MSSanté. Rappel de facturation (CIP seul pour une délivrance ; CIP + RVA / VGP / INJ pour une injection ; code prescripteur pharmacien pour Abrysvo).

## Scan du Datamatrix

- **Identité (étape 1)** : le Datamatrix INS (spécification ANS v2.2, en-tête « IS ») présent sur les documents de santé émis par les logiciels référencés INS (ordonnances, comptes rendus, lettres de liaison) remplit l'identité. Il n'est pas signé : l'identité doit être vérifiée avec le patient. Pour un ayant droit, corriger le NIR (celui de l'assuré ouvrant droit).
- **Carte Vitale / lecteur Kapelse** : non pris en charge. Un navigateur n'a pas accès au lecteur de cartes, et la lecture de la carte Vitale passe par l'API Lecture Vitale du GIE SESAM-Vitale, diffusée sous licence après référencement auprès du CNDA ; les données protégées nécessitent en plus une carte CPS.

- **Douchette** (USB / Bluetooth en émulation clavier) : à l'étape 6, scanner directement — le champ de scan reçoit le code même s'il n'a pas le focus. Formats acceptés : chaîne GS1 brute avec ou sans séparateur FNC1, format avec parenthèses, préfixe `]d2`, et douchette restée en QWERTY sur un poste AZERTY. Conseil : activer la transmission du FNC1/GS dans la configuration de la douchette pour une lecture sans ambiguïté.
- **Caméra** (smartphone / tablette) : bouton « Caméra », disponible sur les navigateurs qui prennent en charge la détection native des codes Datamatrix (Chrome / Edge sur Android et Windows/macOS récents). Non disponible sous Firefox et Safari iOS : utiliser la douchette ou la saisie. Nécessite HTTPS.
- **CIP appris** : aucune base de CIP n'est embarquée. Au premier scan d'une référence, l'outil demande à quelle spécialité prescrite elle correspond et mémorise le CIP13 dans le catalogue (exporté avec `config.json`, modifiable dans Paramètres → Catalogue).

## Conformité de l'ordonnance

L'ordonnance reprend les mentions de l'article R. 5132-3 du CSP : nom, qualité et identifiant RPPS du prescripteur, adresse professionnelle avec la mention « France », téléphone au format international, date, nom, prénoms, sexe et âge du patient (poids si renseigné), dénomination commune et spécialité, posologie et voie, quantité. Elle mentionne le cadre de la prescription pharmaceutique (art. L. 5125-1-1 A et R. 5125-33-8 du CSP, arrêté du 8 août 2023 modifié) et réserve un emplacement pour la signature et le cachet. L'attestation reprend le modèle de la formation (lot, péremption, vaccinateur, officine) et le décret n° 2023-736.

Périmètre appliqué (Ordre des pharmaciens, « qui peut faire quoi », 19/01/2026) : prescription dès 11 ans des vaccins du calendrier, sauf vaccins vivants chez l'immunodéprimé ; grippe dès 11 ans y compris hors recommandations ; Covid-19 dès 5 ans ; vaccins du voyageur exclus.

## Référentiel

- Calendrier des vaccinations et recommandations vaccinales 2026 (ministère de la Santé, avril 2026), y compris le tableau de transition des rappels dTcaP de l'adulte.
- HAS — Rattrapage vaccinal en population générale (2019).
- Mémos Assurance Maladie (vaccination par le pharmacien, grippe) ; supports de formation « Prescription des vaccins à l'officine » (mai 2026).

Le moteur est isolé dans le bloc `<script id="vp-engine">` de `index.html`. La composition en allergènes des spécialités est indicative : vérifier le RCP. Le catalogue (spécialités actives, dénomination du vaccin Covid de la campagne, allergènes), les dates de campagne et les honoraires se modifient dans **Paramètres**.

## Paramétrage et postes multiples

- **Paramètres** (protégés par un code PIN facultatif) : officine, pharmaciens (RPPS, formé et déclaré), campagnes, honoraires, catalogue, registre local facultatif (désactivé par défaut).
- Les paramètres sont stockés dans le navigateur. **Exporter** produit un `config.json` ; l'importer sur chaque poste (compatible Firefox).
- Aucune donnée patient n'est envoyée ni conservée : la saisie s'efface avec « Nouveau patient » (sauf registre local, si activé).

## Installation sur le serveur maison

Ce sont des fichiers statiques : n'importe quel serveur web suffit.

```bash
sudo apt install nginx
sudo git clone https://github.com/Zeevek/Prescription-Vaccinale.git /var/www/vaccins
```

```nginx
server {
    listen 80;
    server_name vaccins.local;          # ou l'IP du serveur
    root /var/www/vaccins;
    index index.html;
    location ~ /(\.git|tests) { deny all; }
    location = /config.json { add_header Cache-Control "no-store"; }
}
```

Déposez le `config.json` exporté depuis Paramètres dans `/var/www/vaccins/` : tous les postes le chargent automatiquement au démarrage (dès que sa révision est plus récente que la leur). Mise à jour : `git pull`. Pour le mode hors ligne (service worker) hors `localhost`, servez en HTTPS (certificat local ou Caddy).

## Tests

```bash
node tests/engine.test.js     # 79 cas cliniques sur le moteur
node tests/gs1.test.js        # lecture des Datamatrix GS1
python3 tests/ui.test.py      # parcours complet dans Chromium (Playwright), captures dans tests/out/
```

Le paramètre d'URL `?date=AAAA-MM-JJ` simule la date du jour (tests, contrôle d'une campagne).

---
Outil d'aide à la décision : il ne se substitue ni au jugement du pharmacien ni au calendrier des vaccinations en vigueur.
