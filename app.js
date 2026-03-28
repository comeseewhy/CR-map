const SUPABASE_URL = 'https://fqdqdamvblfozniciukq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_THnJhXqkBXgiOGvjqeXgDQ_XgU3Tuq9';

const ONTARIO_CENTER = [43.7, -79.4];
const INITIAL_ZOOM = 6;

const map = L.map('map').setView(ONTARIO_CENTER, INITIAL_ZOOM);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19
}).addTo(map);

const statusEl = document.getElementById('status');
const locationListEl = document.getElementById('location-list');

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function buildPopupHtml(row) {
  const websiteHtml = row.website
    ? `<a href="${row.website}" target="_blank" rel="noopener noreferrer">Visit website</a>`
    : '';

  const notesHtml = row.notes ? `<br>${row.notes}` : '';

  return `
    <div>
      <strong>${row.name}</strong><br>
      ${row.address}<br>
      ${row.meeting_day} at ${row.meeting_time}
      ${notesHtml}
      ${websiteHtml ? `<br>${websiteHtml}` : ''}
    </div>
  `;
}

function renderLocationList(rows) {
  if (!rows.length) {
    locationListEl.innerHTML = '<p>No locations found.</p>';
    return;
  }

  locationListEl.innerHTML = rows.map((row) => `
    <div class="location-card">
      <strong>${row.name}</strong><br>
      <span>${row.city}</span><br>
      <span>${row.meeting_day} at ${row.meeting_time}</span>
    </div>
  `).join('');
}

async function loadLocations() {
  statusEl.textContent = 'Loading locations...';

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
    return;
  }

  const rows = data
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
      lat: item.locations.lat,
      lng: item.locations.lng
    }));

  rows.forEach((row) => {
    L.marker([row.lat, row.lng])
      .addTo(map)
      .bindPopup(buildPopupHtml(row));
  });

  renderLocationList(rows);
  statusEl.textContent = `${rows.length} locations loaded.`;
}

loadLocations();