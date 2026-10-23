# Application MERN — éléments, inscription et connexion

Cette application respecte le principe demandé : un frontend statique en HTML/CSS/JavaScript appelle une API Express connectée à MongoDB. Elle permet de créer un compte, se connecter, afficher les éléments enregistrés et en ajouter.

## Logique de l'application

1. Le navigateur affiche par défaut la connexion (`#login`) ou l'inscription (`#register`). Les contrôles côté client empêchent les envois évidents : e-mail invalide, champs vides, mot de passe de moins de huit caractères sans lettre ou chiffre, et confirmation différente.
2. L'inscription envoie `POST /api/auth/register`. L'API refait toutes les validations, normalise l'e-mail en minuscules, vérifie son unicité, puis enregistre uniquement un hash bcrypt du mot de passe dans la collection `users`. Le mot de passe et son hash ne sont jamais renvoyés.
3. La connexion envoie `POST /api/auth/login`. Après comparaison bcrypt, l'API crée un JWT signé. Le navigateur conserve le jeton et les informations publiques de l'utilisateur dans `sessionStorage`, uniquement pour la durée de l'onglet.
4. Après connexion, la vue `#app` charge `GET /api/items` et rend la liste sans injecter de HTML non fiable (`textContent`). Le formulaire envoie `POST /api/items` avec un `clientId` généré par le navigateur.
5. `clientId` est indexé de manière unique dans MongoDB. Si le navigateur répète un même POST (par exemple après une coupure), l'API renvoie l'élément déjà créé au lieu de créer un doublon : c'est l'idempotence.
6. Toutes les requêtes passent par `requestApi`. Elle essaie les URLs déclarées en tête de `front/app.js`, avec un délai d'attente via `AbortController`. Si une réponse n'est pas réussie ou si le réseau échoue, elle essaie l'URL suivante. Les deux APIs doivent utiliser le même schéma et la même base pour que la bascule affiche les mêmes données.

## Installation locale

Prérequis : Node.js 18+ et un cluster MongoDB Atlas accessible.

```bash
cd back
# renseigner MONGODB_URI et une vraie valeur JWT_SECRET dans .env
npm install
npm run taha
```

Servez ensuite le dossier `front/` avec un serveur statique, par exemple l'extension Live Server, puis ouvrez son URL dans le navigateur. La configuration fournie vise `http://localhost:3000` en premier. Pour une démonstration locale sans serveur statique, ouvrez `front/index.html`; selon les protections du navigateur, un serveur statique reste préférable.

## Scripts backend

| Commande | Rôle |
| --- | --- |
| `npm start` | démarre l'API avec Node.js |
| `npm run taha` | démarre l'API avec nodemon (script demandé) |

## Variables d'environnement

Copiez `back/.env.example` vers `back/.env`, puis remplacez les valeurs fictives. Le vrai fichier `.env` est ignoré par Git et ne doit jamais être envoyé sur GitHub.

| Variable | Rôle |
| --- | --- |
| `PORT` | port local de l'API (3000 par défaut) |
| `MONGODB_URI` | URI de connexion MongoDB Atlas |
| `JWT_SECRET` | secret de signature, 32 caractères minimum |
| `JWT_EXPIRES_IN` | durée du JWT, par défaut `1d` |
| `ALLOWED_ORIGINS` | origines frontend autorisées, séparées par des virgules |

En production, configurez ces variables dans Vercel séparément de Cloudflare. Ne placez jamais `MONGODB_URI` ou `JWT_SECRET` dans `front/app.js` : ce fichier est public.

## Routes API

| Méthode | Route | Résultat |
| --- | --- | --- |
| `GET` | `/api/health` | état de l'API, sans requérir MongoDB |
| `POST` | `/api/auth/register` | valide et crée un compte ; renvoie l'utilisateur public |
| `POST` | `/api/auth/login` | vérifie le mot de passe et renvoie `{ token, user }` |
| `GET` | `/api/items` | liste les éléments MongoDB, plus récents en premier |
| `POST` | `/api/items` | valide et crée un élément ; `clientId` rend la requête idempotente |

Les erreurs de validation sont en `400`, un e-mail déjà utilisé en `409`, des identifiants invalides en `401`, une route absente en `404` et une erreur interne en `500`.

## Déploiement Vercel et Cloudflare

### 1. Préparer MongoDB Atlas

Dans `back/.env`, utilisez l'URI exacte proposée par Atlas. Ajoutez `mern_taha` après le nom du cluster, autorisez l'IP de votre environnement dans **Network Access**, puis vérifiez localement `GET /api/items`. Une URI incorrecte bloque les routes qui utilisent la base, même si `/api/health` répond.

### 2. Déployer le backend Vercel

1. Dans Vercel, importez le dépôt GitHub et définissez **Root Directory** sur `back`.
2. Vercel détecte Express : aucun `vercel.json` n'est requis pour cette API.
3. Dans **Settings → Environment Variables**, ajoutez pour Production, Preview et Development : `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN` et `ALLOWED_ORIGINS`.
4. Déployez, puis notez l'URL obtenue, par exemple `https://mon-api.vercel.app`.
5. Vérifiez `https://mon-api.vercel.app/api/health`.

Ne copiez jamais le fichier `back/.env` sur Vercel : les variables se configurent dans le tableau de bord Vercel.

### 3. Déployer le frontend Vercel

1. Créez un second projet Vercel à partir du même dépôt, avec **Root Directory** sur `front`.
2. Déployez-le comme site statique. Aucun build n'est nécessaire.
3. Notez l'URL, par exemple `https://mon-front.vercel.app`.
4. Dans les variables Vercel du backend, définissez `ALLOWED_ORIGINS=https://mon-front.vercel.app`, puis redéployez le backend.

### 4. Déployer le Worker Cloudflare

Le dossier `cloudflare-worker/` contient un Worker qui expose le même contrat API et transmet les requêtes à une API Express compatible. C'est une architecture compatible avec Workers : Mongoose reste exécuté côté Node/Vercel, pas dans le runtime Worker.

```bash
cd cloudflare-worker
npm install
npx wrangler login
npx wrangler secret put UPSTREAM_API_URL
# coller l'URL du backend Vercel, par exemple https://mon-api.vercel.app
```

Dans `cloudflare-worker/wrangler.jsonc`, remplacez `https://VOTRE_FRONTEND.vercel.app` par l'URL réelle du frontend, puis déployez :

```bash
npm run deploy
```

Cloudflare donne une URL comme `https://mern-taha-rachidi-api.<compte>.workers.dev`. Vérifiez ensuite `.../api/health`.

### 5. Activer la bascule dans le frontend

Dans `front/app.js`, remplacez les deux valeurs fictives de `BACKENDS` par l'URL du backend Vercel et celle du Worker Cloudflare, dans cet ordre. Poussez cette modification sur GitHub : Vercel redéploiera le frontend automatiquement.

Le Worker agit comme proxy de l'API Vercel. Pour un vrai test de panne indépendant, déployez une seconde copie de `back/` sur un autre projet Vercel, connecté à la même base, puis configurez cette seconde URL comme `UPSTREAM_API_URL` du Worker. Ainsi, si le backend Vercel principal est indisponible, le Worker garde un upstream séparé.

## Éléments à fournir pour l'examen

- URL GitHub : `https://github.com/rachidi50/mern-taha-rachidi.git`
- URL frontend Vercel : à renseigner après déploiement.
- URL backend Vercel : à renseigner après déploiement.
- URL backend Cloudflare : à renseigner après déploiement.

Avant remise, vérifiez `git status`, `git log --oneline` et que les URLs finales sont renseignées. Aucun secret local ne doit être ajouté aux commits.
