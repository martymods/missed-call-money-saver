const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

const DATA_DIR = path.join(__dirname, '..', 'data', 'giving');
const CACHE_FILE = path.join(DATA_DIR, 'faith-metrics-cache.json');
const CACHE_TTL_HOURS = 6;
const CACHE_TTL_MS = CACHE_TTL_HOURS * 60 * 60 * 1000;
const FETCH_TIMEOUT = 15000;

fs.mkdirSync(DATA_DIR, { recursive: true });

const FAITH_CONFIG = {
  christian: {
    label: 'Christian',
    owidIndicator: 'christian-adherents',
    sectors: {
      relief: {
        label: 'Community relief & shelters',
        query: '"Christian" AND (relief OR shelter OR hurricane OR tornado)'
      },
      food: {
        label: 'Food security networks',
        query: '"Christian" AND (food bank OR pantry OR hunger OR meals)'
      },
      youth: {
        label: 'Youth programming',
        query: '"Christian" AND (youth OR teen OR mentorship OR camp)'
      },
      capital: {
        label: 'Capital campaigns',
        query: '"Christian" AND (capital campaign OR construction OR building fund)'
      }
    }
  },
  islam: {
    label: 'Muslim',
    owidIndicator: 'muslim-adherents',
    sectors: {
      ramadan_food: {
        label: 'Ramadan food parcels',
        query: '"Ramadan" AND (food parcel OR zakat OR iftar OR hamper)'
      },
      water: {
        label: 'Water & sanitation',
        query: '"Muslim" AND (water OR sanitation OR hygiene)'
      },
      education: {
        label: 'Scholarships for girls',
        query: '"Muslim" AND (scholarship OR education OR school OR girls education)'
      },
      infrastructure: {
        label: 'Mosque restoration',
        query: 'mosque OR masjid OR "Islamic center" AND (repair OR restoration OR construction)'
      }
    }
  },
  jewish: {
    label: 'Jewish',
    owidIndicator: 'jewish-adherents',
    sectors: {
      refugee: {
        label: 'Refugee welcome centers',
        query: '"Jewish" AND (refugee OR resettlement OR welcome center)'
      },
      culture: {
        label: 'Cultural preservation',
        query: '"Jewish" AND (culture OR heritage OR museum OR arts)'
      },
      energy: {
        label: 'Winter energy assistance',
        query: '"Jewish" AND (winter OR energy OR heating OR utility)'
      },
      education: {
        label: 'Education bursaries',
        query: '"Jewish" AND (education OR bursary OR scholarship OR school)'
      }
    }
  },
  hindu: {
    label: 'Hindu',
    owidIndicator: 'hindu-adherents',
    sectors: {
      disaster: {
        label: 'Disaster recovery',
        query: '"Hindu" AND (disaster OR cyclone OR flood OR earthquake)'
      },
      seva: {
        label: 'Temple seva programs',
        query: 'seva OR annadanam OR "temple service" OR "temple kitchen"'
      },
      health: {
        label: 'Health outreach',
        query: '"Hindu" AND (health OR clinic OR medical OR wellness)'
      },
      education: {
        label: 'Education for children',
        query: '"Hindu" AND (education OR school OR tuition OR scholarship)'
      }
    }
  },
  buddhist: {
    label: 'Buddhist',
    owidIndicator: 'buddhist-adherents',
    sectors: {
      retreats: {
        label: 'Retreat scholarships',
        query: '"Buddhist" AND (retreat OR meditation OR residency)'
      },
      environment: {
        label: 'Environmental care',
        query: '"Buddhist" AND (environment OR forest OR reforestation OR climate)'
      },
      elder: {
        label: 'Elder support services',
        query: '"Buddhist" AND (elder OR hospice OR senior OR caregiver)'
      },
      kitchen: {
        label: 'Community kitchens',
        query: '"Buddhist" AND (kitchen OR soup OR meal OR pantry)'
      }
    }
  }
};

async function readCache() {
  try {
    const content = await fs.promises.readFile(CACHE_FILE, 'utf8');
    if (!content) return null;
    return JSON.parse(content);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeCache(value) {
  const payload = JSON.stringify(value, null, 2);
  await fs.promises.writeFile(CACHE_FILE, payload, 'utf8');
}

function isCacheFresh(cache) {
  if (!cache || !cache.updatedAt) return false;
  const updatedAt = new Date(cache.updatedAt);
  if (Number.isNaN(updatedAt.getTime())) return false;
  return Date.now() - updatedAt.getTime() < CACHE_TTL_MS;
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, { timeout: FETCH_TIMEOUT, ...options });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.text();
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, {
    timeout: FETCH_TIMEOUT,
    headers: { Accept: 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

async function fetchOwidFollowers(indicator) {
  if (!indicator) return { value: null, year: null };
  const url = `https://ourworldindata.org/grapher/${encodeURIComponent(indicator)}.tab`;
  try {
    const text = await fetchText(url, { headers: { Accept: 'text/tab-separated-values' } });
    const lines = text.trim().split(/\r?\n/);
    if (lines.length <= 1) {
      return { value: null, year: null };
    }
    const headers = lines[0].split('\t');
    const entityIndex = headers.findIndex(header => header.toLowerCase() === 'entity');
    const yearIndex = headers.findIndex(header => header.toLowerCase() === 'year');
    const valueIndex = headers.length - 1;
    let latest = null;
    for (let i = 1; i < lines.length; i += 1) {
      const parts = lines[i].split('\t');
      if (!parts.length) continue;
      const entity = entityIndex >= 0 ? parts[entityIndex] : null;
      if (entity && entity !== 'World') continue;
      const year = yearIndex >= 0 ? Number(parts[yearIndex]) : null;
      const rawValue = valueIndex >= 0 ? Number(parts[valueIndex]) : null;
      if (!Number.isFinite(rawValue)) continue;
      if (!latest || (Number.isFinite(year) && year > latest.year)) {
        latest = { value: rawValue, year: Number.isFinite(year) ? year : null };
      }
    }
    return latest || { value: null, year: null };
  } catch (error) {
    console.warn('[FaithMetrics] Failed to load OWID data', { indicator, error: error?.message || error });
    return { value: null, year: null };
  }
}

async function fetchReliefWebCount(query) {
  if (!query) return null;
  const url = new URL('https://api.reliefweb.int/v1/reports');
  url.searchParams.set('appname', 'faith-metrics-cache');
  url.searchParams.set('profile', 'minimal');
  url.searchParams.set('limit', '0');
  url.searchParams.set('query[value]', query);
  url.searchParams.set('query[operator]', 'AND');
  try {
    const data = await fetchJSON(url.toString());
    const total = Number(data?.totalCount ?? data?.total ?? data?.count);
    if (Number.isFinite(total)) {
      return total;
    }
    return null;
  } catch (error) {
    console.warn('[FaithMetrics] Failed to load ReliefWeb count', { query, error: error?.message || error });
    return null;
  }
}

async function buildFaithMetrics() {
  const faithEntries = await Promise.all(
    Object.entries(FAITH_CONFIG).map(async ([key, config]) => {
      const followers = await fetchOwidFollowers(config.owidIndicator);
      const sectors = {};
      const sectorKeys = Object.entries(config.sectors || {});
      await Promise.all(
        sectorKeys.map(async ([sectorKey, sectorConfig]) => {
          const count = await fetchReliefWebCount(sectorConfig.query);
          sectors[sectorKey] = {
            label: sectorConfig.label,
            value: Number.isFinite(count) ? count : null,
            query: sectorConfig.query
          };
        })
      );
      const sectorTotal = Object.values(sectors).reduce((sum, sector) => {
        return sum + (Number.isFinite(sector.value) ? sector.value : 0);
      }, 0);
      return [
        key,
        {
          label: config.label,
          followers,
          sectors,
          totals: {
            sectorActions: sectorTotal
          }
        }
      ];
    })
  );

  const payload = Object.fromEntries(faithEntries);
  return {
    updatedAt: new Date().toISOString(),
    ttlHours: CACHE_TTL_HOURS,
    faiths: payload
  };
}

async function getFaithMetrics({ forceRefresh = false } = {}) {
  const cache = await readCache();
  if (!forceRefresh && cache && isCacheFresh(cache)) {
    return cache;
  }

  const fresh = await buildFaithMetrics();
  try {
    await writeCache(fresh);
  } catch (error) {
    console.warn('[FaithMetrics] Unable to persist cache', error);
  }
  return fresh;
}

module.exports = {
  getFaithMetrics
};
