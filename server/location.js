'use strict';

// Location security helpers: haversine distance and coordinate validity.

const EARTH_RADIUS_KM = 6371;

function isCoord(lat, lng) {
  return lat != null && lng != null &&
    Number.isFinite(parseFloat(lat)) && Number.isFinite(parseFloat(lng)) &&
    Math.abs(parseFloat(lat)) <= 90 && Math.abs(parseFloat(lng)) <= 180;
}

// Distance in km between two lon/lat points. Returns null if either is invalid.
function distanceKm(lat1, lng1, lat2, lng2) {
  if (!isCoord(lat1, lng1) || !isCoord(lat2, lng2)) return null;
  const p1 = parseFloat(lat1) * Math.PI / 180;
  const p2 = parseFloat(lat2) * Math.PI / 180;
  const dLat = (parseFloat(lat2) - parseFloat(lat1)) * Math.PI / 180;
  const dLng = (parseFloat(lng2) - parseFloat(lng1)) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

module.exports = { distanceKm, isCoord, EARTH_RADIUS_KM };
