(function (global) {
  if (!global) return;
  const existing = global.delcoApi;
  if (existing && typeof existing.resolveConfig === 'function') {
    return;
  }

  const STORAGE_KEY = 'delcoApiBase';
  const DEFAULT_BASES = [
    'https://www.delcotechdivision.com',
    'https://delcotechdivision.com'
  ];

  function normalizeBase(base) {
    if (!base || typeof base !== 'string') return null;
    const trimmed = base.trim();
    if (!trimmed) return null;
    return trimmed.replace(/\/+$/, '');
  }

  function getMetaBase() {
    try {
      const el = global.document?.querySelector?.('meta[name="delco-backend"]');
      return el?.content || null;
    } catch (_err) {
      return null;
    }
  }

  function getStoredBase() {
    try {
      return global.localStorage?.getItem?.(STORAGE_KEY) || null;
    } catch (_err) {
      return null;
    }
  }

  function storeBase(base) {
    try {
      const normalized = normalizeBase(base);
      if (!normalized) return;
      global.localStorage?.setItem?.(STORAGE_KEY, normalized);
    } catch (_err) {
      /* ignore */
    }
  }

  function originWithoutWww(origin) {
    if (typeof origin !== 'string') return null;
    if (!origin.startsWith('http')) return null;
    const url = new URL(origin);
    if (!url.hostname.startsWith('www.')) return null;
    return `${url.protocol}//${url.hostname.slice(4)}${url.port ? `:${url.port}` : ''}`;
  }

  async function tryLoadConfig(base) {
    const normalized = normalizeBase(base);
    if (!normalized) return null;
    const url = `${normalized}/config`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'omit',
        mode: 'cors',
      });
      if (!response.ok) {
        return null;
      }
      const data = await response.json().catch(() => null);
      if (data && typeof data === 'object') {
        storeBase(normalized);
        return { base: normalized, config: data };
      }
    } catch (_err) {
      return null;
    }
    return null;
  }

  async function resolveConfig(options = {}) {
    const fallbacks = Array.isArray(global.DELCO_BACKEND_FALLBACKS)
      ? global.DELCO_BACKEND_FALLBACKS
      : [];
    const candidates = [
      normalizeBase(global.DELCO_BACKEND_BASE),
      normalizeBase(getStoredBase()),
      normalizeBase(getMetaBase()),
      normalizeBase(global.location?.origin),
    ];

    const withoutWww = originWithoutWww(global.location?.origin);
    if (withoutWww) {
      candidates.push(normalizeBase(withoutWww));
    }

    for (const fb of fallbacks) {
      candidates.push(normalizeBase(fb));
    }
    for (const fb of DEFAULT_BASES) {
      candidates.push(normalizeBase(fb));
    }

    const seen = new Set();
    for (const candidate of candidates) {
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      const result = await tryLoadConfig(candidate);
      if (result) {
        return result;
      }
    }

    const fallbackBase = normalizeBase(DEFAULT_BASES[0]);
    return {
      base: fallbackBase,
      config: options.fallbackConfig || {},
    };
  }

  global.delcoApi = {
    resolveConfig,
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
