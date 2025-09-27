const express = require('express');
const crypto = require('crypto');
const Stripe = require('stripe');
const { getCollection, ObjectId } = require('../services/mongo');
const { authenticate } = require('./users');

const stripeSecret = process.env.STRIPE_SECRET_KEY || '';
const stripe = stripeSecret ? new Stripe(stripeSecret) : null;

const DEFAULT_LEADER_PRIVILEGES = [
  'manage_team',
  'assign_roles',
  'invite_members',
  'manage_payroll',
  'post_gigs',
  'manage_gigs',
  'release_funds',
];

function nowIso(){
  return new Date().toISOString();
}

function toId(value){
  if (!value) return value;
  if (typeof value === 'string'){
    try {
      return new ObjectId(value);
    } catch (err){
      return value;
    }
  }
  return value;
}

function userIdString(user){
  if (!user) return null;
  return user._id?.toString?.() || user._id || null;
}

function sanitizeTeam(team){
  if (!team) return null;
  const payroll = team.payroll || {};
  return {
    id: team._id?.toString?.() || team._id,
    name: team.name,
    description: team.description || '',
    leaderId: team.leaderId,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
    payroll: {
      payThroughPlatform: !!payroll.payThroughPlatform,
      defaultProvider: payroll.defaultProvider || 'stripe',
      allowManual: payroll.allowManual !== false,
      platformCutPercent: typeof payroll.platformCutPercent === 'number'
        ? payroll.platformCutPercent
        : 10,
    },
  };
}

function sanitizeMember(member){
  if (!member) return null;
  return {
    id: member._id?.toString?.() || member._id,
    teamId: member.teamId,
    userId: member.userId,
    role: member.role || 'member',
    responsibilities: Array.isArray(member.responsibilities) ? member.responsibilities : [],
    privileges: Array.isArray(member.privileges) ? member.privileges : [],
    status: member.status || 'pending',
    joinedAt: member.joinedAt || null,
    updatedAt: member.updatedAt || null,
    invitedBy: member.invitedBy || null,
    isLeader: !!member.isLeader,
    payrollPreference: member.payrollPreference || null,
  };
}

function sanitizeInvite(invite){
  if (!invite) return null;
  return {
    id: invite._id?.toString?.() || invite._id,
    teamId: invite.teamId,
    email: invite.email,
    role: invite.role,
    responsibilities: Array.isArray(invite.responsibilities) ? invite.responsibilities : [],
    privileges: Array.isArray(invite.privileges) ? invite.privileges : [],
    status: invite.status,
    token: invite.token,
    invitedBy: invite.invitedBy,
    createdAt: invite.createdAt,
    respondedAt: invite.respondedAt || null,
  };
}

function sanitizeShift(shift){
  if (!shift) return null;
  return {
    id: shift._id?.toString?.() || shift._id,
    teamId: shift.teamId,
    memberId: shift.memberId,
    userId: shift.userId,
    clockInAt: shift.clockInAt,
    clockOutAt: shift.clockOutAt || null,
    durationMinutes: typeof shift.durationMinutes === 'number' ? shift.durationMinutes : null,
    notes: shift.notes || '',
    status: shift.status || 'open',
  };
}

function sanitizeGig(gig){
  if (!gig) return null;
  return {
    id: gig._id?.toString?.() || gig._id,
    teamId: gig.teamId,
    leaderId: gig.leaderId,
    title: gig.title,
    description: gig.description || '',
    rate: gig.rate,
    currency: gig.currency || 'usd',
    rateType: gig.rateType || 'per_service',
    hiringStatus: gig.hiringStatus || 'open',
    escrowStatus: gig.escrowStatus || 'pending',
    platformCutPercent: gig.platformCutPercent,
    escrowAmountCents: gig.escrowAmountCents || 0,
    paymentIntentId: gig.paymentIntentId || null,
    assignedMemberId: gig.assignedMemberId || null,
    applicants: Array.isArray(gig.applicants) ? gig.applicants : [],
    completion: gig.completion || null,
    createdAt: gig.createdAt,
    updatedAt: gig.updatedAt,
  };
}

async function loadTeam(teamId){
  const teams = await getCollection('teams');
  return teams.findOne({ _id: teamId });
}

async function loadMembership(teamId, userId){
  if (!teamId || !userId) return null;
  const teamMembers = await getCollection('team_members');
  return teamMembers.findOne({ teamId, userId, status: 'active' });
}

function memberHasPrivilege(member, privilege){
  if (!member) return false;
  if (member.isLeader) return true;
  if (Array.isArray(member.privileges) && member.privileges.includes(privilege)) return true;
  return false;
}

function requireLeader(member){
  if (!member) return false;
  if (member.isLeader) return true;
  if (Array.isArray(member.privileges) && member.privileges.includes('manage_team')) return true;
  return false;
}

async function fetchProfilesForMembers(members){
  const userIds = Array.from(new Set((members || []).map((m) => m.userId).filter(Boolean)));
  if (!userIds.length) return new Map();
  const usersCollection = await getCollection('users');
  const map = new Map();
  for (const id of userIds){
    const user = await usersCollection.findOne({ _id: toId(id) });
    if (user){
      map.set(id, {
        id: user._id?.toString?.() || user._id,
        email: user.email,
        name: user.name || '',
        avatar: user.avatar || null,
      });
    }
  }
  return map;
}

module.exports = function createTeamRouter(){
  const router = express.Router();

  router.post('/', authenticate, async (req, res) => {
    try {
      const { name: rawName, description = '', payroll = {} } = req.body || {};
      const name = String(rawName || '').trim();
      if (!name){
        return res.status(400).json({ error: 'team_name_required' });
      }

      const teams = await getCollection('teams');
      const teamMembers = await getCollection('team_members');
      const leaderId = userIdString(req.user);
      const createdAt = nowIso();
      const teamId = crypto.randomUUID();

      const teamDoc = {
        _id: teamId,
        name,
        description: String(description || '').trim(),
        leaderId,
        createdAt,
        updatedAt: createdAt,
        payroll: {
          payThroughPlatform: !!payroll.payThroughPlatform,
          defaultProvider: payroll.defaultProvider || 'stripe',
          allowManual: payroll.allowManual !== false,
          platformCutPercent: typeof payroll.platformCutPercent === 'number'
            ? payroll.platformCutPercent
            : 10,
        },
      };

      await teams.insertOne(teamDoc);

      const leaderMember = {
        _id: crypto.randomUUID(),
        teamId: teamId,
        userId: leaderId,
        role: 'leader',
        responsibilities: ['Team oversight', 'Recruiting'],
        privileges: DEFAULT_LEADER_PRIVILEGES,
        status: 'active',
        joinedAt: createdAt,
        updatedAt: createdAt,
        invitedBy: leaderId,
        isLeader: true,
        payrollPreference: {
          provider: teamDoc.payroll.defaultProvider,
          payThroughPlatform: !!teamDoc.payroll.payThroughPlatform,
          payPerService: false,
        },
      };

      await teamMembers.insertOne(leaderMember);

      res.json({ ok: true, team: sanitizeTeam(teamDoc), membership: sanitizeMember(leaderMember) });
    } catch (err){
      console.error('Team create error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.get('/', authenticate, async (req, res) => {
    try {
      const teamMembers = await getCollection('team_members');
      const userId = userIdString(req.user);
      const memberships = await teamMembers.find({ userId }).toArray();
      const teams = await getCollection('teams');
      const results = [];
      for (const membership of memberships){
        const team = await teams.findOne({ _id: membership.teamId });
        if (team){
          results.push({
            team: sanitizeTeam(team),
            membership: sanitizeMember(membership),
          });
        }
      }
      res.json({ ok: true, teams: results });
    } catch (err){
      console.error('Team list error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.get('/:teamId', authenticate, async (req, res) => {
    try {
      const { teamId } = req.params;
      const team = await loadTeam(teamId);
      if (!team){
        return res.status(404).json({ error: 'team_not_found' });
      }

      const membership = await loadMembership(teamId, userIdString(req.user));
      if (!membership){
        return res.status(403).json({ error: 'not_a_member' });
      }

      const teamMembers = await getCollection('team_members');
      const invitesCollection = await getCollection('team_invites');
      const gigsCollection = await getCollection('team_gigs');
      const shiftsCollection = await getCollection('team_shifts');

      const members = await teamMembers.find({ teamId }).toArray();
      const invites = await invitesCollection.find({ teamId }).toArray();
      const gigs = await gigsCollection.find({ teamId }).toArray();
      const recentShifts = await shiftsCollection.find({ teamId }).toArray();

      const profileMap = await fetchProfilesForMembers(members);
      const enrichedMembers = members.map((m) => ({
        ...sanitizeMember(m),
        profile: profileMap.get(m.userId) || null,
      }));

      res.json({
        ok: true,
        team: sanitizeTeam(team),
        membership: sanitizeMember(membership),
        members: enrichedMembers,
        invites: invites.map(sanitizeInvite),
        gigs: gigs.map(sanitizeGig),
        shifts: recentShifts.map(sanitizeShift),
      });
    } catch (err){
      console.error('Team detail error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/:teamId/invite', authenticate, async (req, res) => {
    try {
      const { teamId } = req.params;
      const team = await loadTeam(teamId);
      if (!team){
        return res.status(404).json({ error: 'team_not_found' });
      }
      const inviter = await loadMembership(teamId, userIdString(req.user));
      if (!requireLeader(inviter)){
        return res.status(403).json({ error: 'forbidden' });
      }

      const { email: rawEmail, role = 'member', responsibilities = [], privileges = [] } = req.body || {};
      const email = String(rawEmail || '').trim().toLowerCase();
      if (!email){
        return res.status(400).json({ error: 'invite_email_required' });
      }

      const invitesCollection = await getCollection('team_invites');
      const existing = await invitesCollection.findOne({ teamId, email, status: 'pending' });
      if (existing){
        return res.status(409).json({ error: 'invite_exists', invite: sanitizeInvite(existing) });
      }

      const invite = {
        _id: crypto.randomUUID(),
        teamId,
        email,
        role: String(role || 'member'),
        responsibilities: Array.isArray(responsibilities) ? responsibilities : [],
        privileges: Array.isArray(privileges) ? privileges : [],
        status: 'pending',
        token: crypto.randomUUID(),
        invitedBy: inviter.userId,
        createdAt: nowIso(),
      };

      await invitesCollection.insertOne(invite);

      res.json({ ok: true, invite: sanitizeInvite(invite) });
    } catch (err){
      console.error('Team invite error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/invites/:token/accept', authenticate, async (req, res) => {
    try {
      const { token } = req.params;
      const invitesCollection = await getCollection('team_invites');
      const invite = await invitesCollection.findOne({ token });
      if (!invite || invite.status !== 'pending'){
        return res.status(404).json({ error: 'invite_not_found' });
      }

      const teams = await getCollection('teams');
      const team = await teams.findOne({ _id: invite.teamId });
      if (!team){
        return res.status(404).json({ error: 'team_not_found' });
      }

      const userEmail = String(req.user?.email || '').toLowerCase();
      if (userEmail !== invite.email){
        return res.status(403).json({ error: 'invite_email_mismatch' });
      }

      const memberCollection = await getCollection('team_members');
      const userId = userIdString(req.user);
      const existingMember = await memberCollection.findOne({ teamId: invite.teamId, userId });
      if (existingMember && existingMember.status === 'active'){
        return res.status(409).json({ error: 'already_member' });
      }

      const now = nowIso();
      if (existingMember){
        const updatedMember = {
          ...existingMember,
          role: invite.role || existingMember.role || 'member',
          responsibilities: Array.isArray(invite.responsibilities) ? invite.responsibilities : [],
          privileges: Array.isArray(invite.privileges) ? invite.privileges : [],
          status: 'active',
          joinedAt: existingMember.joinedAt || now,
          updatedAt: now,
          invitedBy: invite.invitedBy || team.leaderId,
          isLeader: !!existingMember.isLeader && existingMember.isLeader,
          payrollPreference: existingMember.payrollPreference || {
            provider: team.payroll?.defaultProvider || 'stripe',
            payThroughPlatform: !!team.payroll?.payThroughPlatform,
            payPerService: false,
          },
        };

        await memberCollection.updateOne({ _id: existingMember._id }, { $set: updatedMember });
        await invitesCollection.updateOne({ _id: invite._id }, {
          $set: {
            status: 'accepted',
            respondedAt: now,
          },
        });
        return res.json({ ok: true, membership: sanitizeMember(updatedMember) });
      }

      const newMember = {
        _id: crypto.randomUUID(),
        teamId: invite.teamId,
        userId,
        role: invite.role || 'member',
        responsibilities: Array.isArray(invite.responsibilities) ? invite.responsibilities : [],
        privileges: Array.isArray(invite.privileges) ? invite.privileges : [],
        status: 'active',
        joinedAt: now,
        updatedAt: now,
        invitedBy: invite.invitedBy || team.leaderId,
        isLeader: false,
        payrollPreference: {
          provider: team.payroll?.defaultProvider || 'stripe',
          payThroughPlatform: !!team.payroll?.payThroughPlatform,
          payPerService: false,
        },
      };

      await memberCollection.insertOne(newMember);
      await invitesCollection.updateOne({ _id: invite._id }, {
        $set: {
          status: 'accepted',
          respondedAt: now,
        },
      });

      res.json({ ok: true, membership: sanitizeMember(newMember) });
    } catch (err){
      console.error('Invite accept error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/:teamId/members/:memberId/roles', authenticate, async (req, res) => {
    try {
      const { teamId, memberId } = req.params;
      const team = await loadTeam(teamId);
      if (!team){
        return res.status(404).json({ error: 'team_not_found' });
      }
      const actor = await loadMembership(teamId, userIdString(req.user));
      if (!memberHasPrivilege(actor, 'assign_roles')){
        return res.status(403).json({ error: 'forbidden' });
      }

      const memberCollection = await getCollection('team_members');
      const member = await memberCollection.findOne({ _id: memberId, teamId });
      if (!member){
        return res.status(404).json({ error: 'member_not_found' });
      }

      const { role = member.role, responsibilities = member.responsibilities, privileges = member.privileges } = req.body || {};
      const updatedMember = {
        ...member,
        role: String(role || member.role || 'member'),
        responsibilities: Array.isArray(responsibilities) ? responsibilities : [],
        privileges: Array.isArray(privileges) ? privileges : [],
        updatedAt: nowIso(),
      };

      await memberCollection.updateOne({ _id: member._id }, { $set: updatedMember });

      res.json({ ok: true, member: sanitizeMember(updatedMember) });
    } catch (err){
      console.error('Member role update error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/:teamId/members/:memberId/payroll', authenticate, async (req, res) => {
    try {
      const { teamId, memberId } = req.params;
      const team = await loadTeam(teamId);
      if (!team){
        return res.status(404).json({ error: 'team_not_found' });
      }
      const actor = await loadMembership(teamId, userIdString(req.user));
      if (!memberHasPrivilege(actor, 'manage_payroll')){
        return res.status(403).json({ error: 'forbidden' });
      }

      const memberCollection = await getCollection('team_members');
      const member = await memberCollection.findOne({ _id: memberId, teamId });
      if (!member){
        return res.status(404).json({ error: 'member_not_found' });
      }

      const { provider, payThroughPlatform, payPerService, hourlyRate, currency = 'usd', notes = '' } = req.body || {};
      const payrollPreference = {
        provider: provider || member.payrollPreference?.provider || team.payroll?.defaultProvider || 'stripe',
        payThroughPlatform: typeof payThroughPlatform === 'boolean' ? payThroughPlatform : !!(member.payrollPreference?.payThroughPlatform),
        payPerService: typeof payPerService === 'boolean' ? payPerService : !!(member.payrollPreference?.payPerService),
        hourlyRate: typeof hourlyRate === 'number' ? hourlyRate : member.payrollPreference?.hourlyRate || null,
        currency: currency,
        notes: notes,
      };

      const updatedMember = {
        ...member,
        payrollPreference,
        updatedAt: nowIso(),
      };

      await memberCollection.updateOne({ _id: member._id }, { $set: updatedMember });

      res.json({ ok: true, member: sanitizeMember(updatedMember) });
    } catch (err){
      console.error('Member payroll update error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/:teamId/clock-in', authenticate, async (req, res) => {
    try {
      const { teamId } = req.params;
      const member = await loadMembership(teamId, userIdString(req.user));
      if (!member){
        return res.status(403).json({ error: 'not_a_member' });
      }

      const shiftsCollection = await getCollection('team_shifts');
      const existing = await shiftsCollection.findOne({ teamId, userId: member.userId, status: 'open' });
      if (existing){
        return res.status(409).json({ error: 'shift_already_open', shift: sanitizeShift(existing) });
      }

      const shift = {
        _id: crypto.randomUUID(),
        teamId,
        memberId: member._id?.toString?.() || member._id,
        userId: member.userId,
        clockInAt: nowIso(),
        clockOutAt: null,
        durationMinutes: null,
        notes: String(req.body?.notes || ''),
        status: 'open',
      };

      await shiftsCollection.insertOne(shift);

      res.json({ ok: true, shift: sanitizeShift(shift) });
    } catch (err){
      console.error('Clock in error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/:teamId/clock-out', authenticate, async (req, res) => {
    try {
      const { teamId } = req.params;
      const member = await loadMembership(teamId, userIdString(req.user));
      if (!member){
        return res.status(403).json({ error: 'not_a_member' });
      }

      const shiftsCollection = await getCollection('team_shifts');
      const shift = await shiftsCollection.findOne({ teamId, userId: member.userId, status: 'open' });
      if (!shift){
        return res.status(404).json({ error: 'open_shift_not_found' });
      }

      const clockOutAt = nowIso();
      const start = new Date(shift.clockInAt).getTime();
      const end = Date.now();
      const durationMinutes = Math.max(1, Math.round((end - start) / 60000));
      const updatedShift = {
        ...shift,
        clockOutAt,
        durationMinutes,
        status: 'completed',
        notes: req.body?.notes ? String(req.body.notes) : shift.notes,
      };

      await shiftsCollection.updateOne({ _id: shift._id }, { $set: updatedShift });

      res.json({ ok: true, shift: sanitizeShift(updatedShift) });
    } catch (err){
      console.error('Clock out error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.get('/:teamId/shifts', authenticate, async (req, res) => {
    try {
      const { teamId } = req.params;
      const membership = await loadMembership(teamId, userIdString(req.user));
      if (!membership){
        return res.status(403).json({ error: 'not_a_member' });
      }

      const shiftsCollection = await getCollection('team_shifts');
      const filter = { teamId };
      if (req.query?.memberId){
        filter.memberId = req.query.memberId;
      }
      const shifts = await shiftsCollection.find(filter).toArray();
      res.json({ ok: true, shifts: shifts.map(sanitizeShift) });
    } catch (err){
      console.error('Shift list error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/:teamId/gigs', authenticate, async (req, res) => {
    try {
      const { teamId } = req.params;
      const team = await loadTeam(teamId);
      if (!team){
        return res.status(404).json({ error: 'team_not_found' });
      }
      const member = await loadMembership(teamId, userIdString(req.user));
      if (!memberHasPrivilege(member, 'post_gigs')){
        return res.status(403).json({ error: 'forbidden' });
      }

      const {
        title,
        description = '',
        rate,
        currency = 'usd',
        rateType = 'per_service',
        escrowAmount,
        platformCutPercent,
      } = req.body || {};

      const trimmedTitle = String(title || '').trim();
      if (!trimmedTitle){
        return res.status(400).json({ error: 'gig_title_required' });
      }
      const numericRate = Number(rate);
      if (!Number.isFinite(numericRate) || numericRate <= 0){
        return res.status(400).json({ error: 'gig_rate_required' });
      }

      const gigsCollection = await getCollection('team_gigs');
      const gigId = crypto.randomUUID();
      const createdAt = nowIso();

      const gigDoc = {
        _id: gigId,
        teamId,
        leaderId: team.leaderId,
        title: trimmedTitle,
        description: String(description || ''),
        rate: numericRate,
        currency: String(currency || 'usd').toLowerCase(),
        rateType: String(rateType || 'per_service'),
        hiringStatus: 'open',
        escrowStatus: 'pending',
        platformCutPercent: typeof platformCutPercent === 'number' ? platformCutPercent : (team.payroll?.platformCutPercent ?? 10),
        applicants: [],
        createdAt,
        updatedAt: createdAt,
      };

      let clientSecret = null;
      const escrowAmountNumber = Number(escrowAmount);
      if (stripe && Number.isFinite(escrowAmountNumber) && escrowAmountNumber > 0){
        try {
          const amountCents = Math.round(escrowAmountNumber * 100);
          const intent = await stripe.paymentIntents.create({
            amount: amountCents,
            currency: gigDoc.currency,
            capture_method: 'manual',
            metadata: {
              teamId,
              gigId,
              purpose: 'freelance_escrow',
            },
          });
          gigDoc.paymentIntentId = intent.id;
          gigDoc.escrowAmountCents = amountCents;
          gigDoc.escrowStatus = 'awaiting_funding';
          clientSecret = intent.client_secret || null;
        } catch (stripeErr){
          console.error('Stripe escrow create error', stripeErr);
          return res.status(502).json({ error: 'stripe_unavailable' });
        }
      } else if (Number.isFinite(escrowAmountNumber) && escrowAmountNumber > 0){
        gigDoc.escrowAmountCents = Math.round(escrowAmountNumber * 100);
        gigDoc.escrowStatus = 'awaiting_funding';
      }

      await gigsCollection.insertOne(gigDoc);

      res.json({ ok: true, gig: sanitizeGig(gigDoc), paymentIntentClientSecret: clientSecret });
    } catch (err){
      console.error('Gig create error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.get('/:teamId/gigs', authenticate, async (req, res) => {
    try {
      const { teamId } = req.params;
      const membership = await loadMembership(teamId, userIdString(req.user));
      if (!membership){
        return res.status(403).json({ error: 'not_a_member' });
      }
      const gigsCollection = await getCollection('team_gigs');
      const gigs = await gigsCollection.find({ teamId }).toArray();
      res.json({ ok: true, gigs: gigs.map(sanitizeGig) });
    } catch (err){
      console.error('Gig list error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/:teamId/gigs/:gigId/apply', authenticate, async (req, res) => {
    try {
      const { teamId, gigId } = req.params;
      const membership = await loadMembership(teamId, userIdString(req.user));
      if (!membership){
        return res.status(403).json({ error: 'not_a_member' });
      }
      const gigsCollection = await getCollection('team_gigs');
      const gig = await gigsCollection.findOne({ _id: gigId, teamId });
      if (!gig){
        return res.status(404).json({ error: 'gig_not_found' });
      }

      const applicants = Array.isArray(gig.applicants) ? [...gig.applicants] : [];
      const alreadyApplied = applicants.some((app) => app.memberId === membership._id || app.userId === membership.userId);
      if (alreadyApplied){
        return res.status(409).json({ error: 'already_applied' });
      }

      const applicant = {
        memberId: membership._id?.toString?.() || membership._id,
        userId: membership.userId,
        appliedAt: nowIso(),
        note: String(req.body?.note || ''),
      };
      applicants.push(applicant);

      const updated = {
        ...gig,
        applicants,
        updatedAt: nowIso(),
      };

      await gigsCollection.updateOne({ _id: gig._id }, { $set: updated });

      res.json({ ok: true, gig: sanitizeGig(updated) });
    } catch (err){
      console.error('Gig apply error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/:teamId/gigs/:gigId/assign', authenticate, async (req, res) => {
    try {
      const { teamId, gigId } = req.params;
      const member = await loadMembership(teamId, userIdString(req.user));
      if (!memberHasPrivilege(member, 'manage_gigs')){
        return res.status(403).json({ error: 'forbidden' });
      }
      const gigsCollection = await getCollection('team_gigs');
      const gig = await gigsCollection.findOne({ _id: gigId, teamId });
      if (!gig){
        return res.status(404).json({ error: 'gig_not_found' });
      }

      const { memberId, startAt = null } = req.body || {};
      if (!memberId){
        return res.status(400).json({ error: 'member_required' });
      }

      const membersCollection = await getCollection('team_members');
      const assignee = await membersCollection.findOne({ _id: memberId, teamId });
      if (!assignee || assignee.status !== 'active'){
        return res.status(404).json({ error: 'assignee_not_found' });
      }

      const updatedGig = {
        ...gig,
        assignedMemberId: memberId,
        hiringStatus: 'assigned',
        updatedAt: nowIso(),
        startAt,
      };
      await gigsCollection.updateOne({ _id: gig._id }, { $set: updatedGig });

      res.json({ ok: true, gig: sanitizeGig(updatedGig) });
    } catch (err){
      console.error('Gig assign error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/:teamId/gigs/:gigId/release', authenticate, async (req, res) => {
    try {
      const { teamId, gigId } = req.params;
      const member = await loadMembership(teamId, userIdString(req.user));
      if (!memberHasPrivilege(member, 'release_funds')){
        return res.status(403).json({ error: 'forbidden' });
      }

      const gigsCollection = await getCollection('team_gigs');
      const gig = await gigsCollection.findOne({ _id: gigId, teamId });
      if (!gig){
        return res.status(404).json({ error: 'gig_not_found' });
      }

      const { confirmedByLeader = false, confirmedByFreelancer = false, completionNote = '' } = req.body || {};
      if (!confirmedByLeader || !confirmedByFreelancer){
        return res.status(400).json({ error: 'completion_not_confirmed' });
      }

      const updatedGig = {
        ...gig,
        escrowStatus: 'releasing',
        hiringStatus: 'completed',
        completion: {
          confirmedByLeader: !!confirmedByLeader,
          confirmedByFreelancer: !!confirmedByFreelancer,
          note: String(completionNote || ''),
          confirmedAt: nowIso(),
        },
        updatedAt: nowIso(),
      };

      if (stripe && gig.paymentIntentId){
        try {
          await stripe.paymentIntents.capture(gig.paymentIntentId);
          updatedGig.escrowStatus = 'released';
        } catch (stripeErr){
          console.error('Stripe capture error', stripeErr);
          updatedGig.escrowStatus = 'release_failed';
        }
      } else {
        updatedGig.escrowStatus = 'released';
      }

      await gigsCollection.updateOne({ _id: gig._id }, { $set: updatedGig });

      res.json({ ok: true, gig: sanitizeGig(updatedGig) });
    } catch (err){
      console.error('Gig release error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  return router;
};
