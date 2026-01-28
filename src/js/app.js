// ================== FIREBASE INIT ==================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getDatabase, ref, onValue } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDg60AVfyM7sj6UhVze1gRqddp5NxtKk1w',
  authDomain: 'listrik-7facf.firebaseapp.com',
  databaseURL: 'https://listrik-7facf-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'listrik-7facf',
  storageBucket: 'listrik-7facf.firebasestorage.app',
  messagingSenderId: '725196521614',
  appId: '1:725196521614:web:5e0a5521321cb69b7849df',
  measurementId: 'G-JM6ZK8NRDC',
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ================== KONFIGURASI ==================
const OFFLINE_THRESHOLD = 2 * 60 * 1000; // 2 menit (120000 ms)
const MATOT_LIMIT = 3; // timestamp-only change berturut-turut

// State untuk setiap ESP
const espState = {};
let currentSearch = '';
let currentFilter = 'all'; // 'all', 'online', 'offline', 'matot'

// ================== FUNGSI BANTU ==================
function isDataChanged(oldData, newData) {
  if (!oldData || !newData) return true;
  return (
    oldData.Voltage !== newData.Voltage || oldData.Current !== newData.Current || oldData.Watt !== newData.Watt || oldData.Energy_kWh !== newData.Energy_kWh || oldData.Latitude !== newData.Latitude || oldData.Longitude !== newData.Longitude
  );
}

function timeAgo(timestamp) {
  if (!timestamp) return '-';
  const diff = Date.now() - timestamp;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec} detik lalu`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} menit lalu`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hari lalu`;
}

function formatUptime(uptimeTimestamp) {
  if (!uptimeTimestamp || uptimeTimestamp <= 0) return '-';
  const diff = Date.now() - uptimeTimestamp;
  if (diff < 60000) {
    const sec = Math.floor(diff / 1000);
    return `${sec} detik`;
  }
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${min} menit`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} jam`;
  const days = Math.floor(hours / 24);
  return `${days} hari`;
}

function highlightSearchText(text, search) {
  if (!search || !text) return text;
  const lowerText = text.toLowerCase();
  const lowerSearch = search.toLowerCase();
  const index = lowerText.indexOf(lowerSearch);
  if (index === -1) return text;
  const before = text.substring(0, index);
  const match = text.substring(index, index + search.length);
  const after = text.substring(index + search.length);
  return `${before}<mark class="bg-yellow-200 px-1 rounded">${match}</mark>${after}`;
}

// ================== SEARCH & FILTER ==================
function setupSearchAndFilter() {
  // Search input
  const searchInput = document.getElementById('kbdInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      currentSearch = e.target.value.toLowerCase().trim();
      renderCards();
    });
  }

  // Status filter dropdown
  const statusFilter = document.getElementById('status-filter');
  if (statusFilter) {
    statusFilter.value = currentFilter;

    statusFilter.addEventListener('change', (e) => {
      currentFilter = e.target.value;
      console.log(`🔍 Filter changed to: ${currentFilter}`);
      renderCards();
    });
  }
}

// ================== OFFLINE CHECKER ==================
function checkOfflineDevices() {
  const now = Date.now();
  let needsRender = false;
  let needsMapUpdate = false;
  Object.keys(espState).forEach((espId) => {
    const state = espState[espId];
    if (state.status === 'offline') return;
    const timeSinceLastUpdate = now - state.lastSeenTime;
    if (timeSinceLastUpdate > OFFLINE_THRESHOLD) {
      espState[espId].status = 'offline';
      espState[espId].timestampOnlyCount = 0;
      needsRender = true;
      needsMapUpdate = true;
    }
  });
  return { needsRender, needsMapUpdate };
}

// ================== FIREBASE LISTENER ==================
onValue(ref(db, 'EnergyMeter'), (snapshot) => {
  const now = Date.now();
  let needsRender = false;
  let needsMapUpdate = false;
  snapshot.forEach((child) => {
    const espId = child.key;
    const newData = child.val();
    const oldState = espState[espId];
    if (!oldState) {
      espState[espId] = {
        lastData: newData,
        lastSeenTime: newData.timestamp,
        lastUpdateTime: newData.timestamp,
        uptimeStart: newData.uptime,
        timestampOnlyCount: 0,
        status: 'pending',
        lastTimestamp: newData.timestamp,
      };
      needsRender = true;
      needsMapUpdate = true;
      return;
    }
    const timestampChanged = newData.timestamp !== oldState.lastTimestamp;
    if (timestampChanged) {
      espState[espId].lastSeenTime = newData.timestamp;
      espState[espId].lastUpdateTime = newData.timestamp;
      const dataChanged = isDataChanged(oldState.lastData, newData);
      if (dataChanged) {
        espState[espId].status = 'online';
        espState[espId].timestampOnlyCount = 0;
        if (newData.uptime) {
          espState[espId].uptimeStart = newData.uptime;
        }
      } else {
        espState[espId].timestampOnlyCount += 1;
        if (espState[espId].timestampOnlyCount >= MATOT_LIMIT) {
          espState[espId].status = 'matot';
        }
      }
      espState[espId].lastData = newData;
      espState[espId].lastTimestamp = newData.timestamp;
      needsRender = true;
      needsMapUpdate = true;
    }
  });

  const offlineCheck = checkOfflineDevices();
  if (offlineCheck.needsRender) needsRender = true;
  if (offlineCheck.needsMapUpdate) needsMapUpdate = true;

  if (needsRender) {
    renderCards();
    updateStats();
  }

  if (needsMapUpdate && map) {
    updateMapMarkers();
  }
});

// ================== RENDER CARD ==================
function renderCards() {
  const container = document.getElementById('esp-list');
  if (!container) return;

  const filteredEspIds = Object.keys(espState).filter((espId) => {
    const state = espState[espId];
    const data = state.lastData;

    if (currentFilter !== 'all' && state.status !== currentFilter) {
      return false;
    }

    if (currentSearch) {
      const espName = (data?.ESP_id || espId).toLowerCase();
      const searchLower = currentSearch.toLowerCase();
      const matchesName = espName.includes(searchLower);
      const matchesId = espId.toLowerCase().includes(searchLower);
      const matchesLocation = (data?.Latitude + ',' + data?.Longitude).toLowerCase().includes(searchLower);
      if (!matchesName && !matchesId && !matchesLocation) {
        return false;
      }
    }

    return true;
  });

  container.innerHTML = '';

  if (filteredEspIds.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-gray-500">
        <p>Tidak ada ESP yang ditemukan</p>
        <p class="text-sm mt-1">Coba dengan kata kunci lain atau pilih status berbeda</p>
      </div>
    `;
    updateFilteredStats(0);
    return;
  }

  filteredEspIds.forEach((espId) => {
    const state = espState[espId];
    const data = state.lastData;

    let statusClass = '';
    let dotClass = '';
    let statusText = '';
    let animatePulse = '';

    switch (state.status) {
      case 'pending':
        statusClass = 'bg-yellow-100 text-yellow-700 border-yellow-200';
        dotClass = 'bg-yellow-400';
        statusText = 'Pending';
        break;
      case 'online':
        statusClass = 'bg-green-100 text-green-700 border-green-200';
        dotClass = 'bg-green-500';
        statusText = 'Online';
        animatePulse = 'animate-pulse';
        break;
      case 'offline':
        statusClass = 'bg-gray-100 text-gray-700 border-gray-200';
        dotClass = 'bg-gray-400';
        statusText = 'Offline';
        break;
      case 'matot':
        statusClass = 'bg-red-100 text-red-700 border-red-200';
        dotClass = 'bg-red-500';
        statusText = 'Matot';
        animatePulse = 'animate-pulse';
        break;
    }

    const lastUpdateText = state.status === 'pending' ? '-' : timeAgo(state.lastUpdateTime);
    const uptimeText = state.status === 'pending' ? '-' : state.uptimeStart ? formatUptime(state.uptimeStart) : '-';
    const espName = data?.ESP_id || espId;
    const highlightedName = highlightSearchText(espName, currentSearch);
    const highlightedId = highlightSearchText(espId, currentSearch);

    const cardHTML = `
      <div class="bg-white rounded-lg border border-gray-200 p-4 mb-4 hover:shadow-md transition-shadow" data-esp-container="${espId}">
        <div class="flex items-start justify-between mb-3">
          <div>
            <h3 class="font-semibold text-gray-900">${highlightedName}</h3>
            <p class="text-xs text-gray-500 mt-0.5">${highlightedId}</p>
          </div>
          <div class="flex items-center gap-1.5 px-2 py-1 rounded-full border ${statusClass}">
            <div class="w-2 h-2 rounded-full ${dotClass} ${animatePulse}"></div>
            <span class="text-xs font-medium capitalize">${statusText}</span>
          </div>
        </div>
        
        <div class="space-y-2">
          <div class="flex items-start text-sm">
            <div class="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24">
                <path
                  fill="#5f5f5f"
                  d="M11.5 7A2.5 2.5 0 0 1 14 9.5a2.5 2.5 0 0 1-2.5 2.5A2.5 2.5 0 0 1 9 9.5A2.5 2.5 0 0 1 11.5 7m0 1A1.5 1.5 0 0 0 10 9.5a1.5 1.5 0 0 0 1.5 1.5A1.5 1.5 0 0 0 13 9.5A1.5 1.5 0 0 0 11.5 8m-4.7 4.36l4.7 7.73l4.7-7.73c.51-.86.8-1.81.8-2.86A5.5 5.5 0 0 0 11.5 4A5.5 5.5 0 0 0 6 9.5c0 1.05.29 2 .8 2.86m10.25.52L11.5 22l-5.55-9.12C5.35 11.89 5 10.74 5 9.5A6.5 6.5 0 0 1 11.5 3A6.5 6.5 0 0 1 18 9.5c0 1.24-.35 2.39-.95 3.38"
                />
              </svg>
              <span class="text-gray-600 text-xs">
                Lat ${data?.Latitude || '-'}, Lon ${data?.Longitude || '-'}
              </span>
            </div>
          </div>
          
          <div class="flex items-start text-sm">
            <div class="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24">
                <path fill="#7a7a7a" d="M12 20c4.4 0 8-3.6 8-8s-3.6-8-8-8s-8 3.6-8 8s3.6 8 8 8m0-18c5.5 0 10 4.5 10 10s-4.5 10-10 10S2 17.5 2 12S6.5 2 12 2m5 11.9l-.7 1.3l-5.3-2.9V7h1.5v4.4z" />
              </svg>
              <span class="text-gray-600 text-xs" data-esp-time="${espId}">
                ${lastUpdateText}
              </span>
            </div>
          </div>
          
          <div class="flex items-start text-sm mb-4">
            <div class="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24">
                <path fill="#7a7a7a" d="m16 6l2.29 2.29l-4.88 4.88l-4-4L2 16.59L3.41 18l6-6l4 4l6.3-6.29L22 12V6z" />
              </svg>
              <span class="text-gray-600 text-xs" data-esp-uptime="${espId}">
                ${uptimeText}
              </span>
            </div>
          </div>
          
          <button class="w-full py-2 px-3 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-sm font-medium transition-colors">
            Lihat di Map
          </button>
        </div>
      </div>
    `;

    container.insertAdjacentHTML('beforeend', cardHTML);
  });
}

// ================== UPDATE WAKTU REAL-TIME ==================
function updateTimes() {
  Object.keys(espState).forEach((espId) => {
    const state = espState[espId];
    const timeElement = document.querySelector(`[data-esp-time="${espId}"]`);
    if (timeElement && state.status !== 'pending') {
      timeElement.textContent = timeAgo(state.lastUpdateTime);
    }
    const uptimeElement = document.querySelector(`[data-esp-uptime="${espId}"]`);
    if (uptimeElement && state.status !== 'pending' && state.uptimeStart) {
      uptimeElement.textContent = formatUptime(state.uptimeStart);
    }
  });
}

// ================== UPDATE STATS ==================
function updateStats() {
  const total = Object.keys(espState).length;
  const online = Object.values(espState).filter((s) => s.status === 'online').length;
  const offline = Object.values(espState).filter((s) => s.status === 'offline').length;
  const matot = Object.values(espState).filter((s) => s.status === 'matot').length;
  document.getElementById('total-count').textContent = total;
  document.getElementById('online-count').textContent = online;
  document.getElementById('offline-count').textContent = offline;
  document.getElementById('matot-count').textContent = matot;
}

// ================== MAP SYSTEM ==================
let map = null;
let markers = {};
let userInteracted = false;
let initialBoundsSet = false;

function initMap() {
  map = L.map('mapid').setView([-7.7956, 110.3695], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19,
  }).addTo(map);
  map.on('zoomstart', () => (userInteracted = true));
  map.on('movestart', () => (userInteracted = true));
  map.on('dragstart', () => (userInteracted = true));
}

function updateMapMarkers() {
  let newMarkersAdded = false;
  Object.keys(markers).forEach((espId) => {
    if (!espState[espId]) {
      map.removeLayer(markers[espId]);
      delete markers[espId];
    }
  });

  Object.keys(espState).forEach((espId) => {
    const state = espState[espId];
    const data = state.lastData;
    if (!data) return;

    const lat = parseFloat(data.Latitude) || -7.7956;
    const lng = parseFloat(data.Longitude) || 110.3695;
    if (isNaN(lat) || isNaN(lng)) return;

    if (!markers[espId]) {
      markers[espId] = L.marker([lat, lng], {
        icon: createCustomIcon(state.status),
        title: data?.ESP_id || espId,
      }).addTo(map);
      markers[espId].bindPopup(createPopupContent(espId, state, data));
      setupMarkerEvents(espId);
      newMarkersAdded = true;
    } else {
      const currentIconColor = getMarkerStatusColor(markers[espId]);
      if (currentIconColor !== state.status) {
        markers[espId].setIcon(createCustomIcon(state.status));
      }
      const currentLatLng = markers[espId].getLatLng();
      const locationChanged = Math.abs(currentLatLng.lat - lat) > 0.0001 || Math.abs(currentLatLng.lng - lng) > 0.0001;
      if (locationChanged) {
        markers[espId].setLatLng([lat, lng]);
      }
      markers[espId].setPopupContent(createPopupContent(espId, state, data));
    }
  });

  const markerCount = Object.keys(markers).length;
  if (markerCount > 0 && (newMarkersAdded || !initialBoundsSet) && !userInteracted) {
    const markerGroup = L.featureGroup(Object.values(markers));
    map.fitBounds(markerGroup.getBounds(), {
      padding: [50, 50],
      maxZoom: 15,
      animate: false,
    });
    initialBoundsSet = true;
  }
}

function getMarkerStatusColor(marker) {
  if (!marker?.options?.icon?.options?.html) return 'unknown';
  const html = marker.options.icon.options.html;
  if (html.includes('#10b981')) return 'online';
  if (html.includes('#6b7280')) return 'offline';
  if (html.includes('#ef4444')) return 'matot';
  if (html.includes('#f59e0b')) return 'pending';
  return 'unknown';
}

function createCustomIcon(status) {
  const colors = { online: '#10b981', offline: '#6b7280', matot: '#ef4444', pending: '#f59e0b' };
  const color = colors[status] || '#6b7280';
  const pulse = status === 'online' || status === 'matot' ? 'animation: pulse 2s infinite;' : '';
  if (!window.iconCache) window.iconCache = {};
  const cacheKey = `${status}_${pulse ? 'pulse' : 'static'}`;
  if (!window.iconCache[cacheKey]) {
    window.iconCache[cacheKey] = L.divIcon({
      html: `<div style="width:32px;height:32px;background:${color};border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;cursor:pointer"><div style="width:8px;height:8px;background:white;border-radius:50%;${pulse}"></div></div>`,
      className: 'custom-marker',
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32],
    });
  }
  return window.iconCache[cacheKey];
}

function getStatusColor(status) {
  switch (status) {
    case 'online':
      return '#10b981';
    case 'offline':
      return '#6b7280';
    case 'matot':
      return '#ef4444';
    case 'pending':
      return '#f59e0b';
    default:
      return '#6b7280';
  }
}

function createPopupContent(espId, state, data) {
  const lastUpdate = state.status === 'pending' ? '-' : timeAgo(state.lastUpdateTime);
  const uptime = state.status === 'pending' ? '-' : state.uptimeStart ? formatUptime(state.uptimeStart) : '-';
  return `
    <div style="min-width:220px;font-family:system-ui,sans-serif">
      <div style="margin-bottom:12px">
        <h3 style="margin:0 0 4px 0;font-size:16px;font-weight:600;color:#111827">${data?.ESP_id || espId}</h3>
        <p style="margin:0;font-size:12px;color:#6b7280">${espId}</p>
      </div>
      <div style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:12px;margin-bottom:16px;background:${getStatusColor(state.status)}15;border:1px solid ${getStatusColor(state.status)}40">
        <div style="width:8px;height:8px;background:${getStatusColor(state.status)};border-radius:50%;${state.status === 'online' || state.status === 'matot' ? 'animation:pulse 2s infinite' : ''}"></div>
        <span style="font-size:12px;font-weight:500;color:${getStatusColor(state.status)};text-transform:capitalize">${state.status}</span>
      </div>
      <div style="font-size:13px;color:#374151;line-height:1.6">
        <div style="margin-bottom:8px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
            <div><strong>⚡ Voltage:</strong><br><span style="color:#6b7280" data-esp-popup-voltage="${espId}">${data?.Voltage || 0} V</span></div>
            <div><strong>🔌 Current:</strong><br><span style="color:#6b7280" data-esp-popup-current="${espId}">${data?.Current || 0} mA</span></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div><strong>💡 Watt:</strong><br><span style="color:#6b7280" data-esp-popup-watt="${espId}">${data?.Watt || 0} W</span></div>
            <div><strong>🔋 Energy:</strong><br><span style="color:#6b7280" data-esp-popup-energy="${espId}">${data?.Energy_kWh || 0} kWh</span></div>
          </div>
        </div>
        <div style="margin-bottom:8px"><strong>📍 Lokasi:</strong><br><span style="font-size:12px;color:#6b7280">${data?.Latitude || '-'}, ${data?.Longitude || '-'}</span></div>
        <div style="margin-bottom:8px"><strong>🕒 Update:</strong> <span data-esp-popup-time="${espId}">${lastUpdate}</span></div>
        <div><strong>⏱️ Uptime:</strong> <span data-esp-popup-uptime="${espId}">${uptime}</span></div>
      </div>
    </div>
  `;
}

function updatePopupContent(espId) {
  const marker = markers[espId];
  const state = espState[espId];
  if (!marker || !state || !marker.isPopupOpen()) return;
  const popupElement = marker.getPopup().getElement();
  if (!popupElement) return;
  const lastUpdateEl = popupElement.querySelector(`[data-esp-popup-time="${espId}"]`);
  const uptimeEl = popupElement.querySelector(`[data-esp-popup-uptime="${espId}"]`);
  if (lastUpdateEl && state.status !== 'pending') {
    lastUpdateEl.textContent = timeAgo(state.lastUpdateTime);
  }
  if (uptimeEl && state.uptimeStart) {
    uptimeEl.textContent = formatUptime(state.uptimeStart);
  }
  const data = state.lastData;
  if (data) {
    const voltageEl = popupElement.querySelector(`[data-esp-popup-voltage="${espId}"]`);
    const currentEl = popupElement.querySelector(`[data-esp-popup-current="${espId}"]`);
    const wattEl = popupElement.querySelector(`[data-esp-popup-watt="${espId}"]`);
    const energyEl = popupElement.querySelector(`[data-esp-popup-energy="${espId}"]`);
    if (voltageEl) voltageEl.textContent = `${data.Voltage || 0} V`;
    if (currentEl) currentEl.textContent = `${data.Current || 0} mA`;
    if (wattEl) wattEl.textContent = `${data.Watt || 0} W`;
    if (energyEl) energyEl.textContent = `${data.Energy_kWh || 0} kWh`;
  }
}

function updateAllOpenPopups() {
  Object.keys(markers).forEach((espId) => updatePopupContent(espId));
}

function setupMarkerEvents(espId) {
  markers[espId].on('popupopen', () => {
    document.querySelectorAll(`[data-esp-container="${espId}"] button`).forEach((btn) => {
      btn.textContent = 'Sedang dilihat';
      btn.classList.add('bg-blue-200');
    });
  });
  markers[espId].on('popupclose', () => {
    document.querySelectorAll(`[data-esp-container="${espId}"] button`).forEach((btn) => {
      btn.textContent = 'Lihat di Map';
      btn.classList.remove('bg-blue-200');
    });
  });
  markers[espId].on('click', () => {
    userInteracted = true;
  });
}

function fitMapToAllMarkers() {
  const markerCount = Object.keys(markers).length;
  if (markerCount > 0) {
    const markerGroup = L.featureGroup(Object.values(markers));
    map.fitBounds(markerGroup.getBounds(), { padding: [50, 50], maxZoom: 15 });
    userInteracted = false;
  }
}

function addMapControls() {
  const control = L.control({ position: 'topright' });
  control.onAdd = function () {
    const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
    div.innerHTML = `<a href="#" title="Tampilkan semua ESP" style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;background:white;border:2px solid rgba(0,0,0,0.2);border-radius:4px;font-size:18px;color:#333;text-decoration:none">🗺️</a>`;
    div.onclick = (e) => {
      e.preventDefault();
      fitMapToAllMarkers();
    };
    return div;
  };
  if (map) control.addTo(map);
}

function setupCardMapButtons() {
  document.addEventListener('click', (e) => {
    if (e.target.matches('[data-esp-container] button, [data-esp-container] button *')) {
      const button = e.target.closest('button');
      const card = button.closest('[data-esp-container]');
      const espId = card.getAttribute('data-esp-container');
      if (markers[espId]) {
        userInteracted = true;
        markers[espId].openPopup();
        map.setView(markers[espId].getLatLng(), 15);
        button.textContent = 'Sedang dilihat';
        button.classList.add('bg-blue-200');
        markers[espId].once('popupclose', () => {
          button.textContent = 'Lihat di Map';
          button.classList.remove('bg-blue-200');
        });
      }
    }
  });
}

// ================== INIT ==================
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupCardMapButtons();
  addMapControls();
  setupSearchAndFilter();
  console.log('🚀 ESP Monitor started');
});

// ================== INTERVAL ==================
setInterval(() => {
  updateTimes();
  updateAllOpenPopups();
}, 1000);

setInterval(() => {
  if (!map) return;
  const offlineCheck = checkOfflineDevices();
  if (offlineCheck.needsRender) {
    renderCards();
    updateStats();
  }
  if (offlineCheck.needsMapUpdate) {
    updateMapMarkers();
  }
}, 10000);
