const ONTARIO_CENTER = [43.7, -79.4];
const INITIAL_ZOOM = 6;
const FOCUSED_ZOOM = 11;

const DAY_CONFIG = {
  Monday: {
    shortLabel: 'Mon',
    cardClass: 'day-monday',
    badgeClass: 'day-badge--monday',
    markerClass: 'cr-marker--monday'
  },
  Tuesday: {
    shortLabel: 'Tue',
    cardClass: 'day-tuesday',
    badgeClass: 'day-badge--tuesday',
    markerClass: 'cr-marker--tuesday'
  },
  Wednesday: {
    shortLabel: 'Wed',
    cardClass: 'day-wednesday',
    badgeClass: 'day-badge--wednesday',
    markerClass: 'cr-marker--wednesday'
  },
  Thursday: {
    shortLabel: 'Thu',
    cardClass: 'day-thursday',
    badgeClass: 'day-badge--thursday',
    markerClass: 'cr-marker--thursday'
  },
  Friday: {
    shortLabel: 'Fri',
    cardClass: 'day-friday',
    badgeClass: 'day-badge--friday',
    markerClass: 'cr-marker--friday'
  },
  Saturday: {
    shortLabel: 'Sat',
    cardClass: 'day-saturday',
    badgeClass: 'day-badge--saturday',
    markerClass: 'cr-marker--saturday'
  },
  Sunday: {
    shortLabel: 'Sun',
    cardClass: 'day-sunday',
    badgeClass: 'day-badge--sunday',
    markerClass: 'cr-marker--sunday'
  }
};

const FILTER_DAYS = Object.keys(DAY_CONFIG);

const { createClient } = supabase;

const statusEl = document.getElementById('status');
const locationListEl = document.getElementById('location-list');
const searchInputEl = document.getElementById('search-input');
const resetFiltersEl = document.getElementById('reset-filters');
const closestMeetingEl = document.getElementById('closest-meeting');
const dayToggleGroupEl = document.getElementById('day-toggle-group');
const dayToggleEls = Array.from(document.querySelectorAll('.day-toggle'));

const map = L.map('map').setView(ONTARIO_CENTER, INITIAL_ZOOM);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19
}).addTo(map);

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const markersLayer = L.layerGroup().addTo(map);

let allRows = [];
let filteredRows = [];
let selectedOrgId = null;
let closestResult = null;
let isLocatingUser = false;
let shouldAutoFitMap = true;

const markerByOrgId = new Map();
const activeDays = new Set();

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeDay(dayValue) {
  if (!dayValue) {
    return '';
  }

  const trimmed = String(dayValue).trim().toLowerCase();

  const dayMap = {
    monday: 'Monday',
    tuesday: 'Tuesday',
    wednesday: 'Wednesday',
    thursday: 'Thursday',
    friday: 'Friday',
    saturday: 'Saturday',
    sunday: 'Sunday'
  };

  return dayMap[trimmed] || String(dayValue).trim();
}

function getDayConfig(day) {
  return DAY_CONFIG[normalizeDay(day)] || null;
}

function normalizeMeetingTimeForSearch(value) {
  if (!value) {
    return '';
  }

  let text = String(value).trim().toLowerCase();

  text = text.replace(/\s+/g, '');
  text = text.replace(/\./g, '');

  const compactMatch = text.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm)?$/);

  if (!compactMatch) {
    return text;
  }

  const hour = compactMatch[1];
  const minutes = compactMatch[2] || '';
  const meridiem = compactMatch[3] || '';

  const tokens = new Set();
  const hourNumber = String(Number(hour));

  if (meridiem) {
    tokens.add(`${hourNumber}${meridiem}`);

    if (minutes && minutes !== '00') {
      tokens.add(`${hourNumber}:${minutes}${meridiem}`);
    } else {
      tokens.add(`${hourNumber}:00${meridiem}`);
    }
  } else {
    tokens.add(hourNumber);

    if (minutes) {
      tokens.add(`${hourNumber}:${minutes}`);
    }
  }

  tokens.add(text);

  return Array.from(tokens).join(' ');
}

function formatMeetingLine(row) {
  const normalizedDay = normalizeDay(row.meeting_day);

  if (normalizedDay && row.meeting_time) {
    return `${normalizedDay} at ${row.meeting_time}`;
  }

  if (normalizedDay) {
    return normalizedDay;
  }

  if (row.meeting_time) {
    return row.meeting_time;
  }

  return 'Meeting time not listed';
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function calculateDistanceKm(fromLat, fromLng, toLat, toLng) {
  const earthRadiusKm = 6371;
  const deltaLat = toRadians(toLat - fromLat);
  const deltaLng = toRadians(toLng - fromLng);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(fromLat)) *
      Math.cos(toRadians(toLat)) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusKm * c;
}

function formatDistanceKm(distanceKm) {
  if (!Number.isFinite(distanceKm)) {
    return '';
  }

  if (distanceKm < 10) {
    return `${distanceKm.toFixed(1)} km away`;
  }

  return `${Math.round(distanceKm)} km away`;
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this browser.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 300000
    });
  });
}

function setClosestButtonLoading(isLoading) {
  isLocatingUser = isLoading;
  closestMeetingEl.disabled = isLoading;
  closestMeetingEl.textContent = isLoading ? 'Finding closest meeting…' : 'Find closest meeting';
}

function buildPopupHtml(row) {
  const name = escapeHtml(row.name || 'Unnamed location');
  const address = escapeHtml(row.address || 'Address unavailable');
  const city = escapeHtml(row.city || '');
  const province = escapeHtml(row.province || '');
  const meetingLine = escapeHtml(formatMeetingLine(row));
  const notes = row.notes ? escapeHtml(row.notes) : '';
  const website = row.website ? String(row.website).trim() : '';
  const dayConfig = getDayConfig(row.meeting_day);
  const badgeHtml = dayConfig
    ? `<span class="day-badge ${dayConfig.badgeClass}">${escapeHtml(dayConfig.shortLabel)}</span>`
    : '';

  const cityProvinceLine = [city, province].filter(Boolean).join(', ');
  const distanceHtml = Number.isFinite(row.distanceKm)
    ? `<p class="popup-line"><strong>${escapeHtml(formatDistanceKm(row.distanceKm))}</strong></p>`
    : '';

  const websiteHtml = website
    ? `<p class="popup-line"><a href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer">Visit website</a></p>`
    : '';

  const notesHtml = notes
    ? `<p class="popup-line">${notes}</p>`
    : '';

  return `
    <div class="popup-content">
      <strong>${name}</strong>
      <p class="popup-line">${address}</p>
      <p class="popup-line">${cityProvinceLine || 'Location details unavailable'}</p>
      <p class="popup-line">${meetingLine}</p>
      ${distanceHtml}
      ${badgeHtml}
      ${notesHtml}
      ${websiteHtml}
    </div>
  `;
}

function buildSearchText(row) {
  const normalizedMeetingTime = normalizeMeetingTimeForSearch(row.meeting_time);

  return [
    row.name,
    row.address,
    row.city,
    row.province,
    row.notes,
    row.website,
    row.meeting_day,
    row.meeting_time,
    normalizedMeetingTime
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function normalizeSearchTerm(value) {
  const raw = String(value || '').trim().toLowerCase();

  if (!raw) {
    return '';
  }

  const normalizedTime = normalizeMeetingTimeForSearch(raw);

  return `${raw} ${normalizedTime}`.trim();
}

function normalizeRows(data) {
  return data
    .filter((item) => item.locations)
    .map((item) => ({
      org_id: item.org_id,
      name: item.name,
      website: item.website,
      org_type: item.org_type,
      meeting_day: normalizeDay(item.meeting_day),
      meeting_time: item.meeting_time,
      notes: item.notes,
      loc_id: item.locations.loc_id,
      address: item.locations.address,
      city: item.locations.city,
      province: item.locations.province,
      postal_code: item.locations.postal_code,
      lat: Number(item.locations.lat),
      lng: Number(item.locations.lng)
    }))
    .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng));
}

function buildMarkerIcon(row) {
  const dayConfig = getDayConfig(row.meeting_day);
  const markerClass = dayConfig ? dayConfig.markerClass : 'cr-marker--default';

  return L.divIcon({
    className: '',
    html: `<div class="cr-marker ${markerClass}" aria-hidden="true"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10]
  });
}

function renderDayToggles() {
  dayToggleEls.forEach((button) => {
    const day = button.dataset.day;
    const isActive = activeDays.has(day);

    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function renderLocationList(rows) {
  if (!rows.length) {
    locationListEl.innerHTML = '<p class="empty-state">No locations match the current filters.</p>';
    return;
  }

  locationListEl.innerHTML = rows.map((row) => {
    const isSelected = String(row.org_id) === String(selectedOrgId);
    const safeName = escapeHtml(row.name || 'Unnamed location');
    const safeAddress = escapeHtml(row.address || 'Address unavailable');
    const safeCityProvince = escapeHtml(
      [row.city || '', row.province || ''].filter(Boolean).join(', ')
    );
    const safeMeetingLine = escapeHtml(formatMeetingLine(row));
    const safeDistance = Number.isFinite(row.distanceKm)
      ? `<p><strong>${escapeHtml(formatDistanceKm(row.distanceKm))}</strong></p>`
      : '';
    const dayConfig = getDayConfig(row.meeting_day);
    const cardDayClass = dayConfig ? dayConfig.cardClass : '';
    const badgeHtml = dayConfig
      ? `<span class="day-badge ${dayConfig.badgeClass}">${escapeHtml(dayConfig.shortLabel)}</span>`
      : '';

    return `
      <button
        type="button"
        class="location-card ${cardDayClass}${isSelected ? ' is-selected' : ''}"
        data-org-id="${escapeHtml(row.org_id)}"
        aria-pressed="${isSelected ? 'true' : 'false'}"
      >
        <h3>${safeName}</h3>
        <p>${safeAddress}</p>
        <p>${safeCityProvince || 'Location details unavailable'}</p>
        <p>${safeMeetingLine}</p>
        ${safeDistance}
        ${badgeHtml}
      </button>
    `;
  }).join('');
}

function fitMapToRows(rows) {
  const bounds = rows
    .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng))
    .map((row) => [row.lat, row.lng]);

  if (bounds.length === 1) {
    map.setView(bounds[0], FOCUSED_ZOOM);
    return;
  }

  if (bounds.length > 1) {
    map.fitBounds(bounds, {
      padding: [30, 30]
    });
  }
}

function renderMarkers(rows) {
  markersLayer.clearLayers();
  markerByOrgId.clear();

  rows.forEach((row) => {
    const marker = L.marker([row.lat, row.lng], {
      icon: buildMarkerIcon(row)
    }).bindPopup(buildPopupHtml(row));

    marker.on('click', () => {
      selectedOrgId = row.org_id;
      closestResult = row;
      renderLocationList(filteredRows);
      scrollSelectedCardIntoView();
    });

    marker.addTo(markersLayer);
    markerByOrgId.set(String(row.org_id), marker);
  });
}

function updateStatus(rows) {
  const total = allRows.length;
  const shown = rows.length;
  const searchActive = Boolean(searchInputEl.value.trim());

  if (total === 0) {
    statusEl.textContent = 'No locations available.';
    return;
  }

  if (shown === total && activeDays.size === 0 && !searchActive) {
    statusEl.textContent = `${shown} location${shown === 1 ? '' : 's'} loaded.`;
    return;
  }

  if (activeDays.size === 0) {
    statusEl.textContent = `Showing ${shown} of ${total} locations (all days).`;
    return;
  }

  const activeDayNames = FILTER_DAYS.filter((day) => activeDays.has(day));
  statusEl.textContent = `Showing ${shown} of ${total} locations (${activeDayNames.join(', ')}).`;
}

function clearDistanceData() {
  allRows.forEach((row) => {
    delete row.distanceKm;
  });

  closestResult = null;
}

function scrollSelectedCardIntoView() {
  if (!selectedOrgId) {
    return;
  }

  const selectedCard = locationListEl.querySelector(
    `.location-card[data-org-id="${CSS.escape(String(selectedOrgId))}"]`
  );

  if (!selectedCard) {
    return;
  }

  selectedCard.scrollIntoView({
    block: 'nearest',
    behavior: 'smooth'
  });
}

function applyFilters() {
  const searchTerm = normalizeSearchTerm(searchInputEl.value);

  filteredRows = allRows.filter((row) => {
    const searchText = buildSearchText(row);
    const matchesSearch = !searchTerm || searchTerm.split(' ').every((token) => !token || searchText.includes(token));
    const normalizedDay = normalizeDay(row.meeting_day);
    const matchesDay = activeDays.size === 0 || activeDays.has(normalizedDay);

    return matchesSearch && matchesDay;
  });

  if (selectedOrgId && !filteredRows.some((row) => String(row.org_id) === String(selectedOrgId))) {
    selectedOrgId = null;
  }

  renderDayToggles();
  renderMarkers(filteredRows);
  renderLocationList(filteredRows);
  updateStatus(filteredRows);

  if (shouldAutoFitMap) {
    fitMapToRows(filteredRows);
  } else if (selectedOrgId) {
    const marker = markerByOrgId.get(String(selectedOrgId));

    if (marker) {
      const latLng = marker.getLatLng();
      map.setView(latLng, Math.max(map.getZoom(), FOCUSED_ZOOM), { animate: false });
    }
  }
}

function focusLocation(orgId, options = {}) {
  const {
    openPopup = true,
    keepCurrentZoom = false
  } = options;

  const marker = markerByOrgId.get(String(orgId));

  if (!marker) {
    return;
  }

  selectedOrgId = orgId;
  shouldAutoFitMap = false;
  renderLocationList(filteredRows);
  scrollSelectedCardIntoView();

  const latLng = marker.getLatLng();
  const nextZoom = keepCurrentZoom ? map.getZoom() : Math.max(map.getZoom(), FOCUSED_ZOOM);

  map.setView(latLng, nextZoom, { animate: true });

  if (openPopup) {
    marker.openPopup();
  }
}

function toggleDay(day) {
  if (!FILTER_DAYS.includes(day)) {
    return;
  }

  shouldAutoFitMap = true;
  selectedOrgId = null;
  clearDistanceData();

  if (activeDays.has(day)) {
    activeDays.delete(day);
  } else {
    activeDays.add(day);
  }

  applyFilters();
}

function resetFilters() {
  searchInputEl.value = '';
  selectedOrgId = null;
  shouldAutoFitMap = true;
  activeDays.clear();
  clearDistanceData();
  applyFilters();
}

async function findClosestMeeting() {
  if (isLocatingUser) {
    return;
  }

  if (!filteredRows.length) {
    statusEl.textContent = 'No displayed locations are available to compare right now.';
    return;
  }

  setClosestButtonLoading(true);
  statusEl.textContent = 'Finding your location…';

  try {
    const position = await getCurrentPosition();
    const userLat = position.coords.latitude;
    const userLng = position.coords.longitude;

    filteredRows.forEach((row) => {
      row.distanceKm = calculateDistanceKm(userLat, userLng, row.lat, row.lng);
    });

    let closestRow = null;

    filteredRows.forEach((row) => {
      if (!closestRow || row.distanceKm < closestRow.distanceKm) {
        closestRow = row;
      }
    });

    if (!closestRow) {
      statusEl.textContent = 'Could not determine the closest meeting.';
      return;
    }

    closestResult = closestRow;
    selectedOrgId = closestRow.org_id;
    shouldAutoFitMap = false;

    renderMarkers(filteredRows);
    renderLocationList(filteredRows);
    focusLocation(closestRow.org_id);

    statusEl.textContent = `Closest displayed meeting: ${closestRow.name} (${formatDistanceKm(closestRow.distanceKm)}).`;
  } catch (error) {
    if (error && typeof error.code === 'number') {
      switch (error.code) {
        case 1:
          statusEl.textContent = 'Location permission was denied. Please allow location access to find the closest meeting.';
          break;
        case 2:
          statusEl.textContent = 'Your location could not be determined right now.';
          break;
        case 3:
          statusEl.textContent = 'Location request timed out. Please try again.';
          break;
        default:
          statusEl.textContent = 'Could not access your location right now.';
      }
    } else {
      statusEl.textContent = error.message || 'Could not access your location right now.';
    }
  } finally {
    setClosestButtonLoading(false);
  }
}

async function loadLocations() {
  statusEl.textContent = 'Loading locations…';

  const { data, error } = await supabaseClient
    .from('organizations')
    .select(`
      org_id,
      name,
      website,
      org_type,
      meeting_day,
      meeting_time,
      notes,
      locations (
        loc_id,
        address,
        city,
        province,
        postal_code,
        lat,
        lng
      )
    `)
    .order('name', { ascending: true });

  if (error) {
    console.error('Error loading locations:', error);
    statusEl.textContent = 'Could not load locations.';
    locationListEl.innerHTML = '<p class="empty-state">Check the browser console for details.</p>';
    return;
  }

  allRows = normalizeRows(data);
  filteredRows = [...allRows];

  renderDayToggles();
  renderMarkers(filteredRows);
  renderLocationList(filteredRows);
  updateStatus(filteredRows);
  fitMapToRows(filteredRows);
}

searchInputEl.addEventListener('input', () => {
  shouldAutoFitMap = true;
  selectedOrgId = null;
  clearDistanceData();
  applyFilters();
});

resetFiltersEl.addEventListener('click', resetFilters);
closestMeetingEl.addEventListener('click', findClosestMeeting);

dayToggleGroupEl.addEventListener('click', (event) => {
  const toggleButton = event.target.closest('.day-toggle');

  if (!toggleButton) {
    return;
  }

  toggleDay(toggleButton.dataset.day);
});

locationListEl.addEventListener('click', (event) => {
  const card = event.target.closest('.location-card');

  if (!card) {
    return;
  }

  focusLocation(card.dataset.orgId);
});

loadLocations();