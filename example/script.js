/*
 * script.js
 *
 * This file contains all of the client side logic for the Danny's Wok clone.
 * It renders the menu on the page, manages a shopping cart and powers a
 * guided checkout experience for pickup or delivery orders.
 */

// Define the library of menu photography that was supplied for this clone.
// Each filename contains one or two dish names separated by casing.  We use
// the names encoded in the filenames to pair menu entries with imagery.
const fallbackImage = 'images/chinesemenu/store_interior.jpg';
const cartAddSound = typeof Audio === 'function' ? new Audio('audio/wok_register.mp3') : null;
const hoverSound = typeof Audio === 'function' ? new Audio('audio/scroll_hover_over_sound.mp3') : null;

const easternTimeZone = 'America/New_York';
const minutesPerHour = 60;
const storeStatusUpdateInterval = 60 * 1000;

const storeHoursByDay = {
  0: { open: 11 * minutesPerHour + 30, close: 22 * minutesPerHour + 30 },
  1: { open: 11 * minutesPerHour, close: 22 * minutesPerHour + 30 },
  2: { open: 11 * minutesPerHour, close: 22 * minutesPerHour + 30 },
  3: { open: 11 * minutesPerHour, close: 22 * minutesPerHour + 30 },
  4: { open: 11 * minutesPerHour, close: 22 * minutesPerHour + 30 },
  5: { open: 11 * minutesPerHour, close: 23 * minutesPerHour + 30 },
  6: { open: 11 * minutesPerHour, close: 23 * minutesPerHour + 30 },
};

function getEasternNow() {
  const localeString = new Date().toLocaleString('en-US', { timeZone: easternTimeZone });
  return new Date(localeString);
}

function calculateStoreOperatingStatus() {
  const now = getEasternNow();
  const day = now.getDay();
  const currentMinutes = now.getHours() * minutesPerHour + now.getMinutes();
  const hours = storeHoursByDay[day];

  if (!hours) {
    return {
      isOpen: false,
      text: 'Closed · Order ahead for pickup',
      state: 'closed',
    };
  }

  const isOpen = currentMinutes >= hours.open && currentMinutes < hours.close;

  return {
    isOpen,
    text: isOpen ? 'Open' : 'Closed · Order ahead for pickup',
    state: isOpen ? 'open' : 'closed',
  };
}

function resolveApiBase() {
  const globalObject = typeof window !== 'undefined' ? window : globalThis;
  if (globalObject && typeof globalObject.DELCO_BACKEND_BASE === 'string') {
    const candidate = globalObject.DELCO_BACKEND_BASE.trim();
    if (candidate) {
      return candidate;
    }
  }
  if (globalObject && typeof globalObject.DANNYS_WOK_BACKEND_BASE === 'string') {
    const candidate = globalObject.DANNYS_WOK_BACKEND_BASE.trim();
    if (candidate) {
      return candidate;
    }
  }
  if (globalObject && typeof globalObject.DANNYSWOK_BACKEND_BASE === 'string') {
    const candidate = globalObject.DANNYSWOK_BACKEND_BASE.trim();
    if (candidate) {
      return candidate;
    }
  }
  const origin = globalObject?.location?.origin;
  if (typeof origin === 'string' && origin.trim()) {
    const trimmedOrigin = origin.trim();
    if (/localhost|127\.0\.0\.1|::1/.test(trimmedOrigin)) {
      return trimmedOrigin;
    }
  }
  return 'https://www.delcotechdivision.com';
}

const API_BASE = resolveApiBase();

const DEFAULT_STORE_DATA = [
  {
    id: 'southwest',
    shortAddress: '5750 BALTIMORE AVE',
    label: 'Southwest',
    latitude: 39.94346,
    longitude: -75.23863,
  },
  {
    id: 'olney',
    shortAddress: '5675 N FRONT',
    label: 'One & Olney Plaza',
    latitude: 40.039947,
    longitude: -75.122995,
  },
  {
    id: 'hunting-park',
    shortAddress: '4322 NORTH BROAD STREET',
    label: 'Hunting Park',
    latitude: 40.016985,
    longitude: -75.145408,
  },
];

const storeDataById = new Map();
let storeData = [];

function applyStoreData(stores) {
  if (!Array.isArray(stores) || !stores.length) {
    storeData = DEFAULT_STORE_DATA.map((store) => ({ ...store }));
  } else {
    storeData = stores.map((store) => ({ ...store, id: String(store.id || store.label || '').trim().toLowerCase() }));
  }
  storeDataById.clear();
  storeData.forEach((store) => {
    if (store.id) {
      storeDataById.set(store.id, store);
    }
  });
}

applyStoreData(DEFAULT_STORE_DATA);

let storeDataLoaded = false;
let storeDataPromise = null;
let pickupScheduleLockActive = false;
let pickupScheduleIntervalId = null;

function getStoreById(storeId) {
  if (!storeId) {
    return null;
  }
  const normalized = String(storeId).trim().toLowerCase();
  return storeDataById.get(normalized) || null;
}

function getStoreList() {
  return storeData.slice();
}

async function fetchStoreDataFromApi() {
  try {
    const response = await fetch('/api/menu/stores', { cache: 'no-store' });
    if (response.ok) {
      const data = await response.json();
      if (data && Array.isArray(data.stores) && data.stores.length) {
        applyStoreData(data.stores);
      }
    }
  } catch (error) {
    // Ignore fetch errors and continue using the default store data.
  }
  storeDataLoaded = true;
  return storeData;
}

function ensureStoreDataLoaded() {
  if (storeDataLoaded) {
    return Promise.resolve(storeData);
  }
  if (!storeDataPromise) {
    storeDataPromise = fetchStoreDataFromApi().finally(() => {
      storeDataPromise = null;
    });
  }
  return storeDataPromise;
}

const STATE_SALES_TAX_RATE = 0.09;
const ORDER_PROCESSING_FEE = 2;
const DELIVERY_DISTANCE_LIMIT_MILES = 10;
const DELIVERY_FEE_BRACKETS = [
  { max: 0.7, amount: 3 },
  { max: 2, amount: 5 },
  { max: 4, amount: 7.99 },
  { max: 6, amount: 11.99 },
  { max: 8, amount: 17.99 },
  { max: 10, amount: 25.99 },
];

let headerFulfilmentMode = 'pickup';

const analyticsApi = typeof window !== 'undefined' ? window.DannysAnalytics || null : null;
const LOCATION_STORAGE_KEY = analyticsApi?.storageKeys?.location || 'dwkUserLocation';
const LAST_ORDER_STORAGE_KEY = analyticsApi?.storageKeys?.lastOrder || 'dwkLastOrderSummary';
const ORDER_HISTORY_STORAGE_KEY = analyticsApi?.storageKeys?.orderHistory || 'dwkOrderHistory';

const QUICK_REORDER_MAX_ENTRIES = 5;
const ORDER_HISTORY_MAX_ENTRIES = 20;

let quickReorderOrders = [];

function readOrderHistoryStorage() {
  if (analyticsApi?.getOrderHistory) {
    try {
      const history = analyticsApi.getOrderHistory();
      return Array.isArray(history) ? history : [];
    } catch (error) {
      return [];
    }
  }
  if (analyticsApi?.getStoredJson) {
    const stored = analyticsApi.getStoredJson(ORDER_HISTORY_STORAGE_KEY);
    return Array.isArray(stored) ? stored : [];
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(ORDER_HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function writeOrderHistoryStorage(value) {
  if (analyticsApi?.setOrderHistory) {
    analyticsApi.setOrderHistory(Array.isArray(value) ? value : []);
    return;
  }
  if (analyticsApi?.setStoredJson) {
    analyticsApi.setStoredJson(ORDER_HISTORY_STORAGE_KEY, Array.isArray(value) ? value : []);
    return;
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    if (!Array.isArray(value) || !value.length) {
      window.localStorage.removeItem(ORDER_HISTORY_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(ORDER_HISTORY_STORAGE_KEY, JSON.stringify(value));
  } catch (error) {
    // Ignore storage exceptions (e.g. private browsing)
  }
}

function sanitizeHistoryEntry(rawEntry) {
  if (!rawEntry || typeof rawEntry !== 'object') {
    return null;
  }
  const timestampSource = typeof rawEntry.timestamp === 'string' ? rawEntry.timestamp : null;
  const timestamp = timestampSource && !Number.isNaN(Date.parse(timestampSource))
    ? timestampSource
    : new Date().toISOString();
  const fulfilment = typeof rawEntry.fulfilment === 'string' ? rawEntry.fulfilment : '';
  const items = Array.isArray(rawEntry.items)
    ? rawEntry.items
        .slice(0, 50)
        .map((item) => {
          if (!item || typeof item !== 'object') {
            return null;
          }
          const id = typeof item.id === 'string' ? item.id : null;
          const name = typeof item.name === 'string' ? item.name : '';
          if (!id && !name) {
            return null;
          }
          const quantityNumber = Number.isFinite(item.quantity) ? item.quantity : Number(item.quantity);
          const quantity = Number.isFinite(quantityNumber) && quantityNumber > 0
            ? Math.round(quantityNumber)
            : 1;
          return {
            id,
            name: name || 'Menu item',
            quantity,
          };
        })
        .filter(Boolean)
    : [];
  if (!items.length) {
    return null;
  }
  return {
    timestamp,
    fulfilment,
    items,
  };
}

function loadOrderHistoryEntries() {
  const stored = readOrderHistoryStorage();
  const entries = stored
    .map((entry) => sanitizeHistoryEntry(entry))
    .filter(Boolean)
    .sort((a, b) => {
      const timeA = Date.parse(a.timestamp) || 0;
      const timeB = Date.parse(b.timestamp) || 0;
      return timeB - timeA;
    });
  if (entries.length > ORDER_HISTORY_MAX_ENTRIES) {
    writeOrderHistoryStorage(entries.slice(0, ORDER_HISTORY_MAX_ENTRIES));
    return entries.slice(0, ORDER_HISTORY_MAX_ENTRIES);
  }
  return entries;
}

function formatOrderTimestamp(isoString) {
  if (!isoString) {
    return '';
  }
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch (error) {
    return '';
  }
}

function formatOrderSummary(entry) {
  if (!entry || !entry.items || !entry.items.length) {
    return 'Previous order';
  }
  const [firstItem, ...rest] = entry.items;
  const baseName = firstItem.quantity > 1 ? `${firstItem.quantity}× ${firstItem.name}` : firstItem.name;
  if (!rest.length) {
    return baseName;
  }
  return `${baseName} + ${rest.length}`;
}

let activeStoreId = null;
let deliveryMap = null;
let deliveryMapReady = false;
let storeMarker = null;
let userMarker = null;
let deliveryPathLine = null;
let pendingGeocodeController = null;
let locationLoadedFromCache = false;

const deliveryLocationState = {
  lat: null,
  lng: null,
  accuracy: null,
  source: null,
  addressLine1: '',
  city: '',
  postalCode: '',
};

const deliveryQuoteState = {
  distanceMiles: null,
  fee: 0,
  withinRange: true,
  needsLocation: true,
};

if (cartAddSound) {
  cartAddSound.preload = 'auto';
}

if (hoverSound) {
  hoverSound.preload = 'auto';
}

function playHoverSound() {
  if (!hoverSound) {
    return;
  }

  try {
    hoverSound.currentTime = 0;
    const playPromise = hoverSound.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }
  } catch (error) {
    // Ignore playback errors triggered by autoplay policies or unsupported playback.
  }
}

function handleGlobalButtonHover(event) {
  const button = event.target.closest('button');
  if (!button || !document.contains(button)) {
    return;
  }

  if (event.relatedTarget && button.contains(event.relatedTarget)) {
    return;
  }

  playHoverSound();
}

document.addEventListener('mouseover', handleGlobalButtonHover);

function trackEvent(type, payload = {}, options = {}) {
  if (!analyticsApi || typeof analyticsApi.sendEvent !== 'function') {
    return;
  }
  analyticsApi.sendEvent(type, payload, { ensureProfile: true, ...options });
}

function readLocationStorage() {
  if (analyticsApi?.getStoredJson) {
    return analyticsApi.getStoredJson(LOCATION_STORAGE_KEY);
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(LOCATION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function writeLocationStorage(value) {
  if (analyticsApi?.setStoredJson) {
    analyticsApi.setStoredJson(LOCATION_STORAGE_KEY, value);
    return;
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    if (value === null || value === undefined) {
      window.localStorage.removeItem(LOCATION_STORAGE_KEY);
    } else {
      window.localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(value));
    }
  } catch (error) {
    // Ignore storage errors (e.g. private browsing)
  }
}

function applyLocationToFormFields(location, { overwrite = false } = {}) {
  const addressInput = document.getElementById('delivery-address');
  const cityInput = document.getElementById('delivery-city');
  const zipInput = document.getElementById('delivery-zip');
  if (!addressInput || !cityInput || !zipInput) {
    return;
  }
  if (location.addressLine1 && (overwrite || !addressInput.value.trim())) {
    addressInput.value = location.addressLine1;
  }
  if (location.city && (overwrite || !cityInput.value.trim())) {
    cityInput.value = location.city;
  }
  if (location.postalCode && (overwrite || !zipInput.value.trim())) {
    zipInput.value = location.postalCode;
  }
}

function getActiveStore() {
  return activeStoreId ? getStoreById(activeStoreId) : null;
}

function setActiveStore(storeId) {
  activeStoreId = normalizeStoreId(storeId);
  refreshDeliveryQuote();
  updateDeliverySummaryDisplay();
  updateMapMarkers();
  updateCheckoutView();
  updatePickupScheduleLock();
  if (activeStoreId) {
    const store = getActiveStore();
    trackEvent('active_store_set', {
      storeId: activeStoreId,
      label: store?.label,
    });
    if (analyticsApi?.ensureProfile) {
      analyticsApi.ensureProfile({
        storeId: activeStoreId,
        storeLabel: store?.label,
        storeLat: store?.latitude,
        storeLng: store?.longitude,
      });
    }
  }
}

function updatePickupScheduleLock() {
  const pickupWrapper = document.getElementById('pickup-time-wrapper');
  const standardRadio = document.getElementById('pickup-time-standard');
  const scheduleRadio = document.getElementById('pickup-time-schedule');
  const lockMessage = document.getElementById('pickup-time-lock-message');
  if (!pickupWrapper || !standardRadio || !scheduleRadio || !lockMessage) {
    return;
  }

  const status = calculateStoreOperatingStatus();
  const shouldLock = !status.isOpen;
  const standardLabel = standardRadio.closest('label');
  const scheduleLabel = scheduleRadio.closest('label');

  if (shouldLock) {
    const wasLocked = pickupScheduleLockActive;
    if (!pickupScheduleLockActive) {
      standardRadio.disabled = true;
      standardRadio.checked = false;
      standardRadio.setAttribute('aria-disabled', 'true');
      if (standardLabel) {
        standardLabel.classList.add('is-disabled');
      }
      if (scheduleLabel) {
        scheduleLabel.classList.add('is-locked');
      }
      pickupWrapper.classList.add('is-locked');
      pickupScheduleLockActive = true;
    }
    if (!scheduleRadio.checked) {
      scheduleRadio.checked = true;
    }
    if (!wasLocked || selectedPickupTimeOption !== 'schedule') {
      setPickupTimePreference('schedule');
    }
    scheduleRadio.disabled = false;
    scheduleRadio.removeAttribute('aria-disabled');
    lockMessage.textContent = "We're closed right now. Schedule ahead for pickup to place your order.";
    lockMessage.hidden = false;
  } else {
    if (pickupScheduleLockActive) {
      standardRadio.disabled = false;
      standardRadio.removeAttribute('aria-disabled');
      if (standardLabel) {
        standardLabel.classList.remove('is-disabled');
      }
      if (scheduleLabel) {
        scheduleLabel.classList.remove('is-locked');
      }
      pickupWrapper.classList.remove('is-locked');
      pickupScheduleLockActive = false;
    }
    lockMessage.textContent = '';
    lockMessage.hidden = true;
  }
}

function loadCachedDeliveryLocation() {
  const stored = readLocationStorage();
  if (!stored || !Number.isFinite(stored.lat) || !Number.isFinite(stored.lng)) {
    return false;
  }
  deliveryLocationState.lat = stored.lat;
  deliveryLocationState.lng = stored.lng;
  deliveryLocationState.accuracy = Number.isFinite(stored.accuracy) ? stored.accuracy : null;
  deliveryLocationState.source = stored.source || 'cache';
  deliveryLocationState.addressLine1 = stored.addressLine1 || '';
  deliveryLocationState.city = stored.city || '';
  deliveryLocationState.postalCode = stored.postalCode || '';
  locationLoadedFromCache = true;
  applyLocationToFormFields(deliveryLocationState, { overwrite: true });
  refreshDeliveryQuote();
  trackEvent('delivery_location_loaded', {
    source: stored.source || 'cache',
    lat: deliveryLocationState.lat,
    lng: deliveryLocationState.lng,
  });
  updateDeliverySummaryDisplay();
  return true;
}

function persistDeliveryLocationState() {
  if (!Number.isFinite(deliveryLocationState.lat) || !Number.isFinite(deliveryLocationState.lng)) {
    writeLocationStorage(null);
    return;
  }
  writeLocationStorage({
    lat: deliveryLocationState.lat,
    lng: deliveryLocationState.lng,
    accuracy: deliveryLocationState.accuracy,
    source: deliveryLocationState.source,
    addressLine1: deliveryLocationState.addressLine1,
    city: deliveryLocationState.city,
    postalCode: deliveryLocationState.postalCode,
    updatedAt: new Date().toISOString(),
  });
}

function calculateDistanceMiles(lat1, lon1, lat2, lon2) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
}

function determineDeliveryFee(distanceMiles) {
  for (const bracket of DELIVERY_FEE_BRACKETS) {
    if (distanceMiles <= bracket.max) {
      return bracket.amount;
    }
  }
  return DELIVERY_FEE_BRACKETS[DELIVERY_FEE_BRACKETS.length - 1].amount;
}

function refreshDeliveryQuote() {
  const store = getActiveStore();
  if (!store || !Number.isFinite(store.latitude) || !Number.isFinite(store.longitude)) {
    deliveryQuoteState.distanceMiles = null;
    deliveryQuoteState.fee = 0;
    deliveryQuoteState.withinRange = false;
    deliveryQuoteState.needsLocation = true;
    return deliveryQuoteState;
  }
  if (!Number.isFinite(deliveryLocationState.lat) || !Number.isFinite(deliveryLocationState.lng)) {
    deliveryQuoteState.distanceMiles = null;
    deliveryQuoteState.fee = 0;
    deliveryQuoteState.withinRange = true;
    deliveryQuoteState.needsLocation = true;
    return deliveryQuoteState;
  }
  const distance = calculateDistanceMiles(
    store.latitude,
    store.longitude,
    deliveryLocationState.lat,
    deliveryLocationState.lng,
  );
  deliveryQuoteState.distanceMiles = distance;
  deliveryQuoteState.needsLocation = false;
  if (distance > DELIVERY_DISTANCE_LIMIT_MILES) {
    deliveryQuoteState.fee = 0;
    deliveryQuoteState.withinRange = false;
  } else {
    deliveryQuoteState.fee = determineDeliveryFee(distance);
    deliveryQuoteState.withinRange = true;
  }
  return deliveryQuoteState;
}

function updateDeliverySummaryDisplay() {
  const summary = document.getElementById('delivery-distance-summary');
  if (!summary) {
    return;
  }
  summary.classList.remove('is-error', 'is-warning', 'is-success');
  const store = getActiveStore();
  if (!store) {
    summary.textContent = 'Select a store to calculate delivery distance.';
    summary.classList.add('is-warning');
    return;
  }
  if (deliveryQuoteState.needsLocation) {
    summary.textContent = 'Share your location to calculate delivery fees.';
    summary.classList.add('is-warning');
    return;
  }
  if (!deliveryQuoteState.withinRange) {
    const distanceText = deliveryQuoteState.distanceMiles
      ? `${deliveryQuoteState.distanceMiles.toFixed(2)} miles away.`
      : 'outside our delivery range.';
    summary.textContent = `Delivery is available within ${DELIVERY_DISTANCE_LIMIT_MILES} miles. You're ${distanceText}`;
    summary.classList.add('is-error');
    return;
  }
  const distanceText = deliveryQuoteState.distanceMiles
    ? `${deliveryQuoteState.distanceMiles.toFixed(2)} miles`
    : 'within range';
  summary.textContent = `Approximately ${distanceText} from the store. Delivery fee ${formatCurrency(
    deliveryQuoteState.fee,
  )}.`;
  summary.classList.add('is-success');
}

function ensureDeliveryMapInitialized() {
  const container = document.getElementById('delivery-map');
  if (!container || typeof L === 'undefined') {
    return false;
  }
  if (deliveryMap) {
    return true;
  }
  deliveryMap = L.map(container, {
    zoomControl: false,
    attributionControl: false,
    dragging: true,
    scrollWheelZoom: false,
  });
  const streetLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 18 },
  );
  streetLayer.addTo(deliveryMap);
  deliveryMapReady = true;
  deliveryMap.on('click', (event) => {
    setLocationFromCoordinates(event.latlng.lat, event.latlng.lng, 'map');
  });
  return true;
}

function updateMapMarkers() {
  if (!deliveryMap || !deliveryMapReady) {
    return;
  }
  const store = getActiveStore();
  if (store && Number.isFinite(store.latitude) && Number.isFinite(store.longitude)) {
    const storeLatLng = [store.latitude, store.longitude];
    if (!storeMarker) {
      const storeIcon = L.divIcon({
        className: 'delivery-map__store-pin',
        html: '<span class="delivery-map__store-pin-inner" aria-hidden="true"></span>',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      storeMarker = L.marker(storeLatLng, { icon: storeIcon, interactive: false }).addTo(deliveryMap);
    } else {
      storeMarker.setLatLng(storeLatLng);
    }
  } else if (storeMarker) {
    storeMarker.remove();
    storeMarker = null;
  }

  if (Number.isFinite(deliveryLocationState.lat) && Number.isFinite(deliveryLocationState.lng)) {
    const userLatLng = [deliveryLocationState.lat, deliveryLocationState.lng];
    if (!userMarker) {
      const userIcon = L.divIcon({
        className: 'delivery-map__user-pin',
        html: '<span class="delivery-map__user-pin-inner" aria-hidden="true"></span>',
        iconSize: [28, 28],
        iconAnchor: [14, 26],
      });
      userMarker = L.marker(userLatLng, { icon: userIcon, draggable: true }).addTo(deliveryMap);
      userMarker.on('dragend', () => {
        const { lat, lng } = userMarker.getLatLng();
        setLocationFromCoordinates(lat, lng, 'pin');
      });
    } else {
      userMarker.setLatLng(userLatLng);
    }
  } else if (userMarker) {
    userMarker.remove();
    userMarker = null;
  }

  if (storeMarker && userMarker) {
    const storeLatLng = storeMarker.getLatLng();
    const userLatLng = userMarker.getLatLng();
    if (!deliveryPathLine) {
      deliveryPathLine = L.polyline([storeLatLng, userLatLng], {
        color: '#c0392b',
        weight: 3,
        dashArray: '8 8',
      }).addTo(deliveryMap);
    } else {
      deliveryPathLine.setLatLngs([storeLatLng, userLatLng]);
    }
    const bounds = L.latLngBounds([storeLatLng, userLatLng]);
    deliveryMap.fitBounds(bounds, { padding: [24, 48] });
  } else if (deliveryPathLine) {
    deliveryPathLine.remove();
    deliveryPathLine = null;
    if (storeMarker) {
      deliveryMap.setView(storeMarker.getLatLng(), 13);
    }
  } else if (storeMarker) {
    deliveryMap.setView(storeMarker.getLatLng(), 13);
  }

  window.setTimeout(() => {
    deliveryMap.invalidateSize();
  }, 200);
}

async function fetchAddressForLocation(lat, lng, source = 'manual') {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return;
  }
  if (pendingGeocodeController) {
    pendingGeocodeController.abort();
  }
  const controller = new AbortController();
  pendingGeocodeController = controller;
  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('lat', lat);
    url.searchParams.set('lon', lng);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Reverse geocode failed with status ${response.status}`);
    }
    const data = await response.json();
    const address = data?.address || {};
    const streetName =
      address.road ||
      address.pedestrian ||
      address.highway ||
      address.residential ||
      address.neighbourhood ||
      '';
    const houseNumber = address.house_number || '';
    const line1 = [houseNumber, streetName].filter(Boolean).join(' ').trim();
    const city =
      address.city ||
      address.town ||
      address.village ||
      address.borough ||
      address.hamlet ||
      address.municipality ||
      '';
    const postalCode = address.postcode || '';
    if (line1) {
      deliveryLocationState.addressLine1 = line1;
    }
    if (city) {
      deliveryLocationState.city = city;
    }
    if (postalCode) {
      deliveryLocationState.postalCode = postalCode;
    }
    applyLocationToFormFields(deliveryLocationState, { overwrite: source !== 'manual' });
    persistDeliveryLocationState();
    trackEvent('delivery_reverse_geocode', {
      success: true,
      source,
      lat,
      lng,
      addressLine1: deliveryLocationState.addressLine1,
      city: deliveryLocationState.city,
      postalCode: deliveryLocationState.postalCode,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      return;
    }
    trackEvent('delivery_reverse_geocode', {
      success: false,
      source,
      error: error?.message || 'unknown_error',
    });
  } finally {
    if (pendingGeocodeController === controller) {
      pendingGeocodeController = null;
    }
  }
}

function setLocationFromCoordinates(lat, lng, source = 'manual', accuracy = null) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return;
  }
  deliveryLocationState.lat = lat;
  deliveryLocationState.lng = lng;
  deliveryLocationState.accuracy = Number.isFinite(accuracy) ? accuracy : null;
  deliveryLocationState.source = source;
  locationLoadedFromCache = true;
  refreshDeliveryQuote();
  updateDeliverySummaryDisplay();
  updateMapMarkers();
  applyLocationToFormFields(deliveryLocationState, { overwrite: source !== 'manual' });
  persistDeliveryLocationState();
  fetchAddressForLocation(lat, lng, source);
  trackEvent('delivery_location_updated', {
    source,
    lat,
    lng,
    accuracy: deliveryLocationState.accuracy,
    distanceMiles: deliveryQuoteState.distanceMiles,
  });
  updateCheckoutView();
}

function requestBrowserLocation() {
  if (Number.isFinite(deliveryLocationState.lat) && Number.isFinite(deliveryLocationState.lng)) {
    return;
  }
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    trackEvent('delivery_location_permission', { status: 'unsupported' });
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      setLocationFromCoordinates(
        position.coords.latitude,
        position.coords.longitude,
        'geolocation',
        position.coords.accuracy,
      );
      trackEvent('delivery_location_permission', {
        status: 'granted',
        accuracy: position.coords.accuracy,
      });
    },
    (error) => {
      trackEvent('delivery_location_permission', {
        status: 'denied',
        code: error?.code || null,
        message: error?.message || null,
      });
      updateDeliverySummaryDisplay();
    },
    { enableHighAccuracy: true, maximumAge: 60000 },
  );
}

function normalizeStoreId(storeId) {
  if (!storeId) {
    return null;
  }

  const normalized = String(storeId).trim().toLowerCase();
  return storeDataById.has(normalized) ? normalized : null;
}

function applySelectedStoreFromQuery() {
  const displayWrapper = document.getElementById('selected-store-display');
  const addressElement = document.getElementById('selected-store-address');
  if (!displayWrapper || !addressElement) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const matchedStoreId = normalizeStoreId(params.get('store'));
  const matchedStore = matchedStoreId ? getStoreById(matchedStoreId) : null;

  if (matchedStoreId && matchedStore) {
    addressElement.textContent = matchedStore.shortAddress || matchedStore.label || matchedStoreId;
    displayWrapper.dataset.storeId = matchedStoreId;
    displayWrapper.classList.remove('menu-header__selected-store--empty');
    setActiveStore(matchedStoreId);
  } else {
    addressElement.textContent = getHeaderFulfilmentPlaceholder();
    displayWrapper.classList.add('menu-header__selected-store--empty');
    displayWrapper.removeAttribute('data-store-id');
    setActiveStore(null);
  }

  updateHeaderFulfilmentDisplay();
}

function getHeaderFulfilmentPlaceholder() {
  return headerFulfilmentMode === 'delivery' ? 'Select a store for delivery' : 'Select a store for pickup';
}

function updateHeaderFulfilmentDisplay() {
  const displayWrapper = document.getElementById('selected-store-display');
  const labelTextElement = displayWrapper
    ? displayWrapper.querySelector('.menu-header__selected-store-label-text')
    : null;
  const iconElement = displayWrapper
    ? displayWrapper.querySelector('.menu-header__fulfilment-icon')
    : null;
  const valueElement = document.getElementById('selected-store-address');
  if (!displayWrapper || !labelTextElement || !valueElement) {
    return;
  }

  const isDelivery = headerFulfilmentMode === 'delivery';
  labelTextElement.textContent = isDelivery ? 'Delivery from' : 'Pickup from';
  if (iconElement) {
    iconElement.hidden = !isDelivery;
  }
  if (displayWrapper.classList.contains('menu-header__selected-store--empty')) {
    valueElement.textContent = getHeaderFulfilmentPlaceholder();
  }
  displayWrapper.dataset.fulfilment = headerFulfilmentMode;
  displayWrapper.setAttribute('aria-pressed', isDelivery ? 'true' : 'false');
  displayWrapper.setAttribute(
    'aria-label',
    isDelivery ? 'Toggle fulfilment (currently delivery)' : 'Toggle fulfilment (currently pickup)',
  );
}

function handleHeaderFulfilmentToggle(event) {
  if (event.type === 'keydown') {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    if (event.repeat) {
      return;
    }
    event.preventDefault();
  }

  headerFulfilmentMode = headerFulfilmentMode === 'pickup' ? 'delivery' : 'pickup';

  const displayWrapper = document.getElementById('selected-store-display');
  if (displayWrapper) {
    displayWrapper.classList.remove('is-animating');
    // Force a reflow so the animation can replay reliably
    void displayWrapper.offsetWidth; // eslint-disable-line no-void
    displayWrapper.classList.add('is-animating');
  }

  updateHeaderFulfilmentDisplay();

  const checkoutPanel = document.getElementById('checkout-panel');
  if (checkoutPanel && !checkoutPanel.classList.contains('hidden')) {
    applyHeaderFulfilmentToCheckout();
  }
}

const menuImageSources = [
  'images/chinesemenu/b-b-q_spare_rib_tips_w_fried_rice_Fried_Scallop_w_French_Fries.jpg',
  'images/chinesemenu/beef_w_brocccoli_combo_Shrimp_w_Lobster_Sauce_Combo.jpg',
  'images/chinesemenu/beef_w_broccoli_Pepper_Steak_w_Onion.jpg',
  'images/chinesemenu/beef_w_mixed_vegetables_Beef_w_Snow_Peas.jpg',
  'images/chinesemenu/beef_w_scallop_General_Tso_Chicken.jpg',
  'images/chinesemenu/boneless_spare_ribs_Pu_Pu_Platter.jpg',
  'images/chinesemenu/cheese_wonton_B-B-Q-Spare_Ribs.jpg',
  'images/chinesemenu/chicken_chow_mein_combo_Roast_Pork_Egg_Foo_Young_Combo.jpg',
  'images/chinesemenu/chicken_lo_mein_Beef_Lo_Mein.jpg',
  'images/chinesemenu/chicken_w_garlic_sauce_combo_Shrimp_w_Broccoli_combo.jpg',
  'images/chinesemenu/chicken_w_mixed_vegeteables_Curry_Chicken.jpg',
  'images/chinesemenu/chow_san_shiu_Steamed_Shrimp_w_Mixed_Vegetables.jpg',
  'images/chinesemenu/egg_drop_soup_Wonton_soup.jpg',
  'images/chinesemenu/four_season_Shrimp_Beef_w_Garlic_Sauce.jpg',
  'images/chinesemenu/fried_chicken_wings_w_fried_rice_Fried_Crab_Meat_Sticks_w_French_Fries.jpg',
  'images/chinesemenu/fried_jumbo_shrimp_w_fried_rice_Fried_Baby_Shrimp_w_French_Fries.jpg',
  'images/chinesemenu/fried_onion_rings_Egg_Roll.jpg',
  'images/chinesemenu/home_style_bean_curd_Mixed_Vegetabless.jpg',
  'images/chinesemenu/hot_sour_soup_House_Special_Soup.jpg',
  'images/chinesemenu/house_special_fried_rice_Shrimp_Fried_Rice.jpg',
  'images/chinesemenu/hunan_beef_Shredded_Beef_Szechuan_Style.jpg',
  'images/chinesemenu/kung_pao_chihcken_Chicken_w_Garlic_Sauce.jpg',
  'images/chinesemenu/ma_po_to_fu_Broccoli_w_Garlic_Sauce.jpg',
  'images/chinesemenu/mongolian_beed_Triple_Delight.jpg',
  'images/chinesemenu/moo_goo_gai_pan_Chicken_w_Broccoli.jpg',
  'images/chinesemenu/moo_goo_gai_pan_combo_Pepper_Steak_w_Onion_Combo.jpg',
  'images/chinesemenu/orange_chicken_Sesame_Chicken.jpg',
  'images/chinesemenu/party_tray_buffalo_wings.jpg',
  'images/chinesemenu/party_tray_chicken_w_broccoli.jpg',
  'images/chinesemenu/party_tray_chicken_wing.jpg',
  'images/chinesemenu/party_tray_chicken_wings.jpg',
  'images/chinesemenu/party_tray_fried_rice.jpg',
  'images/chinesemenu/party_tray_gerenral_tso_chicken.jpg',
  'images/chinesemenu/party_tray_shrimp_fried_rice.jpg',
  'images/chinesemenu/party_tray_shrimp_lo_mein.jpg',
  'images/chinesemenu/party_tray_spring_roll.jpg',
  'images/chinesemenu/party_tray_vegetable_lo_mein.jpg',
  'images/chinesemenu/pork_fried_rice_Beef_Fried_Rice.jpg',
  'images/chinesemenu/roast_pork_w_chinese_vegetables_combo_B-B-Q_Spare_Ribs_Combo.jpg',
  'images/chinesemenu/roast_pork_w_chinses_Vegetables_Roast_Pork_w_Snow_Peas.jpg',
  'images/chinesemenu/seafood_combination_Happy_Family.jpg',
  'images/chinesemenu/shrimp_chow_mein_Chicken_Chow_Mein.jpg',
  'images/chinesemenu/shrimp_lo_mein_House_Special_Lo_Mein.jpg',
  'images/chinesemenu/shrimp_mei_fun_Singapore_Mei_Fun.jpg',
  'images/chinesemenu/shrimp_szechuan_shrimp_Shrimp_w_Garlic_Sauce.jpg',
  'images/chinesemenu/shrimp_w_lobster_sauce_Shrimp_w_Chinese_Vegeteable.jpg',
  'images/chinesemenu/shrimp_w_mixed_Vegetable_Shrimp_w_Snow_Pea.jpg',
  'images/chinesemenu/steamed_scallop_shrimp_w_mixed_vegetables_Steamed_Checken_w_Broccoli.jpg',
  'images/chinesemenu/store_interior.jpg',
  'images/chinesemenu/store_interior2.jpg',
  'images/chinesemenu/store_interior3.jpg',
  'images/chinesemenu/sweet_sour_shrimp_Sweet_Sour_Chicken.jpg',
  'images/chinesemenu/vegetable_lo_mein_Pork_Lo_Mein.jpg',
];

const TOKEN_STOP_WORDS = new Set([
  'w',
  'with',
  'and',
  'in',
  'on',
  'style',
  'sauce',
  'special',
  'combo',
  'dinner',
  'lunch',
  'pt',
  'pc',
  'pcs',
  'qt',
  'platter',
  'bowl',
  'no',
  'veggie',
  'stick',
  'sticks',
  'young',
  'foo',
]);

const TOKEN_REPLACEMENTS = {
  tsos: 'tso',
  tso: 'tso',
  chihcken: 'chicken',
  checken: 'chicken',
  beed: 'beef',
  gerenral: 'general',
  vegetabless: 'vegetable',
  vegeteable: 'vegetable',
  vegeteables: 'vegetable',
  chinses: 'chinese',
  mixed: 'mixed',
};

function sanitizeKey(text) {
  return text
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\./g, '')
    .replace(/'/g, '')
    .replace(/\(/g, '')
    .replace(/\)/g, '')
    .replace(/\//g, ' ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeToken(token) {
  const replaced = TOKEN_REPLACEMENTS[token] || token;
  if (replaced.endsWith('ies') && replaced.length > 3) {
    return replaced.slice(0, -3) + 'y';
  }
  if (replaced.endsWith('s') && replaced.length > 3) {
    return replaced.slice(0, -1);
  }
  return replaced;
}

function extractTokens(text) {
  return text
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\./g, '')
    .replace(/'/g, '')
    .replace(/\(/g, '')
    .replace(/\)/g, '')
    .replace(/\//g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token && !TOKEN_STOP_WORDS.has(token) && !/^\d+$/.test(token))
    .map(normalizeToken);
}

function buildImageEntries() {
  const entries = [];
  menuImageSources.forEach((src) => {
    const fileName = src.substring(src.lastIndexOf('/') + 1, src.length - 4);
    const upperIndex = fileName.search(/[A-Z]/);
    const parts = upperIndex === -1
      ? [fileName]
      : [
          fileName.slice(0, upperIndex).replace(/_+$/, ''),
          fileName.slice(upperIndex).replace(/^_+/, ''),
        ];
    parts.forEach((part) => {
      const tokens = Array.from(new Set(extractTokens(part.replace(/_/g, ' '))));
      if (tokens.length) {
        entries.push({ src, tokens: new Set(tokens) });
      }
    });
  });
  return entries;
}

const imageEntries = buildImageEntries();

const manualImageMap = {
  bbq_boneless_ribs: 'images/chinesemenu/boneless_spare_ribs_Pu_Pu_Platter.jpg',
  bbq_ribs: 'images/chinesemenu/boneless_spare_ribs_Pu_Pu_Platter.jpg',
  beef_bean_curd_with_black_pepper_sauce: 'images/chinesemenu/home_style_bean_curd_Mixed_Vegetabless.jpg',
  beef_fried_rice: 'images/chinesemenu/pork_fried_rice_Beef_Fried_Rice.jpg',
  beef_string_bean_black_bean_sauce: 'images/chinesemenu/home_style_bean_curd_Mixed_Vegetabless.jpg',
  beef_yat_w_vegetables: 'images/chinesemenu/beef_w_mixed_vegetables_Beef_w_Snow_Peas.jpg',
  brown_rice_no_veggie: 'images/chinesemenu/party_tray_fried_rice.jpg',
  chicken_bean_curd_black_pepper_sauce: 'images/chinesemenu/home_style_bean_curd_Mixed_Vegetabless.jpg',
  chicken_broth: 'images/chinesemenu/hot_sour_soup_House_Special_Soup.jpg',
  chicken_fried_rice: 'images/chinesemenu/house_special_fried_rice_Shrimp_Fried_Rice.jpg',
  chicken_noodle_soup: 'images/chinesemenu/hot_sour_soup_House_Special_Soup.jpg',
  chicken_rice_soup: 'images/chinesemenu/egg_drop_soup_Wonton_soup.jpg',
  chicken_teriyaki_on_stick_4: 'images/chinesemenu/party_tray_chicken_wing.jpg',
  chicken_w_black_pepper_sauce: 'images/chinesemenu/moo_goo_gai_pan_combo_Pepper_Steak_w_Onion_Combo.jpg',
  chicken_w_cashew_nuts: 'images/chinesemenu/kung_pao_chihcken_Chicken_w_Garlic_Sauce.jpg',
  chicken_w_garlic_sauce_combo: 'images/chinesemenu/chicken_w_garlic_sauce_combo_Shrimp_w_Broccoli_combo.jpg',
  chicken_w_string_bean_black_bean_sauce: 'images/chinesemenu/home_style_bean_curd_Mixed_Vegetabless.jpg',
  chicken_w_vegetable_soup: 'images/chinesemenu/chow_san_shiu_Steamed_Shrimp_w_Mixed_Vegetables.jpg',
  chicken_yat_w_vegetables: 'images/chinesemenu/chicken_w_mixed_vegeteables_Curry_Chicken.jpg',
  curry_shrimp_with_onion: 'images/chinesemenu/chicken_w_mixed_vegeteables_Curry_Chicken.jpg',
  dannys_special: 'images/chinesemenu/party_tray_buffalo_wings.jpg',
  fried_chicken_gizzards: 'images/chinesemenu/fried_chicken_wings_w_fried_rice_Fried_Crab_Meat_Sticks_w_French_Fries.jpg',
  fried_chicken_tenders_4pcs: 'images/chinesemenu/fried_chicken_wings_w_fried_rice_Fried_Crab_Meat_Sticks_w_French_Fries.jpg',
  fried_chicken_wings_4pcs: 'images/chinesemenu/fried_chicken_wings_w_fried_rice_Fried_Crab_Meat_Sticks_w_French_Fries.jpg',
  fried_crab_rangoon_10: 'images/chinesemenu/cheese_wonton_B-B-Q-Spare_Ribs.jpg',
  fried_crab_sticks_4pcs: 'images/chinesemenu/fried_chicken_wings_w_fried_rice_Fried_Crab_Meat_Sticks_w_French_Fries.jpg',
  fried_fish_2pcs: 'images/chinesemenu/fried_jumbo_shrimp_w_fried_rice_Fried_Baby_Shrimp_w_French_Fries.jpg',
  fried_jumbo_shrimp_5pcs: 'images/chinesemenu/fried_jumbo_shrimp_w_fried_rice_Fried_Baby_Shrimp_w_French_Fries.jpg',
  fried_pork_wonton_10: 'images/chinesemenu/cheese_wonton_B-B-Q-Spare_Ribs.jpg',
  fried_scallops_10pcs: 'images/chinesemenu/b-b-q_spare_rib_tips_w_fried_rice_Fried_Scallop_w_French_Fries.jpg',
  fried_shrimp_basket_15pc: 'images/chinesemenu/fried_jumbo_shrimp_w_fried_rice_Fried_Baby_Shrimp_w_French_Fries.jpg',
  fried_tofu_in_japanese_style: 'images/chinesemenu/home_style_bean_curd_Mixed_Vegetabless.jpg',
  fried_steamed_dumpling_8: 'images/chinesemenu/chicken_chow_mein_combo_Roast_Pork_Egg_Foo_Young_Combo.jpg',
  fried_steamed_pork_dumplings_8: 'images/chinesemenu/pork_fried_rice_Beef_Fried_Rice.jpg',
  fried_steamed_shrimp_dumpling_8: 'images/chinesemenu/chow_san_shiu_Steamed_Shrimp_w_Mixed_Vegetables.jpg',
  french_fries: 'images/chinesemenu/b-b-q_spare_rib_tips_w_fried_rice_Fried_Scallop_w_French_Fries.jpg',
  general_taos_tofu: 'images/chinesemenu/beef_w_scallop_General_Tso_Chicken.jpg',
  general_tsos_tofu: 'images/chinesemenu/beef_w_scallop_General_Tso_Chicken.jpg',
  general_tsos_shrimp: 'images/chinesemenu/party_tray_gerenral_tso_chicken.jpg',
  gyoza_8: 'images/chinesemenu/chicken_chow_mein_combo_Roast_Pork_Egg_Foo_Young_Combo.jpg',
  home_style_tofu: 'images/chinesemenu/home_style_bean_curd_Mixed_Vegetabless.jpg',
  house_fried_rice: 'images/chinesemenu/house_special_fried_rice_Shrimp_Fried_Rice.jpg',
  hunan_triple_crown: 'images/chinesemenu/hunan_beef_Shredded_Beef_Szechuan_Style.jpg',
  pan_fried_wonton_w_garlic_sauce: 'images/chinesemenu/chicken_w_garlic_sauce_combo_Shrimp_w_Broccoli_combo.jpg',
  pepper_steak_w_onion_combo: 'images/chinesemenu/moo_goo_gai_pan_combo_Pepper_Steak_w_Onion_Combo.jpg',
  phoenix_and_dragon: 'images/chinesemenu/seafood_combination_Happy_Family.jpg',
  pineapple_fried_rice: 'images/chinesemenu/house_special_fried_rice_Shrimp_Fried_Rice.jpg',
  plain_fried_rice_no_veggie: 'images/chinesemenu/party_tray_fried_rice.jpg',
  plain_yat_w_onion: 'images/chinesemenu/moo_goo_gai_pan_combo_Pepper_Steak_w_Onion_Combo.jpg',
  pork_fried_rice: 'images/chinesemenu/pork_fried_rice_Beef_Fried_Rice.jpg',
  pork_yat_w_onion: 'images/chinesemenu/moo_goo_gai_pan_combo_Pepper_Steak_w_Onion_Combo.jpg',
  seafood_soup: 'images/chinesemenu/seafood_combination_Happy_Family.jpg',
  shrimp_teriyaki_on_stick_4: 'images/chinesemenu/party_tray_shrimp_lo_mein.jpg',
  shrimp_with_black_bean_sauce: 'images/chinesemenu/chow_san_shiu_Steamed_Shrimp_w_Mixed_Vegetables.jpg',
  shrimp_w_cashew_nuts: 'images/chinesemenu/shrimp_szechuan_shrimp_Shrimp_w_Garlic_Sauce.jpg',
  shrimp_w_mixed_veg: 'images/chinesemenu/shrimp_w_mixed_Vegetable_Shrimp_w_Snow_Pea.jpg',
  shrimp_yat_w_vegetables: 'images/chinesemenu/chow_san_shiu_Steamed_Shrimp_w_Mixed_Vegetables.jpg',
  spare_rib_tips_pt: 'images/chinesemenu/b-b-q_spare_rib_tips_w_fried_rice_Fried_Scallop_w_French_Fries.jpg',
  spring_roll_3: 'images/chinesemenu/party_tray_spring_roll.jpg',
  steak_egg_roll: 'images/chinesemenu/fried_onion_rings_Egg_Roll.jpg',
  teriyaki_chicken_and_noodle: 'images/chinesemenu/chicken_lo_mein_Beef_Lo_Mein.jpg',
  vegetable_egg_roll_1: 'images/chinesemenu/fried_onion_rings_Egg_Roll.jpg',
  vegetable_fried_rice: 'images/chinesemenu/party_tray_vegetable_lo_mein.jpg',
  vegetable_mei_fun_ho_fun_no_egg: 'images/chinesemenu/party_tray_vegetable_lo_mein.jpg',
  white_rice: 'images/chinesemenu/party_tray_fried_rice.jpg',
  yang_chow_fried_rice: 'images/chinesemenu/house_special_fried_rice_Shrimp_Fried_Rice.jpg',
  fried_chicken_wings_w_fried_rice: 'images/chinesemenu/fried_chicken_wings_w_fried_rice_Fried_Crab_Meat_Sticks_w_French_Fries.jpg',
  fried_crab_meat_sticks_w_french_fries: 'images/chinesemenu/fried_chicken_wings_w_fried_rice_Fried_Crab_Meat_Sticks_w_French_Fries.jpg',
  fried_scallop_w_french_fries: 'images/chinesemenu/b-b-q_spare_rib_tips_w_fried_rice_Fried_Scallop_w_French_Fries.jpg',
  shrimp_fried_rice: 'images/chinesemenu/house_special_fried_rice_Shrimp_Fried_Rice.jpg',
  house_special_soup: 'images/chinesemenu/hot_sour_soup_House_Special_Soup.jpg',
  shrimp_w_broccoli_combo: 'images/chinesemenu/chicken_w_garlic_sauce_combo_Shrimp_w_Broccoli_combo.jpg',
  chicken_w_garlic_sauce_combo: 'images/chinesemenu/chicken_w_garlic_sauce_combo_Shrimp_w_Broccoli_combo.jpg',
  '4_chicken_wings': 'images/chinesemenu/party_tray_chicken_wings.jpg',
  '8_chicken_wings': 'images/chinesemenu/party_tray_chicken_wings.jpg',
  '12_chicken_wings': 'images/chinesemenu/party_tray_chicken_wings.jpg',
  '16_chicken_wings': 'images/chinesemenu/party_tray_chicken_wings.jpg',
  '20_chicken_wings': 'images/chinesemenu/party_tray_chicken_wings.jpg',
  '12_wing_dings': 'images/chinesemenu/party_tray_chicken_wings.jpg',
  '20_wing_dings': 'images/chinesemenu/party_tray_chicken_wings.jpg',
  '30_wing_dings': 'images/chinesemenu/party_tray_chicken_wings.jpg',
  '50_wing_dings': 'images/chinesemenu/party_tray_chicken_wings.jpg',
  '100_wing_dings': 'images/chinesemenu/party_tray_chicken_wings.jpg',
};

function findImageForItem(name, id = null) {
  if (id) {
    const override = menuItemOverrides.get(id);
    if (override?.image) {
      return override.image;
    }
    const item = menuItemsById.get(id);
    if (item?.overrideImage) {
      return item.overrideImage;
    }
  }
  const key = sanitizeKey(name);
  if (manualImageMap[key]) {
    return manualImageMap[key];
  }
  const itemTokens = Array.from(new Set(extractTokens(name)));
  if (!itemTokens.length) {
    return null;
  }
  let bestMatch = null;
  imageEntries.forEach((entry) => {
    let shared = 0;
    itemTokens.forEach((token) => {
      if (entry.tokens.has(token)) {
        shared += 1;
      }
    });
    if (!shared) {
      return;
    }
    const coverage = shared / itemTokens.length;
    if (!bestMatch || coverage > bestMatch.coverage || (coverage === bestMatch.coverage && shared > bestMatch.shared)) {
      bestMatch = { src: entry.src, coverage, shared };
    }
  });
  if (bestMatch && bestMatch.coverage >= 0.5) {
    return bestMatch.src;
  }
  return null;
}

const categoryDescriptions = {
  american: 'Golden fried favourites, wings and ribs cooked the Danny\'s way.',
  appetizer: 'Shareable bites that kick off every meal with bold flavour.',
  soup: 'Comforting soups simmered with fresh vegetables and savoury broths.',
  'fried-rice': 'Classic wok-fried rice with your choice of protein or veggies.',
  'yat-gaw-mein': 'Noodle bowls loaded with protein and savoury broth.',
  seafood: 'Ocean-fresh shrimp and seafood sautéed with crisp vegetables.',
  beef: 'Tender beef stir fried with signature sauces and vegetables.',
  poultry: 'Chicken classics finished with our signature sauces.',
  'lo-mein': 'Soft noodles tossed in house sauce with fresh vegetables.',
  'mei-fun-ho-fun': 'Rice or flat noodles wok-seared with aromatics and spice.',
  'egg-foo-young': 'Fluffy egg patties smothered in rich brown gravy.',
  'vegetables-tofu': 'Vegetable-forward plates and tofu cooked to perfection.',
  'chef-signatures': 'Danny\'s specialities featuring bold flavours and combos.',
  'whole-wings': 'Whole wings fried until crispy on the outside and juicy inside.',
  'party-wing-dings': 'Party-sized wing dings, perfect for sharing.',
  'lunch-special': 'Midday value plates served with rice and classic sides.',
  'dinner-combo': 'Evening combos paired with rice and egg rolls.',
};

// Define the menu data.  Each category has a unique id, a name and a list
// of items.  Each item contains an id, a name, an optional description and
// a price in dollars.  When adding new items be sure to assign unique ids.
const DEFAULT_MENU_DATA = [
  {
    id: 'american',
    name: 'American Dishes',
    items: [
      { id: 'A1', name: 'Fried Chicken Wings (4pcs)', description: 'Four seasoned chicken wings fried until crispy and juicy.', price: 6.60 },
      { id: 'A2', name: 'Fried Fish (2pcs)', description: 'Two breaded white fish fillets fried golden with flaky centers.', price: 5.50 },
      { id: 'A3', name: 'Fried Jumbo Shrimp (5pcs)', description: 'Five jumbo shrimp in light batter fried crunchy and tender.', price: 5.90 },
      { id: 'A4', name: 'Fried Shrimp Basket (15pc)', description: 'Fifteen bite-size breaded shrimp fried crisp for sharing.', price: 6.00 },
      { id: 'A5', name: 'Fried Scallops (10pcs)', description: 'Ten breaded sea scallops fried until golden and sweet.', price: 5.50 },
      { id: 'A6', name: 'Fried Crab Sticks (4pcs)', description: 'Imitation crab sticks wrapped in batter and fried crisp.', price: 4.95 },
      { id: 'A7', name: 'BBQ Boneless Ribs', description: 'Slices of boneless pork ribs glazed in smoky-sweet barbecue sauce.', price: 7.95 },
      { id: 'A8', name: 'Spare Rib Tips (Pt)', description: 'Tender pork rib tips simmered in sweet barbecue sauce.', price: 6.00 },
      { id: 'A9', name: 'Fried Chicken Gizzards', description: 'Seasoned chicken gizzards battered and fried for a crunchy bite.', price: 5.00 },
      { id: 'A10', name: 'Fried Chicken Tenders (4pcs)', description: 'Four strips of marinated chicken breast breaded and fried.', price: 5.50 },
      { id: 'A11', name: 'Shrimp Teriyaki on Stick (4)', description: 'Skewered shrimp brushed with teriyaki glaze and grilled.', price: 6.00 },
      { id: 'A13', name: 'Chicken Teriyaki on Stick (4)', description: 'Chicken skewers lacquered with sweet soy teriyaki sauce.', price: 6.00 },
      { id: 'A14', name: 'French Fries', description: 'Thick-cut potatoes fried golden and lightly salted.', price: 2.75 },
      { id: 'A15', name: 'BBQ Ribs', description: 'Bone-in pork ribs slow-cooked and coated in tangy barbecue sauce.', price: 8.25 },
    ],
  },
  {
    id: 'appetizer',
    name: 'Appetizer',
    items: [
      { id: 'AP1', name: 'Steak Egg Roll', description: 'Crispy egg roll stuffed with seasoned beef, cabbage, and carrots.', price: 2.35 },
      { id: 'AP2', name: 'Vegetable Egg Roll (1)', description: 'Fried roll filled with shredded cabbage, carrots, and glass noodles.', price: 1.85 },
      { id: 'AP3', name: 'Shrimp Egg Roll (1)', description: 'Egg roll packed with shrimp, cabbage, and aromatics.', price: 2.00 },
      { id: 'AP4', name: 'Spring Roll (3)', description: 'Trio of thin-crust rolls filled with vegetables and fried crisp.', price: 3.25 },
      { id: 'AP5', name: 'Fried Crab Rangoon (10)', description: 'Crispy wontons stuffed with creamy crab and scallion filling.', price: 7.25 },
      { id: 'AP6', name: 'Fried Pork Wonton (10)', description: 'Wonton wrappers filled with pork mince and fried golden.', price: 6.50 },
      { id: 'AP7', name: 'Pan Fried Wonton w. Garlic Sauce', description: 'Pan-seared pork wontons served with spicy garlic sauce.', price: 7.25 },
      { id: 'AP8', name: 'Gyoza (8)', description: 'Japanese-style dumplings with pork and vegetables, pan-seared then steamed.', price: 8.75 },
      { id: 'AP9', name: 'Fried/Steamed Dumpling (8)', description: 'Eight dumplings filled with minced meat and cabbage, fried or steamed.', price: 8.25 },
      { id: 'AP10', name: 'Fried/Steamed Shrimp Dumpling (8)', description: 'Shrimp-filled dumplings offered fried or steamed.', price: 8.25 },
      { id: 'AP11', name: 'Fried/Steamed Pork Dumplings (8)', description: 'Savory pork dumplings cooked fried or steamed.', price: 7.25 },
      { id: 'AP12', name: 'Pizza Roll', description: 'Crispy roll stuffed with mozzarella, pepperoni, and tangy sauce.', price: 1.85 },
    ],
  },
  {
    id: 'soup',
    name: 'Soup',
    items: [
      { id: 'S13', name: 'Wonton Soup', description: 'Chicken broth with pork wontons, scallions, and greens.', price: 5.90 },
      { id: 'S13b', name: 'Egg Drop Soup', description: 'Silky chicken broth ribboned with beaten egg and scallion.', price: 5.90 },
      { id: 'S14', name: 'Chicken Noodle Soup', description: 'Light broth with chicken, egg noodles, and vegetables.', price: 5.90 },
      { id: 'S14b', name: 'Chicken Rice Soup', description: 'Savory broth with diced chicken, rice, and vegetables.', price: 5.90 },
      { id: 'S15', name: 'House Special Soup', description: 'Loaded soup with shrimp, chicken, pork, and mixed vegetables in broth.', price: 7.25 },
      { id: 'S16', name: 'Hot & Sour Soup', description: 'Spicy-tangy broth with tofu, bamboo shoots, and mushrooms.', price: 5.95 },
      { id: 'S17', name: 'Chicken w. Vegetable Soup', description: 'Clear broth filled with chicken slices and mixed vegetables.', price: 5.75 },
      { id: 'S18', name: 'Seafood Soup', description: 'Brimming with shrimp, scallops, and vegetables in a savory broth.', price: 7.75 },
      { id: 'S19', name: 'Chicken Broth', description: 'Simple seasoned chicken stock perfect as a light starter.', price: 2.75 },
    ],
  },
  {
    id: 'fried-rice',
    name: 'Fried Rice',
    items: [
      { id: 'FR20', name: 'White Rice', description: 'Steamed long-grain white rice cooked fluffy.', price: 2.25 },
      { id: 'FR21', name: 'Brown Rice (No Veggie)', description: 'Steamed whole-grain brown rice without vegetables.', price: 2.25 },
      { id: 'FR22', name: 'Plain Fried Rice (No Veggie)', description: 'Wok-fried rice with egg and scallion, no vegetables.', price: 3.50 },
      { id: 'FR23', name: 'Vegetable Fried Rice', description: 'Stir-fried rice with egg, carrots, peas, and scallions.', price: 5.75 },
      { id: 'FR24', name: 'Chicken Fried Rice', description: 'Fried rice tossed with diced chicken, egg, and vegetables.', price: 5.95 },
      { id: 'FR24b', name: 'Pork Fried Rice', description: 'Wok-fried rice with roast pork, egg, peas, and carrots.', price: 5.95 },
      { id: 'FR25', name: 'Beef Fried Rice', description: 'Savory fried rice mixed with sliced beef, egg, and vegetables.', price: 6.95 },
      { id: 'FR26', name: 'Shrimp Fried Rice', description: 'Fried rice studded with shrimp, egg, and vegetables.', price: 6.25 },
      { id: 'FR27', name: 'House Fried Rice', description: 'Combination fried rice with shrimp, chicken, pork, egg, and veggies.', price: 6.50 },
      { id: 'FR28', name: 'Yang Chow Fried Rice', description: 'Cantonese-style fried rice with shrimp, roast pork, peas, and egg.', price: 6.75 },
      { id: 'FR29', name: 'Pineapple Fried Rice', description: 'Fried rice tossed with pineapple, shrimp, ham, and veggies.', price: 6.75 },
    ],
  },
  {
    id: 'yat-gaw-mein',
    name: 'Yat Gaw Mein',
    items: [
      { id: 'Y30', name: 'Pork Yat (w. Onion)', description: 'Wheat noodles in savory broth topped with pork slices and onion.', price: 6.45 },
      { id: 'Y31', name: 'Chicken Yat (w. Vegetables)', description: 'Noodle soup with chicken, greens, and rich broth.', price: 6.45 },
      { id: 'Y32', name: 'Shrimp Yat (w. Vegetables)', description: 'Brothy noodles crowned with shrimp and mixed vegetables.', price: 6.95 },
      { id: 'Y33', name: 'Beef Yat (w. Vegetables)', description: 'Tender beef over noodles in aromatic broth with vegetables.', price: 6.95 },
      { id: 'Y34', name: 'Plain Yat (w. Onion)', description: 'Yat gaw mein noodles in broth with scallion and onion.', price: 5.50 },
    ],
  },
  {
    id: 'seafood',
    name: 'Seafood',
    items: [
      { id: 'SF35', name: 'Shrimp w. Broccoli', description: 'Large shrimp stir-fried with crisp broccoli in light garlic sauce.', price: 11.95 },
      { id: 'SF36', name: 'Shrimp w. Mixed Veg', description: 'Shrimp tossed with assorted vegetables in savory sauce.', price: 11.95 },
      { id: 'SF37', name: 'Curry Shrimp with Onion', description: 'Shrimp simmered with onions in fragrant curry sauce.', price: 11.95 },
      { id: 'SF38', name: 'Shrimp in Szechuan Style', description: 'Shrimp cooked with peppers in spicy Szechuan chili sauce.', price: 11.95 },
      { id: 'SF39', name: 'Shrimp in Hunan Style', description: 'Shrimp stir-fried with vegetables in hot Hunan brown sauce.', price: 11.95 },
      { id: 'SF40', name: 'Shrimp w. Cashew Nuts', description: 'Shrimp and cashews tossed with celery and peppers in light sauce.', price: 11.95 },
      { id: 'SF41', name: 'Kung Pao Shrimp', description: 'Shrimp, peanuts, and chili peppers in spicy-sweet Kung Pao sauce.', price: 11.95 },
      { id: 'SF42', name: 'Shrimp w. Garlic Sauce', description: 'Shrimp sautéed with veggies in spicy garlic sauce.', price: 11.95 },
      { id: 'SF43', name: 'Shrimp w. Lobster Sauce', description: 'Shrimp in silky garlic lobster sauce with egg and peas.', price: 11.95 },
    ],
  },
  {
    id: 'beef',
    name: 'Beef',
    items: [
      { id: 'B44', name: 'Beef w. Broccoli', description: 'Sliced beef with broccoli florets in brown garlic sauce.', price: 11.95 },
      { id: 'B45', name: 'Pepper Steak with Onion', description: 'Beef strips stir-fried with bell peppers and onions.', price: 11.95 },
      { id: 'B46', name: 'Beef w. Mixed Vegs', description: 'Beef tossed with broccoli, carrots, and snow peas in savory sauce.', price: 11.95 },
      { id: 'B47', name: 'Beef in Szechuan Style', description: 'Beef with vegetables in spicy Szechuan chili sauce.', price: 11.95 },
      { id: 'B48', name: 'Beef in Hunan Style', description: 'Beef simmered with vegetables in bold Hunan brown sauce.', price: 11.95 },
      { id: 'B49', name: 'Beef in Garlic Sauce', description: 'Beef and vegetables in spicy garlic-infused sauce.', price: 11.95 },
    ],
  },
  {
    id: 'poultry',
    name: 'Poultry',
    items: [
      { id: 'P50', name: 'Sweet & Sour Chicken', description: 'Battered chicken pieces with peppers, pineapple, and tangy sauce.', price: 11.95 },
      { id: 'P51', name: 'Chicken w. Broccoli', description: 'Chicken breast and broccoli in light garlic brown sauce.', price: 11.95 },
      { id: 'P52', name: 'Chicken w. Mixed Vegetables', description: 'Chicken with assorted vegetables in savory sauce.', price: 11.95 },
      { id: 'P53', name: 'Curry Chicken w. Onions', description: 'Chicken simmered with onions in fragrant curry sauce.', price: 11.95 },
      { id: 'P54', name: 'Kung Pao Chicken', description: 'Chicken stir-fried with peanuts, chili peppers, and vegetables.', price: 11.95 },
      { id: 'P55', name: 'Chicken w. Cashew Nuts', description: 'Chicken, cashews, and vegetables in light brown sauce.', price: 11.95 },
      { id: 'P56', name: 'Chicken in Garlic Sauce', description: 'Chicken with veggies coated in spicy garlic sauce.', price: 11.95 },
      { id: 'P57', name: 'Chicken in Szechuan Style', description: 'Chicken and vegetables tossed in fiery Szechuan sauce.', price: 11.95 },
      { id: 'P58', name: 'Chicken in Hunan Style', description: 'Chicken stir-fried with vegetables in spicy Hunan sauce.', price: 11.95 },
    ],
  },
  {
    id: 'lo-mein',
    name: 'Lo Mein',
    items: [
      { id: 'L67', name: 'Chicken Lo Mein', description: 'Soft egg noodles tossed with chicken, vegetables, and house sauce.', price: 8.75 },
      { id: 'L68', name: 'Pork Lo Mein', description: 'Lo mein noodles mixed with roast pork and vegetables.', price: 8.75 },
      { id: 'L69', name: 'Shrimp Lo Mein', description: 'Noodles stir-fried with shrimp, cabbage, and carrots.', price: 9.50 },
      { id: 'L70', name: 'Beef Lo Mein', description: 'Lo mein noodles with beef strips and mixed vegetables.', price: 9.50 },
      { id: 'L71', name: 'House Special Lo Mein', description: 'Combination noodles with shrimp, chicken, pork, and vegetables.', price: 10.25 },
      { id: 'L72', name: 'Vegetable Lo Mein', description: 'Lo mein tossed with broccoli, carrots, and cabbage.', price: 8.25 },
      { id: 'L73', name: 'Plain Lo Mein (No Veggie)', description: 'Noodles stir-fried in savory sauce without vegetables.', price: 7.95 },
    ],
  },
  {
    id: 'mei-fun-ho-fun',
    name: 'Mei Fun / Ho Fun',
    items: [
      { id: 'M74', name: 'Chicken Mei Fun / Ho Fun', description: 'Thin rice or wide noodles with chicken and vegetables.', price: 9.50 },
      { id: 'M75', name: 'Pork Mei Fun / Ho Fun', description: 'Rice or flat noodles stir-fried with pork and vegetables.', price: 9.50 },
      { id: 'M76', name: 'Shrimp Mei Fun / Ho Fun', description: 'Noodles tossed with shrimp, bean sprouts, and scallions.', price: 9.75 },
      { id: 'M77', name: 'Beef Mei Fun / Ho Fun', description: 'Rice noodles with beef strips and mixed vegetables.', price: 9.75 },
      { id: 'M78', name: 'Singapore Mei Fun / Ho Fun', description: 'Curried rice noodles with shrimp, pork, egg, and vegetables.', price: 10.50 },
      { id: 'M79', name: 'Vegetable Mei Fun / Ho Fun (No Egg)', description: 'Rice noodles with assorted vegetables in light sauce.', price: 8.25 },
    ],
  },
  {
    id: 'egg-foo-young',
    name: 'Egg Foo Young',
    items: [
      { id: 'EF80', name: 'Chicken Egg Foo Young', description: 'Egg patties filled with chicken and vegetables under brown gravy.', price: 8.25 },
      { id: 'EF81', name: 'Pork Egg Foo Young', description: 'Fluffy omelets with pork, bean sprouts, and gravy.', price: 8.25 },
      { id: 'EF82', name: 'Shrimp Egg Foo Young', description: 'Egg patties stuffed with shrimp and vegetables topped with gravy.', price: 8.75 },
      { id: 'EF83', name: 'Beef Egg Foo Young', description: 'Savory omelets with beef, onions, and brown gravy.', price: 8.75 },
      { id: 'EF84', name: 'Vegetable Egg Foo Young', description: 'Egg patties packed with mixed vegetables and gravy.', price: 8.25 },
      { id: 'EF85', name: 'Plain Egg Foo Young', description: 'Classic egg foo young patties served with brown gravy.', price: 8.75 },
      { id: 'EF86', name: 'House Egg Foo Young', description: 'Combination egg patties with shrimp, chicken, pork, and vegetables.', price: 8.95 },
    ],
  },
  {
    id: 'vegetables-tofu',
    name: 'Vegetables & Tofu',
    items: [
      { id: 'VT59', name: 'Mixed Vegetables', description: 'Assorted seasonal vegetables stir-fried in light sauce.', price: 8.30 },
      { id: 'VT60', name: 'Plain Broccoli', description: 'Steamed broccoli florets served simply with a touch of garlic.', price: 8.30 },
      { id: 'VT61', name: 'Ma Po Tofu', description: 'Silken tofu with minced pork and spicy bean sauce.', price: 8.50 },
      { id: 'VT62', name: "General Tao's Tofu", description: 'Crispy tofu tossed in sweet and spicy General Tao sauce.', price: 8.50 },
      { id: 'VT63', name: 'Kung Pao Tofu', description: 'Tofu cubes with peanuts, chili peppers, and vegetables in Kung Pao sauce.', price: 8.95 },
      { id: 'VT64', name: 'Fried Tofu in Japanese Style', description: 'Crispy tofu served with light soy-dashi dressing.', price: 8.95 },
      { id: 'VT65', name: 'Sesame Tofu', description: 'Battered tofu glazed with sweet sesame sauce.', price: 8.95 },
      { id: 'VT66', name: 'Home Style Tofu', description: 'Tofu with vegetables braised in savory brown sauce.', price: 8.95 },
    ],
  },
  {
    id: 'chef-signatures',
    name: "Chef's Signatures",
    items: [
      { id: 'H1', name: "General Tso's Chicken", description: 'Crispy chicken chunks coated in sweet, spicy General Tso sauce.', price: 11.25 },
      { id: 'H2', name: 'Sesame Chicken', description: 'Battered chicken glazed with honeyed sesame sauce.', price: 11.25 },
      { id: 'H3', name: 'Bourbon Chicken', description: 'Tender chicken simmered in smoky bourbon-style glaze.', price: 11.25 },
      { id: 'H3b', name: 'Mongolian Beef', description: 'Sliced beef seared with scallions and onions in savory brown sauce.', price: 11.95 },
      { id: 'H4', name: 'Mongolian Chicken', description: 'Chicken strips wok-seared with scallions in Mongolian brown sauce.', price: 11.95 },
      { id: 'H5', name: 'Mongolia Jumbo Shrimp', description: 'Jumbo shrimp sautéed with onions and scallions in Mongolian sauce.', price: 11.95 },
      { id: 'H4b', name: "General Tso's Shrimp", description: 'Crispy shrimp tossed in spicy-sweet General Tso sauce.', price: 12.00 },
      { id: 'H6', name: 'Sesame Shrimp', description: 'Battered shrimp glazed with sesame-infused honey sauce.', price: 12.00 },
      { id: 'H7', name: 'Orange Flavored Chicken', description: 'Crispy chicken tossed in citrusy orange-chili sauce.', price: 11.25 },
      { id: 'H8', name: 'Sizzling Chicken', description: 'Chicken with peppers and onions served in sizzling brown sauce.', price: 11.75 },
      { id: 'H9', name: 'Teriyaki Chicken & Noodle', description: 'Grilled teriyaki chicken served over stir-fried noodles and vegetables.', price: 11.75 },
      { id: 'H10', name: 'Four Seasons', description: 'Shrimp, chicken, beef, and pork with mixed vegetables in brown sauce.', price: 13.50 },
      { id: 'H11', name: 'Phoenix & Dragon', description: 'Shrimp and chicken sautéed with vegetables in spicy sauce.', price: 13.50 },
      { id: 'H12', name: 'Pineapple Chicken in Bowl', description: 'Chicken, bell peppers, and pineapple in tangy sweet sauce over rice.', price: 11.50 },
      { id: 'H13', name: 'Seafood Combination', description: 'Shrimp, scallops, and crab with vegetables in savory sauce.', price: 14.50 },
      { id: 'H14', name: 'Happy Family', description: 'Shrimp, beef, chicken, and pork with vegetables in brown sauce.', price: 13.50 },
      { id: 'H15', name: 'Hunan Triple Crown', description: 'Chicken, beef, and shrimp stir-fried with vegetables in hot Hunan sauce.', price: 13.50 },
      { id: 'H16', name: "Danny's Special", description: 'Chef\'s mix of shrimp, chicken, and roast pork with vegetables in house sauce.', price: 12.50 },
    ],
  },
  {
    id: 'whole-wings',
    name: 'Whole Wings',
    items: [
      { id: 'W4', name: '4 Chicken Wings', description: 'Four whole chicken wings fried crisp and seasoned.', price: 6.60 },
      { id: 'W8', name: '8 Chicken Wings', description: 'Eight whole wings fried to order with a crunchy coating.', price: 13.20 },
      { id: 'W12', name: '12 Chicken Wings', description: 'A dozen whole wings fried golden and juicy.', price: 19.80 },
      { id: 'W16', name: '16 Chicken Wings', description: 'Sixteen crispy whole wings perfect for sharing.', price: 26.40 },
      { id: 'W20', name: '20 Chicken Wings', description: 'Twenty whole wings fried crisp with house seasoning.', price: 33.00 },
    ],
  },
  {
    id: 'party-wing-dings',
    name: 'Party Wing Dings',
    items: [
      { id: 'PD12', name: '12 Wing Dings', description: 'Twelve breaded wing pieces fried crunchy.', price: 9.85 },
      { id: 'PD20', name: '20 Wing Dings', description: 'Twenty wing dings fried crisp for snacking.', price: 16.40 },
      { id: 'PD30', name: '30 Wing Dings', description: 'Thirty bite-size wing sections fried golden.', price: 24.60 },
      { id: 'PD50', name: '50 Wing Dings', description: 'Fifty crispy wing dings ideal for gatherings.', price: 41.00 },
      { id: 'PD100', name: '100 Wing Dings', description: 'One hundred seasoned wing dings fried to a crunch.', price: 82.00 },
    ],
  },
  {
    id: 'lunch-special',
    name: 'Lunch Special',
    items: [
      { id: 'L1', name: 'Chicken Broccoli', description: 'Sliced chicken with broccoli in light brown garlic sauce.', price: 7.85 },
      { id: 'L2', name: 'Chicken w. Black Pepper Sauce', description: 'Chicken stir-fried in bold black pepper sauce with onions and peppers.', price: 7.85 },
      { id: 'L3', name: 'Chicken Mushroom', description: 'Chicken breast sautéed with button mushrooms in savory sauce.', price: 7.85 },
      { id: 'L4', name: 'Chicken Bean Curd Black Pepper Sauce', description: 'Chicken and tofu cubes in zesty black pepper sauce.', price: 7.85 },
      { id: 'L5', name: 'Chicken Lo Mein', description: 'Soft egg noodles tossed with chicken, vegetables, and house sauce.', price: 7.85 },
      { id: 'L6', name: 'Curry Chicken', description: 'Tender chicken simmered in aromatic yellow curry sauce with vegetables.', price: 7.85 },
      { id: 'L7', name: 'Chicken Egg Foo Young', description: 'Egg patties filled with chicken and vegetables under brown gravy.', price: 7.85 },
      { id: 'L8', name: 'Chicken w. String Bean Black Bean Sauce', description: 'Chicken stir-fried with string beans in fermented black bean sauce.', price: 7.85 },
      { id: 'L9', name: 'Sweet & Sour Chicken', description: 'Battered chicken pieces with peppers, pineapple, and tangy sauce.', price: 7.85 },
      { id: 'L10', name: 'Roast Pork Broccoli', description: 'Roast pork slices tossed with broccoli in brown garlic sauce.', price: 7.85 },
      { id: 'L11', name: 'Roast Pork Oyster Sauce', description: 'Roast pork and vegetables finished with savory oyster sauce.', price: 7.85 },
      { id: 'L12', name: 'Roast Pork Mushroom', description: 'Roast pork sautéed with mushrooms in brown sauce.', price: 7.85 },
      { id: 'L13', name: 'Roast Pork with Black Pepper Sauce', description: 'Roast pork strips in spicy black pepper gravy with onions.', price: 7.85 },
      { id: 'L14', name: 'Hunan Chicken', description: 'Chicken and vegetables cooked in hot Hunan chili sauce.', price: 7.85 },
      { id: 'L15', name: 'Szechuan Chicken', description: 'Chicken stir-fried with vegetables in fiery Szechuan pepper sauce.', price: 7.85 },
      { id: 'L16', name: 'Kung Pao Chicken', description: 'Chicken stir-fried with peanuts, chili peppers, and vegetables.', price: 7.85 },
      { id: 'L17', name: 'Mongolian Beef', description: 'Sliced beef seared with scallions and onions in savory brown sauce.', price: 7.85 },
        { id: 'L18', name: 'Chicken w. Garlic Sauce', description: 'Chicken and mixed vegetables coated in spicy garlic sauce.', price: 7.85 },
      { id: 'L19', name: "General Tso's Chicken", description: 'Crispy chicken chunks coated in sweet, spicy General Tso sauce.', price: 7.85 },
      { id: 'L20', name: "General Tso's Tofu", description: 'Crispy tofu tossed in sweet, spicy General Tso sauce.', price: 7.85 },
      { id: 'L21', name: 'Sesame Chicken', description: 'Battered chicken glazed with honeyed sesame sauce.', price: 7.85 },
      { id: 'L22', name: 'Chicken w. Cashew Nuts', description: 'Chicken, cashews, and vegetables in light brown sauce.', price: 7.85 },
      { id: 'L23', name: 'Beef Broccoli', description: 'Beef slices and broccoli in savory brown sauce.', price: 7.85 },
      { id: 'L24', name: 'Pepper Steak', description: 'Beef strips with bell peppers and onions in brown sauce.', price: 7.85 },
      { id: 'L25', name: 'Beef String Bean Black Bean Sauce', description: 'Beef sautéed with string beans in fermented black bean sauce.', price: 7.85 },
      { id: 'L26', name: 'Beef with Mushroom', description: 'Beef slices cooked with mushrooms in rich brown gravy.', price: 7.85 },
      { id: 'L27', name: 'Beef with Oyster Sauce', description: 'Beef and vegetables finished with savory oyster sauce.', price: 7.85 },
      { id: 'L28', name: 'Beef Bean Curd with Black Pepper Sauce', description: 'Beef and tofu in pungent black pepper sauce.', price: 7.85 },
      { id: 'L29', name: 'Shrimp Broccoli', description: 'Shrimp stir-fried with broccoli in garlic brown sauce.', price: 7.85 },
      { id: 'L30', name: 'Shrimp Mushroom', description: 'Shrimp cooked with mushrooms in savory brown sauce.', price: 7.85 },
      { id: 'L31', name: 'Shrimp Oyster Sauce', description: 'Shrimp and vegetables glazed with oyster sauce.', price: 7.85 },
      { id: 'L32', name: 'Shrimp with Black Bean Sauce', description: 'Shrimp stir-fried with peppers in fermented black bean sauce.', price: 7.85 },
    ],
  },
  {
    id: 'dinner-combo',
    name: 'Dinner Combo',
    items: [
      { id: 'D1', name: 'Chicken Broccoli', description: 'Sliced chicken with broccoli in light brown garlic sauce.', price: 9.50 },
      { id: 'D2', name: 'Chicken w. Black Pepper Sauce', description: 'Chicken stir-fried in bold black pepper sauce with onions and peppers.', price: 9.50 },
      { id: 'D3', name: 'Chicken Mushroom', description: 'Chicken breast sautéed with button mushrooms in savory sauce.', price: 9.50 },
      { id: 'D4', name: 'Chicken Bean Curd Black Pepper Sauce', description: 'Chicken and tofu cubes in zesty black pepper sauce.', price: 9.50 },
      { id: 'D5', name: 'Chicken Lo Mein', description: 'Soft egg noodles tossed with chicken, vegetables, and house sauce.', price: 9.50 },
      { id: 'D6', name: 'Curry Chicken', description: 'Tender chicken simmered in aromatic yellow curry sauce with vegetables.', price: 9.50 },
      { id: 'D7', name: 'Chicken Egg Foo Young', description: 'Egg patties filled with chicken and vegetables under brown gravy.', price: 9.50 },
      { id: 'D8', name: 'Chicken w. String Bean Black Bean Sauce', description: 'Chicken stir-fried with string beans in fermented black bean sauce.', price: 9.50 },
      { id: 'D9', name: 'Sweet & Sour Chicken', description: 'Battered chicken pieces with peppers, pineapple, and tangy sauce.', price: 9.50 },
      { id: 'D10', name: 'Roast Pork Broccoli', description: 'Roast pork slices tossed with broccoli in brown garlic sauce.', price: 9.50 },
      { id: 'D11', name: 'Roast Pork Oyster Sauce', description: 'Roast pork and vegetables finished with savory oyster sauce.', price: 9.50 },
      { id: 'D12', name: 'Roast Pork Mushroom', description: 'Roast pork sautéed with mushrooms in brown sauce.', price: 9.50 },
      { id: 'D13', name: 'Roast Pork with Black Pepper Sauce', description: 'Roast pork strips in spicy black pepper gravy with onions.', price: 9.50 },
      { id: 'D14', name: 'Hunan Chicken', description: 'Chicken and vegetables cooked in hot Hunan chili sauce.', price: 9.50 },
      { id: 'D15', name: 'Szechuan Chicken', description: 'Chicken stir-fried with vegetables in fiery Szechuan pepper sauce.', price: 9.50 },
      { id: 'D16', name: 'Kung Pao Chicken', description: 'Chicken stir-fried with peanuts, chili peppers, and vegetables.', price: 9.50 },
      { id: 'D17', name: 'Mongolian Beef', description: 'Sliced beef seared with scallions and onions in savory brown sauce.', price: 9.50 },
        { id: 'D18', name: 'Chicken w. Garlic Sauce', description: 'Chicken and mixed vegetables coated in spicy garlic sauce.', price: 9.50 },
      { id: 'D19', name: "General Tso's Chicken", description: 'Crispy chicken chunks coated in sweet, spicy General Tso sauce.', price: 9.50 },
      { id: 'D20', name: "General Tso's Tofu", description: 'Crispy tofu tossed in sweet, spicy General Tso sauce.', price: 9.50 },
      { id: 'D21', name: 'Sesame Chicken', description: 'Battered chicken glazed with honeyed sesame sauce.', price: 9.50 },
      { id: 'D22', name: 'Chicken w. Cashew Nuts', description: 'Chicken, cashews, and vegetables in light brown sauce.', price: 9.50 },
      { id: 'D23', name: 'Beef Broccoli', description: 'Beef slices and broccoli in savory brown sauce.', price: 9.50 },
      { id: 'D24', name: 'Pepper Steak', description: 'Beef strips with bell peppers and onions in brown sauce.', price: 9.50 },
      { id: 'D25', name: 'Beef String Bean Black Bean Sauce', description: 'Beef sautéed with string beans in fermented black bean sauce.', price: 9.50 },
      { id: 'D26', name: 'Beef with Mushroom', description: 'Beef slices cooked with mushrooms in rich brown gravy.', price: 9.50 },
      { id: 'D27', name: 'Beef with Oyster Sauce', description: 'Beef and vegetables finished with savory oyster sauce.', price: 9.50 },
      { id: 'D28', name: 'Beef Bean Curd with Black Pepper Sauce', description: 'Beef and tofu in pungent black pepper sauce.', price: 9.50 },
      { id: 'D29', name: 'Shrimp Broccoli', description: 'Shrimp stir-fried with broccoli in garlic brown sauce.', price: 9.50 },
      { id: 'D30', name: 'Shrimp Mushroom', description: 'Shrimp cooked with mushrooms in savory brown sauce.', price: 9.50 },
      { id: 'D31', name: 'Shrimp Oyster Sauce', description: 'Shrimp and vegetables glazed with oyster sauce.', price: 9.50 },
      { id: 'D32', name: 'Shrimp with Black Bean Sauce', description: 'Shrimp stir-fried with peppers in fermented black bean sauce.', price: 9.50 },
    ],
  },
];

const menuItemsById = new Map();
const menuItemOverrides = new Map();
let menuData = [];
let menuDataLoaded = false;
let menuDataPromise = null;

function normalizeMenuData(data) {
  if (!Array.isArray(data)) {
    return [];
  }
  return data.map((category) => ({
    ...category,
    items: Array.isArray(category?.items)
      ? category.items.map((item) => {
          const copy = { ...item };
          const parsedPrice = Number(copy.price);
          const normalizedPrice = Number.isFinite(parsedPrice) ? Math.round(parsedPrice * 100) / 100 : 0;
          copy.basePrice = normalizedPrice;
          copy.price = normalizedPrice;
          return copy;
        })
      : [],
  }));
}

function refreshMenuItemsIndex() {
  menuItemsById.clear();
  menuData.forEach((category) => {
    if (!Array.isArray(category.items)) {
      return;
    }
    category.items.forEach((item) => {
      if (!item || typeof item !== 'object' || !item.id) {
        return;
      }
      const basePrice = Number.isFinite(item.basePrice) ? item.basePrice : Number(item.price);
      item.basePrice = Number.isFinite(basePrice) ? Math.round(basePrice * 100) / 100 : 0;
      item.price = item.basePrice;
      const override = menuItemOverrides.get(item.id);
      if (override) {
        if (typeof override.price === 'number' && override.price > 0) {
          item.price = Math.round(override.price * 100) / 100;
        }
        if (override.image) {
          item.overrideImage = override.image;
        } else {
          delete item.overrideImage;
        }
      } else {
        delete item.overrideImage;
      }
      if (!menuItemsById.has(item.id)) {
        menuItemsById.set(item.id, item);
      }
    });
  });
}

function setMenuDataFromSource(source) {
  menuData = normalizeMenuData(source);
  refreshMenuItemsIndex();
}

function setMenuOverridesFromData(data) {
  menuItemOverrides.clear();
  if (data && data.items && typeof data.items === 'object') {
    Object.entries(data.items).forEach(([id, override]) => {
      if (!id || !override || typeof override !== 'object') {
        return;
      }
      const normalizedId = String(id).trim();
      if (!normalizedId) {
        return;
      }
      const entry = {};
      if (typeof override.price === 'number' && override.price > 0) {
        entry.price = Math.round(override.price * 100) / 100;
      }
      if (override.image && typeof override.image === 'string') {
        entry.image = override.image;
      }
      if (Object.keys(entry).length) {
        menuItemOverrides.set(normalizedId, entry);
      }
    });
  }
  if (menuData.length) {
    refreshMenuItemsIndex();
  }
}

async function fetchMenuDataFromApi() {
  try {
    const response = await fetch('data/menu-data.json', { cache: 'no-store' });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && data.length) {
        setMenuDataFromSource(data);
      }
    }
  } catch (error) {
    // Ignore fetch errors and fall back to the default menu data.
  }
  if (!menuData.length) {
    setMenuDataFromSource(DEFAULT_MENU_DATA);
  }
  try {
    const response = await fetch('/api/menu/overrides', { cache: 'no-store' });
    if (response.ok) {
      const overrides = await response.json();
      setMenuOverridesFromData(overrides);
    } else {
      setMenuOverridesFromData(null);
    }
  } catch (error) {
    setMenuOverridesFromData(null);
  }
  menuDataLoaded = true;
  return menuData;
}

function ensureMenuDataLoaded() {
  if (menuDataLoaded) {
    return Promise.resolve(menuData);
  }
  if (!menuDataPromise) {
    menuDataPromise = fetchMenuDataFromApi().finally(() => {
      menuDataPromise = null;
    });
  }
  return menuDataPromise;
}

function findMenuItemById(id) {
  return menuItemsById.get(id) || null;
}

function showQuickReorderMessage(card, message, tone = 'info') {
  if (!card) {
    return;
  }
  const feedback = card.querySelector('.quick-reorder__feedback');
  if (!feedback) {
    return;
  }
  feedback.textContent = message;
  feedback.hidden = false;
  feedback.classList.remove(
    'quick-reorder__feedback--success',
    'quick-reorder__feedback--warning',
  );
  if (tone === 'success') {
    feedback.classList.add('quick-reorder__feedback--success');
  } else if (tone === 'warning') {
    feedback.classList.add('quick-reorder__feedback--warning');
  }
}

function addOrderItemsToCart(order) {
  if (!order || !Array.isArray(order.items) || !order.items.length) {
    return { addedCount: 0, missing: [] };
  }
  let addedCount = 0;
  const missing = [];
  order.items.forEach((orderItem) => {
    if (!orderItem) {
      return;
    }
    const menuItem = findMenuItemById(orderItem.id);
    if (!menuItem) {
      const fallbackName = typeof orderItem.name === 'string' ? orderItem.name : null;
      if (fallbackName) {
        missing.push(fallbackName);
      }
      return;
    }
    const quantityNumber = Number.isFinite(orderItem.quantity)
      ? orderItem.quantity
      : Number(orderItem.quantity);
    const quantity = Number.isFinite(quantityNumber) && quantityNumber > 0
      ? Math.round(quantityNumber)
      : 1;
    if (cart[menuItem.id]) {
      cart[menuItem.id].quantity += quantity;
    } else {
      cart[menuItem.id] = {
        name: menuItem.name,
        price: menuItem.price,
        quantity,
        instructions: '',
      };
    }
    addedCount += quantity;
  });
  if (addedCount > 0) {
    updateCart();
    playCartSound();
    trackEvent('order_reordered', {
      source: 'quick_reorder',
      totalItems: addedCount,
      missingItems: missing.length,
      orderTimestamp: order.timestamp || null,
      fulfilment: order.fulfilment || null,
    });
  }
  return { addedCount, missing };
}

function toggleQuickReorderDetails(card, expanded) {
  if (!card) {
    return;
  }
  const detail = card.querySelector('.quick-reorder__details');
  const summaryButton = card.querySelector('.quick-reorder__summary');
  const detailsButton = card.querySelector('.quick-reorder__details-button');
  if (!detail) {
    return;
  }
  const nextExpanded = typeof expanded === 'boolean' ? expanded : detail.hidden;
  detail.hidden = !nextExpanded;
  if (summaryButton) {
    summaryButton.setAttribute('aria-expanded', String(nextExpanded));
  }
  if (detailsButton) {
    detailsButton.textContent = nextExpanded ? 'Hide details' : 'Details';
    detailsButton.setAttribute('aria-expanded', String(nextExpanded));
  }
}

function handleQuickReorderToggle(event) {
  const button = event.currentTarget;
  if (!button) {
    return;
  }
  const card = button.closest('.quick-reorder__card');
  if (!card) {
    return;
  }
  const detail = card.querySelector('.quick-reorder__details');
  const isExpanded = detail ? !detail.hidden : false;
  toggleQuickReorderDetails(card, !isExpanded);
}

function handleQuickReorderReorder(event) {
  const button = event.currentTarget;
  if (!button) {
    return;
  }
  const index = Number(button.dataset.orderIndex);
  if (!Number.isFinite(index) || index < 0 || index >= quickReorderOrders.length) {
    return;
  }
  const order = quickReorderOrders[index];
  const card = button.closest('.quick-reorder__card');
  if (!order || !card) {
    return;
  }
  const { addedCount, missing } = addOrderItemsToCart(order);
  toggleQuickReorderDetails(card, true);
  if (addedCount > 0) {
    if (missing.length) {
      const missingLabel = missing.length === 1 ? 'item' : 'items';
      showQuickReorderMessage(
        card,
        `Added available dishes to your cart. ${missing.length} ${missingLabel} not available.`,
        'warning',
      );
    } else {
      showQuickReorderMessage(card, 'Added items to your cart.', 'success');
    }
  } else if (missing.length) {
    showQuickReorderMessage(
      card,
      'Those dishes are no longer available, please build a new order.',
      'warning',
    );
  } else {
    showQuickReorderMessage(card, 'We could not add those dishes right now.', 'warning');
  }
}

function renderQuickReorderShelf() {
  const container = document.getElementById('quick-reorder');
  if (!container) {
    return;
  }
  const list = container.querySelector('.quick-reorder__list');
  if (!list) {
    return;
  }
  const history = loadOrderHistoryEntries();
  quickReorderOrders = history.slice(0, QUICK_REORDER_MAX_ENTRIES);
  list.innerHTML = '';
  if (!quickReorderOrders.length) {
    container.hidden = true;
    container.setAttribute('aria-hidden', 'true');
    return;
  }
  container.hidden = false;
  container.setAttribute('aria-hidden', 'false');
  const fragment = document.createDocumentFragment();
  quickReorderOrders.forEach((order, index) => {
    const card = document.createElement('article');
    card.className = 'quick-reorder__card';
    card.setAttribute('role', 'listitem');

    const summaryButton = document.createElement('button');
    summaryButton.type = 'button';
    summaryButton.className = 'quick-reorder__summary';
    summaryButton.dataset.orderIndex = String(index);
    summaryButton.setAttribute('aria-expanded', 'false');

    const summaryText = document.createElement('span');
    summaryText.className = 'quick-reorder__summary-text';
    summaryText.textContent = formatOrderSummary(order);

    const meta = document.createElement('span');
    meta.className = 'quick-reorder__meta';
    const timestampText = formatOrderTimestamp(order.timestamp);
    meta.textContent = timestampText ? timestampText : 'Previous order';

    summaryButton.append(summaryText, meta);

    const actions = document.createElement('div');
    actions.className = 'quick-reorder__actions';

    const detailsButton = document.createElement('button');
    detailsButton.type = 'button';
    detailsButton.className = 'quick-reorder__details-button';
    detailsButton.dataset.orderIndex = String(index);
    detailsButton.textContent = 'Details';
    detailsButton.setAttribute('aria-expanded', 'false');

    const reorderButton = document.createElement('button');
    reorderButton.type = 'button';
    reorderButton.className = 'quick-reorder__reorder-button';
    reorderButton.dataset.orderIndex = String(index);
    reorderButton.textContent = 'Reorder';

    actions.append(detailsButton, reorderButton);

    const details = document.createElement('div');
    details.className = 'quick-reorder__details';
    details.hidden = true;
    const detailId = `quick-reorder-details-${index}`;
    details.id = detailId;
    summaryButton.setAttribute('aria-controls', detailId);
    detailsButton.setAttribute('aria-controls', detailId);

    const itemsList = document.createElement('ul');
    itemsList.className = 'quick-reorder__items';
    order.items.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item.quantity > 1 ? `${item.quantity}× ${item.name}` : item.name;
      itemsList.appendChild(li);
    });

    const feedback = document.createElement('p');
    feedback.className = 'quick-reorder__feedback';
    feedback.setAttribute('role', 'status');
    feedback.hidden = true;

    details.append(itemsList, feedback);

    summaryButton.addEventListener('click', handleQuickReorderToggle);
    detailsButton.addEventListener('click', handleQuickReorderToggle);
    reorderButton.addEventListener('click', handleQuickReorderReorder);

    card.append(summaryButton, actions, details);
    fragment.appendChild(card);
  });
  list.appendChild(fragment);
}

// Cart state.  Each entry in the cart contains an item id, name, quantity,
// price and any special instructions entered during checkout.  We track
// unique ids to update quantities rather than adding duplicates.
const cart = {};

const EXPRESS_DELIVERY_FEE = 3;
let selectedTipPercent = 0.15;
let selectedTipType = 'percent';
let customTipAmount = 0;
let selectedDeliverySpeed = 'standard';
let selectedPickupTimeOption = 'standard';

function createScheduleState() {
  return {
    date: null,
    time: '',
    pendingTime: '',
    confirmed: false,
  };
}

const scheduleStates = {
  pickup: createScheduleState(),
  delivery: createScheduleState(),
};

let activeScheduleContext = 'delivery';

const calendarState = {
  current: startOfMonth(new Date()),
  selected: null,
};

function getScheduleState(context = activeScheduleContext) {
  return scheduleStates[context];
}

function getScheduleContextLabel(context) {
  return context === 'pickup' ? 'pickup' : 'delivery';
}

function getScheduleContextTitle(context) {
  return context === 'pickup' ? 'Pickup' : 'Delivery';
}

function setActiveScheduleContext(context) {
  activeScheduleContext = context;
  const state = getScheduleState();
  const referenceDate = state.date ? startOfDay(state.date) : state.date;
  if (referenceDate) {
    calendarState.selected = startOfDay(referenceDate);
    calendarState.current = startOfMonth(referenceDate);
  } else {
    calendarState.selected = null;
    calendarState.current = startOfMonth(new Date());
  }
  if (!state.pendingTime && state.confirmed && state.time) {
    state.pendingTime = state.time;
  }
  const timeInput = document.getElementById('schedule-time');
  if (timeInput) {
    timeInput.value = state.pendingTime || '';
  }
}

function calculateCartTotals() {
  let total = 0;
  let count = 0;
  Object.values(cart).forEach((item) => {
    total += item.price * item.quantity;
    count += item.quantity;
  });
  return { total, count };
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatCurrency(amount) {
  return `$${amount.toFixed(2)}`;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(date) {
  const first = startOfDay(date);
  first.setDate(1);
  return first;
}

function sameDay(a, b) {
  return Boolean(a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate());
}

const scheduleDateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

function formatScheduleDate(date) {
  return scheduleDateFormatter.format(date);
}

function formatDisplayTime(timeValue) {
  if (timeValue instanceof Date) {
    return timeValue.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (typeof timeValue !== 'string') {
    return '';
  }
  const [hours, minutes] = timeValue.split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return timeValue;
  }
  const temp = new Date();
  temp.setHours(hours, minutes, 0, 0);
  return temp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const calendarDayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function setScheduleSummary(text, variant = 'info') {
  const summary = document.getElementById('schedule-summary');
  if (!summary) {
    return;
  }
  summary.textContent = text || '';
  summary.classList.remove('is-warning', 'is-confirmed');
  if (variant === 'warning') {
    summary.classList.add('is-warning');
  } else if (variant === 'success') {
    summary.classList.add('is-confirmed');
  }
}

function updateScheduleSummary() {
  const scheduleContainer = document.getElementById('schedule-container');
  if (!scheduleContainer || scheduleContainer.classList.contains('hidden')) {
    return;
  }
  const context = activeScheduleContext;
  const state = getScheduleState();
  const label = getScheduleContextLabel(context);
  const title = getScheduleContextTitle(context);
  if (!calendarState.selected) {
    setScheduleSummary(`Select a ${label} date to begin.`, 'info');
    return;
  }
  if (!state.pendingTime) {
    setScheduleSummary(`${title} date set to ${formatScheduleDate(calendarState.selected)}. Choose a ${label} time.`, 'info');
    return;
  }
  if (state.confirmed && state.date && state.time) {
    setScheduleSummary(`${title} scheduled for ${formatScheduleDate(state.date)} at ${formatDisplayTime(state.time)}.`, 'success');
    return;
  }
  setScheduleSummary(
    `Selected ${formatScheduleDate(calendarState.selected)} at ${formatDisplayTime(state.pendingTime)}. Save to confirm.`,
    'warning',
  );
}

function selectCalendarDate(date) {
  const normalized = startOfDay(date);
  calendarState.selected = normalized;
  const state = getScheduleState();
  state.confirmed = false;
  state.date = new Date(normalized);
  if (
    normalized.getFullYear() !== calendarState.current.getFullYear() ||
    normalized.getMonth() !== calendarState.current.getMonth()
  ) {
    calendarState.current = startOfMonth(normalized);
  }
  updateScheduleSummary();
  renderCalendar();
}

function changeCalendarMonth(offset) {
  const base = calendarState.current || startOfMonth(new Date());
  calendarState.current = startOfMonth(new Date(base.getFullYear(), base.getMonth() + offset, 1));
  renderCalendar();
}

function resetCalendarMonth() {
  calendarState.current = startOfMonth(new Date());
  renderCalendar();
}

function renderCalendar() {
  const mount = document.getElementById('calendar');
  if (!mount) {
    return;
  }
  const monthDate = calendarState.current || startOfMonth(new Date());
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const previousMonthDays = new Date(year, month, 0).getDate();
  const startIndex = (firstDay.getDay() + 6) % 7; // Monday-first
  const totalCells = 42;
  const today = startOfDay(new Date());

  const calendar = document.createElement('div');
  calendar.className = 'calendar';

  const nav = document.createElement('nav');
  nav.className = 'calendar--nav';

  const prev = document.createElement('a');
  prev.innerHTML = '&#8249;';
  prev.setAttribute('aria-label', 'Previous month');
  prev.addEventListener('click', () => changeCalendarMonth(-1));

  const next = document.createElement('a');
  next.innerHTML = '&#8250;';
  next.setAttribute('aria-label', 'Next month');
  next.addEventListener('click', () => changeCalendarMonth(1));

  const heading = document.createElement('h1');
  heading.innerHTML = `${monthDate.toLocaleString('default', { month: 'long' })} <small>${year}</small>`;
  heading.addEventListener('click', () => resetCalendarMonth());

  nav.appendChild(prev);
  nav.appendChild(heading);
  nav.appendChild(next);

  const daysNav = document.createElement('nav');
  daysNav.className = 'calendar--days';

  calendarDayLabels.forEach((label) => {
    const span = document.createElement('span');
    span.className = 'label';
    span.textContent = label;
    daysNav.appendChild(span);
  });

  const appendDay = (date, muted = false) => {
    const span = document.createElement('span');
    span.textContent = String(date.getDate());
    if (muted) {
      span.classList.add('muted');
    }
    if (sameDay(date, today)) {
      span.classList.add('today');
    }
    if (calendarState.selected && sameDay(date, calendarState.selected)) {
      span.classList.add('selected');
    }
    span.addEventListener('click', () => selectCalendarDate(date));
    daysNav.appendChild(span);
  };

  for (let i = 0; i < startIndex; i += 1) {
    const dayNumber = previousMonthDays - startIndex + 1 + i;
    appendDay(new Date(year, month - 1, dayNumber), true);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    appendDay(new Date(year, month, day));
  }

  const filledCells = startIndex + daysInMonth;
  const trailing = totalCells - filledCells;
  for (let i = 1; i <= trailing; i += 1) {
    appendDay(new Date(year, month + 1, i), true);
  }

  calendar.appendChild(nav);
  calendar.appendChild(daysNav);

  mount.innerHTML = '';
  mount.appendChild(calendar);
}

function handleScheduleSave() {
  const context = activeScheduleContext;
  const state = getScheduleState();
  const label = getScheduleContextLabel(context);
  const title = getScheduleContextTitle(context);
  if (!calendarState.selected) {
    setScheduleSummary(`Select a ${label} date before saving.`, 'warning');
    return;
  }
  if (!state.pendingTime) {
    setScheduleSummary(`Choose a ${label} time before saving.`, 'warning');
    return;
  }
  const [hours, minutes] = state.pendingTime.split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    setScheduleSummary('Enter a valid time.', 'warning');
    return;
  }
  const selection = new Date(calendarState.selected);
  selection.setHours(hours, minutes, 0, 0);
  if (selection < new Date()) {
    setScheduleSummary(`Please pick a ${label} time in the future.`, 'warning');
    return;
  }
  state.date = selection;
  state.time = state.pendingTime;
  state.confirmed = true;
  calendarState.selected = startOfDay(selection);
  calendarState.current = startOfMonth(selection);
  state.pendingTime = state.time;
  updateScheduleSummary();
  renderCalendar();
}

function setTimePreference(context, value) {
  if (context === 'delivery') {
    selectedDeliverySpeed = value;
  } else {
    selectedPickupTimeOption = value;
  }
  const scheduleContainer = document.getElementById('schedule-container');
  const state = getScheduleState(context);
  const shouldShow = value === 'schedule';
  if (shouldShow) {
    setActiveScheduleContext(context);
    if (scheduleContainer) {
      scheduleContainer.classList.remove('hidden');
      scheduleContainer.setAttribute('aria-hidden', 'false');
      renderCalendar();
      updateScheduleSummary();
    }
  } else {
    if (!state.confirmed) {
      state.pendingTime = '';
    } else {
      state.pendingTime = state.time;
    }
    if (scheduleContainer && activeScheduleContext === context) {
      scheduleContainer.classList.add('hidden');
      scheduleContainer.setAttribute('aria-hidden', 'true');
      setScheduleSummary('', 'info');
    }
  }
  updateCheckoutView();
}

function setDeliverySpeed(value) {
  setTimePreference('delivery', value);
}

function setPickupTimePreference(value) {
  setTimePreference('pickup', value);
}

function updateItemQuantity(id, quantity) {
  const numericQuantity = Number(quantity);
  if (!Number.isFinite(numericQuantity)) {
    return;
  }
  if (numericQuantity <= 0) {
    removeFromCart(id);
    return;
  }
  if (cart[id]) {
    const previousQuantity = cart[id].quantity;
    cart[id].quantity = Math.floor(numericQuantity);
    updateCart();
    if (cart[id].quantity !== previousQuantity) {
      trackEvent('cart_quantity_updated', {
        itemId: id,
        previousQuantity,
        quantity: cart[id].quantity,
      });
    }
  }
}

// Utility: activate a tab by id
function activateTab(targetId) {
  const links = document.querySelectorAll('#menuTab .nav-link');
  const panes = document.querySelectorAll('#menuTabContent .tab-pane');
  links.forEach((link) => {
    if (link.dataset.target === targetId) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
  panes.forEach((pane) => {
    if (pane.id === targetId) {
      pane.classList.add('active');
    } else {
      pane.classList.remove('active');
    }
  });
  trackEvent('menu_tab_viewed', { tabId: targetId });
}

// Render the menu on the page.
function renderMenu() {
  const tabList = document.getElementById('menuTab');
  const tabContent = document.getElementById('menuTabContent');
  if (!tabList || !tabContent) {
    return;
  }
  tabList.innerHTML = '';
  tabContent.innerHTML = '';

  if (!menuData.length) {
    const message = document.createElement('p');
    message.classList.add('menu-empty');
    message.textContent = "We're updating the menu. Please check back soon.";
    tabContent.appendChild(message);
    return;
  }

  menuData.forEach((category, catIndex) => {
    const navItem = document.createElement('li');
    navItem.classList.add('nav-item');

    const navLink = document.createElement('button');
    navLink.type = 'button';
    navLink.classList.add('nav-link');
    navLink.textContent = category.name;
    navLink.dataset.target = category.id;
    if (catIndex === 0) {
      navLink.classList.add('active');
    }
    navLink.addEventListener('click', () => activateTab(category.id));

    navItem.appendChild(navLink);
    tabList.appendChild(navItem);

    const pane = document.createElement('div');
    pane.classList.add('tab-pane');
    if (catIndex === 0) {
      pane.classList.add('active');
    }
    pane.id = category.id;

    const row = document.createElement('div');
    row.classList.add('row');

    category.items.forEach((item, itemIndex) => {
      const col = document.createElement('div');
      col.classList.add('col-md-6');

      const singleMenu = document.createElement('div');
      singleMenu.classList.add('single_menu');

      const img = document.createElement('img');
      const matchedImage = findImageForItem(item.name, item.id);
      img.src = matchedImage || fallbackImage;
      img.alt = item.name;

      const content = document.createElement('div');
      content.classList.add('menu_content');

      const title = document.createElement('h4');
      title.textContent = item.name;
      const priceEl = document.createElement('span');
      priceEl.textContent = `$${item.price.toFixed(2)}`;
      title.appendChild(priceEl);

      const description = document.createElement('p');
      description.textContent = item.description || categoryDescriptions[category.id] || 'Freshly prepared and served hot.';

      const addBtn = document.createElement('button');
      addBtn.classList.add('add-btn');
      addBtn.textContent = 'Add to cart';
      addBtn.addEventListener('click', () => addToCart(item, { imageElement: img }));

      content.appendChild(title);
      content.appendChild(description);
      content.appendChild(addBtn);

      singleMenu.appendChild(img);
      singleMenu.appendChild(content);
      col.appendChild(singleMenu);
      row.appendChild(col);
    });

    pane.appendChild(row);
    tabContent.appendChild(pane);
  });
}

function waitForMenuImages() {
  const images = Array.from(document.querySelectorAll('.single_menu img'));
  if (!images.length) {
    return Promise.resolve();
  }

  const loaders = images.map((img) =>
    new Promise((resolve) => {
      if (img.complete && img.naturalWidth !== 0) {
        resolve();
        return;
      }

      const handleComplete = () => {
        img.removeEventListener('load', handleComplete);
        img.removeEventListener('error', handleComplete);
        resolve();
      };

      img.addEventListener('load', handleComplete, { once: true });
      img.addEventListener('error', handleComplete, { once: true });
    })
  );

  return Promise.all(loaders);
}

function handleMenuLoadingScreen() {
  const loadingScreen = document.getElementById('menu-loading-screen');
  if (!loadingScreen) {
    return;
  }

  const minimumDuration = new Promise((resolve) => {
    window.setTimeout(resolve, 2000);
  });

  Promise.all([minimumDuration, waitForMenuImages()]).then(() => {
    loadingScreen.classList.add('menu-loading-screen--hidden');
    window.setTimeout(() => {
      if (loadingScreen.parentElement) {
        loadingScreen.parentElement.removeChild(loadingScreen);
      }
    }, 600);
  });
}

function shuffleArray(array) {
  const shuffled = array.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }
  return shuffled;
}

function buildHeroCarousel() {
  const track = document.getElementById('hero-track');
  const carousel = document.getElementById('hero-carousel');
  if (!track || !carousel) {
    return;
  }

  track.innerHTML = '';
  carousel.classList.remove('is-hidden');

  const items = Array.from(menuItemsById.values());
  if (!items.length) {
    carousel.classList.add('is-hidden');
    return;
  }

  const randomizedItems = shuffleArray(items);
  const slides = randomizedItems.map((item) => ({
    item,
    image: findImageForItem(item.name, item.id) || fallbackImage,
  }));

  const pointerCoarse = window.matchMedia('(pointer: coarse)');
  const compactWidth = window.matchMedia('(max-width: 768px)');
  const useSwipeMode = pointerCoarse.matches || compactWidth.matches;
  const slidesToRender = useSwipeMode ? slides : slides.concat(slides);

  slidesToRender.forEach(({ item, image }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.classList.add('hero-card');
    button.title = `Add ${item.name} to cart`;
    button.setAttribute('aria-label', `Add ${item.name} to cart`);

    const img = document.createElement('img');
    img.src = image;
    img.alt = item.name;
    img.loading = 'lazy';
    img.decoding = 'async';

    const info = document.createElement('div');
    info.classList.add('hero-card-info');

    const nameSpan = document.createElement('span');
    nameSpan.classList.add('hero-card-name');
    nameSpan.textContent = item.name;

    const priceSpan = document.createElement('span');
    priceSpan.classList.add('hero-card-price');
    priceSpan.textContent = `$${item.price.toFixed(2)}`;

    info.appendChild(nameSpan);
    info.appendChild(priceSpan);

    button.appendChild(img);
    button.appendChild(info);
    button.addEventListener('click', () => addToCart(item, { imageElement: img }));
    track.appendChild(button);
  });

  const duration = Math.min(140, Math.max(45, items.length * 1.2));
  track.style.setProperty('--hero-duration', `${duration}s`);

  if (useSwipeMode) {
    track.dataset.mode = 'swipe';
    carousel.classList.add('is-touch');
    if (typeof carousel.scrollTo === 'function') {
      carousel.scrollTo({ left: 0, behavior: 'auto' });
    } else {
      carousel.scrollLeft = 0;
    }
  } else {
    track.removeAttribute('data-mode');
    carousel.classList.remove('is-touch');
    track.style.removeProperty('transform');
  }
}

// Add an item to the cart.  If the item already exists, increment the quantity.
function addToCart(item, options = {}) {
  if (cart[item.id]) {
    cart[item.id].quantity += 1;
  } else {
    cart[item.id] = {
      name: item.name,
      price: item.price,
      quantity: 1,
      instructions: '',
    };
  }
  updateCart();
  celebrateCartScore(options.imageElement);
  animateItemImage(options.imageElement);
  playCartSound();
  trackEvent('cart_item_added', {
    itemId: item.id,
    name: item.name,
    price: item.price,
    quantity: cart[item.id].quantity,
  });
}

function playCartSound() {
  if (!cartAddSound) {
    return;
  }

  try {
    cartAddSound.currentTime = 0;
    const playPromise = cartAddSound.play();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise.catch(() => {});
    }
  } catch (error) {
    // Ignore errors triggered by autoplay restrictions or unsupported playback.
  }
}

function animateItemImage(imageElement) {
  if (!imageElement) {
    return;
  }
  imageElement.classList.remove('photo-press');
  // Force a reflow so the animation can replay if the user taps repeatedly.
  void imageElement.offsetWidth;
  imageElement.classList.add('photo-press');
  imageElement.addEventListener(
    'animationend',
    () => {
      imageElement.classList.remove('photo-press');
    },
    { once: true }
  );
}

function celebrateCartScore(imageElement) {
  const cartIcon = document.getElementById('cart-icon-button');
  if (!imageElement || !cartIcon) {
    return;
  }

  const prefersReducedMotion =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
  if (prefersReducedMotion && prefersReducedMotion.matches) {
    cartIcon.classList.add('score-pop');
    window.setTimeout(() => {
      cartIcon.classList.remove('score-pop');
    }, 400);
    return;
  }

  const sourceRect = imageElement.getBoundingClientRect();
  const targetRect = cartIcon.getBoundingClientRect();

  if (!sourceRect.width || !sourceRect.height) {
    return;
  }

  const ghost = document.createElement('img');
  ghost.src = imageElement.currentSrc || imageElement.src;
  ghost.className = 'flying-cart-image';
  ghost.alt = '';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.style.width = `${sourceRect.width}px`;
  ghost.style.height = `${sourceRect.height}px`;
  ghost.style.left = `${sourceRect.left}px`;
  ghost.style.top = `${sourceRect.top}px`;

  document.body.appendChild(ghost);

  const deltaX = targetRect.left + targetRect.width / 2 - (sourceRect.left + sourceRect.width / 2);
  const deltaY = targetRect.top + targetRect.height / 2 - (sourceRect.top + sourceRect.height / 2);

  const animation = ghost.animate(
    [
      {
        transform: 'translate(0, 0) scale(1)',
        opacity: 0.95,
        filter: 'drop-shadow(0 12px 18px rgba(0, 0, 0, 0.18))',
      },
      {
        transform: `translate(${deltaX}px, ${deltaY}px) scale(0.25)`,
        opacity: 0,
        filter: 'drop-shadow(0 8px 18px rgba(255, 214, 122, 0.45))',
      },
    ],
    {
      duration: 640,
      easing: 'cubic-bezier(0.21, 0.61, 0.45, 0.98)',
      fill: 'forwards',
    }
  );

  animation.onfinish = () => {
    ghost.remove();
    cartIcon.classList.add('score-pop');
    cartIcon.addEventListener(
      'animationend',
      () => {
        cartIcon.classList.remove('score-pop');
      },
      { once: true }
    );
  };
  animation.oncancel = () => {
    ghost.remove();
  };
}

// Remove an item from the cart entirely
function removeFromCart(id) {
  const removed = cart[id];
  delete cart[id];
  updateCart();
  if (removed) {
    trackEvent('cart_item_removed', {
      itemId: id,
      name: removed.name,
      quantity: removed.quantity,
    });
  }
}

// Update the cart display and totals
function updateCart() {
  const { total, count } = calculateCartTotals();
  const cartCountEl = document.getElementById('cart-count');
  if (cartCountEl) {
    cartCountEl.textContent = count;
  }

  updateCheckoutView();
  applyCartGlow(count, total);
}

function applyCartGlow(count, total) {
  const glowStrength = Math.min(1, Math.max(count / 10, total / 200));
  const glowAlpha = glowStrength > 0 ? 0.25 + glowStrength * 0.55 : 0;

  const cartIcon = document.getElementById('cart-icon-button');
  if (cartIcon) {
    cartIcon.style.setProperty('--glow-strength', glowStrength.toFixed(3));
    cartIcon.style.setProperty('--glow-alpha', glowAlpha.toFixed(3));
    cartIcon.classList.toggle('is-glowing', glowStrength > 0);
  }

}

function toggleDeliveryFields(isDelivery) {
  const deliveryFields = document.getElementById('delivery-fields');
  if (deliveryFields) {
    deliveryFields.classList.toggle('hidden', !isDelivery);
  }
  const mapContainer = document.getElementById('delivery-map-container');
  if (mapContainer) {
    mapContainer.classList.toggle('hidden', !isDelivery);
    if (isDelivery) {
      if (ensureDeliveryMapInitialized()) {
        updateMapMarkers();
      }
      updateDeliverySummaryDisplay();
      if (!locationLoadedFromCache) {
        requestBrowserLocation();
      }
    } else {
      const summary = document.getElementById('delivery-distance-summary');
      if (summary) {
        summary.textContent = '';
        summary.classList.remove('is-error', 'is-warning', 'is-success');
      }
    }
  }
  const pickupWrapper = document.getElementById('pickup-time-wrapper');
  if (pickupWrapper) {
    pickupWrapper.classList.toggle('hidden', isDelivery);
  }
  const tipSection = document.querySelector('.tip-section');
  if (tipSection) {
    tipSection.classList.toggle('hidden', !isDelivery);
  }
  const tipTotalRow = document.getElementById('tip-total-row');
  if (tipTotalRow) {
    tipTotalRow.classList.toggle('hidden', !isDelivery);
  }
  const scheduleContainer = document.getElementById('schedule-container');
  if (isDelivery) {
    if (scheduleContainer && !scheduleContainer.classList.contains('hidden') && activeScheduleContext !== 'delivery') {
      scheduleContainer.classList.add('hidden');
      scheduleContainer.setAttribute('aria-hidden', 'true');
    }
    const selectedDelivery = document.querySelector('input[name="delivery-time"]:checked');
    if (selectedDelivery) {
      setDeliverySpeed(selectedDelivery.value);
    } else {
      setDeliverySpeed(selectedDeliverySpeed);
    }
  } else {
    if (scheduleContainer && !scheduleContainer.classList.contains('hidden') && activeScheduleContext !== 'pickup') {
      scheduleContainer.classList.add('hidden');
      scheduleContainer.setAttribute('aria-hidden', 'true');
      setScheduleSummary('', 'info');
    }
    const selectedPickup = document.querySelector('input[name="pickup-time"]:checked');
    if (selectedPickup) {
      setPickupTimePreference(selectedPickup.value);
    } else {
      setPickupTimePreference(selectedPickupTimeOption);
    }
  }
  trackEvent('fulfilment_changed', { mode: isDelivery ? 'delivery' : 'pickup' });
  updateCheckoutView();
}

function applyHeaderFulfilmentToCheckout() {
  const pickupRadio = document.getElementById('fulfilment-pickup');
  const deliveryRadio = document.getElementById('fulfilment-delivery');
  if (!pickupRadio || !deliveryRadio) {
    return false;
  }

  const isDelivery = headerFulfilmentMode === 'delivery';
  pickupRadio.checked = !isDelivery;
  deliveryRadio.checked = isDelivery;
  toggleDeliveryFields(isDelivery);
  return true;
}

function toggleCheckoutPanel(open) {
  const checkoutPanel = document.getElementById('checkout-panel');
  if (!checkoutPanel) {
    return;
  }

  let syncedFulfilment = false;
  if (open) {
    updatePickupScheduleLock();
    syncedFulfilment = applyHeaderFulfilmentToCheckout();
  }
  checkoutPanel.classList.toggle('hidden', !open);
  checkoutPanel.setAttribute('aria-hidden', String(!open));
  if (open) {
    if (!syncedFulfilment) {
      updateCheckoutView();
    }
    const panelTop = checkoutPanel.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: panelTop - 16, behavior: 'smooth' });
    trackEvent('checkout_panel_opened', { itemCount: Object.keys(cart).length });
  } else {
    trackEvent('checkout_panel_closed');
  }
}

function updateCheckoutView() {
  const checkoutItems = document.getElementById('checkout-items');
  const checkoutTotal = document.getElementById('checkout-total-amount');
  const placeOrderBtn = document.getElementById('place-order');
  if (!checkoutItems || !checkoutTotal) {
    return;
  }
  checkoutItems.innerHTML = '';
  const entries = Object.keys(cart);
  const subtotalEl = document.getElementById('checkout-subtotal-amount');
  const tipSummaryEl = document.getElementById('tip-amount');
  const tipAmountEl = document.getElementById('checkout-tip-amount');
  const deliveryDistanceRow = document.getElementById('delivery-distance-row');
  const deliveryDistanceAmount = document.getElementById('delivery-distance-amount');
  const expressFeeRow = document.getElementById('express-fee-row');
  const expressFeeAmount = document.getElementById('express-fee-amount');
  const feesTaxRow = document.getElementById('fees-tax-row');
  const feesTaxAmount = document.getElementById('fees-tax-amount');
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.classList.add('cart-empty');
    empty.textContent = 'Add a few dishes to begin your order.';
    checkoutItems.appendChild(empty);
    checkoutTotal.textContent = '$0.00';
    if (subtotalEl) {
      subtotalEl.textContent = '$0.00';
    }
    if (tipSummaryEl) {
      tipSummaryEl.textContent = '$0.00';
    }
    if (tipAmountEl) {
      tipAmountEl.textContent = '$0.00';
    }
    if (deliveryDistanceRow) {
      deliveryDistanceRow.classList.add('hidden');
    }
    if (expressFeeRow) {
      expressFeeRow.classList.add('hidden');
    }
    if (feesTaxAmount) {
      feesTaxAmount.textContent = formatCurrency(0);
    }
    if (feesTaxRow) {
      feesTaxRow.classList.remove('hidden');
    }
    if (placeOrderBtn) {
      placeOrderBtn.disabled = true;
    }
    return;
  }
  if (placeOrderBtn) {
    placeOrderBtn.disabled = false;
  }
  entries.forEach((id) => {
    const item = cart[id];
    if (typeof item.instructions !== 'string') {
      item.instructions = '';
    }
    const wrapper = document.createElement('div');
    wrapper.classList.add('checkout-item');

    const image = document.createElement('img');
    image.src = findImageForItem(item.name, id) || fallbackImage;
    image.alt = item.name;

    const details = document.createElement('div');
    details.classList.add('checkout-item-details');
    const title = document.createElement('h4');
    title.textContent = item.name;
    const price = document.createElement('span');
    price.textContent = `$${item.price.toFixed(2)} each`;
    details.appendChild(title);
    details.appendChild(price);

    const instructionsWrapper = document.createElement('div');
    instructionsWrapper.classList.add('instructions-wrapper');

    const instructionsId = `instructions-${id}`;
    const instructionsLabel = document.createElement('label');
    instructionsLabel.classList.add('instructions-label');
    instructionsLabel.htmlFor = instructionsId;
    instructionsLabel.textContent = 'Special Instructions';

    const instructionsNote = document.createElement('p');
    instructionsNote.classList.add('instructions-note');
    instructionsNote.id = `${instructionsId}-note`;
    instructionsNote.textContent = 'Please note: requests for additional items or special preparation may incur an extra charge that will be calculated on your online order.';

    const textarea = document.createElement('textarea');
    textarea.id = instructionsId;
    textarea.classList.add('instructions-textarea');
    textarea.rows = 3;
    textarea.placeholder = 'Add a request, for example “No onions”.';
    textarea.value = item.instructions;
    textarea.setAttribute('aria-describedby', instructionsNote.id);

    const actions = document.createElement('div');
    actions.classList.add('instructions-actions');

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.classList.add('instructions-save');
    saveBtn.textContent = 'Save request';

    const status = document.createElement('span');
    status.classList.add('instructions-status');
    status.setAttribute('aria-live', 'polite');

    let savedValue = item.instructions || '';

    const refreshStatus = () => {
      const currentValue = textarea.value.trim();
      const hasUnsavedChanges = currentValue !== savedValue;
      saveBtn.disabled = !hasUnsavedChanges;
      status.textContent = hasUnsavedChanges
        ? 'Unsaved request'
        : savedValue
          ? 'Request saved'
          : '';
      status.classList.toggle('is-pending', hasUnsavedChanges);
      status.classList.toggle('is-saved', !hasUnsavedChanges && Boolean(savedValue));
    };

    textarea.addEventListener('input', refreshStatus);

    saveBtn.addEventListener('click', () => {
      savedValue = textarea.value.trim();
      cart[id].instructions = savedValue;
      item.instructions = savedValue;
      textarea.value = savedValue;
      refreshStatus();
    });

    actions.appendChild(saveBtn);
    actions.appendChild(status);

    instructionsWrapper.appendChild(instructionsLabel);
    instructionsWrapper.appendChild(instructionsNote);
    instructionsWrapper.appendChild(textarea);
    instructionsWrapper.appendChild(actions);
    details.appendChild(instructionsWrapper);

    refreshStatus();

    const quantity = document.createElement('div');
    quantity.classList.add('checkout-quantity');
    const controls = document.createElement('div');
    controls.classList.add('quantity-controls');

    const minusBtn = document.createElement('button');
    minusBtn.type = 'button';
    minusBtn.textContent = '–';
    minusBtn.addEventListener('click', () => updateItemQuantity(id, item.quantity - 1));

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.value = item.quantity;
    input.addEventListener('change', (event) => {
      updateItemQuantity(id, event.target.value);
      event.target.value = cart[id] ? cart[id].quantity : 0;
    });

    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.textContent = '+';
    plusBtn.addEventListener('click', () => updateItemQuantity(id, item.quantity + 1));

    controls.appendChild(minusBtn);
    controls.appendChild(input);
    controls.appendChild(plusBtn);

    const itemTotal = document.createElement('div');
    itemTotal.classList.add('checkout-item-total');
    itemTotal.textContent = `$${(item.price * item.quantity).toFixed(2)}`;

    quantity.appendChild(controls);
    quantity.appendChild(itemTotal);

    wrapper.appendChild(image);
    wrapper.appendChild(details);
    wrapper.appendChild(quantity);
    checkoutItems.appendChild(wrapper);
  });

  const { total } = calculateCartTotals();
  const subtotal = roundCurrency(total);
  if (subtotalEl) {
    subtotalEl.textContent = formatCurrency(subtotal);
  }
  const deliveryRadio = document.getElementById('fulfilment-delivery');
  const isDelivery = Boolean(deliveryRadio && deliveryRadio.checked);
  const quote = isDelivery ? refreshDeliveryQuote() : deliveryQuoteState;
  let deliveryFee = 0;
  let canDeliver = true;
  if (isDelivery) {
    const store = getActiveStore();
    if (!store || quote.needsLocation || !quote.withinRange) {
      canDeliver = false;
    } else {
      deliveryFee = roundCurrency(quote.fee);
    }
  }
  if (deliveryDistanceRow) {
    if (isDelivery) {
      deliveryDistanceRow.classList.remove('hidden');
      if (deliveryDistanceAmount) {
        deliveryDistanceAmount.textContent = formatCurrency(Math.max(deliveryFee, 0));
      }
    } else {
      deliveryDistanceRow.classList.add('hidden');
    }
  }
  let tipAmount = 0;
  if (entries.length && isDelivery) {
    if (selectedTipType === 'custom') {
      tipAmount = roundCurrency(Math.max(customTipAmount, 0));
    } else {
      const rawTip = Number.isFinite(selectedTipPercent) ? selectedTipPercent : 0;
      tipAmount = roundCurrency(subtotal * rawTip);
    }
  }
  if (tipSummaryEl) {
    tipSummaryEl.textContent = formatCurrency(tipAmount);
  }
  if (tipAmountEl) {
    tipAmountEl.textContent = formatCurrency(tipAmount);
  }
  const expressFee = isDelivery && selectedDeliverySpeed === 'express' ? EXPRESS_DELIVERY_FEE : 0;
  if (expressFeeRow && expressFeeAmount) {
    if (expressFee > 0) {
      expressFeeRow.classList.remove('hidden');
      expressFeeAmount.textContent = formatCurrency(expressFee);
    } else {
      expressFeeRow.classList.add('hidden');
    }
  }
  const processingFee = ORDER_PROCESSING_FEE;
  const taxableAmount = subtotal + processingFee + (isDelivery ? deliveryFee : 0) + expressFee;
  const taxAmount = roundCurrency(taxableAmount * STATE_SALES_TAX_RATE);
  const feesAndEstimatedTax = roundCurrency(processingFee + taxAmount);
  if (feesTaxAmount) {
    feesTaxAmount.textContent = formatCurrency(feesAndEstimatedTax);
  }
  if (feesTaxRow) {
    feesTaxRow.classList.remove('hidden');
  }
  const grandTotal = roundCurrency(
    subtotal + processingFee + (isDelivery ? deliveryFee : 0) + expressFee + taxAmount + tipAmount,
  );
  checkoutTotal.textContent = formatCurrency(grandTotal);
  if (placeOrderBtn) {
    if (isDelivery && !canDeliver) {
      placeOrderBtn.disabled = true;
    } else {
      placeOrderBtn.disabled = false;
    }
  }
}

// Kick off the rendering once the DOM has loaded
document.addEventListener('DOMContentLoaded', async () => {
  if (analyticsApi) {
    trackEvent('page_view', { page: 'menu' }, { keepalive: true });
  }
  await Promise.all([ensureStoreDataLoaded(), ensureMenuDataLoaded()]);
  applySelectedStoreFromQuery();
  updatePickupScheduleLock();
  if (pickupScheduleIntervalId) {
    clearInterval(pickupScheduleIntervalId);
  }
  pickupScheduleIntervalId = window.setInterval(updatePickupScheduleLock, storeStatusUpdateInterval);
  loadCachedDeliveryLocation();
  if (analyticsApi?.ensureProfile) {
    analyticsApi.ensureProfile(
      activeStoreId
        ? {
            storeId: activeStoreId,
            storeLabel: getActiveStore()?.label,
            storeLat: getActiveStore()?.latitude,
            storeLng: getActiveStore()?.longitude,
          }
        : {},
    );
  }
  const storeDisplay = document.getElementById('selected-store-display');
  if (storeDisplay) {
    storeDisplay.addEventListener('click', handleHeaderFulfilmentToggle);
    storeDisplay.addEventListener('keydown', handleHeaderFulfilmentToggle);
    storeDisplay.addEventListener('animationend', () => {
      storeDisplay.classList.remove('is-animating');
    });
    updateHeaderFulfilmentDisplay();
  }
  buildHeroCarousel();
  renderMenu();
  renderQuickReorderShelf();
  handleMenuLoadingScreen();
  updateCart();
  const rebuildHeroForViewport = () => buildHeroCarousel();
  const heroMediaQueries = [
    window.matchMedia('(pointer: coarse)'),
    window.matchMedia('(max-width: 768px)'),
  ];
  heroMediaQueries.forEach((media) => {
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', rebuildHeroForViewport);
    } else if (typeof media.addListener === 'function') {
      media.addListener(rebuildHeroForViewport);
    }
  });
  window.addEventListener('orientationchange', rebuildHeroForViewport);
  const cartLink = document.querySelector('.cart-link');
  if (cartLink) {
    cartLink.addEventListener('click', (event) => {
      if (Object.keys(cart).length) {
        event.preventDefault();
        toggleCheckoutPanel(true);
      }
    });
  }
  const cartIconButton = document.getElementById('cart-icon-button');
  if (cartIconButton) {
    cartIconButton.addEventListener('click', (event) => {
      if (Object.keys(cart).length) {
        event.preventDefault();
        toggleCheckoutPanel(true);
      }
    });
  }
  const closeCheckout = document.getElementById('close-checkout');
  if (closeCheckout) {
    closeCheckout.addEventListener('click', () => toggleCheckoutPanel(false));
  }
  const pickup = document.getElementById('fulfilment-pickup');
  const delivery = document.getElementById('fulfilment-delivery');
  if (pickup && delivery) {
    pickup.addEventListener('change', () => toggleDeliveryFields(false));
    delivery.addEventListener('change', () => toggleDeliveryFields(true));
  }
  const pickupTimeRadios = document.querySelectorAll('input[name="pickup-time"]');
  pickupTimeRadios.forEach((radio) => {
    if (radio.checked) {
      selectedPickupTimeOption = radio.value;
    }
    radio.addEventListener('change', () => {
      if (radio.checked) {
        selectedPickupTimeOption = radio.value;
        setPickupTimePreference(radio.value);
      }
    });
  });
  const deliveryTimeRadios = document.querySelectorAll('input[name="delivery-time"]');
  deliveryTimeRadios.forEach((radio) => {
    if (radio.checked) {
      selectedDeliverySpeed = radio.value;
    }
    radio.addEventListener('change', () => {
      if (radio.checked) {
        selectedDeliverySpeed = radio.value;
        setDeliverySpeed(radio.value);
      }
    });
  });
  const tipButtons = Array.from(document.querySelectorAll('.tip-button'));
  const customTipContainer = document.getElementById('custom-tip-container');
  const customTipInput = document.getElementById('custom-tip-input');
  const customTipButton = tipButtons.find((button) => button.dataset.tip === 'custom');
  const updateCustomTipLabel = () => {
    if (customTipButton) {
      customTipButton.textContent = `Custom (${formatCurrency(Math.max(customTipAmount, 0))})`;
    }
  };
  updateCustomTipLabel();
  if (customTipInput) {
    customTipInput.value = customTipAmount.toFixed(2);
  }
  if (tipButtons.length) {
    let defaultButton = tipButtons.find(
      (button) => button.dataset.tip !== 'custom' && Math.abs(parseFloat(button.dataset.tip) - selectedTipPercent) < 0.0001,
    );
    if (!defaultButton) {
      defaultButton = tipButtons.find((button) => button.dataset.tip !== 'custom') || tipButtons[0];
    }
    if (defaultButton) {
      const defaultValue = defaultButton.dataset.tip;
      if (defaultValue === 'custom') {
        selectedTipType = 'custom';
      } else {
        selectedTipType = 'percent';
        const parsed = parseFloat(defaultValue);
        selectedTipPercent = Number.isFinite(parsed) ? parsed : 0;
      }
      defaultButton.classList.add('is-active');
      if (defaultValue === 'custom' && customTipContainer) {
        customTipContainer.classList.remove('hidden');
        customTipContainer.setAttribute('aria-hidden', 'false');
      }
    }
    tipButtons.forEach((button) => {
      button.addEventListener('click', () => {
        tipButtons.forEach((btn) => btn.classList.toggle('is-active', btn === button));
        const tipValue = button.dataset.tip;
        if (tipValue === 'custom') {
          selectedTipType = 'custom';
          if (customTipContainer) {
            customTipContainer.classList.remove('hidden');
            customTipContainer.setAttribute('aria-hidden', 'false');
          }
          if (customTipInput) {
            customTipInput.focus();
            customTipInput.select();
          }
        } else {
          const percent = parseFloat(tipValue);
          selectedTipType = 'percent';
          selectedTipPercent = Number.isFinite(percent) ? percent : 0;
          if (customTipContainer) {
            customTipContainer.classList.add('hidden');
            customTipContainer.setAttribute('aria-hidden', 'true');
          }
        }
        updateCheckoutView();
      });
    });
  }
  if (customTipInput) {
    customTipInput.addEventListener('input', (event) => {
      const value = parseFloat(event.target.value);
      customTipAmount = Number.isFinite(value) && value >= 0 ? value : 0;
      updateCustomTipLabel();
      if (selectedTipType === 'custom') {
        updateCheckoutView();
      }
    });
    customTipInput.addEventListener('change', (event) => {
      const value = parseFloat(event.target.value);
      customTipAmount = Number.isFinite(value) && value >= 0 ? value : 0;
      event.target.value = customTipAmount.toFixed(2);
      updateCustomTipLabel();
      if (selectedTipType === 'custom') {
        updateCheckoutView();
      }
    });
  }
  toggleDeliveryFields(Boolean(delivery && delivery.checked));
  const scheduleTimeInput = document.getElementById('schedule-time');
  if (scheduleTimeInput) {
    scheduleTimeInput.addEventListener('input', (event) => {
      const state = getScheduleState();
      state.pendingTime = event.target.value;
      state.confirmed = false;
    });
    scheduleTimeInput.addEventListener('change', (event) => {
      const state = getScheduleState();
      state.pendingTime = event.target.value;
      state.confirmed = false;
      updateScheduleSummary();
    });
  }
  const saveScheduleBtn = document.getElementById('save-schedule');
  if (saveScheduleBtn) {
    saveScheduleBtn.addEventListener('click', handleScheduleSave);
  }
  const paymentModal = document.getElementById('payment-modal');
  const paymentModalClose = document.getElementById('close-payment-modal');
  const paymentAmountEl = document.getElementById('payment-amount');
  const paymentSummaryContainer = document.getElementById('payment-order-summary');
  const confirmPaymentBtn = document.getElementById('confirm-payment');
  const paymentStatusEl = document.getElementById('payment-status');
  const applePayCheckoutBtn = document.getElementById('apple-pay-checkout');
  const paymentRequestWrapper = document.getElementById('payment-request-button-wrapper');
  const walletHint = document.getElementById('wallet-hint');
  const cardholderNameInput = document.getElementById('cardholder-name');
  const cardholderEmailInput = document.getElementById('cardholder-email');
  const stripeCardElementContainer = document.getElementById('stripe-card-element');

  let stripeInstance = null;
  let stripeElements = null;
  let stripeCardElement = null;
  let cardMounted = false;
  let paymentRequest = null;
  let paymentRequestButton = null;
  let walletAvailable = false;
  let currentPaymentIntent = null;
  let currentOrderDetails = null;
  let paymentProcessing = false;
  let checkoutRedirecting = false;

  function getStripePublishableKeyFromDom() {
    if (typeof window !== 'undefined') {
      if (typeof window.STRIPE_PUBLISHABLE_KEY === 'string' && window.STRIPE_PUBLISHABLE_KEY.trim()) {
        return window.STRIPE_PUBLISHABLE_KEY.trim();
      }
      if (typeof window.__STRIPE_PUBLISHABLE_KEY__ === 'string' && window.__STRIPE_PUBLISHABLE_KEY__.trim()) {
        return window.__STRIPE_PUBLISHABLE_KEY__.trim();
      }
    }

    const metaTag = document.querySelector('meta[name="stripe-publishable-key"]');
    if (metaTag && typeof metaTag.content === 'string' && metaTag.content.trim()) {
      return metaTag.content.trim();
    }

    const dataSource = document.querySelector('[data-stripe-publishable-key]');
    if (dataSource) {
      const value = dataSource.getAttribute('data-stripe-publishable-key');
      if (value && value.trim()) {
        return value.trim();
      }
    }

    return null;
  }

  let cachedStripeConfig = null;

  async function loadStripeConfigFromJson() {
    let response;
    try {
      response = await fetch('/stripe-config.json', { cache: 'no-store' });
    } catch (error) {
      throw new Error('Could not load stripe-config.json (network error).');
    }

    if (!response.ok) {
      throw new Error(`/stripe-config.json not found (status ${response.status}).`);
    }

    const text = await response.text();
    if (!text || !text.trim().length) {
      throw new Error('stripe-config.json is empty.');
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error(`stripe-config.json is invalid JSON: ${error.message}`);
    }

    if (!data || typeof data.publishableKey !== 'string' || !data.publishableKey.trim()) {
      throw new Error('stripe-config.json missing "publishableKey".');
    }

    return {
      publishableKey: data.publishableKey.trim(),
      menuOrigin: null,
      allowedOrigins: [],
    };
  }

  async function loadStripeConfigFromApi() {
    try {
      const response = await fetch(`${API_BASE}/api/dannyswok/config`, { cache: 'no-store', credentials: 'include' });
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const text = await response.text();
      if (!text || !text.trim().length) {
        throw new Error('Response body was empty.');
      }

      const data = JSON.parse(text);
      const publishableKeyCandidates = [
        data?.publishableKey,
        data?.stripePublishableKey,
        data?.stripePk,
      ];
      const publishableKey = publishableKeyCandidates.find(
        (value) => typeof value === 'string' && value.trim(),
      );

      if (!publishableKey) {
        throw new Error('Missing "publishableKey" in response body.');
      }

      const menuOrigin = typeof data?.menuOrigin === 'string' && data.menuOrigin.trim()
        ? data.menuOrigin.trim()
        : null;
      const allowedOrigins = Array.isArray(data?.allowedOrigins)
        ? data.allowedOrigins.filter((origin) => typeof origin === 'string' && origin.trim()).map((origin) => origin.trim())
        : [];

      return {
        publishableKey: publishableKey.trim(),
        menuOrigin,
        allowedOrigins,
      };
    } catch (error) {
      throw new Error(`/api/dannyswok/config unavailable: ${error.message}`);
    }
  }

  async function fetchStripeConfig() {
    if (cachedStripeConfig) {
      return cachedStripeConfig;
    }

    const globalObject = typeof window !== 'undefined' ? window : globalThis;
    const preferApiConfig = Boolean(globalObject && globalObject.STRIPE_USE_API_CONFIG);
    const allowApiFallback = preferApiConfig || Boolean(globalObject && globalObject.STRIPE_ALLOW_API_FALLBACK);

    if (!preferApiConfig) {
      try {
        cachedStripeConfig = await loadStripeConfigFromJson();
        return cachedStripeConfig;
      } catch (jsonError) {
        if (!allowApiFallback) {
          throw jsonError;
        }
        console.debug('stripe-config.json not available, attempting /api/dannyswok/config instead.', jsonError);
      }
    }

    try {
      cachedStripeConfig = await loadStripeConfigFromApi();
      return cachedStripeConfig;
    } catch (apiError) {
      if (!preferApiConfig) {
        throw apiError;
      }

      console.debug('/api/dannyswok/config unavailable, attempting stripe-config.json instead.', apiError);
      cachedStripeConfig = await loadStripeConfigFromJson();
      return cachedStripeConfig;
    }
  }

  async function ensureStripeInitialized() {
    if (stripeInstance) {
      return stripeInstance;
    }

    let publishableKey = getStripePublishableKeyFromDom();

    if (!publishableKey) {
      const config = await fetchStripeConfig();
      publishableKey = config.publishableKey;
    }

    if (!publishableKey) {
      throw new Error('Stripe publishable key is unavailable.');
    }

    stripeInstance = Stripe(publishableKey);
    stripeElements = stripeInstance.elements({
      appearance: {
        theme: 'stripe',
      },
    });

    return stripeInstance;
  }

  function mountCardElement() {
    if (!stripeElements || !stripeCardElementContainer) {
      throw new Error('Card element unavailable.');
    }
    if (!stripeCardElement) {
      stripeCardElement = stripeElements.create('card', {
        style: {
          base: {
            color: '#1b1b1b',
            fontFamily: 'inherit',
            fontSize: '16px',
            '::placeholder': {
              color: '#a0a0a0',
            },
          },
        },
      });
    }
    if (!cardMounted) {
      stripeCardElement.mount(stripeCardElementContainer);
      cardMounted = true;
    }
  }

  function resetPaymentStatus() {
    if (paymentStatusEl) {
      paymentStatusEl.textContent = '';
      paymentStatusEl.classList.remove('payment-status--error', 'payment-status--success');
    }
  }

  function setPaymentStatus(message, type = 'info') {
    if (!paymentStatusEl) {
      return;
    }
    paymentStatusEl.textContent = message;
    paymentStatusEl.classList.remove('payment-status--error', 'payment-status--success');
    if (type === 'error') {
      paymentStatusEl.classList.add('payment-status--error');
    } else if (type === 'success') {
      paymentStatusEl.classList.add('payment-status--success');
    }
  }

  function setApplePayCheckoutState({ loading = false, disabled = false } = {}) {
    if (!applePayCheckoutBtn) {
      return;
    }
    if (loading) {
      applePayCheckoutBtn.classList.add('is-loading');
    } else {
      applePayCheckoutBtn.classList.remove('is-loading');
    }
    applePayCheckoutBtn.disabled = Boolean(disabled || loading);
  }

  function resetApplePayCheckoutState() {
    checkoutRedirecting = false;
    setApplePayCheckoutState({ loading: false, disabled: false });
  }

  function closePaymentModal() {
    if (paymentModal) {
      paymentModal.classList.add('hidden');
      paymentModal.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('modal-open');
    currentOrderDetails = null;
    currentPaymentIntent = null;
    paymentProcessing = false;
    resetApplePayCheckoutState();
    resetPaymentStatus();
    if (confirmPaymentBtn) {
      confirmPaymentBtn.disabled = false;
      confirmPaymentBtn.classList.remove('is-loading');
    }
  }

function buildOrderDetailsForPayment() {
  const { total: subtotal, count } = calculateCartTotals();
  if (!count) {
    return null;
  }
    const fulfilmentRadio = document.querySelector('input[name="fulfilment"]:checked');
    const fulfilmentValue = fulfilmentRadio ? fulfilmentRadio.value : 'pickup';
  const fulfilment = fulfilmentValue === 'delivery' ? 'Delivery' : 'Pickup';
  const isDelivery = fulfilment === 'Delivery';
  const quote = isDelivery ? refreshDeliveryQuote() : deliveryQuoteState;
  if (isDelivery) {
    const store = getActiveStore();
    if (!store) {
      throw new Error('Select a store before requesting delivery.');
    }
    if (quote.needsLocation) {
      throw new Error('Share your delivery location to continue.');
    }
    if (!quote.withinRange) {
      throw new Error(`Delivery is limited to ${DELIVERY_DISTANCE_LIMIT_MILES} miles from the store.`);
    }
  }
  let tipAmount = 0;
  if (isDelivery) {
    if (selectedTipType === 'custom') {
      tipAmount = roundCurrency(Math.max(customTipAmount, 0));
    } else {
      const tipPercent = Number.isFinite(selectedTipPercent) ? selectedTipPercent : 0;
      tipAmount = roundCurrency(subtotal * tipPercent);
    }
  }
  const expressFee = isDelivery && selectedDeliverySpeed === 'express' ? EXPRESS_DELIVERY_FEE : 0;
  const deliveryFee = isDelivery ? roundCurrency(Math.max(quote.fee, 0)) : 0;
  const processingFee = ORDER_PROCESSING_FEE;
  const taxableAmount = subtotal + processingFee + deliveryFee + expressFee;
  const taxAmount = roundCurrency(taxableAmount * STATE_SALES_TAX_RATE);
  const feesAndEstimatedTax = roundCurrency(processingFee + taxAmount);
  const items = Object.keys(cart).map((id) => {
    const item = cart[id];
    return {
      id,
      name: item.name,
        quantity: item.quantity,
        unitPrice: item.price,
        total: roundCurrency(item.price * item.quantity),
        instructions: item.instructions || '',
      };
    });
    const notes = [];
    let scheduleDescription = '';
    if (isDelivery) {
      const dropoff = document.querySelector('input[name="dropoff"]:checked');
      if (dropoff) {
        notes.push(dropoff.value === 'door' ? 'Leave at the door' : 'Hand to customer');
      }
      const dropoffNotes = document.getElementById('dropoff-notes');
      if (dropoffNotes && dropoffNotes.value.trim()) {
        notes.push(`Instructions: ${dropoffNotes.value.trim()}`);
      }
      if (selectedDeliverySpeed === 'express') {
        notes.push('Express delivery (ETA 15 mins)');
      } else if (selectedDeliverySpeed === 'schedule') {
        const deliverySchedule = scheduleStates.delivery;
        if (deliverySchedule.confirmed && deliverySchedule.date && deliverySchedule.time) {
          scheduleDescription = `Scheduled for ${formatScheduleDate(deliverySchedule.date)} at ${formatDisplayTime(deliverySchedule.time)}`;
          notes.push(scheduleDescription);
        }
      }
    } else if (selectedPickupTimeOption === 'schedule') {
      const pickupSchedule = scheduleStates.pickup;
      if (pickupSchedule.confirmed && pickupSchedule.date && pickupSchedule.time) {
        scheduleDescription = `Pickup on ${formatScheduleDate(pickupSchedule.date)} at ${formatDisplayTime(pickupSchedule.time)}`;
        notes.push(scheduleDescription);
      } else {
        notes.push('Pickup schedule pending confirmation');
      }
    } else {
      scheduleDescription = 'Pickup window: 10 – 15 mins';
      notes.push(scheduleDescription);
    }
  if (isDelivery && tipAmount > 0) {
    notes.push(`Tip: ${formatCurrency(tipAmount)}`);
  }
  const grandTotal = roundCurrency(subtotal + processingFee + deliveryFee + expressFee + taxAmount + tipAmount);
  const deliveryName = document.getElementById('delivery-name');
  const deliveryPhone = document.getElementById('delivery-phone');
  const deliveryAddress = document.getElementById('delivery-address');
  const deliveryCity = document.getElementById('delivery-city');
  const deliveryZip = document.getElementById('delivery-zip');
    const customer = {
      name: deliveryName ? deliveryName.value.trim() : '',
      phone: deliveryPhone ? deliveryPhone.value.trim() : '',
      address: [deliveryAddress?.value.trim(), deliveryCity?.value.trim(), deliveryZip?.value.trim()]
        .filter(Boolean)
        .join(', '),
    };
    return {
    fulfilment,
    isDelivery,
    subtotal: roundCurrency(subtotal),
    tipAmount,
    expressFee,
    deliveryFee,
    processingFee,
    feesAndEstimatedTax,
    taxAmount,
    grandTotal,
    items,
    notes,
    scheduleDescription,
    customer,
    };
  }

  function buildPaymentMetadata(order) {
  const metadata = {
    fulfilment: order.fulfilment,
    subtotal: order.subtotal.toFixed(2),
    tip: order.tipAmount.toFixed(2),
    express_fee: order.expressFee.toFixed(2),
    delivery_fee: order.deliveryFee.toFixed(2),
    processing_fee: order.processingFee.toFixed(2),
    fees_estimated_tax: order.feesAndEstimatedTax.toFixed(2),
    tax: order.taxAmount.toFixed(2),
    total: order.grandTotal.toFixed(2),
  };
    if (order.scheduleDescription) {
      metadata.schedule = order.scheduleDescription;
    }
    if (order.customer?.name) {
      metadata.customer_name = order.customer.name;
    }
    if (order.customer?.phone) {
      metadata.customer_phone = order.customer.phone;
    }
    if (order.customer?.address) {
      metadata.customer_address = order.customer.address;
    }
    if (order.notes.length) {
      metadata.notes = order.notes.join(' | ').slice(0, 500);
    }
    order.items.slice(0, 5).forEach((item, index) => {
      metadata[`item_${index + 1}`] = `${item.quantity}x ${item.name}`;
    });
    if (typeof analyticsApi?.getTrackingId === 'function') {
      const trackingId = analyticsApi.getTrackingId();
      if (trackingId) {
        metadata.tracking_id = trackingId;
      }
    }
    return metadata;
  }

  async function createPaymentIntent(order) {
    const breakdown = buildPaymentRequestBreakdown(order);
    const amount = breakdown.total;
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Your cart total must be greater than zero.');
    }
    const itemsPayload = order.items.map((item) => ({
      name: item.name,
      unitPriceCents: toStripeMinorUnits(item.unitPrice),
      unit_amount: toStripeMinorUnits(item.unitPrice),
      quantity: item.quantity,
    }));
    const feesPayload = {
      taxCents: breakdown.taxCents,
      deliveryCents: breakdown.deliveryCents,
      expressCents: breakdown.expressCents,
      tipCents: breakdown.tipCents,
      serviceFeeCents: breakdown.serviceCents,
    };
    const response = await fetch(`${API_BASE}/api/dannyswok/create-payment-intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        amount,
        currency: 'usd',
        description: `${order.fulfilment} order at Danny's Wok`,
        metadata: buildPaymentMetadata(order),
        items: itemsPayload,
        fees: feesPayload,
        subtotal: order.subtotal,
        subtotalCents: breakdown.subtotalCents,
        total: order.grandTotal,
        totalCents: breakdown.total,
        fulfillment: order.isDelivery ? 'delivery' : 'pickup',
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.clientSecret) {
      throw new Error(data.message || data.error || 'Unable to start payment.');
    }
    currentPaymentIntent = {
      clientSecret: data.clientSecret,
      id: data.paymentIntentId || data.id,
      amount,
    };
  }

  async function createCheckoutSession(order) {
    const breakdown = buildPaymentRequestBreakdown(order);
    const payload = {
      order: {
        fulfilment: order.fulfilment,
        isDelivery: order.isDelivery,
        subtotal: order.subtotal,
        tipAmount: order.tipAmount,
        expressFee: order.expressFee,
        deliveryFee: order.deliveryFee,
        processingFee: order.processingFee,
        feesAndEstimatedTax: order.feesAndEstimatedTax,
        taxAmount: order.taxAmount,
        grandTotal: order.grandTotal,
        scheduleDescription: order.scheduleDescription,
        notes: order.notes,
        customer: order.customer,
        items: order.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
        })),
      },
      metadata: buildPaymentMetadata(order),
      fees: {
        taxCents: breakdown.taxCents,
        serviceFeeCents: breakdown.serviceCents,
        deliveryCents: breakdown.deliveryCents,
        expressCents: breakdown.expressCents,
        tipCents: breakdown.tipCents,
      },
      subtotalCents: breakdown.subtotalCents,
      totalCents: breakdown.total,
    };
    const response = await fetch(`${API_BASE}/api/dannyswok/create-checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      // Ignore parse errors so we can surface a generic message below.
    }
    if (!response.ok || !data?.id || !data?.url) {
      const message = data?.message || data?.error || 'Unable to start Apple Pay checkout.';
      throw new Error(message);
    }
    return data;
  }

  function renderPaymentSummary(order) {
    if (!paymentSummaryContainer) {
      return;
    }
    const itemsHtml = order.items
      .map(
        (item) =>
          `<li><span>${item.quantity}× ${item.name}</span><span>${formatCurrency(item.total)}</span></li>`,
      )
      .join('');
    const feesAndEstimatedTax = roundCurrency(order.processingFee + order.taxAmount);
    const totals = [
      `<div><span>Subtotal</span><span>${formatCurrency(order.subtotal)}</span></div>`,
      `<div><span>Fees &amp; Estimated Tax</span><span>${formatCurrency(feesAndEstimatedTax)}</span></div>`,
      order.deliveryFee > 0
        ? `<div><span>Delivery fee</span><span>${formatCurrency(order.deliveryFee)}</span></div>`
        : '',
      order.tipAmount > 0 ? `<div><span>Tip</span><span>${formatCurrency(order.tipAmount)}</span></div>` : '',
      order.expressFee > 0
        ? `<div><span>Express delivery</span><span>${formatCurrency(order.expressFee)}</span></div>`
        : '',
      `<div class="payment-order-summary__grand"><span>Total</span><span>${formatCurrency(order.grandTotal)}</span></div>`,
    ]
      .filter(Boolean)
      .join('');
    const detailParts = [order.scheduleDescription, ...order.notes.filter((note) => note !== order.scheduleDescription)];
    paymentSummaryContainer.innerHTML = `
      <h3 class="payment-order-summary__title">Your order</h3>
      <ul class="payment-order-summary__items">${itemsHtml}</ul>
      <div class="payment-order-summary__totals">${totals}</div>
      <p class="payment-order-summary__fulfilment">${[order.fulfilment, detailParts.join(' • ')].filter(Boolean).join(' • ')}</p>
    `;
  }

  function toStripeMinorUnits(value) {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number)) {
      return 0;
    }
    const cents = Math.round((number + Number.EPSILON) * 100);
    return cents >= 0 ? cents : 0;
  }

  function buildPaymentRequestBreakdown(order) {
    const subtotalCents = toStripeMinorUnits(order.subtotal);
    const taxCents = toStripeMinorUnits(order.taxAmount);
    const serviceCents = toStripeMinorUnits(order.processingFee);
    const deliveryCents = order.deliveryFee > 0 ? toStripeMinorUnits(order.deliveryFee) : 0;
    const expressCents = order.expressFee > 0 ? toStripeMinorUnits(order.expressFee) : 0;
    const tipCents = order.tipAmount > 0 ? toStripeMinorUnits(order.tipAmount) : 0;
    const feesAndEstimatedTaxCents = taxCents + serviceCents;
    const computedTotal =
      subtotalCents + feesAndEstimatedTaxCents + deliveryCents + expressCents + tipCents;
    let grandTotalCents = toStripeMinorUnits(order.grandTotal);
    if (computedTotal > 0 && Math.abs(computedTotal - grandTotalCents) <= 1) {
      grandTotalCents = computedTotal;
    }

    const displayItems = [
      { label: 'Subtotal', amount: subtotalCents },
      { label: 'Fees & Estimated Tax', amount: feesAndEstimatedTaxCents },
      ...(deliveryCents ? [{ label: 'Delivery fee', amount: deliveryCents }] : []),
      ...(expressCents ? [{ label: 'Express delivery', amount: expressCents }] : []),
      ...(tipCents ? [{ label: 'Tip', amount: tipCents }] : []),
    ];

    return {
      total: grandTotalCents,
      displayItems,
      subtotalCents,
      taxCents,
      serviceCents,
      deliveryCents,
      expressCents,
      tipCents,
    };
  }

  async function updatePaymentRequest(order) {
    if (!stripeInstance || !paymentRequestWrapper) {
      return;
    }
    const breakdown = buildPaymentRequestBreakdown(order);
    const { total: amount, displayItems } = breakdown;
    if (!paymentRequest) {
      paymentRequest = stripeInstance.paymentRequest({
        country: 'US',
        currency: 'usd',
        total: {
          label: 'Dreamworld LLC',
          amount,
        },
        displayItems,
        requestPayerName: true,
        requestPayerEmail: true,
        requestPayerPhone: true,
      });

      paymentRequest.on('paymentmethod', async (event) => {
        try {
          if (!currentPaymentIntent) {
            await createPaymentIntent(currentOrderDetails);
          }
          const confirmation = await stripeInstance.confirmCardPayment(
            currentPaymentIntent.clientSecret,
            {
              payment_method: event.paymentMethod.id,
            },
            { handleActions: false },
          );
          if (confirmation.error) {
            event.complete('fail');
            setPaymentStatus(confirmation.error.message || 'Payment failed.', 'error');
            return;
          }
          let { paymentIntent } = confirmation;
          if (paymentIntent && paymentIntent.status === 'requires_action') {
            const nextConfirmation = await stripeInstance.confirmCardPayment(
              currentPaymentIntent.clientSecret,
            );
            if (nextConfirmation.error) {
              event.complete('fail');
              setPaymentStatus(nextConfirmation.error.message || 'Payment failed.', 'error');
              return;
            }
            paymentIntent = nextConfirmation.paymentIntent;
          }
          event.complete('success');
          setPaymentStatus('Payment successful! Redirecting…', 'success');
          trackEvent(
            'purchase_complete',
            {
              method: 'payment_request',
              amount: currentOrderDetails?.grandTotal,
              fulfilment: currentOrderDetails?.fulfilment,
              paymentIntentId: paymentIntent?.id || currentPaymentIntent?.id || null,
            },
            { keepalive: true },
          );
          if (analyticsApi?.getStoredJson && analyticsApi?.setStoredJson) {
            const lastOrder = analyticsApi.getStoredJson(LAST_ORDER_STORAGE_KEY) || {};
            lastOrder.reported = true;
            analyticsApi.setStoredJson(LAST_ORDER_STORAGE_KEY, lastOrder);
          }
          setTimeout(() => {
            closePaymentModal();
            window.location.href = 'thankyou.html';
          }, 1000);
        } catch (error) {
          console.error(error);
          event.complete('fail');
          setPaymentStatus(error.message || 'Unable to complete Apple Pay payment.', 'error');
        }
      });

      paymentRequest.on('cancel', () => {
        setPaymentStatus('Apple Pay was cancelled. You can still pay with your card.', 'error');
      });

      paymentRequest.canMakePayment().then((result) => {
        walletAvailable = Boolean(result);
        if (walletAvailable) {
          if (!paymentRequestButton) {
            paymentRequestButton = stripeElements.create('paymentRequestButton', {
              paymentRequest,
              style: {
                paymentRequestButton: {
                  theme: 'dark',
                  height: '48px',
                },
              },
            });
            paymentRequestButton.mount(paymentRequestWrapper);
          }
          paymentRequestWrapper.classList.remove('hidden');
          paymentRequestWrapper.setAttribute('aria-hidden', 'false');
          if (walletHint) {
            walletHint.classList.remove('hidden');
            walletHint.setAttribute('aria-hidden', 'false');
          }
        } else {
          paymentRequestWrapper.classList.add('hidden');
          paymentRequestWrapper.setAttribute('aria-hidden', 'true');
          if (walletHint) {
            walletHint.classList.add('hidden');
            walletHint.setAttribute('aria-hidden', 'true');
          }
        }
      });
    } else {
      paymentRequest.update({
        total: {
          label: 'Dreamworld LLC',
          amount,
        },
        displayItems,
      });
    }

    if (!walletAvailable) {
      paymentRequestWrapper.classList.add('hidden');
      paymentRequestWrapper.setAttribute('aria-hidden', 'true');
      if (walletHint) {
        walletHint.classList.add('hidden');
        walletHint.setAttribute('aria-hidden', 'true');
      }
    }
  }

  async function openPaymentModal(order) {
    if (!paymentModal || !paymentAmountEl) {
      throw new Error('Payment modal is unavailable.');
    }
    if (analyticsApi?.setStoredJson) {
      const orderSnapshot = {
        storeId: activeStoreId,
        fulfilment: order.fulfilment,
        grandTotal: order.grandTotal,
        subtotal: order.subtotal,
        processingFee: order.processingFee,
        deliveryFee: order.deliveryFee,
        expressFee: order.expressFee,
        feesAndEstimatedTax: order.feesAndEstimatedTax,
        taxAmount: order.taxAmount,
        tipAmount: order.tipAmount,
        items: order.items.slice(0, 20).map((item) => ({
          id: item.id,
          name: item.name,
          quantity: item.quantity,
          total: item.total,
        })),
        timestamp: new Date().toISOString(),
        reported: false,
      };
      analyticsApi.setStoredJson(LAST_ORDER_STORAGE_KEY, orderSnapshot);
    }
    trackEvent('checkout_started', {
      subtotal: order.subtotal,
      processingFee: order.processingFee,
      deliveryFee: order.deliveryFee,
      expressFee: order.expressFee,
      feesAndEstimatedTax: order.feesAndEstimatedTax,
      taxAmount: order.taxAmount,
      tipAmount: order.tipAmount,
      grandTotal: order.grandTotal,
      fulfilment: order.fulfilment,
      itemCount: order.items.length,
    });
    currentOrderDetails = order;
    paymentModal.classList.remove('hidden');
    paymentModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    paymentAmountEl.textContent = formatCurrency(order.grandTotal);
    renderPaymentSummary(order);
    resetPaymentStatus();
    resetApplePayCheckoutState();
    if (confirmPaymentBtn) {
      confirmPaymentBtn.disabled = true;
      confirmPaymentBtn.classList.add('is-loading');
    }
    if (applePayCheckoutBtn) {
      setApplePayCheckoutState({ loading: true });
    }
    try {
      await ensureStripeInitialized();
      mountCardElement();
      await createPaymentIntent(order);
      await updatePaymentRequest(order);
      if (confirmPaymentBtn) {
        confirmPaymentBtn.disabled = false;
        confirmPaymentBtn.classList.remove('is-loading');
      }
      if (applePayCheckoutBtn) {
        setApplePayCheckoutState({ loading: false, disabled: false });
      }
      setPaymentStatus('Enter your payment details to finish.');
    } catch (error) {
      setPaymentStatus(error.message || 'Unable to start payment.', 'error');
      if (confirmPaymentBtn) {
        confirmPaymentBtn.disabled = true;
        confirmPaymentBtn.classList.remove('is-loading');
      }
      if (applePayCheckoutBtn) {
        setApplePayCheckoutState({ loading: false, disabled: true });
      }
    }
  }

  async function handleConfirmPayment() {
    if (!stripeInstance || !stripeCardElement || !currentPaymentIntent || !currentOrderDetails) {
      setPaymentStatus('Payment is not ready yet. Please try again.', 'error');
      return;
    }
    if (paymentProcessing) {
      return;
    }
    paymentProcessing = true;
    if (confirmPaymentBtn) {
      confirmPaymentBtn.disabled = true;
      confirmPaymentBtn.classList.add('is-loading');
    }
    setPaymentStatus('Processing payment…');
    const billingDetails = {};
    if (cardholderNameInput && cardholderNameInput.value.trim()) {
      billingDetails.name = cardholderNameInput.value.trim();
    }
    if (cardholderEmailInput && cardholderEmailInput.value.trim()) {
      billingDetails.email = cardholderEmailInput.value.trim();
    }
    try {
      const result = await stripeInstance.confirmCardPayment(currentPaymentIntent.clientSecret, {
        payment_method: {
          card: stripeCardElement,
          billing_details: billingDetails,
        },
      });
      if (result.error) {
        throw new Error(result.error.message || 'Payment failed.');
      }
      setPaymentStatus('Payment successful! Redirecting…', 'success');
      trackEvent(
        'purchase_complete',
        {
          method: 'card',
          amount: currentOrderDetails.grandTotal,
          fulfilment: currentOrderDetails.fulfilment,
          paymentIntentId: result.paymentIntent?.id || currentPaymentIntent?.id || null,
        },
        { keepalive: true },
      );
      if (analyticsApi?.getStoredJson && analyticsApi?.setStoredJson) {
        const lastOrder = analyticsApi.getStoredJson(LAST_ORDER_STORAGE_KEY) || {};
        lastOrder.reported = true;
        analyticsApi.setStoredJson(LAST_ORDER_STORAGE_KEY, lastOrder);
      }
      setTimeout(() => {
        closePaymentModal();
        window.location.href = 'thankyou.html';
      }, 1000);
    } catch (error) {
      setPaymentStatus(error.message || 'Unable to complete payment.', 'error');
      if (confirmPaymentBtn) {
        confirmPaymentBtn.disabled = false;
        confirmPaymentBtn.classList.remove('is-loading');
      }
      if (applePayCheckoutBtn) {
        setApplePayCheckoutState({ loading: false, disabled: false });
      }
    } finally {
      paymentProcessing = false;
    }
  }

  async function handleApplePayCheckout() {
    if (!applePayCheckoutBtn || checkoutRedirecting) {
      return;
    }
    if (!currentOrderDetails) {
      setPaymentStatus('Payment is not ready yet. Please try again.', 'error');
      return;
    }
    checkoutRedirecting = true;
    setApplePayCheckoutState({ loading: true });
    setPaymentStatus('Redirecting to Apple Pay checkout…');
    try {
      await ensureStripeInitialized();
      const session = await createCheckoutSession(currentOrderDetails);
      const { error } = await stripeInstance.redirectToCheckout({ sessionId: session.id });
      if (error) {
        throw new Error(error.message || 'Stripe Checkout redirect failed.');
      }
    } catch (error) {
      checkoutRedirecting = false;
      setApplePayCheckoutState({ loading: false, disabled: false });
      setPaymentStatus(error.message || 'Unable to start Apple Pay checkout.', 'error');
    }
  }

  if (paymentModalClose) {
    paymentModalClose.addEventListener('click', closePaymentModal);
  }
  if (paymentModal) {
    paymentModal.addEventListener('click', (event) => {
      if (event.target === paymentModal) {
        closePaymentModal();
      }
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && paymentModal && !paymentModal.classList.contains('hidden')) {
      closePaymentModal();
    }
  });
  if (confirmPaymentBtn) {
    confirmPaymentBtn.addEventListener('click', handleConfirmPayment);
  }
  if (applePayCheckoutBtn) {
    applePayCheckoutBtn.addEventListener('click', handleApplePayCheckout);
  }
  const placeOrderBtn = document.getElementById('place-order');
  if (placeOrderBtn) {
    placeOrderBtn.addEventListener('click', async () => {
      let orderDetails = null;
      try {
        orderDetails = buildOrderDetailsForPayment();
      } catch (error) {
        alert(error.message || 'Unable to prepare your order.');
        return;
      }
      if (!orderDetails) {
        alert('Add items to your cart before placing an order.');
        return;
      }
      trackEvent('place_order_clicked', {
        fulfilment: orderDetails.fulfilment,
        itemCount: orderDetails.items.length,
        grandTotal: orderDetails.grandTotal,
      });
      try {
        await openPaymentModal(orderDetails);
      } catch (error) {
        alert(error.message || 'Unable to start payment.');
      }
    });
  }
});
