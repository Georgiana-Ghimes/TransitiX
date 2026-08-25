import { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';

/** How often we push a point while the driver is on a live route. */
const INTERVAL_MS = 30_000;
/** Ignore tiny jitter so we do not fill the trail with parking-lot noise. */
const MIN_MOVE_M = 25;

function haversineM(a, b) {
  if (!a || !b) return Infinity;
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6_371_000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Quietly streams the phone's GPS to the server while the driver has an active route.
 * No UI chrome — a toast on hard failure would only annoy someone driving.
 */
export default function DriverLocationReporter({ enabled = true, routeId = null, vehicleId = null }) {
  const [supported] = useState(() => typeof navigator !== 'undefined' && Boolean(navigator.geolocation));
  const lastSent = useRef(null);
  const watchId = useRef(null);
  const routeIdRef = useRef(routeId);
  const vehicleIdRef = useRef(vehicleId);

  useEffect(() => { routeIdRef.current = routeId; }, [routeId]);
  useEffect(() => { vehicleIdRef.current = vehicleId; }, [vehicleId]);

  useEffect(() => {
    if (!enabled || !supported) return undefined;

    let cancelled = false;
    let lastAttempt = 0;

    const send = async (coords) => {
      const now = Date.now();
      if (now - lastAttempt < INTERVAL_MS / 2) return;
      const sample = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        speed: coords.speed != null && Number.isFinite(coords.speed)
          ? Math.round(coords.speed * 3.6 * 10) / 10
          : null,
        heading: coords.heading != null && Number.isFinite(coords.heading) ? coords.heading : null,
        accuracy_m: coords.accuracy != null ? coords.accuracy : null,
        recorded_at: new Date(coords.timestamp || Date.now()).toISOString(),
        route_id: routeIdRef.current || undefined,
        vehicle_id: vehicleIdRef.current || undefined,
        ignition: true,
      };
      if (haversineM(lastSent.current, sample) < MIN_MOVE_M && now - lastAttempt < INTERVAL_MS) {
        return;
      }
      lastAttempt = now;
      try {
        await api.telematics.reportPosition(sample);
        lastSent.current = sample;
      } catch {
        // Offline / no vehicle yet — buffer is the next successful fix.
      }
    };

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (cancelled) return;
        send(pos.coords);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 }
    );

    const timer = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        (pos) => { if (!cancelled) send(pos.coords); },
        () => {},
        { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 }
      );
    }, INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, [enabled, supported]);

  return null;
}
