const { getCollection, ObjectId } = require('../services/mongo');
const { decryptString } = require('./crypto');

function parseIntegrationCredentials(raw){
  if (!raw) return {};
  if (typeof raw === 'object' && raw !== null){
    return raw;
  }
  try {
    const decoded = decryptString(String(raw));
    if (!decoded) return {};
    return JSON.parse(decoded);
  } catch (err){
    return {};
  }
}

async function findIntegrationById(id, userId){
  const col = await getCollection('integrations');
  const filter = { _id: new ObjectId(id) };
  if (userId){
    filter.userId = userId;
  }
  const row = await col.findOne(filter);
  return row || null;
}

async function findIntegrationByService(userId, serviceId){
  const col = await getCollection('integrations');
  const row = await col.findOne({ userId, serviceId });
  return row || null;
}

module.exports = {
  parseIntegrationCredentials,
  findIntegrationById,
  findIntegrationByService,
};
