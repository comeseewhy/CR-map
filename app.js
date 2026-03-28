const ONTARIO_CENTER = [43.7, -79.4];
const INITIAL_ZOOM = 6;

const { createClient } = supabase;

const statusEl = document.getElementById('status');
const locationListEl = document.getElementById('location-list');

const map = L.map('map').setView(ONTARIO_CENTER, INITIAL_ZOOM);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19
}).addTo(map);

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const markersLayer = L.layerGroup().addTo(map);

function formatMeetingLine(row) {
  if (row.meeting_day && row.meeting_time) {
    return `${row.meeting_day} at ${row.meeting_time}`;
  }

  if (row.meeting_day) {
    return row.meeting_day;
  }

  if (row.meeting_time) {
    return row.meeting_time;
  }

  return 'Meeting time not listed';
}

function buildPopupHtml(row) {
  const websiteHtml = row.website
    ? `<p class="popup-line"><a href="${row.website}" target="_blank" rel="noopener noreferrer">Visit website</a></p>`
    : '';

  const notesHtml = row.notes
    ? `<p class="popup-line">${row.notes}</p>`
    : '';

  const hybridHtml = row.is_hybrid
    ? '<p class="popup-line">Hybrid option available</p>'
    : '';

  return `
    <div class="popup-content">
      <strong>${row.name || 'Unnamed location'}</strong>
      <p class="popup-line">${row.address || 'Address unavailable'}</p>
      <p class="popup-line">${row.city || ''}${row.city && row.province ? ', ' : ''}${row.province || ''}</p>
      <p class="popup-line">${formatMeetingLine(row)}</p>
      ${hybridHtml}
      ${notesHtml}
      ${websiteHtml}
    </div>
  `;
}

function renderLocationList(rows) {
  if (!rows.length) {
    locationListEl.innerHTML = '<p>No locations found.</p>';
    return;
  }

  locationListEl.innerHTML = rows.map((row) => `
    <article class="location-card">
      <h3>${row.name || 'Unnamed location'}</h3>
      <p>${row.address || 'Address unavailable'}</p>
      <p>${row.city || ''}${row.city && row.province ? ', ' : ''}${row.province || ''}</p>
      <p>${formatMeetingLine(row)}</p>
    </article>
  `).join('');
}

function normalizeRows(data) {
  return data
    .filter((item) => item.locations)
    .map((item) => ({
      org_id: item.org_id,
      name: item.name,
      website: item.website,
      org_type: item.org_type,
      meeting_day: item.meeting_day,
      meeting_time: item.meeting_time,
      is_hybrid: item.is_hybrid,
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

function renderMarkers(rows) {
  markersLayer.clearLayers();

  const bounds = [];

  rows.forEach((row) => {
    const marker = L.marker([row.lat, row.lng])
      .bindPopup(buildPopupHtml(row));

    marker.addTo(markersLayer);
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
    locationListEl.innerHTML = '<p>Check the browser console for details.</p>';
    return;
  }

  const rows = normalizeRows(data);

  renderMarkers(rows);
  renderLocationList(rows);
  statusEl.textContent = `${rows.length} location${rows.length === 1 ? '' : 's'} loaded.`;
}

loadLocations();