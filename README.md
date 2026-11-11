# Mes projets — lanceur GitHub Pages

Une petite application web (PWA) mobile first qui liste mes dépôts GitHub ayant GitHub Pages activé et les ouvre en un tap dans un nouvel onglet. Installable sur l'écran d'accueil, utilisable hors ligne.

Chaque projet peut s'afficher en **liste**, avec son **icône**, ou avec une **capture d'écran** du site lancé. Ces visuels sont générés automatiquement par une GitHub Action (voir plus bas).

## Contenu

| Fichier | Rôle |
|---|---|
| `index.html` | L'application complète (HTML + CSS + JS) |
| `manifest.webmanifest`, `sw.js`, `icons/` | Installation sur l'écran d'accueil, mode hors ligne, icônes de l'appli |
| `.github/workflows/update-projects.yml` | L'Action qui génère captures, icônes et `projects.json` |
| `scripts/build-projects.mjs` | Le script lancé par l'Action (Playwright + sharp) |
| `projects.config.json` | Réglages de la génération (exclusions, taille de capture…) |
| `package.json`, `package-lock.json` | Dépendances du script |
| `projects.json`, `shots/`, `icons/projects/` | **Générés par l'Action** : liste des projets, captures, icônes |
| `.nojekyll` | Demande à GitHub Pages de servir les fichiers tels quels |

## Mise en ligne (une seule fois)

1. Crée un dépôt GitHub (par exemple `mes-projets`) et pousse-y tout le contenu de ce dossier à la racine :
   ```bash
   git init
   git add .
   git commit -m "Lanceur GitHub Pages"
   git branch -M main
   git remote add origin https://github.com/PierreCyrilDecrock/mes-projets.git
   git push -u origin main
   ```
2. **Settings → Pages → Build and deployment → Deploy from a branch**, branche `main`, dossier `/ (root)`.
3. **Onglet Actions → « Mettre à jour les projets » → Run workflow.** Au bout de quelques minutes, l'Action ajoute au dépôt `projects.json`, `shots/` et `icons/projects/`, puis GitHub Pages republie le site.
4. Ouvre `https://pierrecyrildecrock.github.io/mes-projets/` et installe l'appli sur l'écran d'accueil.

Tous les chemins sont relatifs : l'appli fonctionne aussi dans le dépôt `pierrecyrildecrock.github.io` (racine).

> Si l'étape 3 échoue au moment d'enregistrer les changements, vérifie **Settings → Actions → General → Workflow permissions** : choisis *Read and write permissions*.

## Installation sur l'écran d'accueil

- **iPhone / iPad (Safari)** : bouton Partager → *Sur l'écran d'accueil*.
- **Android (Chrome)** : menu ⋮ → *Installer l'application*.
- **Ordinateur (Chrome / Edge)** : icône d'installation dans la barre d'adresse.

## Captures et icônes

L'Action ouvre chaque projet dans un navigateur (Chromium), attend le chargement, puis :

- enregistre une **capture d'écran** (`shots/<projet>.jpg`) ;
- cherche l'**icône du projet** (`apple-touch-icon`, favicon, ou icônes du manifeste du site) et l'enregistre en PNG (`icons/projects/<projet>.png`). Si le projet n'en déclare aucune, une **vignette carrée de la capture** est utilisée à la place.

Elle tourne **chaque jour** (nouveaux projets, mises à jour), à la demande (onglet Actions), et quand `projects.config.json` ou le script changent. Seuls les projets modifiés depuis le dernier passage sont recapturés ; pour tout refaire, lance l'Action avec l'option *force*.

Pour qu'un projet ait **sa propre icône**, ajoute dans le `<head>` de son `index.html` :

```html
<link rel="icon" href="icon.png">
<link rel="apple-touch-icon" href="icon.png">
```

(PNG ou SVG, au moins 48 × 48 px ; le format `.ico` n'est pas lu.)

### Réglages : `projects.config.json`

```json
{
  "exclude": ["un-depot-a-ignorer"],
  "includeForks": false,
  "viewport": { "width": 1280, "height": 720 },
  "waitMs": 2000
}
```

- `exclude` : dépôts à ne pas afficher (le dépôt de l'appli elle-même est déjà exclu).
- `viewport` : taille de la fenêtre de capture. Le format 16:9 remplit l'aperçu sans rognage.
- `waitMs` : pause avant la capture, en millisecondes. Augmente-la pour un projet qui affiche d'abord un écran de chargement, une animation d'intro ou une scène 3D.

## Affichage dans l'appli

Dans ⚙︎ → **Affichage** : liste simple (par défaut), avec icônes, ou avec aperçus. ★ épingle un projet en haut, ↻ recharge la liste.

## Si le message « Load failed » apparaît

Il signifie que la page n'a pas pu joindre l'API GitHub. Causes habituelles :

- la page est ouverte **depuis un aperçu de fichier** (pièce jointe, application Fichiers) et non depuis son adresse `https://…github.io/…` ;
- l'appareil est hors ligne, ou la limite de 60 requêtes par heure de l'API GitHub est atteinte.

Une fois `projects.json` généré (étape 3), l'appli ne contacte plus l'API GitHub : elle lit ce fichier depuis son propre site. Tant qu'il n'existe pas, elle interroge l'API en direct et affiche, en cas d'échec, une liste de secours signalée comme non vérifiée, avec un bouton *Réessayer*.

## Limites

- Seuls les dépôts **publics** avec GitHub Pages sont listés.
- La capture montre la **première page** du site. Un site qui exige une connexion, ou qui affiche d'abord un bandeau de consentement, sera capturé dans cet état.
- Un projet dont le site renvoie une erreur (build en échec, par exemple) apparaît sans capture ; l'erreur est notée dans `projects.json` et dans les journaux de l'Action.
- L'Action est gratuite pour un dépôt public. GitHub désactive toutefois les exécutions planifiées après 60 jours sans activité dans le dépôt : il suffit de les réactiver depuis l'onglet Actions.

## Mettre à jour l'appli

Après toute modification de `index.html`, `sw.js` ou des icônes, change `VERSION` dans `sw.js` (`v3` → `v4`…) pour que les appareils déjà installés récupèrent la nouvelle version.

## Tester en local

```bash
python3 -m http.server 8000        # puis http://localhost:8000
```

Pour lancer la génération à la main (Node 20 ou plus) :

```bash
npm install
npx playwright install chromium
GITHUB_USER=PierreCyrilDecrock npm run build:projects
```
