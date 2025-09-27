const express = require('express');
const crypto = require('crypto');
const { getCollection } = require('../services/mongo');

const WORKSPACE_ID = 'warehouse-hq';
const MAX_TASK_HISTORY = 200;
const MAX_SHIFTS = 120;
const MAX_SHIFT_ACTIVITY = 40;
const MAX_TIME_EVENTS = 400;
const MAX_BROADCASTS = 200;
const MAX_GAMIFICATION = 80;

function nowIso(){
  return new Date().toISOString();
}

function baseWorkspace(){
  const now = nowIso();
  return {
    _id: WORKSPACE_ID,
    createdAt: now,
    updatedAt: now,
    roster: [],
    tasks: [],
    shifts: [],
    timePunches: [],
    broadcasts: [],
    gamification: [],
  };
}

function sanitizeString(value){
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function sanitizeNumber(value, fallback = 0){
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function sanitizeBoolean(value){
  return value === true || value === 'true' || value === '1' || value === 1;
}

function sanitizeMember(input = {}){
  const member = { ...input };
  member.id = sanitizeString(member.id) || crypto.randomUUID();
  member.name = sanitizeString(member.name) || 'Crew Member';
  member.role = sanitizeString(member.role) || 'Specialist';
  member.team = sanitizeString(member.team);
  member.headline = sanitizeString(member.headline);
  member.serviceArea = sanitizeString(member.serviceArea);
  member.status = sanitizeString(member.status);
  member.availability = sanitizeString(member.availability);
  member.privateNote = sanitizeString(member.privateNote);
  member.contact = sanitizeString(member.contact);
  member.isFreelancer = sanitizeBoolean(member.isFreelancer);
  member.tags = Array.isArray(member.tags)
    ? member.tags.map(tag => sanitizeString(tag)).filter(Boolean)
    : [];
  member.aliases = Array.isArray(member.aliases)
    ? member.aliases.map(alias => sanitizeString(alias)).filter(Boolean)
    : [];
  member.photo = sanitizeString(member.photo);
  member.avatarSeed = sanitizeString(member.avatarSeed) || member.name || member.id;
  return member;
}

function sanitizeTask(input = {}){
  const task = { ...input };
  task.id = sanitizeString(task.id) || crypto.randomUUID();
  task.title = sanitizeString(task.title) || 'Untitled mission';
  task.owner = sanitizeString(task.owner);
  task.ownerId = sanitizeString(task.ownerId) || null;
  task.type = sanitizeString(task.type) || 'General';
  task.dueDate = sanitizeString(task.dueDate) || null;
  task.link = sanitizeString(task.link);
  task.status = sanitizeString(task.status) || 'open';
  task.createdAt = sanitizeString(task.createdAt) || nowIso();
  task.activity = Array.isArray(task.activity)
    ? task.activity.map(entry => ({
        id: sanitizeString(entry.id) || crypto.randomUUID(),
        actor: sanitizeString(entry.actor) || 'Warehouse HQ',
        channel: sanitizeString(entry.channel) || 'team',
        message: sanitizeString(entry.message) || 'Update logged.',
        timestamp: sanitizeString(entry.timestamp) || nowIso(),
      })).filter(entry => entry.message)
    : [];
  return task;
}

function sanitizeShiftActivity(entry = {}){
  return {
    id: sanitizeString(entry.id) || crypto.randomUUID(),
    message: sanitizeString(entry.message) || 'Update logged.',
    timestamp: sanitizeString(entry.timestamp) || nowIso(),
    level: (sanitizeString(entry.level) || 'info').toLowerCase(),
    actorSnapshot: entry.actorSnapshot && typeof entry.actorSnapshot === 'object'
      ? {
          id: sanitizeString(entry.actorSnapshot.id) || null,
          name: sanitizeString(entry.actorSnapshot.name) || 'Warehouse HQ',
          role: sanitizeString(entry.actorSnapshot.role) || 'Member',
          team: sanitizeString(entry.actorSnapshot.team),
          headline: sanitizeString(entry.actorSnapshot.headline),
          serviceArea: sanitizeString(entry.actorSnapshot.serviceArea),
          status: sanitizeString(entry.actorSnapshot.status),
          availability: sanitizeString(entry.actorSnapshot.availability),
          tags: Array.isArray(entry.actorSnapshot.tags)
            ? entry.actorSnapshot.tags.map(tag => sanitizeString(tag)).filter(Boolean)
            : [],
          privateNote: sanitizeString(entry.actorSnapshot.privateNote),
          contact: sanitizeString(entry.actorSnapshot.contact),
          isFreelancer: sanitizeBoolean(entry.actorSnapshot.isFreelancer),
          photo: sanitizeString(entry.actorSnapshot.photo),
          avatarSeed: sanitizeString(entry.actorSnapshot.avatarSeed),
        }
      : null,
  };
}

function sanitizeShift(input = {}){
  const shift = { ...input };
  shift.id = sanitizeString(shift.id) || crypto.randomUUID();
  shift.title = sanitizeString(shift.title) || 'Shift';
  shift.zone = sanitizeString(shift.zone);
  shift.date = sanitizeString(shift.date) || null;
  shift.start = sanitizeString(shift.start) || null;
  shift.end = sanitizeString(shift.end) || null;
  shift.coverage = sanitizeNumber(shift.coverage, 1);
  shift.allowMobileSwaps = sanitizeBoolean(shift.allowMobileSwaps);
  shift.gpsMode = sanitizeString(shift.gpsMode) || 'recommended';
  shift.notes = sanitizeString(shift.notes);
  shift.owner = sanitizeString(shift.owner);
  shift.ownerId = sanitizeString(shift.ownerId) || null;
  shift.status = sanitizeString(shift.status) || 'published';
  shift.createdAt = sanitizeString(shift.createdAt) || nowIso();
  shift.mobileActions = Array.isArray(shift.mobileActions)
    ? shift.mobileActions.map(entry => sanitizeShiftActivity(entry))
    : [];
  return shift;
}

function sanitizeGeo(geo){
  if (!geo || typeof geo !== 'object') return null;
  const lat = Number(geo.lat);
  const lng = Number(geo.lng);
  const accuracy = Number(geo.accuracy);
  const hasLat = Number.isFinite(lat);
  const hasLng = Number.isFinite(lng);
  const hasAccuracy = Number.isFinite(accuracy);
  if (!hasLat && !hasLng && !hasAccuracy) return null;
  return {
    lat: hasLat ? lat : null,
    lng: hasLng ? lng : null,
    accuracy: hasAccuracy ? accuracy : null,
  };
}

function sanitizeTimeEvent(input = {}){
  const event = { ...input };
  event.id = sanitizeString(event.id) || crypto.randomUUID();
  event.member = sanitizeString(event.member);
  event.memberId = sanitizeString(event.memberId) || null;
  event.shiftId = sanitizeString(event.shiftId) || null;
  event.type = sanitizeString(event.type) || 'clock-in';
  event.method = sanitizeString(event.method) || 'gps';
  event.timestamp = sanitizeString(event.timestamp) || nowIso();
  event.notes = sanitizeString(event.notes);
  event.geo = sanitizeGeo(event.geo);
  return event;
}

function sanitizeBroadcast(input = {}){
  const broadcast = { ...input };
  broadcast.id = sanitizeString(broadcast.id) || crypto.randomUUID();
  broadcast.message = sanitizeString(broadcast.message) || 'Update';
  broadcast.channel = sanitizeString(broadcast.channel) || 'All Hands';
  broadcast.priority = (sanitizeString(broadcast.priority) || 'normal').toLowerCase();
  broadcast.createdAt = sanitizeString(broadcast.createdAt) || nowIso();
  broadcast.author = sanitizeString(broadcast.author) || 'Warehouse HQ';
  broadcast.authorId = sanitizeString(broadcast.authorId) || null;
  broadcast.authorSnapshot = broadcast.authorSnapshot && typeof broadcast.authorSnapshot === 'object'
    ? {
        id: sanitizeString(broadcast.authorSnapshot.id) || null,
        name: sanitizeString(broadcast.authorSnapshot.name) || broadcast.author,
        role: sanitizeString(broadcast.authorSnapshot.role),
        team: sanitizeString(broadcast.authorSnapshot.team),
        headline: sanitizeString(broadcast.authorSnapshot.headline),
        serviceArea: sanitizeString(broadcast.authorSnapshot.serviceArea),
        status: sanitizeString(broadcast.authorSnapshot.status),
        availability: sanitizeString(broadcast.authorSnapshot.availability),
        tags: Array.isArray(broadcast.authorSnapshot.tags)
          ? broadcast.authorSnapshot.tags.map(tag => sanitizeString(tag)).filter(Boolean)
          : [],
        privateNote: sanitizeString(broadcast.authorSnapshot.privateNote),
        contact: sanitizeString(broadcast.authorSnapshot.contact),
        isFreelancer: sanitizeBoolean(broadcast.authorSnapshot.isFreelancer),
        photo: sanitizeString(broadcast.authorSnapshot.photo),
        avatarSeed: sanitizeString(broadcast.authorSnapshot.avatarSeed),
      }
    : null;
  return broadcast;
}

function sanitizeGamification(input = {}){
  const entry = { ...input };
  entry.id = sanitizeString(entry.id) || crypto.randomUUID();
  entry.message = sanitizeString(entry.message);
  entry.createdAt = sanitizeString(entry.createdAt) || nowIso();
  return entry;
}

async function loadWorkspace(){
  const collection = await getCollection('warehouse_workspace');
  let workspace = await collection.findOne({ _id: WORKSPACE_ID });
  if (!workspace){
    workspace = baseWorkspace();
    await collection.insertOne(workspace);
  }
  workspace.roster = Array.isArray(workspace.roster)
    ? workspace.roster.map(sanitizeMember)
    : [];
  workspace.tasks = Array.isArray(workspace.tasks)
    ? workspace.tasks.map(sanitizeTask)
    : [];
  workspace.shifts = Array.isArray(workspace.shifts)
    ? workspace.shifts.map(sanitizeShift)
    : [];
  workspace.timePunches = Array.isArray(workspace.timePunches)
    ? workspace.timePunches.map(sanitizeTimeEvent)
    : [];
  workspace.broadcasts = Array.isArray(workspace.broadcasts)
    ? workspace.broadcasts.map(sanitizeBroadcast)
    : [];
  workspace.gamification = Array.isArray(workspace.gamification)
    ? workspace.gamification.map(sanitizeGamification)
    : [];
  return workspace;
}

async function persistWorkspace(workspace){
  const collection = await getCollection('warehouse_workspace');
  const now = nowIso();
  const payload = {
    roster: workspace.roster.slice(0, MAX_TASK_HISTORY),
    tasks: workspace.tasks.slice(-MAX_TASK_HISTORY),
    shifts: workspace.shifts.slice(0, MAX_SHIFTS),
    timePunches: workspace.timePunches.slice(0, MAX_TIME_EVENTS),
    broadcasts: workspace.broadcasts.slice(0, MAX_BROADCASTS),
    gamification: workspace.gamification.slice(0, MAX_GAMIFICATION),
    updatedAt: now,
  };
  const createdAt = workspace.createdAt || now;
  await collection.updateOne(
    { _id: WORKSPACE_ID },
    {
      $set: payload,
      $setOnInsert: { createdAt },
    },
    { upsert: true }
  );
  workspace.updatedAt = now;
  workspace.createdAt = createdAt;
  return workspace;
}

function sanitizeWorkspaceResponse(workspace){
  return {
    id: workspace._id,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    roster: workspace.roster.map(sanitizeMember),
    tasks: workspace.tasks.map(sanitizeTask),
    shifts: workspace.shifts.map(sanitizeShift),
    timePunches: workspace.timePunches.map(sanitizeTimeEvent),
    broadcasts: workspace.broadcasts.map(sanitizeBroadcast),
    gamification: workspace.gamification.map(sanitizeGamification),
  };
}

module.exports = function createWarehouseRouter(){
  const router = express.Router();

  router.get('/state', async (_req, res) => {
    try {
      const workspace = await loadWorkspace();
      res.json({ ok: true, workspace: sanitizeWorkspaceResponse(workspace) });
    } catch (err){
      console.error('warehouse state error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/roster', async (req, res) => {
    try {
      const workspace = await loadWorkspace();
      const member = sanitizeMember(req.body || {});
      if (!member.name){
        return res.status(400).json({ error: 'name_required' });
      }
      const existingIndex = workspace.roster.findIndex(entry => entry.id === member.id);
      if (existingIndex >= 0){
        workspace.roster[existingIndex] = member;
      } else {
        workspace.roster.push(member);
      }
      await persistWorkspace(workspace);
      res.json({ ok: true, member: sanitizeMember(member) });
    } catch (err){
      console.error('warehouse roster error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.delete('/roster/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const workspace = await loadWorkspace();
      const before = workspace.roster.length;
      workspace.roster = workspace.roster.filter(member => member.id !== id);
      if (workspace.roster.length === before){
        return res.status(404).json({ error: 'member_not_found' });
      }
      await persistWorkspace(workspace);
      res.json({ ok: true });
    } catch (err){
      console.error('warehouse roster delete error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/tasks', async (req, res) => {
    try {
      const workspace = await loadWorkspace();
      const payload = req.body || {};
      const task = sanitizeTask({
        title: payload.title,
        owner: payload.owner,
        ownerId: payload.ownerId,
        type: payload.type,
        dueDate: payload.dueDate,
        link: payload.link,
        status: 'open',
        activity: [
          {
            message: 'Dispatched mission to floor.',
            channel: 'team',
            actor: 'Warehouse HQ',
            timestamp: nowIso(),
          },
        ],
      });
      workspace.tasks.push(task);
      await persistWorkspace(workspace);
      res.json({ ok: true, task: sanitizeTask(task) });
    } catch (err){
      console.error('warehouse task error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/shifts', async (req, res) => {
    try {
      const workspace = await loadWorkspace();
      const payload = req.body || {};
      const shift = sanitizeShift({
        title: payload.title,
        zone: payload.zone,
        date: payload.date,
        start: payload.start,
        end: payload.end,
        coverage: payload.coverage,
        allowMobileSwaps: payload.allowMobileSwaps,
        gpsMode: payload.gpsMode,
        notes: payload.notes,
        owner: payload.owner,
        ownerId: payload.ownerId,
        status: 'published',
        mobileActions: [
          sanitizeShiftActivity({
            message: 'Shift published to mobile board.',
            level: 'info',
            actorSnapshot: payload.actorSnapshot,
          }),
        ],
      });
      workspace.shifts.unshift(shift);
      const broadcast = sanitizeBroadcast({
        message: `${shift.title} published to mobile board.`,
        channel: shift.zone || 'Labor Alerts',
        priority: 'normal',
        author: payload.actorSnapshot?.name || 'Warehouse HQ',
        authorId: payload.actorSnapshot?.id || null,
        authorSnapshot: payload.actorSnapshot || null,
      });
      workspace.broadcasts.unshift(broadcast);
      await persistWorkspace(workspace);
      res.json({ ok: true, shift: sanitizeShift(shift), broadcast: sanitizeBroadcast(broadcast) });
    } catch (err){
      console.error('warehouse shift error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/shifts/:id/events', async (req, res) => {
    try {
      const { id } = req.params;
      const workspace = await loadWorkspace();
      const shift = workspace.shifts.find(entry => entry.id === id);
      if (!shift){
        return res.status(404).json({ error: 'shift_not_found' });
      }
      const payload = req.body || {};
      const event = sanitizeShiftActivity({
        message: payload.message,
        level: payload.level,
        timestamp: payload.timestamp,
        actorSnapshot: payload.actorSnapshot,
      });
      shift.mobileActions.unshift(event);
      shift.mobileActions = shift.mobileActions.slice(0, MAX_SHIFT_ACTIVITY);
      if (payload.status){
        shift.status = sanitizeString(payload.status) || shift.status;
      }
      if (payload.coverage != null){
        shift.coverage = sanitizeNumber(payload.coverage, shift.coverage);
      }
      let broadcast = null;
      if (payload.broadcast && payload.broadcast.message){
        broadcast = sanitizeBroadcast({
          ...payload.broadcast,
          authorSnapshot: payload.broadcast.authorSnapshot || payload.actorSnapshot || null,
        });
        workspace.broadcasts.unshift(broadcast);
      }
      await persistWorkspace(workspace);
      res.json({
        ok: true,
        shift: sanitizeShift(shift),
        broadcast: broadcast ? sanitizeBroadcast(broadcast) : null,
      });
    } catch (err){
      console.error('warehouse shift event error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/time-events', async (req, res) => {
    try {
      const workspace = await loadWorkspace();
      const payload = req.body || {};
      const event = sanitizeTimeEvent({
        member: payload.member,
        memberId: payload.memberId,
        shiftId: payload.shiftId,
        type: payload.type,
        method: payload.method,
        timestamp: payload.timestamp,
        notes: payload.notes,
        geo: payload.geo,
      });
      workspace.timePunches.unshift(event);
      workspace.timePunches = workspace.timePunches.slice(0, MAX_TIME_EVENTS);
      let shift = null;
      let broadcast = null;
      if (event.shiftId){
        shift = workspace.shifts.find(entry => entry.id === event.shiftId) || null;
        if (shift){
          if (payload.status){
            shift.status = sanitizeString(payload.status) || shift.status;
          }
          if (payload.appendActivity && payload.appendActivity.message){
            const activity = sanitizeShiftActivity({
              message: payload.appendActivity.message,
              level: payload.appendActivity.level,
              actorSnapshot: payload.appendActivity.actorSnapshot,
            });
            shift.mobileActions.unshift(activity);
            shift.mobileActions = shift.mobileActions.slice(0, MAX_SHIFT_ACTIVITY);
            if (payload.appendActivity.broadcast && payload.appendActivity.broadcast.message){
              broadcast = sanitizeBroadcast({
                ...payload.appendActivity.broadcast,
                authorSnapshot: payload.appendActivity.broadcast.authorSnapshot
                  || payload.appendActivity.actorSnapshot
                  || null,
              });
              workspace.broadcasts.unshift(broadcast);
            }
          }
        }
      }
      await persistWorkspace(workspace);
      res.json({
        ok: true,
        timeEvent: sanitizeTimeEvent(event),
        shift: shift ? sanitizeShift(shift) : null,
        broadcast: broadcast ? sanitizeBroadcast(broadcast) : null,
      });
    } catch (err){
      console.error('warehouse time event error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/broadcasts', async (req, res) => {
    try {
      const workspace = await loadWorkspace();
      const payload = req.body || {};
      const broadcast = sanitizeBroadcast(payload);
      if (!broadcast.message){
        return res.status(400).json({ error: 'message_required' });
      }
      workspace.broadcasts.unshift(broadcast);
      await persistWorkspace(workspace);
      res.json({ ok: true, broadcast: sanitizeBroadcast(broadcast) });
    } catch (err){
      console.error('warehouse broadcast error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/gamification', async (req, res) => {
    try {
      const workspace = await loadWorkspace();
      const payload = req.body || {};
      const entry = sanitizeGamification(payload);
      if (!entry.message){
        return res.status(400).json({ error: 'message_required' });
      }
      workspace.gamification.unshift(entry);
      await persistWorkspace(workspace);
      res.json({ ok: true, entry: sanitizeGamification(entry) });
    } catch (err){
      console.error('warehouse gamification error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  return router;
};
