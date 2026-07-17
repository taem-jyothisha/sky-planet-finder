/**
 * Vedic sky helpers + ISS look angles.
 *
 * AYANĀṂŚA POLICY (hard rule):
 *   Raman (B.V. Raman / Swiss Ephemeris SIDM_RAMAN) ONLY.
 *   Lahiri, KP, Fagan-Bradley, and every other ayanāṃśa are BANNED.
 *
 * Sky pointing uses tropical ecliptic → equator → horizon (real sky).
 * Sidereal labels (rāśi / nakṣatra) use Raman only.
 */
(function (global) {
  "use strict";

  const NAKSHATRAS = [
    "Aśvinī", "Bharaṇī", "Kṛttikā", "Rohiṇī", "Mṛgaśira", "Ārdrā",
    "Punarvasu", "Puṣya", "Aśleṣā", "Maghā", "Pūrva Phalguṇī", "Uttara Phalguṇī",
    "Hasta", "Citrā", "Svātī", "Viśākhā", "Anurādhā", "Jyeṣṭhā",
    "Mūla", "Pūrva Āṣāḍhā", "Uttara Āṣāḍhā", "Śravaṇa", "Dhaniṣṭhā", "Śatabhiṣā",
    "Pūrva Bhādrapadā", "Uttara Bhādrapadā", "Revatī",
  ];

  const RASIS = [
    { id: "mesha", label: "Meṣa", en: "Aries" },
    { id: "vrishabha", label: "Vṛṣabha", en: "Taurus" },
    { id: "mithuna", label: "Mithuna", en: "Gemini" },
    { id: "karka", label: "Karka", en: "Cancer" },
    { id: "simha", label: "Siṃha", en: "Leo" },
    { id: "kanya", label: "Kanyā", en: "Virgo" },
    { id: "tula", label: "Tulā", en: "Libra" },
    { id: "vrischika", label: "Vṛścika", en: "Scorpio" },
    { id: "dhanu", label: "Dhanu", en: "Sagittarius" },
    { id: "makara", label: "Makara", en: "Capricorn" },
    { id: "kumbha", label: "Kumbha", en: "Aquarius" },
    { id: "meena", label: "Mīna", en: "Pisces" },
  ];

  const GRAHAS = [
    { id: "Sun", body: "Sun", label: "Sūrya", en: "Sun", color: "#ffd27a", kind: "graha" },
    { id: "Moon", body: "Moon", label: "Candra", en: "Moon", color: "#e8eefc", kind: "graha" },
    { id: "Mars", body: "Mars", label: "Maṅgala", en: "Mars", color: "#ff7a5c", kind: "graha" },
    { id: "Mercury", body: "Mercury", label: "Budha", en: "Mercury", color: "#c4b8a8", kind: "graha" },
    { id: "Jupiter", body: "Jupiter", label: "Guru", en: "Jupiter", color: "#f0b878", kind: "graha" },
    { id: "Venus", body: "Venus", label: "Śukra", en: "Venus", color: "#f5e6c8", kind: "graha" },
    { id: "Saturn", body: "Saturn", label: "Śani", en: "Saturn", color: "#e8d090", kind: "graha" },
    { id: "Rahu", body: null, label: "Rāhu", en: "N. node", color: "#b0a0ff", kind: "graha", node: "rahu" },
    { id: "Ketu", body: null, label: "Ketu", en: "S. node", color: "#ff9ad5", kind: "graha", node: "ketu" },
  ];

  function norm360(a) {
    a = a % 360;
    if (a < 0) a += 360;
    return a;
  }

  /**
   * Raman ayanāṃśa in degrees (Swiss Ephemeris SIDM_RAMAN).
   *
   * SE definition (Robert Hand / B.V. Raman mode):
   *   t0 = J1900.0 (JD 2415020.0)
   *   ayan(t0) = 360° − 338.98556° = 21.01444°
   *   constant rate = 50.333333333″/year (not modern variable precession)
   *
   * Never substitute Lahiri or any other ayanāṃśa here.
   */
  function ramanAyanamsa(time) {
    // Astronomy.MakeTime: time.tt = TT days since J2000.0 (JD 2451545.0)
    const jd = 2451545.0 + (time && typeof time.tt === "number" ? time.tt : 0);
    const jd1900 = 2415020.0;
    const years = (jd - jd1900) / 365.25;
    const ayan0 = 360 - 338.98556; // 21.01444°
    const rateDegPerYear = 50.333333333 / 3600; // "/yr → °/yr
    return ayan0 + rateDegPerYear * years;
  }

  /** @deprecated Use ramanAyanamsa — name kept only as alias that still returns Raman */
  function ayanamsa(time) {
    return ramanAyanamsa(time);
  }

  function tropicalToSidereal(tropLon, time) {
    return norm360(tropLon - ramanAyanamsa(time));
  }

  function siderealToTropical(sidLon, time) {
    return norm360(sidLon + ramanAyanamsa(time));
  }

  function nakshatraIndex(sidLon) {
    return Math.floor(norm360(sidLon) / (360 / 27)) % 27;
  }

  function nakshatraName(sidLon) {
    return NAKSHATRAS[nakshatraIndex(sidLon)];
  }

  function rasiIndex(sidLon) {
    return Math.floor(norm360(sidLon) / 30) % 12;
  }

  function rasiName(sidLon) {
    return RASIS[rasiIndex(sidLon)].label;
  }

  /** Degree within rāśi 0–30 */
  function degreeInRasi(sidLon) {
    return norm360(sidLon) % 30;
  }

  /** Nakṣatra pāda 1–4 */
  function nakshatraPada(sidLon) {
    const width = 360 / 27;
    const within = norm360(sidLon) % width;
    return Math.min(4, Math.floor(within / (width / 4)) + 1);
  }

  /**
   * Jyotishi sky-recognition metadata for a graha.
   * Helps answer: “Can I actually see this tonight?”
   */
  function grahaSkyRole(g, alt, mag) {
    if (g.node === "rahu" || g.node === "ketu" || g.id === "Rahu" || g.id === "Ketu") {
      return {
        code: "node",
        nakedEye: false,
        badge: "Chāyā",
        note: "Mathematical node · not a light in the sky · aim by belt + Align",
      };
    }
    if (g.body === "Sun" || g.id === "Sun") {
      return {
        code: "day",
        nakedEye: false,
        badge: "Sūrya",
        note: "Daytime body · not for night recognition",
      };
    }
    if (alt < -2) {
      return {
        code: "set",
        nakedEye: false,
        badge: "Set",
        note: "Below horizon now · note rise az for later",
      };
    }
    if (alt >= -2 && alt < 8) {
      return {
        code: "horizon",
        nakedEye: mag != null ? mag <= 2.5 : true,
        badge: "Rise/Set",
        note: "Near horizon · atmosphere · best after Align",
      };
    }
    // Naked-eye planets roughly mag ≤ ~6; practical bright cut ~2.5 for cities
    if (mag != null && mag <= 1.5) {
      return {
        code: "bright",
        nakedEye: true,
        badge: "Bright",
        note: "Strong naked-eye candidate · match color + ecliptic",
      };
    }
    if (mag != null && mag <= 4.5) {
      return {
        code: "visible",
        nakedEye: true,
        badge: "Visible",
        note: "Likely naked-eye in dark/clear sky",
      };
    }
    if (mag != null && mag > 4.5) {
      return {
        code: "faint",
        nakedEye: false,
        badge: "Faint",
        note: "Hard naked-eye · binoculars / trust AR after Align",
      };
    }
    return {
      code: "ok",
      nakedEye: alt > 10,
      badge: "Up",
      note: "Above horizon · confirm with belt + Align",
    };
  }

  /** Moon phase 0–1 (0/1 new, 0.5 full) + pakṣa label */
  function moonPhaseInfo(time) {
    try {
      const phase = Astronomy.MoonPhase(time); // 0–360 elongation-ish in some versions
      // astronomy-engine MoonPhase returns degrees 0–360 (illumination cycle)
      const deg = typeof phase === "number" ? phase : 0;
      const illum = Astronomy.Illumination("Moon", time);
      const frac = illum && illum.phase_fraction != null ? illum.phase_fraction : null;
      let paksha = "—";
      if (deg < 180) paksha = "Śukla";
      else paksha = "Kṛṣṇa";
      let shape = "Moon";
      if (frac != null) {
        if (frac < 0.05) shape = "Amāvasyā / thin";
        else if (frac < 0.35) shape = "Crescent";
        else if (frac < 0.65) shape = "Half / gibbous";
        else if (frac < 0.95) shape = "Gibbous / near pūrṇimā";
        else shape = "Pūrṇimā / full";
      }
      return { deg, frac, paksha, shape, mag: illum ? illum.mag : null };
    } catch (_) {
      return null;
    }
  }

  /**
   * Rising ecliptic point ≈ Lagna direction on the sky:
   * ecliptic altitude ~0°, azimuth in eastern semicircle (rising).
   */
  function findRisingEcliptic(time, observer) {
    let best = null;
    for (let lon = 0; lon < 360; lon += 0.5) {
      try {
        const hor = eclipticToHorizon(lon, 0, time, observer);
        // East ≈ 90°; rising half roughly az 0–180 depending on lat — use 20–160
        if (hor.azimuth < 15 || hor.azimuth > 165) continue;
        const score = Math.abs(hor.altitude) + (hor.azimuth < 40 || hor.azimuth > 140 ? 0.5 : 0);
        if (Math.abs(hor.altitude) > 2.5) continue;
        if (!best || score < best.score) {
          best = {
            tropLon: lon,
            az: hor.azimuth,
            alt: hor.altitude,
            score,
          };
        }
      } catch (_) {}
    }
    return best;
  }

  /** Mean lunar ascending node (tropical ecliptic longitude), Meeus */
  function meanAscendingNode(time) {
    const T = time.tt / 36525.0;
    const Omega =
      125.0445479 -
      1934.1362891 * T +
      0.0020754 * T * T +
      (T * T * T) / 467441.0 -
      (T * T * T * T) / 60616000.0;
    return norm360(Omega);
  }

  /**
   * True ecliptic of date (lon, lat deg) → horizontal az/alt for observer.
   * MUST use ECT (of date), not ECL (J2000 mean).
   */
  function eclipticToHorizon(lonDeg, latDeg, time, observer) {
    const lon = (lonDeg * Math.PI) / 180;
    const lat = (latDeg * Math.PI) / 180;
    const cosLat = Math.cos(lat);
    const ect = new Astronomy.Vector(
      cosLat * Math.cos(lon),
      cosLat * Math.sin(lon),
      Math.sin(lat),
      time
    );
    // True ecliptic of date → equator of date
    const rot =
      typeof Astronomy.Rotation_ECT_EQD === "function"
        ? Astronomy.Rotation_ECT_EQD(time)
        : Astronomy.Rotation_ECL_EQD(time);
    const eqd = Astronomy.RotateVector(rot, ect);
    const equ = Astronomy.EquatorFromVector(eqd);
    return Astronomy.Horizon(time, observer, equ.ra, equ.dec, "normal");
  }

  /** Geocentric tropical ecliptic longitude of a body (deg) — for Vedic labels */
  function tropicalEclipticLon(bodyId, time) {
    if (bodyId === "Moon") {
      return norm360(Astronomy.EclipticGeoMoon(time).lon);
    }
    if (bodyId === "Sun") {
      return norm360(Astronomy.SunPosition(time).elon);
    }
    // Geocentric vector → of-date ecliptic longitude (NOT heliocentric EclipticLongitude)
    const geo = Astronomy.GeoVector(bodyId, time, true);
    const ecl = Astronomy.Ecliptic(geo);
    return norm360(ecl.elon);
  }

  /**
   * Geodetic → ECEF (meters). WGS84.
   */
  function geodeticToEcef(latDeg, lonDeg, altM) {
    const a = 6378137.0;
    const f = 1 / 298.257223563;
    const e2 = f * (2 - f);
    const lat = (latDeg * Math.PI) / 180;
    const lon = (lonDeg * Math.PI) / 180;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
    return {
      x: (N + altM) * cosLat * Math.cos(lon),
      y: (N + altM) * cosLat * Math.sin(lon),
      z: (N * (1 - e2) + altM) * sinLat,
    };
  }

  /**
   * Observer + satellite geodetic → topocentric az (0=N CW) + alt (deg).
   */
  function lookAngles(obsLat, obsLon, obsAltM, satLat, satLon, satAltM) {
    const o = geodeticToEcef(obsLat, obsLon, obsAltM || 0);
    const s = geodeticToEcef(satLat, satLon, satAltM || 0);
    const dx = s.x - o.x;
    const dy = s.y - o.y;
    const dz = s.z - o.z;

    const lat = (obsLat * Math.PI) / 180;
    const lon = (obsLon * Math.PI) / 180;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const sinLon = Math.sin(lon);
    const cosLon = Math.cos(lon);

    // ECEF → ENU
    const east = -sinLon * dx + cosLon * dy;
    const north = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;
    const up = cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz;

    const range = Math.sqrt(east * east + north * north + up * up);
    const alt = (Math.asin(up / range) * 180) / Math.PI;
    let az = (Math.atan2(east, north) * 180) / Math.PI;
    if (az < 0) az += 360;
    return { azimuth: az, altitude: alt, rangeKm: range / 1000 };
  }

  async function fetchISS() {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
    try {
      const res = await fetch(
        "https://api.wheretheiss.at/v1/satellites/25544",
        { cache: "no-store", signal: ctrl ? ctrl.signal : undefined }
      );
      if (!res.ok) throw new Error("ISS feed HTTP " + res.status);
      const data = await res.json();
      return {
        lat: data.latitude,
        lon: data.longitude,
        altKm: data.altitude,
        velocity: data.velocity,
        visibility: data.visibility,
        timestamp: data.timestamp,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  global.SkyExtras = {
    NAKSHATRAS,
    RASIS,
    GRAHAS,
    norm360,
    ramanAyanamsa,
    ayanamsa, // always Raman
    tropicalToSidereal,
    siderealToTropical,
    nakshatraIndex,
    nakshatraName,
    rasiIndex,
    rasiName,
    degreeInRasi,
    nakshatraPada,
    grahaSkyRole,
    moonPhaseInfo,
    findRisingEcliptic,
    meanAscendingNode,
    eclipticToHorizon,
    tropicalEclipticLon,
    lookAngles,
    fetchISS,
  };
})(typeof window !== "undefined" ? window : globalThis);
