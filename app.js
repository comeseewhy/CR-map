const ONTARIO_CENTER = [43.7, -79.4];
const INITIAL_ZOOM = 6;
const FOCUSED_ZOOM = 11;
const ZOOM_BUFFER = 0.45;

const DAY_CONFIG = {
  Monday: {
    shortLabel: 'Mon',
    cardClass: 'day-monday',
    badgeClass: 'day-badge--monday',
    markerClass: 'cr-marker--monday',
    color: '#2e8b57'
  },
  Tuesday: {
    shortLabel: 'Tue',
    cardClass: 'day-tuesday',
    badgeClass: 'day-badge--tuesday',
    markerClass: 'cr-marker--tuesday',
    color: '#d4af37'
  },
  Wednesday: {
    shortLabel: 'Wed',
    cardClass: 'day-wednesday',
    badgeClass: 'day-badge--wednesday',
    markerClass: 'cr-marker--wednesday',
    color: '#c0392b'
  },
  Thursday: {
    shortLabel: 'Thu',
    cardClass: 'day-thursday',
    badgeClass: 'day-badge--thursday',
    markerClass: 'cr-marker--thursday',
    color: '#e67e22'
  },
  Friday: {
    shortLabel: 'Fri',
    cardClass: 'day-friday',
    badgeClass: 'day-badge--friday',
    markerClass: 'cr-marker--friday',
    color: '#2f6fed'
  },
  Saturday: {
    shortLabel: 'Sat',
    cardClass: 'day-saturday',
    badgeClass: 'day-badge--saturday',
    markerClass: 'cr-marker--saturday',
    color: '#ff5fa2'
  },
  Sunday: {
    shortLabel: 'Sun',
    cardClass: 'day-sunday',
    badgeClass: 'day-badge--sunday',
    markerClass: 'cr-marker--sunday',
    color: '#7b4ce2'
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
const siteHeaderEl = document.querySelector('.site-header');

const map = L.map('map').setView(ONTARIO_CENTER, INITIAL_ZOOM);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19
}).addTo(map);

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const markersLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);

let allRows = [];
let filteredRows = [];
let selectedOrgId = null;
let isLocatingUser = false;
let shouldAutoFitMap = true;
let closestSession = null;
let isDistanceSorted = false;

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

function getDayColor(day) {
  const dayConfig = getDayConfig(day);
  return dayConfig ? dayConfig.color : '#7f8c8d';
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

function buildGoogleMapsUrl(row) {
  const destination = `${row.lat},${row.lng}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

function buildUserMarkerIcon() {
  return L.divIcon({
    className: '',
    html: `
      <div class="user-marker" aria-hidden="true">
        <span class="user-marker__mouth"></span>
      </div>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -14]
  });
}

function setClosestButtonLoading(isLoading) {
  isLocatingUser = isLoading;
  closestMeetingEl.disabled = isLoading;
  closestMeetingEl.textContent = isLoading ? 'Finding closest meeting…' : 'Find closest meeting';
}

function getPopupSizeConfig() {
  const isMobile = window.matchMedia('(max-width: 768px)').matches;

  if (isMobile) {
    return {
      maxWidth: 240,
      minWidth: 196,
      estimatedHeight: 132
    };
  }

  return {
    maxWidth: 248,
    minWidth: 208,
    estimatedHeight: 140
  };
}

function getHeaderCompensation() {
  const headerHeight = siteHeaderEl ? siteHeaderEl.offsetHeight : 72;
  return Math.max(32, Math.round(headerHeight * 0.45));
}

function getBaseMapPadding() {
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  const headerCompensation = getHeaderCompensation();

  if (isMobile) {
    return {
      top: 38 + headerCompensation,
      right: 24,
      bottom: 34,
      left: 24
    };
  }

  return {
    top: 30 + headerCompensation,
    right: 34,
    bottom: 34,
    left: 34
  };
}

function getSingleLocationFocusOffset() {
  const isMobile = window.matchMedia('(max-width: 768px)').matches;

  if (isMobile) {
    return { x: 0, y: 114 };
  }

  return { x: -116, y: 98 };
}

function normalizeVector(x, y) {
  const length = Math.hypot(x, y);

  if (!length) {
    return { x: 0, y: -1 };
  }

  return {
    x: x / length,
    y: y / length
  };
}

function pickPopupOffset(row) {
  const popupSize = getPopupSizeConfig();
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  const markerPoint = map.latLngToContainerPoint([row.lat, row.lng]);
  const mapSize = map.getSize();

  let popupVector = { x: 0, y: -1 };

  if (closestSession && Number.isFinite(closestSession.userLat) && Number.isFinite(closestSession.userLng)) {
    const userPoint = map.latLngToContainerPoint([closestSession.userLat, closestSession.userLng]);
    const routeVector = {
      x: markerPoint.x - userPoint.x,
      y: markerPoint.y - userPoint.y
    };

    const perpA = normalizeVector(-routeVector.y, routeVector.x);
    const perpB = normalizeVector(routeVector.y, -routeVector.x);

    const candidateDistance = isMobile ? 58 : 72;
    const candidates = [
      {
        x: perpA.x * candidateDistance,
        y: perpA.y * candidateDistance
      },
      {
        x: perpB.x * candidateDistance,
        y: perpB.y * candidateDistance
      }
    ];

    const estimatePopupBounds = (offset) => {
      const centerX = markerPoint.x + offset.x;
      const bottomY = markerPoint.y + offset.y - 10;
      const width = popupSize.maxWidth;
      const height = popupSize.estimatedHeight;

      const left = centerX - width / 2;
      const right = centerX + width / 2;
      const top = bottomY - height;
      const bottom = bottomY;

      const visibleLeft = Math.max(0, left);
      const visibleRight = Math.min(mapSize.x, right);
      const visibleTop = Math.max(0, top);
      const visibleBottom = Math.min(mapSize.y, bottom);

      const visibleWidth = Math.max(0, visibleRight - visibleLeft);
      const visibleHeight = Math.max(0, visibleBottom - visibleTop);
      const visibleArea = visibleWidth * visibleHeight;
      const totalArea = width * height;

      const topBias = (mapSize.y - top) * 0.01;
      const sideBias = Math.min(centerX, mapSize.x - centerX) * 0.005;

      return (visibleArea / totalArea) + topBias + sideBias;
    };

    popupVector = estimatePopupBounds(candidates[0]) >= estimatePopupBounds(candidates[1])
      ? normalizeVector(candidates[0].x, candidates[0].y)
      : normalizeVector(candidates[1].x, candidates[1].y);
  } else {
    popupVector = normalizeVector(isMobile ? 0 : -1, -1);
  }

  const offsetDistance = isMobile ? 54 : 66;

  return L.point(
    Math.round(popupVector.x * offsetDistance),
    Math.round(popupVector.y * offsetDistance)
  );
}

function getPaddingForPopupOffset(offset) {
  const popupSize = getPopupSizeConfig();
  const base = getBaseMapPadding();

  const leftNeed = offset.x < 0 ? Math.abs(offset.x) + Math.round(popupSize.maxWidth * 0.55) : 0;
  const rightNeed = offset.x > 0 ? Math.abs(offset.x) + Math.round(popupSize.maxWidth * 0.55) : 0;
  const topNeed = offset.y < 0 ? Math.abs(offset.y) + popupSize.estimatedHeight + 12 : 0;
  const bottomNeed = offset.y > 0 ? Math.abs(offset.y) + 34 : 0;

  return {
    paddingTopLeft: [
      Math.max(base.left, leftNeed + 16),
      Math.max(base.top, topNeed + 16)
    ],
    paddingBottomRight: [
      Math.max(base.right, rightNeed + 16),
      Math.max(base.bottom, bottomNeed + 16)
    ]
  };
}

function applyZoomBuffer() {
  const nextZoom = map.getZoom() - ZOOM_BUFFER;
  map.setZoom(nextZoom, { animate: false });
}

function buildPopupHtml(row) {
  const name = escapeHtml(row.name || 'Unnamed location');
  const address = escapeHtml(row.address || 'Address unavailable');
  const meetingLine = escapeHtml(formatMeetingLine(row));
  const notes = row.notes ? escapeHtml(row.notes) : '';
  const website = row.website ? String(row.website).trim() : '';
  const mapsUrl = buildGoogleMapsUrl(row);
  const routeColor = getDayColor(row.meeting_day);

  const distanceHtml = Number.isFinite(row.distanceKm)
    ? `<p class="popup-distance">${escapeHtml(formatDistanceKm(row.distanceKm))}</p>`
    : '';

  const notesHtml = notes
    ? `<p class="popup-notes">${notes}</p>`
    : '';

  const websiteHtml = website
    ? `<a class="popup-btn" href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer">Visit Website</a>`
    : '';

  return `
    <div class="popup-card" style="border-left-color: ${escapeHtml(routeColor)};">
      <p class="popup-title">${name}</p>
      <p class="popup-address">${address}</p>
      <p class="popup-meeting">${meetingLine}</p>
      ${distanceHtml}
      ${notesHtml}
      <div class="popup-actions">
        <a class="popup-btn" href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer">Map</a>
        ${websiteHtml}
      </div>
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

function updateMarkerPopupOffset(marker, row) {
  const popup = marker.getPopup();

  if (!popup) {
    return L.point(0, 0);
  }

  const offset = pickPopupOffset(row);
  popup.options.offset = offset;
  return offset;
}

function fitMapToRouteAndPopup(rowOverride = null) {
  if (!closestSession || !closestSession.userLat || !(rowOverride || closestSession.closestRow)) {
    return;
  }

  const activeRow = rowOverride || closestSession.closestRow;
  const marker = markerByOrgId.get(String(activeRow.org_id));
  const offset = marker ? updateMarkerPopupOffset(marker, activeRow) : L.point(0, 0);
  const padding = getPaddingForPopupOffset(offset);

  const bounds = L.latLngBounds([
    [closestSession.userLat, closestSession.userLng],
    [activeRow.lat, activeRow.lng]
  ]);

  map.fitBounds(bounds, {
    paddingTopLeft: padding.paddingTopLeft,
    paddingBottomRight: padding.paddingBottomRight,
    maxZoom: FOCUSED_ZOOM
  });

  applyZoomBuffer();
}

function renderMarkers(rows) {
  markersLayer.clearLayers();
  markerByOrgId.clear();

  const popupSize = getPopupSizeConfig();

  rows.forEach((row) => {
    const marker = L.marker([row.lat, row.lng], {
      icon: buildMarkerIcon(row)
    }).bindPopup(buildPopupHtml(row), {
      autoPan: true,
      keepInView: true,
      maxWidth: popupSize.maxWidth,
      minWidth: popupSize.minWidth,
      offset: L.point(0, -8),
      autoPanPaddingTopLeft: [24, getBaseMapPadding().top],
      autoPanPaddingBottomRight: [24, 24]
    });

    marker.on('click', () => {
      focusLocation(row.org_id, {
        openPopup: true,
        keepCurrentZoom: true
      });
    });

    marker.addTo(markersLayer);
    markerByOrgId.set(String(row.org_id), marker);
  });
}

function renderClosestSessionVisuals() {
  routeLayer.clearLayers();

  if (!closestSession || !closestSession.closestRow) {
    return;
  }

  const { userLat, userLng, closestRow } = closestSession;
  const routeColor = getDayColor(closestRow.meeting_day);

  const userMarker = L.marker([userLat, userLng], {
    icon: buildUserMarkerIcon()
  }).bindPopup('<div class="user-popup-label">Your location</div>');

  const line = L.polyline(
    [
      [userLat, userLng],
      [closestRow.lat, closestRow.lng]
    ],
    {
      color: routeColor,
      weight: 4,
      opacity: 0.9,
      dashArray: '8 6',
      lineCap: 'round',
      lineJoin: 'round'
    }
  );

  line.addTo(routeLayer);
  userMarker.addTo(routeLayer);
}

function updateStatus(rows) {
  const total = allRows.length;
  const shown = rows.length;
  const searchActive = Boolean(searchInputEl.value.trim());

  if (total === 0) {
    statusEl.textContent = 'No locations available.';
    return;
  }

  if (closestSession && closestSession.closestRow) {
    const closestRow = closestSession.closestRow;
    const distanceText = Number.isFinite(closestRow.distanceKm)
      ? formatDistanceKm(closestRow.distanceKm)
      : 'distance available';
    statusEl.textContent = `Closest displayed meeting: ${closestRow.name} (${distanceText}), sorted by distance.`;
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
}

function clearClosestSession() {
  closestSession = null;
  isDistanceSorted = false;
  routeLayer.clearLayers();
  clearDistanceData();
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

function sortRowsForDisplay(rows) {
  if (!isDistanceSorted) {
    return rows;
  }

  return [...rows].sort((a, b) => {
    const aHasDistance = Number.isFinite(a.distanceKm);
    const bHasDistance = Number.isFinite(b.distanceKm);

    if (aHasDistance && bHasDistance) {
      return a.distanceKm - b.distanceKm;
    }

    if (aHasDistance) {
      return -1;
    }

    if (bHasDistance) {
      return 1;
    }

    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

function openPopupForRow(row) {
  const marker = markerByOrgId.get(String(row.org_id));

  if (!marker) {
    return;
  }

  updateMarkerPopupOffset(marker, row);

  window.setTimeout(() => {
    marker.openPopup();
  }, 190);
}

function applyFilters() {
  const searchTerm = normalizeSearchTerm(searchInputEl.value);

  filteredRows = allRows.filter((row) => {
    const searchText = buildSearchText(row);
    const matchesSearch = !searchTerm || searchTerm
      .split(' ')
      .every((token) => !token || searchText.includes(token));
    const normalizedDay = normalizeDay(row.meeting_day);
    const matchesDay = activeDays.size === 0 || activeDays.has(normalizedDay);

    return matchesSearch && matchesDay;
  });

  filteredRows = sortRowsForDisplay(filteredRows);

  if (selectedOrgId && !filteredRows.some((row) => String(row.org_id) === String(selectedOrgId))) {
    selectedOrgId = null;
  }

  if (
    closestSession &&
    closestSession.closestRow &&
    !filteredRows.some((row) => String(row.org_id) === String(closestSession.closestRow.org_id))
  ) {
    clearClosestSession();
    filteredRows = sortRowsForDisplay(filteredRows);
  }

  renderDayToggles();
  renderMarkers(filteredRows);
  renderClosestSessionVisuals();
  renderLocationList(filteredRows);
  updateStatus(filteredRows);

  if (closestSession && closestSession.closestRow && selectedOrgId === String(closestSession.closestRow.org_id)) {
    fitMapToRouteAndPopup();
    return;
  }

  if (shouldAutoFitMap) {
    fitMapToRows(filteredRows);
  } else if (selectedOrgId) {
    const marker = markerByOrgId.get(String(selectedOrgId));
    const selectedRow = filteredRows.find((row) => String(row.org_id) === String(selectedOrgId));

    if (marker && selectedRow) {
      const latLng = marker.getLatLng();
      const nextZoom = Math.max(map.getZoom(), FOCUSED_ZOOM);
      const offset = getSingleLocationFocusOffset();
      const point = map.project(latLng, nextZoom).subtract([offset.x, offset.y]);
      const targetLatLng = map.unproject(point, nextZoom);

      updateMarkerPopupOffset(marker, selectedRow);
      map.setView(targetLatLng, nextZoom, { animate: false });
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

  const selectedRow = filteredRows.find((row) => String(row.org_id) === String(orgId));
  if (!selectedRow) {
    return;
  }

  selectedOrgId = orgId;
  shouldAutoFitMap = false;

  if (closestSession && closestSession.userLat) {
    closestSession.closestRow = selectedRow;
    renderClosestSessionVisuals();
    updateStatus(filteredRows);
    fitMapToRouteAndPopup(selectedRow);

    if (openPopup) {
      openPopupForRow(selectedRow);
    }
  } else {
    const latLng = marker.getLatLng();
    const nextZoom = keepCurrentZoom ? map.getZoom() : Math.max(map.getZoom(), FOCUSED_ZOOM);
    const offset = getSingleLocationFocusOffset();
    const point = map.project(latLng, nextZoom).subtract([offset.x, offset.y]);
    const targetLatLng = map.unproject(point, nextZoom);

    updateMarkerPopupOffset(marker, selectedRow);
    map.setView(targetLatLng, nextZoom, { animate: true });

    if (openPopup) {
      openPopupForRow(selectedRow);
    }
  }

  renderLocationList(filteredRows);
  scrollSelectedCardIntoView();
}

function toggleDay(day) {
  if (!FILTER_DAYS.includes(day)) {
    return;
  }

  shouldAutoFitMap = true;
  selectedOrgId = null;
  clearClosestSession();

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
  clearClosestSession();
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

    closestSession = {
      userLat,
      userLng,
      closestRow
    };

    isDistanceSorted = true;
    selectedOrgId = closestRow.org_id;
    shouldAutoFitMap = false;

    filteredRows = sortRowsForDisplay(filteredRows);

    renderMarkers(filteredRows);
    renderClosestSessionVisuals();
    renderLocationList(filteredRows);
    updateStatus(filteredRows);
    scrollSelectedCardIntoView();
    fitMapToRouteAndPopup(closestRow);
    openPopupForRow(closestRow);
  } catch (error) {
    clearClosestSession();

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
  clearClosestSession();
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

window.addEventListener('resize', () => {
  if (selectedOrgId && closestSession && closestSession.closestRow) {
    fitMapToRouteAndPopup();
    openPopupForRow(closestSession.closestRow);
  }
});

loadLocations();