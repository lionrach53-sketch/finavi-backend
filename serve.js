// ============================================================================
// BACKEND MONGODB - COACH FINANCIER PERSONNEL
// Stack: Node.js + Express + MongoDB
// ============================================================================

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const webpush = require('web-push');
const app = express();

// Set NODE_ENV early - defaults to 'development' for fallback to MongoMemoryServer
const NODE_ENV = process.env.NODE_ENV || 'development';

// Lightweight logger used throughout the server. Controlled by LOG_LEVEL env var ('debug'|'info'|'warn'|'error').
const LOG_LEVEL = process.env.LOG_LEVEL || process.env.VITE_LOG_LEVEL || 'info';
const logger = {
  info: (...args) => { if (['info', 'debug'].includes(LOG_LEVEL)) console.log('ℹ️', ...args); },
  debug: (...args) => { if (LOG_LEVEL === 'debug') console.log('🔍', ...args); },
  warn: (...args) => { if (['info','debug','warn'].includes(LOG_LEVEL)) console.warn('⚠️', ...args); },
  error: (...args) => { console.error('❌', ...args); }
};

// ============================================================================
// CONFIGURATION
// ============================================================================
// Configure CORS: allow multiple origins for dev and production
const allowedOrigins = [
  'http://localhost:3000',     // dev: backend serves frontend
  'http://localhost:5173',     // dev: Vite frontend
  'http://localhost:5174',     // dev: Vite frontend (fallback port)
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  process.env.CORS_ORIGIN      // production: from env var
].filter(Boolean);

// Always allow CORS in production (no restriction for now)
const corsOptions = {
  origin: true,  // Allow all origins
  credentials: true
};

app.use(cors(corsOptions));
// Ensure preflight (OPTIONS) requests are handled with CORS headers
app.options('*', cors(corsOptions));
// Fallback: ensure CORS headers are set on all responses (helpful if upstream strips them)
app.use((req, res, next) => {
  try {
    if (!res.getHeader('Access-Control-Allow-Origin')) {
      res.setHeader('Access-Control-Allow-Origin', typeof corsOptions.origin === 'boolean' && corsOptions.origin === true ? '*' : (corsOptions.origin || '*'));
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } catch (e) {}
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

// Security headers
app.use(helmet());

// Content Security Policy - environment-aware (more permissive in development)
const devCsp = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", 'https://www.gstatic.com'],
  styleSrc: ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
  fontSrc: ["'self'", 'https://fonts.gstatic.com'],
  connectSrc: ["'self'", 'http://localhost:3000', 'ws://localhost:3000', 'http://127.0.0.1:9222'],
  imgSrc: ["'self'", 'data:']
};

const prodCsp = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  imgSrc: ["'self'"]
};

app.use(
  helmet.contentSecurityPolicy({
    directives: NODE_ENV === 'development' ? devCsp : prodCsp
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || 900000),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || 100),
  message: 'Trop de requêtes, veuillez réessayer plus tard',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health'
});
app.use(limiter);

// ============================================================================
// VALIDATION & ERROR HANDLING
// ============================================================================
// Async handler wrapper to catch errors in async middleware
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Validation schemas
const transactionValidationSchema = Joi.object({
  userId: Joi.string().required().messages({
    'any.required': 'userId est requis'
  }),
  type: Joi.string().valid('expense', 'gain').required().messages({
    'any.only': 'type doit être "expense" ou "gain"'
  }),
  amount: Joi.number().positive().required().messages({
    'number.positive': 'amount doit être positif'
  }),
  comment: Joi.string().max(500).required().messages({
    'string.max': 'comment ne peut pas dépasser 500 caractères'
  }),
  budgetId: Joi.string().required().messages({
    'any.required': 'budgetId est requis'
  }),
  categoryId: Joi.string().optional(),
  transactionDate: Joi.date().optional()
});

const dayValidationSchema = Joi.object({
  userId: Joi.string().required(),
  date: Joi.date().optional(),
  totalExpense: Joi.number().optional(),
  totalGain: Joi.number().optional(),
  budgets: Joi.array().optional()
});

const budgetValidationSchema = Joi.object({
  userId: Joi.string().required(),
  name: Joi.string().required().max(100),
  limit: Joi.number().positive().required(),
  description: Joi.string().optional().max(300),
  category: Joi.string().optional()
});

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/coach-financier';
const path = require('path');

// Configure web-push VAPID keys if provided
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || null;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || null;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(
      'mailto:admin@example.com',
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );
    console.log('✅ web-push VAPID configured');
  } catch (e) {
    console.warn('⚠️ Error configuring web-push VAPID:', e.message || e);
  }
} else {
  console.warn('⚠️ VAPID keys not set. Push notifications will be disabled until VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are configured.');
}

// ============================================================================
// CONNEXION MONGODB (avec fallback vers MongoDB en mémoire pour le dev)
// ============================================================================
async function connectWithFallback() {
  try {
    if (process.env.MONGODB_URI) {
      await mongoose.connect(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 5000
      });
      console.log('✅ Connexion MongoDB réussie (URI)');
      return;
    }

    // Tentative de connexion à l'instance locale par défaut
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000 // Timeout faster to trigger fallback
    });
    console.log('✅ Connexion MongoDB locale réussie');
  } catch (err) {
    console.error('⚠️ Connexion MongoDB échouée:', err.message);
    if (NODE_ENV === 'development') {
      try {
        console.warn('⚠️ NODE_ENV=development — démarrage d\'un MongoMemoryServer en fallback');
        // lazy-require to avoid bundling in production
        const { MongoMemoryServer } = require('mongodb-memory-server');
        const mongod = await MongoMemoryServer.create();
        const memUri = mongod.getUri();
        await mongoose.connect(memUri, {
          useNewUrlParser: true,
          useUnifiedTopology: true
        });
        console.log('✅ Connexion via MongoMemoryServer réussie');
      } catch (memErr) {
        console.error('❌ Erreur connexion MongoMemoryServer:', memErr);
        process.exit(1);
      }
    } else {
      console.error('❌ MongoDB inaccessible en production, arrêt du serveur.');
      process.exit(1);
    }
  }
}

connectWithFallback();

// Transactions support flag (will be checked after connection)
let TRANSACTIONS_SUPPORTED = true;

async function checkTransactionsSupport() {
  try {
    const s = await mongoose.startSession();
    try {
      s.startTransaction();
      // try to commit (may fail on standalone)
      await s.commitTransaction().catch(() => {});
      s.endSession();
      TRANSACTIONS_SUPPORTED = true;
    } catch (e) {
      TRANSACTIONS_SUPPORTED = false;
      try { s.endSession(); } catch (__) {}
    }
  } catch (e) {
    TRANSACTIONS_SUPPORTED = false;
  }
  if (NODE_ENV === 'development') console.log('🔁 Transactions supported:', TRANSACTIONS_SUPPORTED);
}

// ============================================================================
// SCHÉMAS MONGODB
// ============================================================================

// Schéma Utilisateur
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  preferences: {
    notifications: { type: Boolean, default: true },
    aiAdvice: { type: Boolean, default: true },
    darkMode: { type: Boolean, default: false },
    language: { type: String, default: 'fr' },
    reminders: { type: Boolean, default: true }
  },
  subscription: {
    plan: { type: String, enum: ['free', 'premium'], default: 'free' },
    startDate: { type: Date },
    endDate: { type: Date },
    isActive: { type: Boolean, default: false },
    daysRemaining: { type: Number, default: 0 },
    paymentMethod: { type: String, enum: ['mobile_money', 'card', null], default: null }
  },
  createdAt: { type: Date, default: Date.now }
});

// Schéma Budget
const budgetMongooseSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  clientId: { type: String, required: false, index: true },
  amount: { type: Number, required: true },
  frequency: { type: String, enum: ['daily', 'weekly', 'monthly'], required: true },
  isPrimary: { type: Boolean, default: false },
  // Immutable baseline and current amount for ledger behavior
  initialAmount: { type: Number, required: true },
  currentAmount: { type: Number, required: true },
  createdFrom: { type: String, enum: ['manual','derived'], default: 'manual' },
  immutableInitial: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

// Ensure legacy or client-created budgets always have initialAmount/currentAmount
// before validation so the server invariants (single source-of-truth) hold.
budgetMongooseSchema.pre('validate', function(next) {
  try {
    if (typeof this.initialAmount === 'undefined' || this.initialAmount === null) {
      this.initialAmount = Number(this.amount || 0);
    }
    if (typeof this.currentAmount === 'undefined' || this.currentAmount === null) {
      this.currentAmount = Number(this.amount || 0);
    }
  } catch (e) {
    // swallow and allow validation to report issues
  }
  next();
});

// Schéma Objectif
const objectiveSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: false },
  targetAmount: { type: Number, required: true },
  targetDate: { type: String, required: true }, // YYYY-MM-DD
  savedAmount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  achieved: { type: Boolean, default: false }
});

const Objective = mongoose.model('Objective', objectiveSchema);

// Schéma Tontine (simple MVP)
const tontineSchema = new mongoose.Schema({
  name: { type: String, required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  contributionAmount: { type: Number, required: true },
  clientId: { type: String, required: false, index: true },
  startDate: { type: String, required: false },
  endDate: { type: String, required: false },
  frequency: { type: String, required: false },
  budgetId: { type: mongoose.Schema.Types.ObjectId, ref: 'Budget', required: false },
  participantsCount: { type: Number, default: 0 },
  members: [{ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, contributed: { type: Number, default: 0 }, position: { type: Number } }],
  totalAmount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const Tontine = mongoose.model('Tontine', tontineSchema);

// Schéma Transaction
const transactionMongooseSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  budgetId: { type: mongoose.Schema.Types.ObjectId, ref: 'Budget' },
  type: { type: String, enum: ['expense', 'gain'], required: true },
  amount: { type: Number, required: true },
  comment: { type: String, required: true },
  date: { type: String, required: true }, // Format: YYYY-MM-DD
  time: { type: String, required: true }, // Format: HH:MM
  createdAt: { type: Date, default: Date.now }
});

// Schéma Jour (historique quotidien verrouillé)
const dayMongooseSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true }, // Format: YYYY-MM-DD
  initialPocket: { type: Number, required: true },
  budgetsAvailable: { type: Number, required: true },
  gains: { type: Number, default: 0 },
  expenses: { type: Number, default: 0 },
  finalPocket: { type: Number, required: true },
  locked: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

// Indice unique composé: chaque utilisateur ne peut avoir qu'un seul jour par date
dayMongooseSchema.index({ userId: 1, date: 1 }, { unique: true });

const User = mongoose.model('User', userSchema);
const Budget = mongoose.model('Budget', budgetMongooseSchema);
const Transaction = mongoose.model('Transaction', transactionMongooseSchema);
const Day = mongoose.model('Day', dayMongooseSchema);

// JournalEntry schema for immutable ledger entries
const journalEntrySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  txType: { type: String, enum: ['expense','gain','adjustment'], required: true },
  amount: { type: Number, required: true },
  comment: { type: String },
  affected: [{ budgetId: { type: mongoose.Schema.Types.ObjectId, ref: 'Budget' }, before: Number, after: Number }],
  ruleApplied: { type: String },
  meta: { type: Object },
  createdAt: { type: Date, default: Date.now }
});
const JournalEntry = mongoose.model('JournalEntry', journalEntrySchema);

// Push subscription schema
const pushSubscriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subscription: { type: Object, required: true },
  createdAt: { type: Date, default: Date.now }
});
const PushSubscription = mongoose.model('PushSubscription', pushSubscriptionSchema);

// Supprimer l'ancien indice unique sur 'date' seul et laisser Mongoose créer le nouvel indice composé
async function fixDayIndexes() {
  try {
    const collection = mongoose.connection.collection('days');
    const indexes = await collection.getIndexes();
    
    // Chercher et supprimer l'indice unique sur 'date' seul
    for (const [indexName, indexSpec] of Object.entries(indexes)) {
      if (indexName === 'date_1' || (indexSpec.key && indexSpec.key.date && !indexSpec.key.userId)) {
        console.log(`Suppression de l'indice ancien: ${indexName}`);
        await collection.dropIndex(indexName);
      }
    }
  } catch (err) {
    // Ignorer les erreurs si les index n'existent pas
    if (!err.message.includes('index not found')) {
      console.warn('Erreur lors de la suppression des indices:', err.message);
    }
  }
}

// Appeler la fonction de correction après la connexion
mongoose.connection.on('connected', () => {
  fixDayIndexes().catch(err => console.error('Erreur fixDayIndexes:', err));
  // Detect transactions availability (replica set) and set flag
  checkTransactionsSupport().catch(err => console.warn('checkTransactionsSupport failed', err));
});

// Enforce strict replica-set / transactions in production: exit if not available
process.on('beforeExit', () => {
  if (process.env.NODE_ENV === 'production') {
    if (!TRANSACTIONS_SUPPORTED) {
      console.error('❌ MongoDB transactions are not supported in this environment. In production, a replica-set is required for transactional safety. Exiting.');
      process.exit(1);
    }
  }
});

// ============================================================================
// FONCTIONS UTILITAIRES
// ============================================================================

// Obtenir la date du jour au format YYYY-MM-DD
function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

// Obtenir le numéro de la semaine
function getWeekNumber(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return weekNo;
}

// Helper function to check if user exists
async function userExists(userIdParam) {
  const user = await User.findOne({ email: `${userIdParam}@test.local` });
  return user !== null;
}

// Compute periods elapsed since start date according to frequency
function periodsElapsedSince(startDateStr, frequency) {
  if (!startDateStr) return 0;
  const start = new Date(startDateStr);
  const now = new Date();
  if (frequency === 'monthly') {
    return (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  }
  if (frequency === 'weekly') {
    const msPerWeek = 1000 * 60 * 60 * 24 * 7;
    return Math.floor((now - start) / msPerWeek);
  }
  // daily
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((now - start) / msPerDay);
}

// Helper function to create a new user
async function createUser(userIdParam, name, email) {
  const user = new User({
    name: name || userIdParam,
    email: email || `${userIdParam}@test.local`,
    role: 'user'
  });
  await user.save();
  return user._id.toString();
}

// Helper function to resolve string userIds to MongoDB ObjectIds (used for existing users)
async function resolveUserId(userIdParam) {
  const isValidObjectId = (id) => {
    return /^[0-9a-fA-F]{24}$/.test(id);
  };
  
  if (isValidObjectId(userIdParam)) {
    return new mongoose.Types.ObjectId(userIdParam);
  }

  // For string IDs like "user_123", find user (don't create)
  let user = await User.findOne({ email: `${userIdParam}@test.local` });
  if (!user) {
    throw new Error('Utilisateur non trouvé');
  }
  return user._id; // Return ObjectId instance
}

// Calculate remaining budget using the single source of truth: `Budget.currentAmount`.
// Decision-making and 'argent en poche' must rely on `currentAmount` only.
// Supports optional session for transactional reads.
async function calculateRemainingBudget(budget, userId, currentDate, session = null) {
  // If budget is a document instance with currentAmount, return it.
  if (budget && typeof budget.currentAmount !== 'undefined') {
    return Math.max(0, Number(budget.currentAmount || 0));
  }

  // Otherwise load by id
  const id = budget && budget._id ? budget._id : budget;
  if (!id) return 0;
  let b;
  if (session) b = await Budget.findById(id).session(session);
  else b = await Budget.findById(id);
  if (!b) return 0;
  return Math.max(0, Number(b.currentAmount || 0));
}

// Calculer les budgets disponibles pour aujourd'hui
// Sum of all budgets' currentAmount. Accepts optional session for transactional reads.
// Budget disponible global STRICT: primary monthly currentAmount only.
// Enforce product rule: budget_dispo = monthly.currentAmount.
// If no primary monthly budget exists, return 0 (strict enforcement).
async function calculateBudgetsAvailable(userId, currentDate, session = null) {
  const query = Budget.findOne({ userId, frequency: 'monthly', isPrimary: true });
  if (session) query.session(session);
  const primary = await query.exec();
  if (!primary) return 0;

  // Compute total expenses for the month of currentDate (format YYYY-MM-DD)
  try {
    const yearMonth = (currentDate || getTodayDate()).slice(0,7); // 'YYYY-MM'
    const txQuery = { userId, type: 'expense', date: { $regex: `^${yearMonth}` } };
    let txs;
    if (session) txs = await Transaction.find(txQuery).session(session);
    else txs = await Transaction.find(txQuery);
    const totalExpenses = txs.reduce((s, t) => s + Number(t.amount || 0), 0);

    // Base salary to subtract from: prefer initialAmount, fallback to amount or currentAmount
    const base = Number(primary.initialAmount || primary.amount || primary.currentAmount || 0);
    const available = Math.max(0, Math.round((base - totalExpenses) * 100) / 100);

    // Reconcile stored primary.currentAmount with computed available when they differ.
    try {
      const stored = Number(primary.currentAmount || 0);
      const diff = Math.abs(stored - available);
      if (diff > 0.01) {
        // create a JournalEntry recording the adjustment
        const jeData = { userId, txType: 'adjustment', amount: Math.round((available - stored) * 100) / 100, comment: 'Réconciliation automatique primary currentAmount', affected: [{ budgetId: primary._id, before: stored, after: available }], ruleApplied: 'reconcile_primary_current_amount' };
        if (session) {
          await Budget.updateOne({ _id: primary._id }, { $set: { currentAmount: available } }).session(session);
          const je = new JournalEntry(jeData);
          await je.save({ session });
        } else {
          await Budget.updateOne({ _id: primary._id }, { $set: { currentAmount: available } });
          const je = new JournalEntry(jeData);
          await je.save();
        }
      }
    } catch (e) {
      // ignore reconciliation errors and return computed available
    }

    return available;
  } catch (e) {
    // Fallback to currentAmount if any error occurs
    return Math.max(0, Number(primary.currentAmount || 0));
  }
}

// Validate budget hierarchy with DB lookups. Enforces monthly -> weekly -> daily caps.
async function validateBudgetHierarchy(userId, frequency, amount) {
  const numAmount = Number(amount || 0);
  if (!(numAmount > 0)) return { valid: false, message: 'Le montant du budget doit être positif' };

  // Primary monthly budget (source of truth)
  const primary = await Budget.findOne({ userId, isPrimary: true, frequency: 'monthly' });
  if (frequency === 'weekly' && primary) {
    const maxWeekly = Number(primary.initialAmount || primary.amount || 0) / 4;
    if (numAmount > maxWeekly) return { valid: false, message: `Budget hebdomadaire ne peut pas dépasser ${Math.floor(maxWeekly)} XOF (mensuel / 4)` };
  }
  if (frequency === 'daily' && primary) {
    const maxDaily = Number(primary.initialAmount || primary.amount || 0) / 28;
    if (numAmount > maxDaily) return { valid: false, message: `Budget journalier ne peut pas dépasser ${Math.floor(maxDaily)} XOF (mensuel / 28)` };
  }

  // If daily and a weekly budget exists, ensure daily <= weekly/7
  if (frequency === 'daily') {
    const weekly = await Budget.findOne({ userId, frequency: 'weekly' });
    if (weekly) {
      const maxDailyFromWeekly = Number(weekly.amount || weekly.initialAmount || 0) / 7;
      if (numAmount > maxDailyFromWeekly) return { valid: false, message: `Budget journalier ne peut pas dépasser ${Math.floor(maxDailyFromWeekly)} XOF (hebdomadaire / 7)` };
    }
  }

  return { valid: true };
}

// Compute 'argent en poche' following strict product rules:
// - based only on the single primary monthly salary budget
// - weekly baseline = salary_monthly / 4
// - daily baseline = weekly / 7 (not returned here)
// - argent_en_poche = weekly_baseline - (sum of this week's daily and weekly expenses)
// - gains DO NOT increase argent_en_poche
async function computeArgentEnPoche(userId, currentDate) {
  // find primary monthly salary budget
  // Argent en poche is the weekly budget's currentAmount (server-authoritative)
  const weeklyBudget = await Budget.findOne({ userId, frequency: 'weekly' });
  if (!weeklyBudget) {
    // Fallback: if no weekly budget exists, try deriving from primary monthly baseline
    const salaryBudget = await Budget.findOne({ userId, isPrimary: true, frequency: 'monthly' });
    if (!salaryBudget) return 0;
    return Math.max(0, Math.round((salaryBudget.initialAmount || 0) / 4));
  }
  return Math.max(0, Math.round(weeklyBudget.currentAmount || 0));
}

// Compute intelligent dynamic limits (monthly -> weekly -> daily) based on
// the budget still disponible and the remaining days in a 30‑day cycle.
// This does not modify the DB, it only returns recommendations used by the frontend.
function computeDynamicLimits(budgetsAvailable, currentDate) {
  const available = Math.max(0, Number(budgetsAvailable || 0));
  if (!available) {
    return {
      monthlyAvailable: 0,
      weeklyLimit: 0,
      dailyLimit: 0,
      daysLeft: 0,
      weeksLeft: 0
    };
  }

  const dateStr = currentDate || getTodayDate(); // 'YYYY-MM-DD'
  let dayOfMonth = 1;
  try {
    const parts = dateStr.split('-').map((p) => parseInt(p, 10));
    if (parts.length === 3 && !Number.isNaN(parts[2])) {
      dayOfMonth = parts[2];
    }
  } catch (_) {}

  const DAYS_IN_CYCLE = 30;
  const dayIndex = Math.min(DAYS_IN_CYCLE, Math.max(1, dayOfMonth));
  const daysLeft = Math.max(1, DAYS_IN_CYCLE - dayIndex + 1);
  const weeksLeft = Math.max(1, Math.ceil(daysLeft / 7));

  const dailyLimit = Math.floor(available / daysLeft);
  const weeklyLimit = Math.floor(available / weeksLeft);

  return {
    monthlyAvailable: available,
    weeklyLimit,
    dailyLimit,
    daysLeft,
    weeksLeft
  };
}

// Générer un conseil IA basique (à améliorer avec une vraie IA)
function generateAIAdvice(todayData, transactions) {
  const { gains, expenses, budgetsAvailable } = todayData;
  
  if (gains > expenses) {
    return `Excellent travail ! Vos gains d'aujourd'hui (${gains}€) dépassent vos dépenses (${expenses}€). Continuez à prioriser les dépenses essentielles sur votre budget mensuel pour préserver vos revenus hebdomadaires pour les imprévus.`;
  } else if (expenses > budgetsAvailable * 0.5) {
    return `Attention, vous avez déjà utilisé plus de 50% de vos budgets disponibles aujourd'hui. Pensez à limiter les dépenses non essentielles pour le reste de la journée.`;
  } else if (transactions.length === 0) {
    return `Aucune transaction aujourd'hui. N'oubliez pas d'enregistrer toutes vos dépenses et gains pour un suivi précis de vos finances.`;
  } else {
    return `Vous gérez bien vos budgets. Il vous reste ${budgetsAvailable.toFixed(2)}€ disponibles dans vos différentes sources de revenus.`;
  }
}

// ============================================================================
// ROUTES API - UTILISATEUR
// ============================================================================

// GET /api - API Health Check
app.get('/api', (req, res) => {
  res.json({
    status: 'ok',
    message: 'API Coach Financier running',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV
  });
});

// GET /api/check-user/:phoneNumber - Vérifier si un utilisateur existe
app.get('/api/check-user/:phoneNumber', asyncHandler(async (req, res) => {
  const { phoneNumber } = req.params;
  const userEmail = `${phoneNumber.replace(/\D/g, '')}@test.local`;
  logger.info(`Incoming check-user request for ${phoneNumber}`);
  logger.debug('Computed userEmail for check-user', { userEmail });
  try {
    const exists = await User.findOne({ email: userEmail });
    logger.debug('check-user DB result', { exists: !!exists });
    res.json({
      phoneNumber: phoneNumber,
      exists: !!exists,
      message: exists ? 'Compte trouvé' : 'Aucun compte trouvé'
    });
  } catch (err) {
    console.error('Error in /api/check-user', err && err.stack ? err.stack : err);
    // rethrow to be handled by global error handler
    throw err;
  }
}));

// GET /api/user-by-phone/:phoneNumber - Retourne l'utilisateur complet par numéro
app.get('/api/user-by-phone/:phoneNumber', asyncHandler(async (req, res) => {
  const { phoneNumber } = req.params;
  const userEmail = `${phoneNumber.replace(/\D/g, '')}@test.local`;

  const user = await User.findOne({ email: userEmail });
  if (!user) {
    return res.status(404).json({ message: 'Utilisateur non trouvé' });
  }

  res.json({
    success: true,
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      subscription: user.subscription || null
    }
  });
}));

// POST /api/subscribe - Créer / activer un abonnement pour un utilisateur
app.post('/api/subscribe', asyncHandler(async (req, res) => {
  const { userId, plan, paymentMethod } = req.body;
  if (!userId || !plan) {
    return res.status(400).json({ message: 'userId et plan sont requis' });
  }

  if (!['free', 'premium'].includes(plan)) {
    return res.status(400).json({ message: 'Plan invalide' });
  }

  const resolvedUserId = await resolveUserId(userId).catch(() => null);
  if (!resolvedUserId) {
    return res.status(404).json({ message: 'Utilisateur non trouvé' });
  }

  const user = await User.findById(resolvedUserId);
  if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });

  const now = new Date();
  const periodDays = plan === 'premium' ? 30 : 0;
  const endDate = periodDays > 0 ? new Date(now.getTime() + periodDays * 24 * 60 * 60 * 1000) : null;

  user.subscription = {
    plan,
    startDate: now,
    endDate: endDate,
    isActive: plan === 'premium',
    daysRemaining: periodDays,
    paymentMethod: paymentMethod || null
  };

  await user.save();

  res.status(201).json({ success: true, subscription: user.subscription });
}));

// POST /api/unsubscribe - Annuler l'abonnement
app.post('/api/unsubscribe', asyncHandler(async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ message: 'userId requis' });

  const resolvedUserId = await resolveUserId(userId).catch(() => null);
  if (!resolvedUserId) return res.status(404).json({ message: 'Utilisateur non trouvé' });

  const user = await User.findById(resolvedUserId);
  if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });

  if (!user.subscription) {
    return res.status(400).json({ message: 'Aucun abonnement actif' });
  }

  user.subscription.isActive = false;
  user.subscription.endDate = new Date();
  user.subscription.daysRemaining = 0;
  user.subscription.plan = 'free';

  await user.save();
  res.json({ success: true, subscription: user.subscription });
}));

// GET /api/subscription/:userId - Récupérer l'abonnement d'un utilisateur
app.get('/api/subscription/:userId', asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const resolvedUserId = await resolveUserId(userId).catch(() => null);
  if (!resolvedUserId) return res.status(404).json({ message: 'Utilisateur non trouvé' });

  const user = await User.findById(resolvedUserId);
  if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });

  res.json({ success: true, subscription: user.subscription || null });
}));

// GET /api/days/:userId - Récupérer les données du jour
app.get('/api/days/:userId', asyncHandler(async (req, res) => {
  try {
    let { userId } = req.params;
    userId = await resolveUserId(userId); // Convert string ID to ObjectId if needed
    const currentDate = getTodayDate();
    
    // Récupérer l'utilisateur
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }
    
    // Récupérer ou créer le jour actuel
    let today = await Day.findOne({ userId, date: currentDate });
    
    if (!today) {
      // Récupérer le dernier jour pour l'argent en poche initial
      const lastDay = await Day.findOne({ userId })
        .sort({ date: -1 })
        .limit(1);
      

      const initialPocket = lastDay ? lastDay.finalPocket : 0;
      const budgetsAvailable = await calculateBudgetsAvailable(userId, currentDate);

      // Créer le nouveau jour: initialPocket is taken from lastDay.finalPocket.
      // At new day start there are no additional gains/expenses accounted yet.
      today = new Day({
        userId,
        date: currentDate,
        initialPocket,
        budgetsAvailable,
        gains: 0,
        expenses: 0,
        finalPocket: initialPocket,
        locked: false
      });
      
      await today.save();
    }
    
    // Récupérer les budgets avec montants restants
    const budgets = await Budget.find({ userId });
    const budgetsWithRemaining = await Promise.all(
      budgets.map(async (budget) => {
        const remaining = await calculateRemainingBudget(budget, userId, currentDate);
        
        return {
          id: budget._id.toString(),
          name: budget.name,
          amount: budget.amount,
          frequency: budget.frequency,
          remainingToday: budget.frequency === 'daily' ? remaining : undefined,
          remainingThisWeek: budget.frequency === 'weekly' ? remaining : undefined,
          remainingThisMonth: budget.frequency === 'monthly' ? remaining : undefined
        };
      })
    );
    
    // Récupérer les transactions du jour
    const transactions = await Transaction.find({
      userId,
      date: currentDate
    }).sort({ createdAt: 1 });
    
    const formattedTransactions = transactions.map(t => ({
      id: t._id.toString(),
      type: t.type,
      amount: t.amount,
      comment: t.comment,
      budgetId: t.budgetId?.toString(),
      time: t.time
    }));
    
    // Récupérer l'historique (7 derniers jours)
    const history = await Day.find({
      userId,
      date: { $lt: currentDate }
    })
    .sort({ date: -1 })
    .limit(7);
    
    const formattedHistory = history.map(day => ({
      date: day.date,
      initialPocket: day.initialPocket,
      budgetsAvailable: day.budgetsAvailable,
      gains: day.gains,
      expenses: day.expenses,
      finalPocket: day.finalPocket,
      locked: day.locked
    }));
    
    // Générer conseil IA
    const aiAdvice = generateAIAdvice(today, formattedTransactions);
    
    res.json({
      user: {
        id: user._id.toString(),
        name: user.name,
        role: user.role
      },
      budgets: budgetsWithRemaining,
      today: {
        date: today.date,
        initialPocket: today.initialPocket,
        budgetsAvailable: today.budgetsAvailable,
        gains: today.gains,
        expenses: today.expenses,
        finalPocket: today.finalPocket,
        locked: today.locked
      },
      transactions: formattedTransactions,
      history: formattedHistory,
      aiAdvice
    });
    
  } catch (error) {
    console.error('Erreur GET /api/days:', error);
    return res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
}));

// =====================
// OBJECTIVES CRUD
// =====================
// GET /api/objectives/:userId
app.get('/api/objectives/:userId', asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const resolvedUserId = await resolveUserId(userId);
  const objectives = await Objective.find({ userId: resolvedUserId }).sort({ createdAt: -1 });
  res.json({ success: true, objectives: objectives.map(o => ({ id: o._id.toString(), name: o.name || null, targetAmount: o.targetAmount, targetDate: o.targetDate, achieved: o.achieved, savedAmount: o.savedAmount || 0 })) });
}));

// POST /api/objectives - create
app.post('/api/objectives', asyncHandler(async (req, res) => {
  const { userId, name, targetAmount, targetDate } = req.body;
  if (!userId || !targetAmount || !targetDate) return res.status(400).json({ message: 'userId, targetAmount et targetDate requis' });
  const resolvedUserId = await resolveUserId(userId);
  const obj = new Objective({ userId: resolvedUserId, name: name || null, targetAmount, targetDate, savedAmount: 0 });
  await obj.save();
  res.status(201).json({ success: true, objective: { id: obj._id.toString(), name: obj.name, targetAmount: obj.targetAmount, targetDate: obj.targetDate, savedAmount: obj.savedAmount } });
}));

// PUT /api/objectives/:id
app.put('/api/objectives/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { targetAmount, targetDate, achieved } = req.body;
  const obj = await Objective.findById(id);
  if (!obj) return res.status(404).json({ message: 'Objectif non trouvé' });
  if (targetAmount) obj.targetAmount = targetAmount;
  if (targetDate) obj.targetDate = targetDate;
  if (typeof achieved === 'boolean') obj.achieved = achieved;
  await obj.save();
  res.json({ success: true, objective: obj });
}));

// POST /api/objectives/:id/allocate - allouer un montant depuis un budget vers un objectif
app.post('/api/objectives/:id/allocate', asyncHandler(async (req, res) => {
  const { id } = req.params;
  let { userId, budgetId, amount } = req.body;
  if (!userId || !budgetId || !amount) return res.status(400).json({ message: 'userId, budgetId et amount requis' });
  amount = Number(amount);
  if (amount <= 0) return res.status(400).json({ message: 'Montant invalide' });

  userId = await resolveUserId(userId);
  const obj = await Objective.findById(id);
  if (!obj) return res.status(404).json({ message: 'Objectif non trouvé' });

  // Verify budget exists and belongs to user
  const budget = await Budget.findById(budgetId);
  if (!budget) return res.status(404).json({ message: 'Budget non trouvé' });
  if (budget.userId.toString() !== userId.toString()) return res.status(403).json({ message: 'Budget n\'appartient pas à l\'utilisateur' });

  const currentDate = getTodayDate();
  const remaining = await calculateRemainingBudget(budget, userId, currentDate);
  if (amount > remaining) return res.status(400).json({ message: `Dépassement du budget "${budget.name}". Reste: ${remaining}€` });

  // Create transaction
  const currentTime = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  // Perform deduction from budget(s) and record transaction + journal entry.
  if (TRANSACTIONS_SUPPORTED) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      // create transaction in-session
      const transaction = new Transaction({ userId, budgetId, type: 'expense', amount, comment: `Allocation vers objectif ${obj._id.toString()}`, date: currentDate, time: currentTime });
      await transaction.save({ session });

      // prepare cascade similar to /api/transactions
      const toUpdate = [];
      toUpdate.push(budget);
      if (budget.frequency === 'daily') {
        const weekly = await Budget.findOne({ userId, frequency: 'weekly' }).session(session);
        if (weekly) toUpdate.push(weekly);
        const monthlyPrimary = await Budget.findOne({ userId, frequency: 'monthly', isPrimary: true }).session(session);
        if (monthlyPrimary) toUpdate.push(monthlyPrimary);
      } else if (budget.frequency === 'weekly') {
        const monthlyPrimary = await Budget.findOne({ userId, frequency: 'monthly', isPrimary: true }).session(session);
        if (monthlyPrimary) toUpdate.push(monthlyPrimary);
      }

      const affected = [];
      for (const b of toUpdate) {
        const before = Number(b.currentAmount || 0);
        const after = before - Number(amount || 0);
        if (after < 0) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ message: `Allocation rejetée — le budget "${b.name}" serait négatif (${after})` });
        }
        affected.push({ budgetId: b._id, before, after, name: b.name });
      }

      for (const a of affected) {
        await Budget.updateOne({ _id: a.budgetId }, { $set: { currentAmount: a.after } }).session(session);
      }

      const je = new JournalEntry({ userId, txType: 'expense', amount, comment: `Allocation vers objectif ${obj._id.toString()}`, affected: affected.map(a => ({ budgetId: a.budgetId, before: a.before, after: a.after })), ruleApplied: 'allocate_to_objective' });
      await je.save({ session });

      // Update Day totals within session
      const todayTransactions = await Transaction.find({ userId, date: currentDate }).session(session);
      const totalGains = todayTransactions.filter(t => t.type === 'gain').reduce((sum, t) => sum + t.amount, 0);
      const totalExpenses = todayTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
      const lastDay = await Day.findOne({ userId }).sort({ date: -1 }).limit(1).session(session);
      const initialPocket = lastDay ? lastDay.finalPocket : 0;
      const budgetsAvailable = await calculateBudgetsAvailable(userId, currentDate, session);
      const finalPocket = initialPocket + totalGains - totalExpenses;
      await Day.updateOne({ userId, date: currentDate }, { $set: { initialPocket, budgetsAvailable, gains: totalGains, expenses: totalExpenses, finalPocket } }, { upsert: true, session });

      // Update objective savedAmount and save within session
      obj.savedAmount = (obj.savedAmount || 0) + amount;
      if (obj.savedAmount >= obj.targetAmount) obj.achieved = true;
      await obj.save({ session });

      await session.commitTransaction();
      session.endSession();

      return res.json({ success: true, objective: { id: obj._id.toString(), name: obj.name || null, targetAmount: obj.targetAmount, targetDate: obj.targetDate, savedAmount: obj.savedAmount, achieved: obj.achieved } });
    } catch (e) {
      try { await session.abortTransaction(); } catch (__) {}
      try { session.endSession(); } catch (__) {}
      console.error('Erreur allocation objective transactionnelle:', e);
      return res.status(500).json({ message: 'Erreur serveur lors de l allocation vers objectif', error: e.message });
    }
  } else {
    // Fallback: conditional updates similar to transactions fallback
    const toUpdate = [];
    toUpdate.push(budget);
    if (budget.frequency === 'daily') {
      const weekly = await Budget.findOne({ userId, frequency: 'weekly' });
      if (weekly) toUpdate.push(weekly);
      const monthlyPrimary = await Budget.findOne({ userId, frequency: 'monthly', isPrimary: true });
      if (monthlyPrimary) toUpdate.push(monthlyPrimary);
    } else if (budget.frequency === 'weekly') {
      const monthlyPrimary = await Budget.findOne({ userId, frequency: 'monthly', isPrimary: true });
      if (monthlyPrimary) toUpdate.push(monthlyPrimary);
    }

    const affected = [];
    for (const b of toUpdate) {
      const before = Number(b.currentAmount || 0);
      const after = before - Number(amount || 0);
      if (after < 0) return res.status(400).json({ message: `Allocation rejetée — le budget "${b.name}" serait négatif (${after})` });
      affected.push({ budgetId: b._id, before, after });
    }

    const updated = [];
    try {
      for (const a of affected) {
        const u = await Budget.findOneAndUpdate({ _id: a.budgetId, currentAmount: { $gte: Number(amount || 0) } }, { $inc: { currentAmount: -Number(amount || 0) } }, { new: true });
        if (!u) throw new Error('Conflit de disponibilité budget');
        updated.push(a.budgetId);
      }

      const transaction = new Transaction({ userId, budgetId, type: 'expense', amount, comment: `Allocation vers objectif ${obj._id.toString()}`, date: currentDate, time: currentTime });
      await transaction.save();
      const je = new JournalEntry({ userId, txType: 'expense', amount, comment: `Allocation vers objectif ${obj._id.toString()}`, affected: affected.map(a => ({ budgetId: a.budgetId, before: a.before, after: a.after })), ruleApplied: 'allocate_to_objective_fallback' });
      await je.save();

      // Recompute Day totals
      const todayTransactions = await Transaction.find({ userId, date: currentDate });
      const totalGains = todayTransactions.filter(t => t.type === 'gain').reduce((sum, t) => sum + t.amount, 0);
      const totalExpenses = todayTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
      const lastDay = await Day.findOne({ userId }).sort({ date: -1 }).limit(1);
      const initialPocket = lastDay ? lastDay.finalPocket : 0;
      const budgetsAvailable = await calculateBudgetsAvailable(userId, currentDate);
      const finalPocket = initialPocket + totalGains - totalExpenses;
      await Day.updateOne({ userId, date: currentDate }, { $set: { initialPocket, budgetsAvailable, gains: totalGains, expenses: totalExpenses, finalPocket } }, { upsert: true });

      // Update objective
      obj.savedAmount = (obj.savedAmount || 0) + amount;
      if (obj.savedAmount >= obj.targetAmount) obj.achieved = true;
      await obj.save();

      return res.json({ success: true, objective: { id: obj._id.toString(), name: obj.name || null, targetAmount: obj.targetAmount, targetDate: obj.targetDate, savedAmount: obj.savedAmount, achieved: obj.achieved } });
    } catch (e) {
      for (const bid of updated) {
        try { await Budget.updateOne({ _id: bid }, { $inc: { currentAmount: Number(amount || 0) } }); } catch (__) {}
      }
      console.error('Erreur allocation objective (fallback):', e);
      return res.status(500).json({ message: 'Erreur lors de l allocation vers objectif', error: e.message });
    }
  }
}));

// DELETE /api/objectives/:id
app.delete('/api/objectives/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const obj = await Objective.findById(id);
  if (!obj) return res.status(404).json({ message: 'Objectif non trouvé' });
  await Objective.deleteOne({ _id: id });
  res.json({ success: true });
}));

// =====================
// TONTINES (MVP)
// =====================
// POST /api/tontines - create tontine
app.post('/api/tontines', asyncHandler(async (req, res) => {
  const { userId, name, contributionAmount, startDate, endDate, frequency, budgetId, clientId, participantsCount, myPosition } = req.body;
  console.log('POST /api/tontines payload:', { userId, name, contributionAmount, startDate, endDate, frequency, budgetId, clientId, participantsCount, myPosition });
  if (!userId || !name || !contributionAmount) return res.status(400).json({ message: 'userId, name et contributionAmount requis' });
  const resolvedUserId = await resolveUserId(userId);

  // If clientId provided, avoid duplicate creations
  if (clientId) {
    const existing = await Tontine.findOne({ clientId, ownerId: resolvedUserId });
    if (existing) {
      return res.status(200).json({ success: true, tontine: { id: existing._id.toString(), name: existing.name, contributionAmount: existing.contributionAmount, startDate: existing.startDate || null, endDate: existing.endDate || null, frequency: existing.frequency || null, budgetId: existing.budgetId || null } });
    }
  }

  const members = [{ userId: resolvedUserId, contributed: 0, position: myPosition ? Number(myPosition) : 1 }];
  const t = new Tontine({ name, ownerId: resolvedUserId, contributionAmount, participantsCount: participantsCount ? Number(participantsCount) : (members.length), members, totalAmount: 0, clientId: clientId || null, startDate: startDate || null, endDate: endDate || null, frequency: frequency || null, budgetId: budgetId || null });
  await t.save();
  console.log('Tontine saved with budgetId:', t.budgetId);
  res.status(201).json({ success: true, tontine: { id: t._id.toString(), name: t.name, contributionAmount: t.contributionAmount, startDate: t.startDate || null, endDate: t.endDate || null, frequency: t.frequency || null, budgetId: t.budgetId ? t.budgetId.toString() : null } });
}));

// GET /api/tontines/:userId - list tontines where user is owner or member
app.get('/api/tontines/:userId', asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const resolvedUserId = await resolveUserId(userId);
  const tontines = await Tontine.find({ $or: [{ ownerId: resolvedUserId }, { 'members.userId': resolvedUserId }] });
  const results = tontines.map(t => {
    const participants = t.participantsCount || t.members.length || 0;
    const totalNeeded = participants > 0 ? participants * (t.contributionAmount || 0) : 0;
    const overallPercent = totalNeeded > 0 ? Math.min(100, Math.round(((t.totalAmount || 0) / totalNeeded) * 100)) : 0;
    const member = t.members.find(m => m.userId.toString() === resolvedUserId.toString()) || {};
    const myPercent = (t.contributionAmount && member.contributed) ? Math.min(100, Math.round((member.contributed / t.contributionAmount) * 100)) : 0;
    const elapsed = periodsElapsedSince(t.startDate || getTodayDate(), t.frequency || 'monthly');
    const currentReceiverIndex = participants > 0 ? ((elapsed % participants) + 1) : 1;
    const myPosition = member.position || null;
    const turnsUntilMe = (myPosition && participants) ? ((myPosition - currentReceiverIndex + participants) % participants) : null;
    return {
      id: t._id.toString(), name: t.name, contributionAmount: t.contributionAmount, totalAmount: t.totalAmount,
      startDate: t.startDate || null, endDate: t.endDate || null, frequency: t.frequency || null, budgetId: t.budgetId ? t.budgetId.toString() : null,
      clientId: t.clientId || null, members: t.members.map(m => ({ userId: m.userId.toString(), contributed: m.contributed, position: m.position })),
      participantsCount: participants, overallPercent, myPercent, currentReceiverIndex, myPosition, turnsUntilMe
    };
  });
  res.json({ success: true, tontines: results });
}));

// POST /api/tontines/:id/join
app.post('/api/tontines/:id/join', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { userId, position } = req.body;
  if (!userId) return res.status(400).json({ message: 'userId requis' });
  const resolvedUserId = await resolveUserId(userId);
  const tontine = await Tontine.findById(id);
  if (!tontine) return res.status(404).json({ message: 'Tontine non trouvée' });
  if (tontine.members.find(m => m.userId.toString() === resolvedUserId.toString())) return res.status(400).json({ message: 'Déjà membre' });
  // assign position: provided or next available
  let assignedPos = position ? Number(position) : (tontine.members.length + 1);
  // ensure no duplicate positions
  const used = new Set(tontine.members.map(m => Number(m.position || 0)));
  while (used.has(assignedPos)) assignedPos++;
  tontine.members.push({ userId: resolvedUserId, contributed: 0, position: assignedPos });
  // bump participantsCount if present
  tontine.participantsCount = Math.max(tontine.participantsCount || 0, tontine.members.length);
  await tontine.save();
  res.json({ success: true, position: assignedPos });
}));

// POST /api/tontines/:id/contribute
app.post('/api/tontines/:id/contribute', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { userId, amount } = req.body;
  if (!userId || !amount) return res.status(400).json({ message: 'userId et amount requis' });
  const resolvedUserId = await resolveUserId(userId);
  const tontine = await Tontine.findById(id);
  if (!tontine) return res.status(404).json({ message: 'Tontine non trouvée' });
  const member = tontine.members.find(m => m.userId.toString() === resolvedUserId.toString());
  if (!member) return res.status(400).json({ message: 'Utilisateur non membre' });
  member.contributed = (member.contributed || 0) + Number(amount);
  tontine.totalAmount = (tontine.totalAmount || 0) + Number(amount);
  await tontine.save();
  // Optionally create a Transaction record if tontine linked to a budget
  if (tontine.budgetId) {
    try {
      const now = new Date();
      const tr = new Transaction({ userId: resolvedUserId, budgetId: tontine.budgetId, type: 'expense', amount: Number(amount), comment: `Tontine: ${tontine.name}`, date: getTodayDate(), time: now.toTimeString().slice(0,5) });
      await tr.save();
      console.log('✅ Tontine transaction saved:', tr._id ? tr._id.toString() : '<no-id>', { userId: tr.userId, budgetId: tr.budgetId, date: tr.date, time: tr.time, amount: tr.amount });
      var createdTontineTransactionId = tr._id ? tr._id.toString() : null;

      // Recompute today's totals and Day finalPocket for user
      const currentDate = getTodayDate();
      const todayTransactions = await Transaction.find({ userId: resolvedUserId, date: currentDate });
      const totalGains = todayTransactions.filter(t => t.type === 'gain').reduce((sum, t) => sum + t.amount, 0);
      const totalExpenses = todayTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
      const lastDay = await Day.findOne({ userId: resolvedUserId }).sort({ date: -1 }).limit(1);
      const initialPocket = lastDay ? lastDay.finalPocket : 0;
      const budgetsAvailable = await calculateBudgetsAvailable(resolvedUserId, currentDate);
      const finalPocket = initialPocket + totalGains - totalExpenses;
      await Day.updateOne({ userId: resolvedUserId, date: currentDate }, { $set: { initialPocket, budgetsAvailable, gains: totalGains, expenses: totalExpenses, finalPocket } }, { upsert: true });
    } catch (e) {
      console.warn('Erreur création transaction pour tontine:', e.message || e);
    }
  }

  res.json({ success: true, totalAmount: tontine.totalAmount, transactionId: typeof createdTontineTransactionId !== 'undefined' ? createdTontineTransactionId : null });
}));

// GET /api/tontines/id/:id
app.get('/api/tontines/id/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const t = await Tontine.findById(id);
  if (!t) return res.status(404).json({ message: 'Tontine non trouvée' });
  const participants = t.participantsCount || t.members.length || 0;
  const totalNeeded = participants > 0 ? participants * (t.contributionAmount || 0) : 0;
  const overallPercent = totalNeeded > 0 ? Math.min(100, Math.round(((t.totalAmount || 0) / totalNeeded) * 100)) : 0;
  res.json({ success: true, tontine: { id: t._id.toString(), name: t.name, contributionAmount: t.contributionAmount, totalAmount: t.totalAmount, members: t.members.map(m => ({ userId: m.userId.toString(), contributed: m.contributed, position: m.position })), participantsCount: participants, overallPercent } });
}));

// GET /api/tontines/:id/percent/:userId - percent until user's turn and related metrics
app.get('/api/tontines/:id/percent/:userId', asyncHandler(async (req, res) => {
  const { id, userId } = req.params;
  const resolvedUserId = await resolveUserId(userId);
  const t = await Tontine.findById(id);
  if (!t) return res.status(404).json({ message: 'Tontine non trouvée' });
  const participants = t.participantsCount || t.members.length || 0;
  const elapsed = periodsElapsedSince(t.startDate || getTodayDate(), t.frequency || 'monthly');
  const currentReceiverIndex = participants > 0 ? ((elapsed % participants) + 1) : 1;
  const member = t.members.find(m => m.userId.toString() === resolvedUserId.toString()) || null;
  const myPosition = member ? (member.position || null) : null;
  const turnsUntilMe = (myPosition && participants) ? ((myPosition - currentReceiverIndex + participants) % participants) : null;
  const percentUntilMyTurn = turnsUntilMe != null && participants ? Math.round(((participants - turnsUntilMe) / participants) * 100) : null;
  res.json({ success: true, percentUntilMyTurn, turnsUntilMe, currentReceiverIndex, myPosition, participantsCount: participants });
}));

// =====================
// USER PREFERENCES
// =====================
// PUT /api/users/:userId/preferences
app.put('/api/users/:userId/preferences', asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const prefs = req.body;
  const resolvedUserId = await resolveUserId(userId);
  const user = await User.findById(resolvedUserId);
  if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });
  user.preferences = { ...user.preferences.toObject?.() || user.preferences || {}, ...prefs };
  await user.save();
  res.json({ success: true, preferences: user.preferences });
}));

// GET /api/dashboard/:userId - Récupérer le résumé calculé (solde, wallets, transactions, objectifs, conseil IA)
app.get('/api/dashboard/:userId', asyncHandler(async (req, res) => {
  let { userId } = req.params;
  userId = await resolveUserId(userId);

  const currentDate = getTodayDate();

  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });

  // Get today's Day record (budgetsAvailable, gains, expenses)
  const today = await Day.findOne({ userId, date: currentDate });
  const budgetsAvailable = today ? today.budgetsAvailable : await calculateBudgetsAvailable(userId, currentDate);

  // derniers jours pour solde précédent
  const lastDay = await Day.findOne({ userId }).sort({ date: -1 }).limit(1);
  const previousBalance = lastDay ? lastDay.finalPocket : 0;

  // Récupérer budgets et calculer les remaining par wallet
  const budgets = await Budget.find({ userId });
  const wallets = await Promise.all(budgets.map(async (b) => {
    const remaining = await calculateRemainingBudget(b, userId, currentDate);
    return {
      id: b._id.toString(),
      name: b.name,
      amount: b.amount,
      frequency: b.frequency,
      remaining,
      isPrimary: !!b.isPrimary
    };
  }));

  // Transactions du jour
  const todayTransactions = await Transaction.find({ userId, date: currentDate }).sort({ createdAt: 1 });

  // Calcul des gains par fréquence (selon budget frequency)
  const gainsByFreq = { daily: 0, weekly: 0, monthly: 0 };
  let totalExpenses = 0;
  for (const t of todayTransactions) {
    if (t.type === 'gain') {
      if (t.budgetId) {
        const b = budgets.find(x => x._id.toString() === t.budgetId.toString());
        if (b) gainsByFreq[b.frequency] = (gainsByFreq[b.frequency] || 0) + t.amount;
        else gainsByFreq.daily += t.amount; // fallback
      } else {
        gainsByFreq.daily += t.amount;
      }
    } else if (t.type === 'expense') {
      totalExpenses += t.amount;
    }
  }

  // Total gains (used for AI advice and Day calculations) — gains do not affect argent_en_poche
  const totalGains = (gainsByFreq.daily || 0) + (gainsByFreq.weekly || 0) + (gainsByFreq.monthly || 0);

  // Argent en poche (strict product rule): weekly remaining derived from primary monthly salary
  // Gains from other sources DO NOT increase argent en poche
  const argent_en_poche = await computeArgentEnPoche(userId, currentDate);

  // Dynamic intelligent limits (month -> week -> day) based on remaining monthly budget
  const dynamicLimits = computeDynamicLimits(budgetsAvailable, currentDate);

  // Analyse des seuils hebdomadaires et mensuels pour le conseil IA
  let weeklyExpenses = 0;
  try {
    const current = new Date(currentDate);
    const weekStart = new Date(current);
    weekStart.setDate(current.getDate() - 6); // 7 derniers jours, aujourd'hui inclus
    const weekStartStr = weekStart.toISOString().slice(0, 10);
    const weekDays = await Day.find({
      userId,
      date: { $gte: weekStartStr, $lte: currentDate }
    });
    weeklyExpenses = weekDays.reduce((sum, d) => sum + (d.expenses || 0), 0);
  } catch (e) {
    weeklyExpenses = 0;
  }

  // Baseline mensuelle issue du budget primaire (salaire principal)
  const primaryMonthly = budgets.find(b => b.isPrimary && b.frequency === 'monthly') || null;
  let monthlyBaseline = null;
  let monthlyUsed = null;
  let monthlyUsageRatio = null;
  if (primaryMonthly) {
    monthlyBaseline = Number(primaryMonthly.initialAmount || primaryMonthly.amount || 0) || null;
    if (monthlyBaseline && typeof budgetsAvailable === 'number') {
      monthlyUsed = Math.max(0, monthlyBaseline - budgetsAvailable);
      monthlyUsageRatio = monthlyUsed / monthlyBaseline;
    }
  }

  // Objectifs
  const objectives = await Objective.find({ userId });
  const objectivesFormatted = objectives.map(o => ({
    id: o._id.toString(),
    name: o.name || null,
    targetAmount: o.targetAmount,
    targetDate: o.targetDate,
    achieved: o.achieved,
    savedAmount: o.savedAmount || 0,
    progressPercent: Math.min(100, Math.round(((o.savedAmount || 0) / o.targetAmount) * 100))
  }));

  // AI advice: single short actionable advice based on today's balance, expenses, budget overruns and active objective
  let aiAdvice = '';
  const activeObjective = objectives.find(o => !o.achieved) || null;
  const { monthlyAvailable, weeklyLimit, dailyLimit, daysLeft, weeksLeft } = dynamicLimits || {};
  // Detect any budget overrun (unbounded remaining < 0)
  let budgetOverrun = false;
  for (const w of wallets) {
    const bSpent = todayTransactions.filter(t => t.type === 'expense' && String(t.budgetId) === String(w.id)).reduce((s, t) => s + t.amount, 0);
    const bGains = todayTransactions.filter(t => t.type === 'gain' && String(t.budgetId) === String(w.id)).reduce((s, t) => s + t.amount, 0);
    const unbounded = (w.amount || 0) + bGains - bSpent;
    if (unbounded < 0) { budgetOverrun = true; break; }
  }

  if (argent_en_poche <= 0) {
    aiAdvice = `Votre argent en poche est épuisé. Réduisez immédiatement les dépenses non-essentielles.`;
  } else if (budgetOverrun) {
    aiAdvice = 'Un de vos budgets est dépassé aujourd\'hui — réduisez ou réallouez des dépenses.';
  } else if (monthlyUsageRatio != null && monthlyUsageRatio > 0.9) {
    // Plus de 90% du budget mensuel déjà utilisé
    const remaining = Math.max(0, (monthlyBaseline || 0) - (monthlyUsed || 0));
    aiAdvice = `Attention, vous avez déjà utilisé plus de 90% de votre budget mensuel principal. Il ne vous reste que ${remaining} XOF pour finir le mois. Réduisez fortement les dépenses non essentielles.`;
  } else if (weeklyLimit && weeklyExpenses > weeklyLimit) {
    const diffWeek = weeklyExpenses - weeklyLimit;
    aiAdvice = `Sur les 7 derniers jours, vos dépenses (${weeklyExpenses} XOF) dépassent le seuil conseillé hebdomadaire de ${weeklyLimit} XOF (écart de ${diffWeek} XOF). Ralentissez les dépenses cette semaine pour rester dans le budget du mois.`;
  } else if (dailyLimit && totalExpenses > dailyLimit) {
    const diffDay = totalExpenses - dailyLimit;
    const remainingDays = daysLeft || 1;
    aiAdvice = `Aujourd'hui vos dépenses (${totalExpenses} XOF) dépassent le seuil conseillé de ${dailyLimit} XOF pour respecter votre budget du mois (écart de ${diffDay} XOF). Pour les ${remainingDays} prochains jours, essayez de rester autour de ${Math.floor((monthlyAvailable || 0) / remainingDays)} XOF par jour.`;
  } else if (activeObjective && argent_en_poche < activeObjective.targetAmount * 0.2) {
    aiAdvice = `Pensez à augmenter vos gains ou réduire dépenses pour progresser vers l\'objectif ${activeObjective.targetAmount} XOF.`;
  } else if (totalExpenses > totalGains) {
    const diff = totalExpenses - totalGains;
    aiAdvice = `Vos dépenses dépassent vos gains d\'aujourd\'hui de ${diff} XOF — réduisez les non-essentiels.`;
  } else {
    aiAdvice = 'Bonne gestion aujourd\'hui — vos gains couvrent vos dépenses.';
  }

  res.json({
    success: true,
    user: { id: user._id.toString(), name: user.name, email: user.email, subscription: user.subscription || null },
    argent_en_poche,
    budgetsAvailable,
     dynamicLimits,
    wallets,
    transactions: todayTransactions.map(t => ({ id: t._id.toString(), type: t.type, amount: t.amount, comment: t.comment, time: t.time, budgetId: t.budgetId ? t.budgetId.toString() : null })),
    objectives: objectivesFormatted,
    aiAdvice
  });
}));

// POST /api/register - Enregistrer un nouvel utilisateur
app.post('/api/register', asyncHandler(async (req, res) => {
  const { phoneNumber, firstName, lastName } = req.body;
  // Optional: primary income to seed the main budget and whether to create default budgets
  const { primaryIncomeAmount, primaryIncomeFrequency, createDefaultBudgets } = req.body;
  logger.info('Incoming register request');
  logger.debug('register request body', { body: req.body });

  if (!phoneNumber || !firstName || !lastName) {
    logger.warn('register validation failed - missing fields', { phoneNumber, firstName, lastName });
    return res.status(400).json({ 
      message: 'Numéro de téléphone, prénom et nom sont requis' 
    });
  }
  
  // Vérifier si l'utilisateur n'existe pas déjà
  const userEmail = `${phoneNumber.replace(/\D/g, '')}@test.local`;
  const existingUser = await User.findOne({ email: userEmail });
  
  if (existingUser) {
    return res.status(409).json({ 
      message: 'Un compte existe déjà avec ce numéro de téléphone' 
    });
  }
  
  // Créer le nouvel utilisateur
  let userId;
  try {
    userId = await createUser(phoneNumber, `${firstName} ${lastName}`, userEmail);
  } catch (err) {
    console.error('Error creating user in /api/register', err && err.stack ? err.stack : err);
    throw err;
  }

  // Create default budgets: monthly (primary) + weekly + daily with proper cascade allocation.
  // User can customize names/amounts after login.
  const createdBudgets = [];
  if (createDefaultBudgets) {
    const monthlyAmount = primaryIncomeAmount ? Number(primaryIncomeAmount) : 125000;
    const weeklyAmount = Math.round(monthlyAmount / 4);
    const dailyAmount = Math.round(weeklyAmount / 5); // ~5 working days per week

    // 1. Create monthly (primary) with full amount
    const monthly = new Budget({ userId, name: 'Salaire Principal', amount: monthlyAmount, frequency: 'monthly', isPrimary: true, initialAmount: monthlyAmount, currentAmount: monthlyAmount, createdFrom: 'derived', immutableInitial: true });
    await monthly.save();
    createdBudgets.push({ id: monthly._id.toString(), name: monthly.name, amount: monthly.amount, frequency: monthly.frequency });

    // 2. Create weekly with allocation from monthly
    const weekly = new Budget({ userId, name: 'ARGENT PAR SEMAINE', amount: weeklyAmount, frequency: 'weekly', isPrimary: false, initialAmount: weeklyAmount, currentAmount: weeklyAmount, createdFrom: 'derived', immutableInitial: false });
    await weekly.save();
    // Deduct weekly from monthly
    await Budget.updateOne({ _id: monthly._id }, { $set: { currentAmount: monthlyAmount - weeklyAmount } });
    createdBudgets.push({ id: weekly._id.toString(), name: weekly.name, amount: weekly.amount, frequency: weekly.frequency });
    
    // 3. Create daily with allocation from weekly
    const daily = new Budget({ userId, name: 'ARGENT PAR jour', amount: dailyAmount, frequency: 'daily', isPrimary: false, initialAmount: dailyAmount, currentAmount: dailyAmount, createdFrom: 'derived', immutableInitial: false });
    await daily.save();
    // Deduct daily from weekly
    await Budget.updateOne({ _id: weekly._id }, { $set: { currentAmount: weeklyAmount - dailyAmount } });
    createdBudgets.push({ id: daily._id.toString(), name: daily.name, amount: daily.amount, frequency: daily.frequency });

    // Write JournalEntry recording the allocations
    const je = new JournalEntry({
      userId,
      txType: 'adjustment',
      amount: 0,
      comment: 'Budget initial setup: monthly primary + weekly + daily allocations',
      affected: [
        { budgetId: monthly._id, before: monthlyAmount, after: monthlyAmount - weeklyAmount },
        { budgetId: weekly._id, before: weeklyAmount, after: weeklyAmount - dailyAmount },
        { budgetId: daily._id, before: dailyAmount, after: dailyAmount }
      ],
      ruleApplied: 'initial_budget_allocation'
    });
    await je.save();
  }
  
  res.status(201).json({
    success: true,
    message: 'Compte créé avec succès',
    userId: userId,
    user: {
      id: userId,
      name: `${firstName} ${lastName}`,
      email: userEmail
    }
  });
}));

// GET /api/budgets/:userId - Récupérer les budgets d'un utilisateur
app.get('/api/budgets/:userId', asyncHandler(async (req, res) => {
  let { userId } = req.params;
  userId = await resolveUserId(userId);

  const budgets = await Budget.find({ userId });
  const currentDate = getTodayDate();

  const budgetsWithRemaining = await Promise.all(budgets.map(async (b) => {
    const remaining = await calculateRemainingBudget(b, userId, currentDate);
    return {
      id: b._id.toString(),
      name: b.name,
      amount: b.amount,
      frequency: b.frequency,
      remaining
    };
  }));

  res.json({ success: true, budgets: budgetsWithRemaining });
}));

// POST /api/budgets - Créer un nouveau budget
app.post('/api/budgets', asyncHandler(async (req, res) => {
  const { userId, name, amount, frequency, clientId, isPrimary } = req.body;

  if (!userId || !name || typeof amount === 'undefined' || !frequency) {
    return res.status(400).json({ message: 'userId, name, amount, frequency sont requis' });
  }

  const numericAmount = Number(amount || 0);
  if (!(numericAmount > 0)) {
    return res.status(400).json({ message: 'Le montant du budget doit être supérieur à 0' });
  }

  if (!['daily', 'weekly', 'monthly'].includes(frequency)) {
    return res.status(400).json({ message: 'frequency doit être: daily, weekly, ou monthly' });
  }

  const resolvedUserId = await resolveUserId(userId);

  // Enforce single immutable primary salary budget per user
  if (isPrimary) {
    const existingPrimary = await Budget.findOne({ userId: resolvedUserId, isPrimary: true });
    if (existingPrimary) {
      return res.status(400).json({ message: 'Un budget principal existe déjà et ne peut pas être recréé ou modifié' });
    }
    if (frequency !== 'monthly') {
      return res.status(400).json({ message: 'Le budget principal doit être mensuel' });
    }
  }

  // Validate budget hierarchy constraints (server-side, enforced)
  if (!isPrimary) {
    const validation = await validateBudgetHierarchy(resolvedUserId, frequency, numericAmount);
    if (!validation.valid) {
      return res.status(400).json({ message: validation.message });
    }
  }

  // idempotent create if clientId provided
  if (clientId) {
    const existing = await Budget.findOne({ clientId, userId: resolvedUserId });
    if (existing) {
      return res.status(200).json({ success: true, budget: { id: existing._id.toString(), name: existing.name, amount: existing.amount, frequency: existing.frequency } });
    }
  }

  const budget = new Budget({
    userId: resolvedUserId,
    name,
    amount: numericAmount,
    frequency,
    clientId: clientId || null,
    isPrimary: !!isPrimary,
    initialAmount: numericAmount,
    currentAmount: numericAmount,
    createdFrom: isPrimary ? 'derived' : 'manual',
    immutableInitial: !!isPrimary
  });

  // If creating a weekly budget (non-primary), allocate it from the primary monthly budget
  if (!isPrimary && frequency === 'weekly') {
    if (TRANSACTIONS_SUPPORTED) {
      const session = await mongoose.startSession();
      try {
        session.startTransaction();
        // load primary monthly in-session
        const primary = await Budget.findOne({ userId: resolvedUserId, frequency: 'monthly', isPrimary: true }).session(session);
        if (!primary) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ message: 'Aucun budget mensuel principal trouvé pour allouer le budget hebdomadaire' });
        }
        const before = Number(primary.currentAmount || 0);
        const after = before - numericAmount;
        if (after < 0) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ message: `Allocation impossible — le budget mensuel principal serait négatif (${after})` });
        }
        // save the new budget and update primary
        await budget.save({ session });
        await Budget.updateOne({ _id: primary._id }, { $set: { currentAmount: after } }).session(session);
        const je = new JournalEntry({ userId: resolvedUserId, txType: 'expense', amount: numericAmount, comment: `Allocation automatique budget hebdo ${name}`, affected: [{ budgetId: primary._id, before, after }, { budgetId: budget._id, before: numericAmount, after: numericAmount }], ruleApplied: 'allocation_weekly_from_month' });
        await je.save({ session });
        await session.commitTransaction();
        session.endSession();
        return res.status(201).json({ success: true, budget: { id: budget._id.toString(), name: budget.name, amount: budget.amount, frequency: budget.frequency } });
      } catch (e) {
        try { await session.abortTransaction(); } catch (__) {}
        try { session.endSession(); } catch (__) {}
        console.error('Erreur allocation budget hebdo transactionnelle:', e);
        return res.status(500).json({ message: 'Erreur serveur lors de la création du budget', error: e.message });
      }
    } else {
      // Fallback: conditional update on primary
      const primary = await Budget.findOne({ userId: resolvedUserId, frequency: 'monthly', isPrimary: true });
      if (!primary) return res.status(400).json({ message: 'Aucun budget mensuel principal trouvé pour allouer le budget hebdomadaire' });
      const before = Number(primary.currentAmount || 0);
      const after = before - numericAmount;
      if (after < 0) return res.status(400).json({ message: `Allocation impossible — le budget mensuel principal serait négatif (${after})` });
      // apply conditional update
      const updated = await Budget.findOneAndUpdate({ _id: primary._id, currentAmount: { $gte: numericAmount } }, { $inc: { currentAmount: -numericAmount } }, { new: true });
      if (!updated) return res.status(409).json({ message: 'Conflit de disponibilité lors de l allocation du budget hebdomadaire' });
      await budget.save();
      const je = new JournalEntry({ userId: resolvedUserId, txType: 'expense', amount: numericAmount, comment: `Allocation automatique budget hebdo ${name} (fallback)`, affected: [{ budgetId: primary._id, before, after }], ruleApplied: 'allocation_weekly_from_month_fallback' });
      await je.save();
      return res.status(201).json({ success: true, budget: { id: budget._id.toString(), name: budget.name, amount: budget.amount, frequency: budget.frequency } });
    }
  }

  // Default save for other budgets
  await budget.save();

  res.status(201).json({ success: true, budget: { id: budget._id.toString(), name: budget.name, amount: budget.amount, frequency: budget.frequency } });
}));

// GET /api/budgets/id/:id - Récupérer un budget par id
app.get('/api/budgets/id/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const budget = await Budget.findById(id);
  if (!budget) return res.status(404).json({ message: 'Budget non trouvé' });
  res.json({ success: true, budget });
}));

// PUT /api/budgets/:id - Mettre à jour un budget
app.put('/api/budgets/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, amount } = req.body; // frequency is intentionally not updatable

  const budget = await Budget.findById(id);
  if (!budget) return res.status(404).json({ message: 'Budget non trouvé' });

  if (name) budget.name = name;
  if (typeof amount !== 'undefined') {
    const numericAmount = Number(amount || 0);
    if (!(numericAmount > 0)) return res.status(400).json({ message: 'Le montant du budget doit être supérieur à 0' });
    if (budget.isPrimary) return res.status(400).json({ message: 'Le montant du budget principal ne peut pas être modifié' });
    
    // Validate budget hierarchy constraints when changing amount
    const validation = await validateBudgetHierarchy(budget.userId, budget.frequency, numericAmount);
    if (!validation.valid) {
      return res.status(400).json({ message: validation.message });
    }
    
    budget.amount = numericAmount;
  }

  await budget.save();
  res.json({ success: true, budget });
}));

// DELETE /api/budgets/:id - Supprimer un budget
app.delete('/api/budgets/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const budget = await Budget.findById(id);
  if (!budget) return res.status(404).json({ message: 'Budget non trouvé' });

  // Supprimer les transactions associées ? ici on conserve historique mais on retire le budget
  await Budget.deleteOne({ _id: id });
  res.json({ success: true, message: 'Budget supprimé' });
}));

// GET /api/budgets/:id/remaining - Récupérer le montant restant calculé pour un budget
app.get('/api/budgets/:id/remaining', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { date } = req.query; // optionnel: YYYY-MM-DD
  const budget = await Budget.findById(id);
  if (!budget) return res.status(404).json({ message: 'Budget non trouvé' });

  const userId = budget.userId.toString();
  const currentDate = date || getTodayDate();
  const remaining = await calculateRemainingBudget(budget, userId, currentDate);
  res.json({ success: true, remaining });
}));

// POST /api/transactions - Ajouter une transaction (avec validation)
app.post('/api/transactions', asyncHandler(async (req, res) => {
  // Validation avec Joi
  const { error, value } = transactionValidationSchema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({
      message: 'Erreur de validation',
      errors: error.details.map(d => ({ field: d.path[0], message: d.message }))
    });
  }

  let { userId, type, amount, comment, budgetId } = value;
  userId = await resolveUserId(userId); // Convert string ID to ObjectId if needed
  const currentDate = getTodayDate();
  const currentTime = new Date().toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit'
  });
  
  // Vérifier que le jour n'est pas verrouillé
  const today = await Day.findOne({ userId, date: currentDate });
  if (today && today.locked) {
    return res.status(403).json({ message: 'Le jour est verrouillé, aucune modification possible' });
  }
  
  // For expense ensure the target budget exists (we will enforce availability inside transaction or fallback)
  if (type === 'expense') {
    const bcheck = await Budget.findById(budgetId);
    if (!bcheck) return res.status(404).json({ message: 'Budget non trouvé' });
  }

  // If the server supports multi-document transactions, use them. Otherwise use a safer fallback.
  if (TRANSACTIONS_SUPPORTED) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      // Create the Transaction record (in-session)
      const transaction = new Transaction({ userId, budgetId: budgetId || null, type, amount, comment, date: currentDate, time: currentTime });
      await transaction.save({ session });

      // Determine affected budgets and perform cascade (all reads/updates in-session)
      const affected = [];
      const loadAndPrepare = async (bId) => {
        if (!bId) return null;
        const b = await Budget.findById(bId).session(session);
        return b;
      };

      const targetBudget = budgetId ? await loadAndPrepare(budgetId) : null;
      if (type === 'expense') {
        if (!targetBudget) {
          await session.abortTransaction();
          return res.status(404).json({ message: 'Budget non trouvé' });
        }

        const toUpdate = [];
        toUpdate.push(targetBudget);
        // Cascade to immediate parent only (not grandparents)
        if (targetBudget.frequency === 'daily') {
          const weekly = await Budget.findOne({ userId, frequency: 'weekly' }).session(session);
          if (weekly) toUpdate.push(weekly);
          // Note: do NOT cascade to monthly when daily expense
        } else if (targetBudget.frequency === 'weekly') {
          const monthlyPrimary = await Budget.findOne({ userId, frequency: 'monthly', isPrimary: true }).session(session);
          if (monthlyPrimary) toUpdate.push(monthlyPrimary);
        }

        for (const b of toUpdate) {
          const before = Number(b.currentAmount || 0);
          const after = before - Number(amount || 0);
          if (after < 0) {
            await session.abortTransaction();
            return res.status(400).json({ message: `Opération rejetée — le budget "${b.name}" serait négatif (${after})` });
          }
          affected.push({ budgetId: b._id, before, after });
        }

        for (const a of affected) {
          await Budget.updateOne({ _id: a.budgetId }, { $set: { currentAmount: a.after } }).session(session);
        }

        const je = new JournalEntry({ userId, txType: 'expense', amount, comment, affected: affected.map(a => ({ budgetId: a.budgetId, before: a.before, after: a.after })), ruleApplied: 'cascade_expense', meta: { sourceBudget: budgetId } });
        await je.save({ session });
      } else if (type === 'gain') {
        const je = new JournalEntry({ userId, txType: 'gain', amount, comment, affected: [], ruleApplied: 'gain_to_savings' });
        await je.save({ session });
      }

      // Update Day document totals (reads use session)
      const todayTransactions = await Transaction.find({ userId, date: currentDate }).session(session);
      const totalGains = todayTransactions.filter(t => t.type === 'gain').reduce((s, t) => s + t.amount, 0);
      const totalExpenses = todayTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
      const lastDay = await Day.findOne({ userId }).sort({ date: -1 }).limit(1).session(session);
      const initialPocket = lastDay ? lastDay.finalPocket : 0;
      const budgetsAvailable = await calculateBudgetsAvailable(userId, currentDate, session);
      const finalPocket = initialPocket + totalGains - totalExpenses;

      await Day.updateOne({ userId, date: currentDate }, { $set: { initialPocket, budgetsAvailable, gains: totalGains, expenses: totalExpenses, finalPocket } }, { upsert: true, session });

      await session.commitTransaction();
      session.endSession();

      res.status(201).json({ message: 'Transaction créée avec succès', transaction: { id: transaction._id.toString(), type: transaction.type, amount: transaction.amount, comment: transaction.comment, time: transaction.time } });
    } catch (err) {
      try { await session.abortTransaction(); } catch (__) {}
      try { session.endSession(); } catch (__) {}
      console.error('Erreur transactionnelle POST /api/transactions:', err);
      return res.status(500).json({ message: 'Erreur serveur lors de l\'enregistrement de la transaction', error: err.message });
    }
  } else {
    // Fallback when transactions are not available: perform conditional per-budget updates and rollback on failure.
    if (type === 'expense') {
      // Load budgets deterministically
      const targetBudget = await Budget.findById(budgetId);
      if (!targetBudget) return res.status(404).json({ message: 'Budget non trouvé' });

      const toUpdate = [];
      toUpdate.push(targetBudget);
      // Cascade to immediate parent only (not grandparents)
      if (targetBudget.frequency === 'daily') {
        const weekly = await Budget.findOne({ userId, frequency: 'weekly' });
        if (weekly) toUpdate.push(weekly);
        // Note: do NOT cascade to monthly when daily expense
      } else if (targetBudget.frequency === 'weekly') {
        const monthlyPrimary = await Budget.findOne({ userId, frequency: 'monthly', isPrimary: true });
        if (monthlyPrimary) toUpdate.push(monthlyPrimary);
      }

      // Check availability using currentAmount snapshot
      const affected = [];
      for (const b of toUpdate) {
        const before = Number(b.currentAmount || 0);
        const after = before - Number(amount || 0);
        if (after < 0) return res.status(400).json({ message: `Opération rejetée — le budget "${b.name}" serait négatif (${after})` });
        affected.push({ budgetId: b._id, before, after });
      }

      // Apply updates one by one using conditional atomic updates
      const updated = [];
      try {
        for (const a of affected) {
          const u = await Budget.findOneAndUpdate({ _id: a.budgetId, currentAmount: { $gte: Number(amount || 0) } }, { $inc: { currentAmount: -Number(amount || 0) } }, { new: true });
          if (!u) throw new Error('Conflit de disponibilité budget');
          updated.push(a.budgetId);
        }

        // Persist Transaction and JournalEntry
        const transaction = new Transaction({ userId, budgetId: budgetId || null, type, amount, comment, date: currentDate, time: currentTime });
        await transaction.save();
        const je = new JournalEntry({ userId, txType: 'expense', amount, comment, affected: affected.map(a => ({ budgetId: a.budgetId, before: a.before, after: a.after })), ruleApplied: 'cascade_expense_fallback', meta: { sourceBudget: budgetId } });
        await je.save();

        // Recompute Day totals (best-effort)
        const todayTransactions = await Transaction.find({ userId, date: currentDate });
        const totalGains = todayTransactions.filter(t => t.type === 'gain').reduce((s, t) => s + t.amount, 0);
        const totalExpenses = todayTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
        const lastDay = await Day.findOne({ userId }).sort({ date: -1 }).limit(1);
        const initialPocket = lastDay ? lastDay.finalPocket : 0;
        const budgetsAvailable = await calculateBudgetsAvailable(userId, currentDate);
        const finalPocket = initialPocket + totalGains - totalExpenses;
        await Day.updateOne({ userId, date: currentDate }, { $set: { initialPocket, budgetsAvailable, gains: totalGains, expenses: totalExpenses, finalPocket } }, { upsert: true });

        return res.status(201).json({ message: 'Transaction créée avec succès (fallback)', transaction: { id: transaction._id.toString(), type: transaction.type, amount: transaction.amount, comment: transaction.comment, time: transaction.time } });
      } catch (e) {
        // revert applied updates
        for (const bid of updated) {
          try { await Budget.updateOne({ _id: bid }, { $inc: { currentAmount: Number(amount || 0) } }); } catch (__) {}
        }
        return res.status(409).json({ message: 'Conflit de disponibilité lors de la mise à jour des budgets, réessayez' });
      }
    } else if (type === 'gain') {
      // Gains fallback: save transaction and journal entry
      const transaction = new Transaction({ userId, budgetId: budgetId || null, type, amount, comment, date: currentDate, time: currentTime });
      await transaction.save();
      const je = new JournalEntry({ userId, txType: 'gain', amount, comment, affected: [], ruleApplied: 'gain_to_savings' });
      await je.save();

      // update Day totals
      const todayTransactions = await Transaction.find({ userId, date: currentDate });
      const totalGains = todayTransactions.filter(t => t.type === 'gain').reduce((s, t) => s + t.amount, 0);
      const totalExpenses = todayTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
      const lastDay = await Day.findOne({ userId }).sort({ date: -1 }).limit(1);
      const initialPocket = lastDay ? lastDay.finalPocket : 0;
      const budgetsAvailable = await calculateBudgetsAvailable(userId, currentDate);
      const finalPocket = initialPocket + totalGains - totalExpenses;
      await Day.updateOne({ userId, date: currentDate }, { $set: { initialPocket, budgetsAvailable, gains: totalGains, expenses: totalExpenses, finalPocket } }, { upsert: true });

      return res.status(201).json({ message: 'Transaction (gain) créée avec succès (fallback)' });
    }
  }
    
}));

// GET /api/transactions/id/:id - debug endpoint to fetch a transaction by id
app.get('/api/transactions/id/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const tx = await Transaction.findById(id);
  if (!tx) return res.status(404).json({ message: 'Transaction non trouvée' });
  res.json({ success: true, transaction: { id: tx._id.toString(), userId: tx.userId.toString(), budgetId: tx.budgetId ? tx.budgetId.toString() : null, type: tx.type, amount: tx.amount, comment: tx.comment, date: tx.date, time: tx.time, createdAt: tx.createdAt } });
}));

// ============================================================================
// ROUTES API - ADMIN
// ============================================================================

// GET /api/admin/stats - Statistiques globales
app.get('/api/admin/stats', async (req, res) => {
  try {
    const currentDate = getTodayDate();
    
    // Nombre total d'utilisateurs
    const totalUsers = await User.countDocuments({ role: 'user' });
    
    // Utilisateurs actifs aujourd'hui (avec transactions)
    const activeToday = await Transaction.distinct('userId', {
      date: currentDate
    }).then(ids => ids.length);
    
    // Nombre total de budgets
    const totalBudgets = await Budget.countDocuments();
    
    // Argent moyen en poche
    const todayDays = await Day.find({ date: currentDate });
    const avgPocketMoney = todayDays.length > 0
      ? todayDays.reduce((sum, day) => sum + day.finalPocket, 0) / todayDays.length
      : 0;
    
    res.json({
      totalUsers,
      activeToday,
      totalBudgets,
      avgPocketMoney: Math.round(avgPocketMoney)
    });
    
  } catch (error) {
    console.error('Erreur GET /api/admin/stats:', error);
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
});

// GET /api/admin/users - Liste des utilisateurs avec leurs données
app.get('/api/admin/users', async (req, res) => {
  try {
    const currentDate = getTodayDate();
    
    const users = await User.find({ role: 'user' });
    
    const usersWithData = await Promise.all(
      users.map(async (user) => {
        const budgets = await Budget.countDocuments({ userId: user._id });
        const todayData = await Day.findOne({ userId: user._id, date: currentDate });
        
        const lastTransaction = await Transaction.findOne({ userId: user._id })
          .sort({ createdAt: -1 })
          .limit(1);
        
        return {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          budgetsCount: budgets,
          pocketMoney: todayData?.finalPocket || 0,
          lastActivity: lastTransaction?.createdAt || user.createdAt,
          createdAt: user.createdAt
        };
      })
    );
    
    res.json({ users: usersWithData });
    
  } catch (error) {
    console.error('Erreur GET /api/admin/users:', error);
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
});

// ============================================================================
// ROUTES UTILITAIRES
// ============================================================================

// POST /api/seed - Créer des données de test (développement uniquement)
app.post('/api/seed', asyncHandler(async (req, res) => {
  // Protection: seed uniquement en développement
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ message: 'Endpoint de seeding désactivé en production' });
  }

  // Nettoyer les données existantes
  await User.deleteMany({});
  await Budget.deleteMany({});
  await Transaction.deleteMany({});
  await Day.deleteMany({});
  
  // Créer un utilisateur test
  const user = new User({
    name: 'Sophie Martin',
    email: 'sophie@example.com',
      role: 'user'
    });
    await user.save();
    
    // Créer un admin test
    const admin = new User({
      name: 'Admin',
      email: 'admin@example.com',
      role: 'admin'
    });
    await admin.save();
    
    // Créer des budgets
    const budget1 = new Budget({
      userId: user._id,
      name: 'Salaire Principal',
      amount: 2500,
      frequency: 'monthly'
    });
    await budget1.save();
    
    const budget2 = new Budget({
      userId: user._id,
      name: 'Freelance Client A',
      amount: 600,
      frequency: 'weekly'
    });
    await budget2.save();
    
    const budget3 = new Budget({
      userId: user._id,
      name: 'Micro-tâches',
      amount: 50,
      frequency: 'daily'
    });
    await budget3.save();
    
    res.json({
      message: 'Données de test créées avec succès',
      user: { id: user._id, name: user.name },
      admin: { id: admin._id, name: admin.name }
    });
}));

// ============================================================================
// ============================================================================
// GESTION DES ERREURS GLOBALE & 404
// ============================================================================

// 404 handler (defined at end so all routes are registered first)

// POST /api/ai/advice - Request AI financial advice using OpenAI
const { getOpenAIAdvice } = require('./ia/openaiClient');

app.post('/api/ai/advice', asyncHandler(async (req, res) => {
  const { userId, context } = req.body || {};
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ success: false, message: 'OpenAI API key not configured on server (OPENAI_API_KEY).' });

  // Try to build a short summary if context not provided
  let prompt = '';
  if (context && typeof context === 'string') {
    prompt = context;
  } else if (context && typeof context === 'object') {
    try {
      prompt = `Utilisateur ${userId || ''} - Contexte: ${JSON.stringify(context)}\nDonne des conseils financiers pratiques en francais, actions prioritaires et alertes.`;
    } catch (e) {
      prompt = 'Donne des conseils financiers pratiques en francais basés sur le contexte utilisateur fourni.';
    }
  } else if (userId) {
    // Basic enrichment: fetch budgets, objectives and recent transactions for the user
    try {
      const resolved = await resolveUserId(userId).catch(() => null);
      if (resolved) {
        const budgets = await Budget.find({ userId: resolved }).limit(10);
        const objectives = await Objective.find({ userId: resolved }).limit(5);
        const recentTx = await Transaction.find({ userId: resolved }).sort({ createdAt: -1 }).limit(10);
        // Build a clearer prompt: short summary, 3 prioritized actions, and explicit alerts if any.
        prompt = `Résumé utilisateur:\nBudgets: ${budgets.map(b => `${b.name}=${b.amount}/${b.frequency}`).join('; ')}\nObjectifs: ${objectives.map(o => `${o.name || 'obj'} ${o.savedAmount || 0}/${o.targetAmount}`).join('; ')}\nTransactions récentes: ${recentTx.map(t => `${t.type} ${t.amount} (${t.comment})`).join('; ')}\n\nConsignes:\n- Réponds en français de façon concise et empathique.\n- Commence par un court résumé (1-2 phrases).\n- Ensuite fournis 3 actions prioritaires et concrètes que l'utilisateur peut faire (numérotées).\n- Si des alertes sont nécessaires (ex: dépassement de budget, objectif en retard), affiche-les clairement après les actions.\n- Termine par un petit rappel motivant.\nNe fournis PAS d'informations sensibles ni de diagnostics financiers complexes. Merci.`;
      } else {
        prompt = 'Donne des recommandations financières générales et priorisées en francais.';
      }
    } catch (e) {
      prompt = 'Donne des recommandations financières générales et priorisées en francais.';
    }
  } else {
    prompt = 'Donne des recommandations financières générales et priorisées en francais.';
  }

  try {
    const advice = await getOpenAIAdvice(apiKey, prompt);
    // send push to user subscriptions if available
    try {
      const resolved = userId ? await resolveUserId(userId).catch(() => null) : null;
      if (resolved && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
        // Save a short payload and send
        const payload = JSON.stringify({ title: 'Conseil Coach Financier', body: advice });
        const subs = await PushSubscription.find({ userId: resolved });
        for (const s of subs) {
          try {
            await webpush.sendNotification(s.subscription, payload);
          } catch (err) {
            console.warn('Push send failed, removing subscription', err.message || err);
            // Optionally remove invalid subscriptions
            try { await PushSubscription.deleteOne({ _id: s._id }); } catch (e) {}
          }
        }
      }
    } catch (e) {
      console.warn('Erreur lors de l envoi des push:', e.message || e);
    }

    return res.json({ success: true, advice });
  } catch (err) {
    console.error('Erreur OpenAI:', err.message || err);
    return res.status(500).json({ success: false, message: 'Erreur lors de l appel à OpenAI', error: err.message || String(err) });
  }
}));

// GET /api/ai/test - Minimal test to verify OpenAI connectivity (does not return the key)
app.get('/api/ai/test', asyncHandler(async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(400).json({ success: false, message: 'OPENAI_API_KEY not configured' });
  try {
    const advice = await getOpenAIAdvice(apiKey, 'Donne une réponse courte: OK');
    return res.json({ success: true, message: 'OpenAI reachable', sample: advice.slice(0, 200) });
  } catch (err) {
    console.error('OpenAI test error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Erreur connexion OpenAI', error: err.message || String(err) });
  }
}));

// GET /api/push/vapidPublicKey - return VAPID public key for frontend subscription
app.get('/api/push/vapidPublicKey', asyncHandler(async (req, res) => {
  if (!VAPID_PUBLIC_KEY) return res.status(400).json({ success: false, message: 'VAPID public key not configured' });
  res.json({ success: true, publicKey: VAPID_PUBLIC_KEY });
}));

// POST /api/push/subscribe - save a PushSubscription for a user
app.post('/api/push/subscribe', asyncHandler(async (req, res) => {
  const { userId, subscription } = req.body || {};
  if (!userId || !subscription) return res.status(400).json({ success: false, message: 'userId and subscription are required' });
  const resolvedUserId = await resolveUserId(userId).catch(() => null);
  if (!resolvedUserId) return res.status(404).json({ success: false, message: 'User not found' });
  try {
    // upsert subscription (avoid duplicates)
    const existing = await PushSubscription.findOne({ userId: resolvedUserId, 'subscription.endpoint': subscription.endpoint });
    if (existing) {
      existing.subscription = subscription;
      await existing.save();
      return res.json({ success: true });
    }
    const ps = new PushSubscription({ userId: resolvedUserId, subscription });
    await ps.save();
    res.json({ success: true });
  } catch (e) {
    console.error('Error saving push subscription', e);
    res.status(500).json({ success: false, message: 'Error saving subscription' });
  }
}));

// POST /api/push/unsubscribe - remove a PushSubscription for a user
app.post('/api/push/unsubscribe', asyncHandler(async (req, res) => {
  const { userId, endpoint } = req.body || {};
  if (!userId || !endpoint) return res.status(400).json({ success: false, message: 'userId and endpoint are required' });
  const resolvedUserId = await resolveUserId(userId).catch(() => null);
  if (!resolvedUserId) return res.status(404).json({ success: false, message: 'User not found' });

  try {
    const removed = await PushSubscription.deleteMany({ userId: resolvedUserId, 'subscription.endpoint': endpoint });
    return res.json({ success: true, removed: removed.deletedCount });
  } catch (e) {
    console.error('Error removing push subscription', e);
    return res.status(500).json({ success: false, message: 'Error removing subscription' });
  }
}));

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Erreur non gérée:', err);
  console.error(err && err.stack ? err.stack : err);
  
  // Erreurs Joi
  if (err.details && err.details[0]?.type === 'object.unknown') {
    return res.status(400).json({
      message: 'Erreur de validation',
      errors: err.details.map(d => ({ field: d.path[0], message: d.message }))
    });
  }
  
  // Erreurs MongoDB
  if (err.name === 'MongoError') {
    return res.status(400).json({ message: 'Erreur base de données', error: err.message });
  }
  
  // Erreurs par défaut
  res.status(err.status || 500).json({
    message: 'Erreur serveur interne',
    error: NODE_ENV === 'development' ? err.message : 'Une erreur est survenue'
  });
});

// 404 handler - placed after all routes
app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.method} ${req.path} non trouvée` });
});

// ============================================================================
// DÉMARRAGE DU SERVEUR
// ============================================================================
async function startServer() {
  try {
    await connectWithFallback();
    
    // Créer indices pour performance (non-blocking, skip on error)
    Promise.all([
      Transaction.collection.createIndex({ userId: 1, date: -1 }).catch(() => {}),
      Transaction.collection.createIndex({ budgetId: 1 }).catch(() => {}),
      Day.collection.createIndex({ userId: 1, date: -1 }).catch(() => {}),
      User.collection.createIndex({ email: 1 }, { unique: true }).catch(() => {})
    ]).then(() => {
      if (NODE_ENV === 'development') {
        console.log('✅ Indices MongoDB créés');
      }
    }).catch(err => {
      console.warn('⚠️ Indices MongoDB non créés (non-critical):', err.message);
    });
    
    // En production, servir les fichiers statiques du front buildé
    if (process.env.NODE_ENV === 'production') {
      const publicPath = path.join(__dirname, 'public');
      app.use(express.static(publicPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(publicPath, 'index.html'));
      });
    }
    
    app.listen(PORT, () => {
      console.log(`✅ Serveur démarré sur le port ${PORT}`);
      console.log(`📊 API disponible sur http://localhost:${PORT}/api`);
      console.log(`🔒 Rate limiting: ${process.env.RATE_LIMIT_MAX_REQUESTS || 100} requêtes par ${process.env.RATE_LIMIT_WINDOW_MS || 900000}ms`);
      if (NODE_ENV === 'production') {
        console.log(`📦 Serving static files from ${path.join(__dirname, 'public')}`);
      }
    });
  } catch (error) {
    console.error('❌ Erreur au démarrage du serveur:', error);
    process.exit(1);
  }
}

startServer();

// Export pour tests
module.exports = app;