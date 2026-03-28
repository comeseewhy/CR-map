const ONTARIO_CENTER = [43.7, -79.4];
const INITIAL_ZOOM = 6;

const { createClient } = supabase;

const statusEl = document.getElementById('status');
const locationListEl = document.getElementById('location-list');
const searchInputEl = document.getElementById('search-input');
const dayFilterEl = document.getElementById('day-filter');
const hybridOnlyEl = document.getElementById('hybrid-only');
const resetFiltersEl = document.getElementById('reset-filters');

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
const markerByOrgId = new Map();

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

function buildPopupHtml(row) {
  const name = escapeHtml(row.name || 'Unnamed location');
  const address = escapeHtml(row.address || 'Address unavailable');
  const city = escapeHtml(row.city || '');
  const province = escapeHtml(row.province || '');
  const meetingLine = escapeHtml(formatMeetingLine(row));
  const notes = row.notes ? escapeHtml(row.notes) : '';
  const website = row.website ? String(row.website).trim() : '';

  const cityProvinceLine = [city, province].filter(Boolean).join(', ');

  const websiteHtml = website
    ? `<p class="popup-line"><a href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer">Visit website</a></p>`
    : '';

  const notesHtml = notes
    ? `<p class="popup-line">${notes}</p>`
    : '';

  const hybridHtml = row.is_hybrid
    ? '<p class="popup-line">Hybrid option available</p>'
    : '';

  return `
    <div class="popup-content">
      <strong>${name}</strong>
      <p class="popup-line">${address}</p>
      <p class="popup-line">${cityProvinceLine || 'Location details unavailable'}</p>
      <p class="popup-line">${meetingLine}</p>
      ${hybridHtml}
      ${notesHtml}
      ${websiteHtml}
    </div>
  `;
}

function buildSearchText(row) {
  return [
    row.name,
    row.address,
    row.city,
    row.province,
    row.notes,
    row.website,
    row.meeting_day,
    row.meeting_time
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
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
      is_hybrid: Boolean(item.is_hybrid),
      online_day: item.online_day,
      online_time: item.online_time,
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

function renderLocationList(rows) {
  if (!rows.length) {
    locationListEl.innerHTML = '<p class="empty-state">No locations match the current filters.</p>';
    return;
  }

  locationListEl.innerHTML = rows.map((row) => {
    const isSelected = row.org_id === selectedOrgId;
    const safeName = escapeHtml(row.name || 'Unnamed location');
    const safeAddress = escapeHtml(row.address || 'Address unavailable');
    const safeCityProvince = escapeHtml(
      [row.city || '', row.province || ''].filter(Boolean).join(', ')
    );
    const safeMeetingLine = escapeHtml(formatMeetingLine(row));
    const hybridLabel = row.is_hybrid
      ? '<p>Hybrid option available</p>'
      : '';

    return `
      <button
        type="button"
        class="location-card${isSelected ? ' is-selected' : ''}"
        data-org-id="${escapeHtml(row.org_id)}"
        aria-pressed="${isSelected ? 'true' : 'false'}"
      >
        <h3>${safeName}</h3>
        <p>${safeAddress}</p>
        <p>${safeCityProvince || 'Location details unavailable'}</p>
        <p>${safeMeetingLine}</p>
        ${hybridLabel}
      </button>
    `;
  }).join('');
}

function renderMarkers(rows) {
  markersLayer.clearLayers();
  markerByOrgId.clear();

  const bounds = [];

  rows.forEach((row) => {
    const marker = L.marker([row.lat, row.lng]).bindPopup(buildPopupHtml(row));

    marker.on('click', () => {
      selectedOrgId = row.org_id;
      renderLocationList(filteredRows);
    });

    marker.addTo(markersLayer);
    markerByOrgId.set(String(row.org_id), marker);
    bounds.push([row.lat, row.lng]);
  });

  if (bounds.length === 1) {
    map.setView(bounds[0], 11);
    return;
  }

  if (bounds.length > 1) {
    map.fitBounds(bounds, {
      padding: [30, 30]
    });
  }
}

function updateStatus(rows) {
  const total = allRows.length;
  const shown = rows.length;

  if (total === 0) {
    statusEl.textContent = 'No locations available.';
    return;
  }

  if (shown === total) {
    statusEl.textContent = `${shown} location${shown === 1 ? '' : 's'} loaded.`;
    return;
  }

  statusEl.textContent = `Showing ${shown} of ${total} location${total === 1 ? '' : 's'}.`;
}

function applyFilters() {
  const searchTerm = searchInputEl.value.trim().toLowerCase();
  const selectedDay = dayFilterEl.value;
  const hybridOnly = hybridOnlyEl.checked;

  filteredRows = allRows.filter((row) => {
    const matchesSearch = !searchTerm || buildSearchText(row).includes(searchTerm);
    const matchesDay = !selectedDay || normalizeDay(row.meeting_day) === selectedDay;
    const matchesHybrid = !hybridOnly || row.is_hybrid === true;

    return matchesSearch && matchesDay && matchesHybrid;
  });

  if (selectedOrgId && !filteredRows.some((row) => row.org_id === selectedOrgId)) {
    selectedOrgId = null;
  }

  renderMarkers(filteredRows);
  renderLocationList(filteredRows);
  updateStatus(filteredRows);
}

function focusLocation(orgId) {
  const marker = markerByOrgId.get(String(orgId));

  if (!marker) {
    return;
  }

  selectedOrgId = orgId;
  renderLocationList(filteredRows);

  const latLng = marker.getLatLng();
  map.setView(latLng, Math.max(map.getZoom(), 11), { animate: true });
  marker.openPopup();
}

function resetFilters() {
  searchInputEl.value = '';
  dayFilterEl.value = '';
  hybridOnlyEl.checked = false;
  selectedOrgId = null;
  applyFilters();
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
      is_hybrid,
      online_day,
      online_time,
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

  renderMarkers(filteredRows);
  renderLocationList(filteredRows);
  updateStatus(filteredRows);
}

searchInputEl.addEventListener('input', applyFilters);
dayFilterEl.addEventListener('change', applyFilters);
hybridOnlyEl.addEventListener('change', applyFilters);
resetFiltersEl.addEventListener('click', resetFilters);

locationListEl.addEventListener('click', (event) => {
  const card = event.target.closest('.location-card');

  if (!card) {
    return;
  }

  focusLocation(card.dataset.orgId);
});

loadLocations();