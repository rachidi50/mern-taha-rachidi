require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

/* ---------- Middlewares ---------- */
const origins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({ origin: origins.length ? origins : true }));
app.use(express.json({ limit: "20kb" }));

/* ---------- Route de santé (sans base de données) ---------- */
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "API opérationnelle", runtime: "node" });
});

/* ---------- Connexion MongoDB ---------- */
let connecting;

async function connectDB() {
  if (mongoose.connection.readyState === 1) return;
  if (!process.env.MONGODB_URI) {
    const error = new Error("La variable MONGODB_URI est absente.");
    error.status = 500;
    throw error;
  }
  if (!connecting) {
    connecting = mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  }
  try {
    await connecting;
  } catch (error) {
    connecting = undefined;
    throw error;
  }
}

// Toutes les routes après /api/health dépendent de MongoDB.
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    next(error);
  }
});

/* ---------- Modèles Mongoose ---------- */
const itemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    // La même clé est envoyée lors d'une tentative répétée : le POST reste idempotent.
    clientId: { type: String, unique: true, sparse: true, trim: true, maxlength: 120 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 50 },
    lastName: { type: String, required: true, trim: true, maxlength: 50 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

const Item = mongoose.models.Item || mongoose.model("Item", itemSchema);
const User = mongoose.models.User || mongoose.model("User", userSchema);

function publicUser(user) {
  return {
    id: user._id.toString(),
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    createdAt: user.createdAt,
  };
}

function validationError(fields) {
  return { error: "Certains champs sont invalides.", fields };
}

function validateRegistration(body) {
  const fields = {};
  const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
  const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!firstName || firstName.length > 50) fields.firstName = "Entrez un prénom de 50 caractères maximum.";
  if (!lastName || lastName.length > 50) fields.lastName = "Entrez un nom de 50 caractères maximum.";
  if (!EMAIL_RE.test(email)) fields.email = "Entrez une adresse e-mail valide.";
  if (!PASSWORD_RE.test(password)) fields.password = "8 caractères minimum, avec une lettre et un chiffre.";
  else if (Buffer.byteLength(password, "utf8") > 72) fields.password = "Le mot de passe ne doit pas dépasser 72 octets.";
  if (body.confirm !== undefined && body.confirm !== password) fields.confirm = "Les mots de passe ne correspondent pas.";
  return { fields, value: { firstName, lastName, email, password } };
}

function validateLogin(body) {
  const fields = {};
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!EMAIL_RE.test(email)) fields.email = "Entrez une adresse e-mail valide.";
  if (!password) fields.password = "Entrez votre mot de passe.";
  return { fields, value: { email, password } };
}

function validateItem(body) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const clientId = body.clientId;
  if (!name) return { error: "Le champ 'name' est requis." };
  if (name.length > 100) return { error: "Le champ 'name' est trop long (100 maximum)." };
  if (clientId !== undefined && (typeof clientId !== "string" || !clientId.trim() || clientId.length > 120)) {
    return { error: "La clé clientId est invalide." };
  }
  return { value: { name, clientId: clientId && clientId.trim() } };
}

// Exposés seulement pour les tests unitaires, sans nécessiter de connexion MongoDB.
app.locals.validators = { validateRegistration, validateLogin, validateItem };

function createToken(user) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    const error = new Error("JWT_SECRET doit contenir au moins 32 caractères.");
    error.status = 500;
    throw error;
  }
  return jwt.sign({ sub: user._id.toString(), email: user.email }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "1d",
  });
}

/* ---------- Routes d'authentification ---------- */
app.post("/api/auth/register", async (req, res, next) => {
  try {
    const { fields, value } = validateRegistration(req.body || {});
    if (Object.keys(fields).length) return res.status(400).json(validationError(fields));

    const existingUser = await User.findOne({ email: value.email }).lean();
    if (existingUser) {
      return res.status(409).json({ error: "Cette adresse e-mail est déjà utilisée.", fields: { email: "Utilisez une autre adresse e-mail." } });
    }

    const passwordHash = await bcrypt.hash(value.password, 12);
    const user = await User.create({
      firstName: value.firstName,
      lastName: value.lastName,
      email: value.email,
      passwordHash,
    });
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ error: "Cette adresse e-mail est déjà utilisée.", fields: { email: "Utilisez une autre adresse e-mail." } });
    }
    next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const { fields, value } = validateLogin(req.body || {});
    if (Object.keys(fields).length) return res.status(400).json(validationError(fields));

    const user = await User.findOne({ email: value.email }).select("+passwordHash");
    const passwordMatches = user && (await bcrypt.compare(value.password, user.passwordHash));
    if (!passwordMatches) return res.status(401).json({ error: "Adresse e-mail ou mot de passe incorrect." });

    res.json({ token: createToken(user), user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

/* ---------- Routes des éléments ---------- */
app.get("/api/items", async (req, res, next) => {
  try {
    const items = await Item.find().sort({ createdAt: -1 }).lean();
    res.json(items);
  } catch (error) {
    next(error);
  }
});

app.post("/api/items", async (req, res, next) => {
  try {
    const validation = validateItem(req.body || {});
    if (validation.error) return res.status(400).json({ error: validation.error });
    const { name, clientId: normalizedClientId } = validation.value;
    if (normalizedClientId) {
      const existingItem = await Item.findOne({ clientId: normalizedClientId });
      if (existingItem) return res.status(200).json(existingItem);
    }

    const item = await Item.create({ name, clientId: normalizedClientId });
    res.status(201).json(item);
  } catch (error) {
    if (error && error.code === 11000) {
      const clientId = typeof (req.body && req.body.clientId) === "string" ? req.body.clientId.trim() : undefined;
      const existingItem = await Item.findOne({ clientId });
      if (existingItem) return res.status(200).json(existingItem);
    }
    next(error);
  }
});

/* ---------- Route inconnue et erreurs ---------- */
app.use((req, res) => res.status(404).json({ error: "Route introuvable." }));

app.use((error, req, res, next) => {
  console.error(error);
  if (error.name === "ValidationError") return res.status(400).json({ error: error.message });
  if (error.status) return res.status(error.status).json({ error: error.message });
  res.status(500).json({ error: "Erreur serveur." });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Serveur démarré sur http://localhost:${PORT}`));
}

module.exports = app;
