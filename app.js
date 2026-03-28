const ONTARIO_CENTER = [43.7, -79.4];
const INITIAL_ZOOM = 6;

const sampleLocation = {
  name: 'Stone Church – Davenport Campus',
  address: '45 Davenport Road, Toronto, Ontario, M5R 1H2',
  city: 'Toronto',
  province: 'Ontario',
  meetingDay: 'Wednesday',
  meetingTime: '6:45 PM',
  website: 'http://www.stonechurch.ca/',
  lat: 43.6727365,
  lng: -79.3897137
};

const map = L.map('map').setView(ONTARIO_CENTER, INITIAL_ZOOM);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19
}).addTo(map);

const marker = L.marker([sampleLocation.lat, sampleLocation.lng]).addTo(map);

marker.bindPopup(`
  <div>
    <strong>${sampleLocation.name}</strong><br>
    ${sampleLocation.address}<br>
    ${sampleLocation.meetingDay} at ${sampleLocation.meetingTime}<br>
    <a href="${sampleLocation.website}" target="_blank" rel="noopener noreferrer">Visit website</a>
  </div>
`);

marker.openPopup();