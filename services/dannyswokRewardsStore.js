const crypto = require('crypto');
const { getCollection } = require('./mongo');
const {
  DEFAULT_REWARD_SETTINGS,
  DEFAULT_REWARD_AUTOMATION,
  FORTUNE_SETS,
  DEFAULT_PROFILE_TEMPLATE,
  DEFAULT_WINNERS,
  DEFAULT_REWARD_EVENTS,
} = require('../data/dannyswok-rewards');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clampPercent(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function normalizeOdds(inputOdds = {}) {
  const odds = { ...DEFAULT_REWARD_SETTINGS.odds };
  Object.entries(inputOdds || {}).forEach(([key, value]) => {
    if (typeof value === 'string' && value.trim()) {
      odds[key] = value.trim();
    }
  });
  return odds;
}

function calculateBudgetPool({ budgetPercent, revenueBaseline }) {
  const percent = toNumber(budgetPercent, DEFAULT_REWARD_SETTINGS.budgetPercent);
  const revenue = toNumber(revenueBaseline, DEFAULT_REWARD_SETTINGS.revenueBaseline);
  return Math.max(0, (percent / 100) * revenue);
}

async function ensureSingleton(collectionName, id, defaultsFactory) {
  const collection = await getCollection(collectionName);
  let doc = await collection.findOne({ _id: id });
  if (!doc) {
    doc = { _id: id, ...defaultsFactory() };
    await collection.insertOne(doc);
  }
  return { collection, doc };
}

async function loadSettings() {
  const { collection, doc } = await ensureSingleton(
    'dannyswok_reward_settings',
    'settings',
    () => clone(DEFAULT_REWARD_SETTINGS),
  );
  return { collection, doc };
}

async function loadAutomation() {
  const { collection, doc } = await ensureSingleton(
    'dannyswok_reward_automation',
    'automation',
    () => clone(DEFAULT_REWARD_AUTOMATION),
  );
  return { collection, doc };
}

async function loadWinners() {
  const { collection, doc } = await ensureSingleton(
    'dannyswok_reward_winners',
    'winners',
    () => ({ entries: clone(DEFAULT_WINNERS) }),
  );
  return { collection, doc };
}

async function loadEvents() {
  const { collection, doc } = await ensureSingleton(
    'dannyswok_reward_events',
    'events',
    () => clone(DEFAULT_REWARD_EVENTS),
  );
  return { collection, doc };
}

function buildSetProgress(inventory = []) {
  const collectedBySet = new Map();
  inventory
    .filter((item) => item?.setId && item?.pieceId)
    .forEach((item) => {
      const setKey = item.setId;
      const pieceKey = item.pieceId;
      if (!collectedBySet.has(setKey)) {
        collectedBySet.set(setKey, new Map());
      }
      const pieceMap = collectedBySet.get(setKey);
      if (!pieceMap.has(pieceKey)) {
        pieceMap.set(pieceKey, []);
      }
      pieceMap.get(pieceKey).push({
        inventoryId: item.id,
        collectedAt: item.collectedAt,
        expiresAt: item.expiresAt || null,
        rewardOutcome: item.rewardOutcome || null,
        callToAction: item.callToAction || null,
        progressNote: item.progressNote || null,
        rarity: item.rarity || null,
      });
    });

  return FORTUNE_SETS.map((set) => {
    const pieceMap = collectedBySet.get(set.id) || new Map();
    const pieces = set.pieces.map((piece) => {
      const matches = pieceMap.get(piece.id) || [];
      const latest = matches.length
        ? matches.slice().sort((a, b) => new Date(b.collectedAt) - new Date(a.collectedAt))[0]
        : null;
      return {
        ...piece,
        status: matches.length ? 'collected' : 'missing',
        collectedAt: latest?.collectedAt || null,
        inventoryId: latest?.inventoryId || null,
        expiresAt: latest?.expiresAt || null,
        rewardOutcome: latest?.rewardOutcome || null,
        callToAction: latest?.callToAction || null,
        progressNote: latest?.progressNote || null,
        duplicates: matches.length > 1 ? matches.length - 1 : 0,
      };
    });
    const collectedCount = pieces.filter((piece) => piece.status === 'collected').length;
    const completionRate = pieces.length ? collectedCount / pieces.length : 0;
    const lastCollectedAt = pieces
      .map((piece) => piece.collectedAt)
      .filter(Boolean)
      .sort((a, b) => new Date(b) - new Date(a))[0] || null;
    return {
      id: set.id,
      name: set.name,
      rarity: set.rarity,
      prize: set.prize,
      theme: set.theme,
      accentColor: set.accentColor,
      pieces,
      collectedCount,
      totalPieces: pieces.length,
      completionRate,
      isComplete: collectedCount === pieces.length && pieces.length > 0,
      isActive: collectedCount > 0 && collectedCount < pieces.length,
      lastCollectedAt,
    };
  });
}

function summarizeInventory(inventory = []) {
  const sorted = inventory.slice().sort((a, b) => new Date(b.collectedAt) - new Date(a.collectedAt));
  const duplicates = sorted
    .filter((item) => item?.setId && item?.pieceId)
    .reduce((map, item) => {
      const key = `${item.setId}::${item.pieceId}`;
      map[key] = (map[key] || 0) + 1;
      return map;
    }, {});

  const duplicateCount = Object.values(duplicates).reduce((sum, count) => sum + Math.max(0, count - 1), 0);

  return {
    inventory: sorted,
    counts: {
      total: sorted.length,
      collection: sorted.filter((item) => item.type === 'collection').length,
      instant: sorted.filter((item) => item.type === 'instant').length,
      points: sorted.filter((item) => item.type === 'points').length,
      duplicates: duplicateCount,
    },
    lastRevealAt: sorted.length ? sorted[0].collectedAt : null,
  };
}

function serializeProfile(profileDoc) {
  const base = profileDoc || {};
  const { inventory: inventoryRaw = [] } = base;
  const inventoryInfo = summarizeInventory(inventoryRaw);
  const sets = buildSetProgress(inventoryRaw);
  const completedSets = sets.filter((set) => set.isComplete).length;

  return {
    userId: base.userId,
    points: toNumber(base.points, DEFAULT_PROFILE_TEMPLATE.points),
    nextTier: toNumber(base.nextTier, DEFAULT_PROFILE_TEMPLATE.nextTier),
    streakDays: toNumber(base.streakDays, DEFAULT_PROFILE_TEMPLATE.streakDays),
    streakBonus: base.streakBonus || DEFAULT_PROFILE_TEMPLATE.streakBonus,
    instantWins: toNumber(base.instantWins, DEFAULT_PROFILE_TEMPLATE.instantWins),
    lastInstantReward: base.lastInstantReward || DEFAULT_PROFILE_TEMPLATE.lastInstantReward,
    inventory: inventoryInfo.inventory,
    sets,
    stats: {
      totalReveals: inventoryInfo.counts.total,
      collectionPieces: inventoryInfo.counts.collection,
      instantRewards: inventoryInfo.counts.instant,
      xpAwards: inventoryInfo.counts.points,
      duplicatePieces: inventoryInfo.counts.duplicates,
      completedSets,
    },
    telemetry: {
      lastRevealAt: inventoryInfo.lastRevealAt,
      updatedAt: base.updatedAt || base.createdAt || null,
      createdAt: base.createdAt || null,
    },
  };
}

async function ensureProfile(userId) {
  if (!userId) {
    throw new Error('User ID is required.');
  }
  const collection = await getCollection('dannyswok_reward_profiles');
  let doc = await collection.findOne({ _id: userId });
  if (!doc) {
    const now = new Date().toISOString();
    const template = clone(DEFAULT_PROFILE_TEMPLATE);
    doc = {
      _id: userId,
      userId,
      points: template.points,
      nextTier: template.nextTier,
      streakDays: template.streakDays,
      streakBonus: template.streakBonus,
      instantWins: template.instantWins,
      lastInstantReward: template.lastInstantReward,
      inventory: template.inventory || [],
      createdAt: now,
      updatedAt: now,
    };
    await collection.insertOne(doc);
  }
  return { collection, doc };
}

async function getRewardSettings() {
  const { doc } = await loadSettings();
  const budgetPercent = toNumber(doc.budgetPercent, DEFAULT_REWARD_SETTINGS.budgetPercent);
  const revenueBaseline = toNumber(doc.revenueBaseline, DEFAULT_REWARD_SETTINGS.revenueBaseline);
  const odds = normalizeOdds(doc.odds);
  const budgetPool = calculateBudgetPool({ budgetPercent, revenueBaseline });
  return {
    budgetPercent,
    revenueBaseline,
    odds,
    budgetPool,
    updatedAt: doc.updatedAt || null,
    updatedBy: doc.updatedBy || null,
  };
}

async function updateRewardSettings(patch = {}) {
  const { collection, doc } = await loadSettings();
  const next = { ...doc };
  if (patch.budgetPercent !== undefined) {
    next.budgetPercent = clampPercent(toNumber(patch.budgetPercent, doc.budgetPercent));
  }
  if (patch.revenueBaseline !== undefined) {
    next.revenueBaseline = Math.max(0, toNumber(patch.revenueBaseline, doc.revenueBaseline));
  }
  if (patch.odds) {
    next.odds = normalizeOdds({ ...doc.odds, ...patch.odds });
  }
  if (patch.updatedBy) {
    next.updatedBy = patch.updatedBy;
  }
  next.updatedAt = new Date().toISOString();
  await collection.updateOne({ _id: 'settings' }, { $set: next });
  return getRewardSettings();
}

async function getRewardAutomation() {
  const { doc } = await loadAutomation();
  return {
    ...DEFAULT_REWARD_AUTOMATION,
    ...doc,
  };
}

async function updateRewardAutomation(patch = {}) {
  const { collection, doc } = await loadAutomation();
  const next = { ...doc };
  Object.entries(DEFAULT_REWARD_AUTOMATION).forEach(([key, value]) => {
    if (typeof value === 'boolean' && patch[key] !== undefined) {
      next[key] = Boolean(patch[key]);
    }
  });
  if (patch.updatedBy) {
    next.updatedBy = patch.updatedBy;
  }
  next.updatedAt = new Date().toISOString();
  await collection.updateOne({ _id: 'automation' }, { $set: next });
  return getRewardAutomation();
}

async function getRewardProfile(userId) {
  const { doc } = await ensureProfile(userId);
  return serializeProfile(doc);
}

async function listRewardProfiles() {
  const collection = await getCollection('dannyswok_reward_profiles');
  const docs = await collection.find({}).toArray();
  return docs.map((doc) => serializeProfile(doc));
}

async function recordFortuneResult(userId, payload = {}) {
  const { collection, doc } = await ensureProfile(userId);
  const now = new Date();
  const nowIso = now.toISOString();
  const entry = {
    id: payload.id || crypto.randomUUID(),
    label: payload.label || payload.pieceLabel || 'Fortune cookie reveal',
    type: payload.type || 'collection',
    rarity: payload.rarity || (payload.type === 'instant' ? 'instant' : 'common'),
    icon: payload.icon || '🥠',
    setId: payload.setId || null,
    pieceId: payload.pieceId || null,
    rewardOutcome: payload.rewardOutcome || null,
    fortune: payload.fortune || null,
    callToAction: payload.callToAction || null,
    progressNote: payload.progressNote || null,
    collectedAt: payload.collectedAt || nowIso,
    expiresAt: payload.expiresAt || null,
  };

  const inventory = Array.isArray(doc.inventory) ? doc.inventory.slice() : [];
  inventory.unshift(entry);
  const maxInventory = toNumber(payload.keepLatest, 0) > 0 ? toNumber(payload.keepLatest) : 60;
  if (inventory.length > maxInventory) {
    inventory.length = maxInventory;
  }

  const next = {
    ...doc,
    inventory,
    updatedAt: nowIso,
  };

  if (payload.pointsAwarded !== undefined) {
    next.points = toNumber(doc.points, DEFAULT_PROFILE_TEMPLATE.points) + toNumber(payload.pointsAwarded, 0);
  }

  if (payload.nextTier !== undefined) {
    next.nextTier = Math.max(0, toNumber(payload.nextTier));
  }

  if (payload.instantWin === true || payload.type === 'instant') {
    next.instantWins = toNumber(doc.instantWins, DEFAULT_PROFILE_TEMPLATE.instantWins) + 1;
    if (payload.instantRewardLabel) {
      next.lastInstantReward = payload.instantRewardLabel;
    } else if (entry.rewardOutcome) {
      next.lastInstantReward = entry.rewardOutcome;
    }
  }

  if (payload.streakReset) {
    next.streakDays = 0;
  } else if (payload.streakIncrement) {
    next.streakDays = toNumber(doc.streakDays, DEFAULT_PROFILE_TEMPLATE.streakDays) + toNumber(payload.streakIncrement, 0);
  } else if (payload.streakDays !== undefined) {
    next.streakDays = Math.max(0, toNumber(payload.streakDays));
  }

  if (payload.streakBonus) {
    next.streakBonus = payload.streakBonus;
  }

  await collection.updateOne({ _id: userId }, { $set: next });
  return serializeProfile(next);
}

async function updateRewardStreak(userId, options = {}) {
  const { collection, doc } = await ensureProfile(userId);
  const next = { ...doc };
  if (options.reset) {
    next.streakDays = 0;
  } else if (options.increment) {
    next.streakDays = toNumber(doc.streakDays, DEFAULT_PROFILE_TEMPLATE.streakDays) + toNumber(options.increment, 0);
  } else if (options.value !== undefined) {
    next.streakDays = Math.max(0, toNumber(options.value));
  }
  if (options.streakBonus !== undefined) {
    next.streakBonus = options.streakBonus;
  }
  next.updatedAt = new Date().toISOString();
  await collection.updateOne({ _id: userId }, { $set: next });
  return serializeProfile(next);
}

async function getRecentWinners() {
  const { doc } = await loadWinners();
  return Array.isArray(doc.entries) ? doc.entries.slice() : [];
}

async function addWinner(entry = {}) {
  const { collection, doc } = await loadWinners();
  const nowIso = new Date().toISOString();
  const formatted = {
    id: entry.id || crypto.randomUUID(),
    userId: entry.userId || null,
    prize: entry.prize || 'Mystery reward',
    variant: entry.variant || 'instant',
    announcedAt: entry.announcedAt || nowIso,
    location: entry.location || null,
    shareCard: entry.shareCard || null,
  };
  const entries = Array.isArray(doc.entries) ? doc.entries.slice() : [];
  entries.unshift(formatted);
  while (entries.length > 25) {
    entries.pop();
  }
  await collection.updateOne({ _id: 'winners' }, { $set: { entries } });
  return entries;
}

async function listRewardEvents() {
  const { doc } = await loadEvents();
  return {
    flashEvents: doc.flashEvents || [],
    expiringPieces: doc.expiringPieces || [],
    streakBoosts: doc.streakBoosts || [],
    marketingMoments: doc.marketingMoments || [],
  };
}

async function updateRewardEvents(patch = {}) {
  const { collection, doc } = await loadEvents();
  const next = { ...doc };
  ['flashEvents', 'expiringPieces', 'streakBoosts', 'marketingMoments'].forEach((key) => {
    if (patch[key]) {
      next[key] = Array.isArray(patch[key]) ? clone(patch[key]) : doc[key];
    }
  });
  await collection.updateOne({ _id: 'events' }, { $set: next });
  return listRewardEvents();
}

function summarizeSets(sets) {
  const totals = sets.reduce(
    (acc, set) => {
      acc.totalPieces += set.totalPieces;
      acc.collectedPieces += set.collectedCount;
      if (set.isComplete) {
        acc.completedSets += 1;
      }
      if (set.isActive) {
        acc.activeSets += 1;
      }
      return acc;
    },
    { totalPieces: 0, collectedPieces: 0, completedSets: 0, activeSets: 0 },
  );
  return totals;
}

async function getRewardSummary() {
  const profiles = await listRewardProfiles();
  const totals = profiles.reduce(
    (acc, profile) => {
      acc.players += 1;
      acc.totalPoints += toNumber(profile.points, 0);
      acc.activeStreaks += profile.streakDays > 0 ? 1 : 0;
      acc.instantWins += toNumber(profile.instantWins, 0);
      const setSummary = summarizeSets(profile.sets || []);
      acc.completedSets += setSummary.completedSets;
      acc.activeCollections += setSummary.activeSets;
      acc.collectionPieces += setSummary.collectedPieces;
      return acc;
    },
    {
      players: 0,
      totalPoints: 0,
      activeStreaks: 0,
      instantWins: 0,
      completedSets: 0,
      activeCollections: 0,
      collectionPieces: 0,
    },
  );

  const settings = await getRewardSettings();
  const winners = await getRecentWinners();

  return {
    players: totals.players,
    activeStreaks: totals.activeStreaks,
    instantWins: totals.instantWins,
    completedSets: totals.completedSets,
    activeCollections: totals.activeCollections,
    collectionPieces: totals.collectionPieces,
    totalPoints: totals.totalPoints,
    prizeBudget: {
      percent: settings.budgetPercent,
      baseline: settings.revenueBaseline,
      pool: settings.budgetPool,
    },
    latestWinners: winners.slice(0, 5),
    updatedAt: new Date().toISOString(),
  };
}

module.exports = {
  getRewardSettings,
  updateRewardSettings,
  getRewardAutomation,
  updateRewardAutomation,
  getRewardProfile,
  recordFortuneResult,
  updateRewardStreak,
  getRecentWinners,
  addWinner,
  listRewardEvents,
  updateRewardEvents,
  getRewardSummary,
};
