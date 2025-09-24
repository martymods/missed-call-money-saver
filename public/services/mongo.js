const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let MongoClient;
let ObjectId;
try {
  ({ MongoClient, ObjectId } = require('mongodb'));
} catch (err) {
  MongoClient = null;
  ObjectId = class FallbackObjectId {
    constructor(id){ this.id = id || crypto.randomUUID(); }
    toString(){ return this.id; }
  };
}

let clientPromise = null;
let cachedDb = null;
const fallbackDir = path.join(__dirname, '..', 'data', 'mongo-fallback');

async function connect(){
  if (!MongoClient){
    return null;
  }
  if (cachedDb) return cachedDb;
  if (!clientPromise){
    const uri = process.env.MONGODB_URI;
    if (!uri) return null;
    const client = new MongoClient(uri, {
      maxPoolSize: Number(process.env.MONGODB_MAX_POOL || 10),
    });
    clientPromise = client.connect().then(() => {
      cachedDb = client.db(process.env.MONGODB_DB || 'missed-call-money-saver');
      return cachedDb;
    });
  }
  return clientPromise;
}

function ensureFallbackDir(){
  if (!fs.existsSync(fallbackDir)){
    fs.mkdirSync(fallbackDir, { recursive: true });
  }
}

function readFallback(name){
  ensureFallbackDir();
  const file = path.join(fallbackDir, `${name}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (err){
    return [];
  }
}

function writeFallback(name, docs){
  ensureFallbackDir();
  const file = path.join(fallbackDir, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(docs, null, 2));
}

function matchDoc(doc, filter){
  return Object.keys(filter).every(key => {
    if (key === '_id'){
      const val = filter[key];
      const docId = doc._id?.toString?.() || doc._id;
      const filterId = val?.toString?.() || val;
      return docId === filterId;
    }
    return doc[key] === filter[key];
  });
}

function createFileCollection(name){
  return {
    async findOne(filter){
      const docs = readFallback(name);
      return docs.find(doc => matchDoc(doc, filter)) || null;
    },
    async insertOne(doc){
      const docs = readFallback(name);
      const _id = doc._id || crypto.randomUUID();
      const record = { ...doc, _id };
      docs.push(record);
      writeFallback(name, docs);
      return { insertedId: _id };
    },
    async updateOne(filter, update){
      const docs = readFallback(name);
      let modified = false;
      const updatedDocs = docs.map(doc => {
        if (matchDoc(doc, filter)){
          modified = true;
          if (update.$set){
            return { ...doc, ...update.$set };
          }
        }
        return doc;
      });
      if (modified){
        writeFallback(name, updatedDocs);
      }
      return { modifiedCount: modified ? 1 : 0 };
    },
    async deleteOne(filter){
      const docs = readFallback(name);
      const remaining = docs.filter(doc => !matchDoc(doc, filter));
      writeFallback(name, remaining);
      return { deletedCount: docs.length - remaining.length };
    },
    find(filter = {}){
      const docs = readFallback(name).filter(doc => matchDoc(doc, filter));
      return {
        toArray: async () => docs,
        sort(){ return this; },
        limit(){ return this; },
      };
    },
  };
}

async function getCollection(name){
  if (MongoClient){
    const db = await connect();
    if (db) return db.collection(name);
  }
  return createFileCollection(name);
}

module.exports = {
  connect,
  getCollection,
  ObjectId,
};