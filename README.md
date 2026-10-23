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
cp .env.example .env
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

Copiez `back/.env.example` vers `back/.env`. Le vrai fichier `.env` est ignoré par Git.

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

## Déploiement et bascule

1. Déployez `front/` comme site statique sur Vercel et remplacez l'URL locale dans `front/app.js` par l'URL de l'API Vercel.
2. Déployez une seconde API compatible sur Cloudflare Workers et remplacez `https://ton-worker.workers.dev` par son URL réelle.
3. Donnez aux deux APIs le même contrat (`/api/health`, `/api/auth/*`, `/api/items`) et la même base MongoDB, puis définissez leurs variables séparément.
4. Définissez `ALLOWED_ORIGINS` avec l'URL réelle du frontend Vercel pour limiter CORS.
5. Testez : API principale disponible, API principale indisponible, puis les deux indisponibles. Dans ce dernier cas l'interface affiche une erreur claire.

Une API Express/Mongoose ne s'exécute pas telle quelle dans un Worker : le code du Worker doit utiliser une architecture compatible avec le runtime Cloudflare. Les URLs de production ne sont volontairement pas inventées ici : renseignez-les après vos déploiements.

## Éléments à fournir pour l'examen

- URL GitHub : à renseigner après création du dépôt distant.
- URL frontend Vercel : à renseigner après déploiement.
- URL backend Vercel : à renseigner après déploiement.
- URL backend Cloudflare : à renseigner après déploiement.

Le dossier reçu n'était pas un dépôt Git (`git status` ne trouvait pas de `.git`) ; il faut donc initialiser/relier le dépôt et réaliser les commits demandés avant remise. Aucun secret local ne doit être ajouté aux commits.
