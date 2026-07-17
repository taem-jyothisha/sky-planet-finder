/**
 * Sky — AR finder: grahas, nakṣatras, rāśis, ISS
 * iPhone-tuned · high-accuracy GPS · zoom · calibrate
 */
(() => {
  "use strict";

  const X = () => window.SkyExtras;
  const BASE_H_FOV = 62;
  const BASE_V_FOV = 46;

  const $ = (id) => document.getElementById(id);

  const els = {
    camera: $("camera"),
    canvas: $("skyCanvas"),
    gate: $("gate"),
    gateError: $("gateError"),
    btnGateStart: $("btnGateStart"),
    btnStart: $("btnStart"),
    btnClearTarget: $("btnClearTarget"),
    btnCalibrate: $("btnCalibrate"),
    statusChip: $("statusChip"),
    locChip: $("locChip"),
    objectList: $("objectList"),
    pointingMain: $("pointingMain"),
    pointingSub: $("pointingSub"),
    guideArrow: $("guideArrow"),
    guideText: $("guideText"),
    guideMeta: $("guideMeta"),
    lockedBadge: $("lockedBadge"),
    lockedName: $("lockedName"),
    lockedDetail: $("lockedDetail"),
    headingOffset: $("headingOffset"),
    headingOffsetVal: $("headingOffsetVal"),
    pitchOffset: $("pitchOffset"),
    pitchOffsetVal: $("pitchOffsetVal"),
    zoomVal: $("zoomVal"),
    zoomBtns: document.querySelectorAll("[data-zoom]"),
    zoomSlider: $("zoomSlider"),
    debugLine: $("debugLine"),
    layerTabs: document.querySelectorAll(".layer-tab[data-layer]"),
    listTitle: $("listTitle"),
    layerHint: $("layerHint"),
    listMeta: $("listMeta"),
    onlyAbove: $("onlyAbove"),
  };

  const ctx = els.canvas.getContext("2d");

  const state = {
    stream: null,
    videoTrack: null,
    lat: null,
    lon: null,
    elevM: 0,
    accM: null,
    headingRaw: null,
    heading: null,
    pitchRaw: null,
    pitch: null,
    roll: 0,
    headingOffset: 0,
    pitchOffset: 0,
    zoom: 1,
    zoomMin: 0.5,
    zoomMax: 8,
    hardwareZoom: false,
    targetId: null,
    /** @type {Array<object>} */
    objects: [],
    /** Only one layer shown on camera + list at a time */
    activeLayer: "graha",
    onlyAbove: true,
    running: false,
    orientReady: false,
    lastBodyCompute: 0,
    lastIssFetch: 0,
    iss: null,
    issError: null,
    geoWatchId: null,
    screenAngle: 0,
    smoothHeading: null,
    smoothPitch: null,
  };

  function setStatus(text, kind) {
    els.statusChip.textContent = text;
    els.statusChip.className = "chip " + (kind || "muted");
  }

  function setLocChip() {
    if (!els.locChip) return;
    if (state.lat == null) {
      els.locChip.textContent = "GPS…";
      return;
    }
    const acc = state.accM != null ? " ±" + Math.round(state.accM) + "m" : "";
    els.locChip.textContent =
      state.lat.toFixed(5) + ", " + state.lon.toFixed(5) + acc;
  }

  function showGateError(msg) {
    els.gateError.hidden = !msg;
    els.gateError.textContent = msg || "";
  }

  function norm360(a) {
    a = a % 360;
    if (a < 0) a += 360;
    return a;
  }

  function deltaAngle(from, to) {
    let d = norm360(to) - norm360(from);
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  }

  function compassLabel(az) {
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return dirs[Math.round(norm360(az) / 45) % 8];
  }

  function smoothAngle(prev, next, alpha) {
    if (prev == null || Number.isNaN(prev)) return next;
    return norm360(prev + deltaAngle(prev, next) * alpha);
  }

  function smoothLinear(prev, next, alpha) {
    if (prev == null || Number.isNaN(prev)) return next;
    return prev + (next - prev) * alpha;
  }

  function viewFov() {
    const z = Math.max(0.5, state.zoom || 1);
    return { h: BASE_H_FOV / z, v: BASE_V_FOV / z };
  }

  function lookAtThreshold() {
    const { h } = viewFov();
    return Math.max(2.5, Math.min(10, h * 0.14));
  }

  function lockThreshold() {
    const { h } = viewFov();
    return Math.max(1.8, Math.min(7, h * 0.1));
  }

  function cssSize() {
    return { w: window.innerWidth, h: window.innerHeight };
  }

  function updateScreenAngle() {
    const so = screen.orientation || window.screen?.orientation;
    if (so && typeof so.angle === "number") state.screenAngle = so.angle;
    else if (typeof window.orientation === "number") state.screenAngle = window.orientation;
    else state.screenAngle = window.innerWidth > window.innerHeight ? 90 : 0;
  }

  // ── Sensors ──────────────────────────────────────────────────────────

  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error((label || "Step") + " timed out (" + ms / 1000 + "s)")),
        ms
      );
      promise.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        }
      );
    });
  }

  async function requestOrientationPermission() {
    // Never block forever — iOS may leave the prompt pending
    const run = async () => {
      if (
        typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function"
      ) {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== "granted") {
          throw new Error(
            "Motion denied. Settings → Safari → Motion & Orientation → Allow."
          );
        }
      }
      if (
        typeof DeviceMotionEvent !== "undefined" &&
        typeof DeviceMotionEvent.requestPermission === "function"
      ) {
        try {
          await DeviceMotionEvent.requestPermission();
        } catch (_) {}
      }
    };
    await withTimeout(run(), 12000, "Motion permission");
  }

  function onOrientation(e) {
    updateScreenAngle();
    const beta = typeof e.beta === "number" ? e.beta : null;
    const gamma = typeof e.gamma === "number" ? e.gamma : null;
    const alpha = typeof e.alpha === "number" ? e.alpha : null;

    let heading = null;
    if (typeof e.webkitCompassHeading === "number" && !Number.isNaN(e.webkitCompassHeading)) {
      heading = e.webkitCompassHeading;
      const ang = state.screenAngle;
      if (ang === 90) heading = norm360(heading + 90);
      else if (ang === -90 || ang === 270) heading = norm360(heading - 90);
      else if (ang === 180) heading = norm360(heading + 180);
    } else if (alpha != null) {
      heading = norm360(360 - alpha);
      const ang = state.screenAngle;
      if (ang === 90) heading = norm360(heading + 90);
      else if (ang === -90 || ang === 270) heading = norm360(heading - 90);
    }

    let pitch = null;
    if (beta != null) {
      const ang = state.screenAngle;
      if (ang === 0 || ang === 180) pitch = 90 - beta;
      else if (ang === 90) pitch = gamma != null ? -gamma : 90 - beta;
      else if (ang === -90 || ang === 270) pitch = gamma != null ? gamma : 90 - beta;
      else pitch = 90 - beta;
      pitch = Math.max(-40, Math.min(95, pitch));
    }

    if (heading != null) {
      state.headingRaw = heading;
      state.smoothHeading = smoothAngle(
        state.smoothHeading,
        norm360(heading + state.headingOffset),
        0.35
      );
      state.heading = state.smoothHeading;
      state.orientReady = true;
    }
    if (pitch != null) {
      state.pitchRaw = pitch;
      state.smoothPitch = smoothLinear(
        state.smoothPitch,
        pitch + state.pitchOffset,
        0.35
      );
      state.pitch = state.smoothPitch;
    }
    if (gamma != null) state.roll = gamma;
  }

  function startOrientation() {
    window.addEventListener("deviceorientation", onOrientation, true);
    window.addEventListener("deviceorientationabsolute", onOrientation, true);
    window.addEventListener("orientationchange", updateScreenAngle);
    if (screen.orientation) {
      screen.orientation.addEventListener("change", updateScreenAngle);
    }
  }

  function applyGeo(pos) {
    state.lat = pos.coords.latitude;
    state.lon = pos.coords.longitude;
    state.accM = pos.coords.accuracy;
    if (typeof pos.coords.altitude === "number" && !Number.isNaN(pos.coords.altitude)) {
      state.elevM = pos.coords.altitude;
    }
    setLocChip();
    computeSky();
    if (state.accM != null && state.accM < 50) {
      setStatus("GPS locked ±" + Math.round(state.accM) + "m", "ok");
    } else if (state.accM != null) {
      setStatus("GPS refining ±" + Math.round(state.accM) + "m…", "warn");
    }
  }

  function getPositionOnce(options) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation not available"));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });
  }

  async function getLocation() {
    if (!navigator.geolocation) {
      throw new Error("Geolocation not available.");
    }
    // Fast path first (network/wifi), then refine with high accuracy — avoids iOS hang
    let pos = null;
    try {
      pos = await getPositionOnce({
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 60000,
      });
    } catch (_) {
      /* try high accuracy next */
    }
    if (!pos) {
      pos = await getPositionOnce({
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      });
    }
    applyGeo(pos);

    if (state.geoWatchId != null) navigator.geolocation.clearWatch(state.geoWatchId);
    state.geoWatchId = navigator.geolocation.watchPosition(
      applyGeo,
      () => {},
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
    );
  }

  /** Fallback rough location so sky math still works if GPS is denied/slow */
  async function getLocationFallback() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch("https://ipapi.co/json/", { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error("ip lookup failed");
      const data = await res.json();
      if (data.latitude != null && data.longitude != null) {
        applyGeo({
          coords: {
            latitude: data.latitude,
            longitude: data.longitude,
            accuracy: 5000,
            altitude: null,
          },
        });
        setStatus("Approx location (IP) · enable Precise GPS for accuracy", "warn");
        return true;
      }
    } catch (_) {}
    // Last resort: still open app (user can recalibrate); use equator default only as last resort
    state.lat = state.lat ?? 20;
    state.lon = state.lon ?? 78;
    state.accM = 99999;
    setLocChip();
    setStatus("No GPS · set Precise Location in Settings", "warn");
    return false;
  }

  // ── Camera + zoom ────────────────────────────────────────────────────

  async function startCamera() {
    if (!window.isSecureContext) {
      throw new Error("Need HTTPS for camera on iPhone.");
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera API not available.");
    }
    const tries = [
      {
        audio: false,
        video: {
          facingMode: { exact: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      },
      { audio: false, video: { facingMode: { ideal: "environment" } } },
      { audio: false, video: { facingMode: "environment" } },
    ];
    let lastErr = null;
    for (const c of tries) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(c);
        state.stream = stream;
        state.videoTrack = stream.getVideoTracks()[0] || null;
        els.camera.setAttribute("playsinline", "");
        els.camera.setAttribute("webkit-playsinline", "");
        els.camera.muted = true;
        els.camera.srcObject = stream;
        await els.camera.play().catch(() => {});
        setupZoomFromTrack();
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(lastErr?.message || "Camera denied.");
  }

  function setupZoomFromTrack() {
    const track = state.videoTrack;
    if (track && typeof track.getCapabilities === "function") {
      const caps = track.getCapabilities() || {};
      if (caps.zoom) {
        state.hardwareZoom = true;
        state.zoomMin = caps.zoom.min ?? 1;
        state.zoomMax = Math.min(caps.zoom.max ?? 5, 15);
        const settings = track.getSettings?.() || {};
        state.zoom = settings.zoom || Math.max(state.zoomMin, 1);
      }
    }
    if (!state.hardwareZoom) {
      state.zoomMin = 0.5;
      state.zoomMax = 8;
      state.zoom = 1;
    }
    if (els.zoomSlider) {
      els.zoomSlider.min = String(state.zoomMin);
      els.zoomSlider.max = String(state.zoomMax);
      els.zoomSlider.step = "0.1";
      els.zoomSlider.value = String(state.zoom);
    }
    applyZoom(state.zoom);
  }

  async function applyZoom(z) {
    z = Math.max(state.zoomMin, Math.min(state.zoomMax, Number(z) || 1));
    state.zoom = z;
    const track = state.videoTrack;
    if (track && state.hardwareZoom) {
      try {
        await track.applyConstraints({ advanced: [{ zoom: z }] });
        els.camera.style.transform = "scale(1)";
      } catch (_) {
        els.camera.style.transform = "scale(" + Math.max(1, z) + ")";
      }
    } else {
      els.camera.style.transform = "scale(" + Math.max(0.5, z) + ")";
    }
    els.camera.style.transformOrigin = "center center";
    if (els.zoomVal) {
      els.zoomVal.textContent =
        Math.round(state.zoom * 10) / 10 + "×" + (state.hardwareZoom ? " · hw" : " · dig");
    }
    if (els.zoomSlider) els.zoomSlider.value = String(state.zoom);
    els.zoomBtns?.forEach((btn) => {
      const v = Number(btn.getAttribute("data-zoom"));
      btn.classList.toggle("active", Math.abs(v - state.zoom) < 0.15);
    });
  }

  let pinchStartDist = null;
  let pinchStartZoom = 1;
  function touchDist(a, b) {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }
  function onTouchStart(ev) {
    if (ev.touches.length === 2) {
      pinchStartDist = touchDist(ev.touches[0], ev.touches[1]);
      pinchStartZoom = state.zoom;
    }
  }
  function onTouchMove(ev) {
    if (ev.touches.length === 2 && pinchStartDist) {
      ev.preventDefault();
      applyZoom(pinchStartZoom * (touchDist(ev.touches[0], ev.touches[1]) / pinchStartDist));
    }
  }
  function onTouchEnd(ev) {
    if (ev.touches.length < 2) pinchStartDist = null;
  }

  // ── Sky catalog ──────────────────────────────────────────────────────

  async function refreshISS(force) {
    if (!force && performance.now() - state.lastIssFetch < 4000) return;
    if (state.lat == null) return;
    state.lastIssFetch = performance.now();
    try {
      const iss = await withTimeout(X().fetchISS(), 8000, "ISS feed");
      const look = X().lookAngles(
        state.lat,
        state.lon,
        state.elevM || 0,
        iss.lat,
        iss.lon,
        (iss.altKm || 420) * 1000
      );
      state.iss = {
        ...iss,
        az: look.azimuth,
        alt: look.altitude,
        rangeKm: look.rangeKm,
      };
      state.issError = null;
    } catch (err) {
      state.issError = err.message || String(err);
    }
  }

  function computeSky() {
    if (state.lat == null || state.lon == null || typeof Astronomy === "undefined" || !X()) {
      return;
    }
    const Ex = X();
    const observer = new Astronomy.Observer(state.lat, state.lon, state.elevM || 0);
    const time = Astronomy.MakeTime(new Date());
    const aya = Ex.lahiriAyanamsa(time);
    const out = [];

    // Always compute all layers; UI shows one at a time
    for (const g of Ex.GRAHAS) {
      try {
        let az, alt, tropLon, sidLon, mag = null;
        if (g.node === "rahu") {
          tropLon = Ex.meanAscendingNode(time);
          sidLon = Ex.tropicalToSidereal(tropLon, time);
          const hor = Ex.eclipticToHorizon(tropLon, 0, time, observer);
          az = hor.azimuth;
          alt = hor.altitude;
        } else if (g.node === "ketu") {
          tropLon = Ex.norm360(Ex.meanAscendingNode(time) + 180);
          sidLon = Ex.tropicalToSidereal(tropLon, time);
          const hor = Ex.eclipticToHorizon(tropLon, 0, time, observer);
          az = hor.azimuth;
          alt = hor.altitude;
        } else {
          const equ = Astronomy.Equator(g.body, time, observer, true, true);
          const hor = Astronomy.Horizon(time, observer, equ.ra, equ.dec, "normal");
          az = hor.azimuth;
          alt = hor.altitude;
          tropLon = Ex.tropicalEclipticLon(g.body, time);
          sidLon = Ex.tropicalToSidereal(tropLon, time);
          try {
            if (g.body === "Sun") mag = -26.7;
            else mag = Astronomy.Illumination(g.body, time).mag;
          } catch (_) {}
        }
        out.push({
          id: "graha:" + g.id,
          kind: "graha",
          label: g.label,
          sub: g.en + " · " + Ex.rasiName(sidLon) + " · " + Ex.nakshatraName(sidLon),
          color: g.color,
          az,
          alt,
          mag,
          sidLon,
          tropLon,
          rasi: Ex.rasiName(sidLon),
          nakshatra: Ex.nakshatraName(sidLon),
        });
      } catch (err) {
        console.warn("graha", g.id, err);
      }
    }

    Ex.RASIS.forEach((r, i) => {
      const sidCenter = i * 30 + 15;
      const trop = Ex.siderealToTropical(sidCenter, time);
      try {
        const hor = Ex.eclipticToHorizon(trop, 0, time, observer);
        out.push({
          id: "rasi:" + r.id,
          kind: "rasi",
          label: r.label,
          sub: r.en + " rāśi · ecliptic center",
          color: "hsl(" + (i * 30) + " 70% 70%)",
          az: hor.azimuth,
          alt: hor.altitude,
          mag: null,
          sidLon: sidCenter,
          region: true,
        });
      } catch (_) {}
    });

    const width = 360 / 27;
    Ex.NAKSHATRAS.forEach((name, i) => {
      const sidCenter = i * width + width / 2;
      const trop = Ex.siderealToTropical(sidCenter, time);
      try {
        const hor = Ex.eclipticToHorizon(trop, 0, time, observer);
        out.push({
          id: "nak:" + i,
          kind: "nakshatra",
          label: name,
          sub: "Nakṣatra " + (i + 1) + " of 27",
          color: "hsl(" + ((i * 13.3 + 180) % 360) + " 65% 72%)",
          az: hor.azimuth,
          alt: hor.altitude,
          mag: null,
          sidLon: sidCenter,
          region: true,
        });
      } catch (_) {}
    });

    if (state.iss) {
      out.push({
        id: "iss",
        kind: "iss",
        label: "ISS",
        sub:
          (state.iss.alt > 0 ? "Above horizon" : "Below horizon") +
          " · " +
          Math.round(state.iss.rangeKm || 0) +
          " km" +
          (state.iss.visibility ? " · " + state.iss.visibility : ""),
        color: "#6dffa8",
        az: state.iss.az,
        alt: state.iss.alt,
        mag: state.iss.alt > 10 ? -1.5 : 0,
        rangeKm: state.iss.rangeKm,
      });
    }

    // Sort: above horizon first, then by angular distance if aiming, else alt
    out.sort((a, b) => {
      const au = a.alt > 0 ? 0 : 1;
      const bu = b.alt > 0 ? 0 : 1;
      if (au !== bu) return au - bu;
      if (state.heading != null && state.pitch != null) {
        const da = Math.hypot(deltaAngle(state.heading, a.az), a.alt - state.pitch);
        const db = Math.hypot(deltaAngle(state.heading, b.az), b.alt - state.pitch);
        return da - db;
      }
      return b.alt - a.alt;
    });

    state.objects = out;
    state._aya = aya;
    state._time = time;
  }

  // ── Projection ───────────────────────────────────────────────────────

  function project(obj) {
    if (state.heading == null || state.pitch == null) return null;
    const dAz = deltaAngle(state.heading, obj.az);
    const dAlt = obj.alt - state.pitch;
    const { w, h } = cssSize();
    const fov = viewFov();
    const x = w / 2 + (dAz / (fov.h / 2)) * (w / 2);
    const y = h / 2 - (dAlt / (fov.v / 2)) * (h / 2);
    const angDist = Math.hypot(dAz, dAlt);
    const inFov =
      Math.abs(dAz) < (fov.h / 2) * 1.05 && Math.abs(dAlt) < (fov.v / 2) * 1.05;
    return { x, y, dAz, dAlt, angDist, inFov, fov };
  }

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const { w, h } = cssSize();
    els.canvas.width = Math.round(w * dpr);
    els.canvas.height = Math.round(h * dpr);
    els.canvas.style.width = w + "px";
    els.canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ── Draw ─────────────────────────────────────────────────────────────

  function draw() {
    const { w, h } = cssSize();
    ctx.clearRect(0, 0, w, h);

    // Ecliptic guide for zodiac / nakṣatra layers
    if (state.activeLayer === "rasi" || state.activeLayer === "nakshatra") {
      drawEclipticBand(w, h);
    }

    let nearest = null;
    let nearestPointlike = null;

    // Only draw the active layer (+ keep selected target if any)
    const drawList = state.objects.filter(
      (o) => o.kind === state.activeLayer || o.id === state.targetId
    );

    for (const obj of drawList) {
      if (obj.alt < -12 && obj.id !== state.targetId) continue;
      const p = project(obj);
      if (!p) continue;

      if (obj.kind === state.activeLayer) {
        if (!nearest || p.angDist < nearest.angDist) nearest = { obj, ...p };
        const pointlike = obj.kind === "graha" || obj.kind === "iss";
        if (pointlike && (!nearestPointlike || p.angDist < nearestPointlike.angDist)) {
          nearestPointlike = { obj, ...p };
        }
      }

      const isTarget = obj.id === state.targetId;
      const drawIt =
        isTarget ||
        p.inFov ||
        (obj.kind === "graha" && p.angDist < 30) ||
        (obj.kind === "iss" && p.angDist < 40) ||
        (obj.kind === "rasi" && p.angDist < 22) ||
        (obj.kind === "nakshatra" && p.angDist < 16);

      if (!drawIt) continue;

      const px = Math.max(20, Math.min(w - 20, p.x));
      const py = Math.max(90, Math.min(h - 200, p.y));

      let r = 7;
      if (obj.kind === "iss") r = 11;
      else if (obj.kind === "rasi") r = 6;
      else if (obj.kind === "nakshatra") r = 5;
      else if (obj.label === "Sūrya") r = 15;
      else if (obj.label === "Candra") r = 13;
      else if (obj.mag != null && obj.mag < 0) r = 10;

      const alpha = p.inFov ? 1 : isTarget ? 0.85 : 0.4;
      ctx.save();
      ctx.globalAlpha = alpha;

      if (obj.kind === "rasi" || obj.kind === "nakshatra") {
        // Diamond for regions
        ctx.beginPath();
        ctx.moveTo(px, py - r - 2);
        ctx.lineTo(px + r, py);
        ctx.lineTo(px, py + r + 2);
        ctx.lineTo(px - r, py);
        ctx.closePath();
        ctx.fillStyle = obj.color;
        ctx.globalAlpha = alpha * 0.85;
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(px, py, r + 10, 0, Math.PI * 2);
        ctx.fillStyle = obj.color + "44";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = obj.color;
        ctx.fill();
        ctx.lineWidth = obj.kind === "iss" ? 2.5 : 2;
        ctx.strokeStyle = obj.kind === "iss" ? "#6dffa8" : "rgba(255,255,255,0.9)";
        ctx.stroke();
        if (obj.kind === "iss") {
          // ISS cross wings
          ctx.strokeStyle = "#6dffa8";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(px - r - 8, py);
          ctx.lineTo(px + r + 8, py);
          ctx.moveTo(px, py - r - 4);
          ctx.lineTo(px, py + r + 4);
          ctx.stroke();
        }
      }

      const kindTag =
        obj.kind === "graha"
          ? ""
          : obj.kind === "iss"
            ? " 🛰"
            : obj.kind === "rasi"
              ? " · rāśi"
              : " · nak";
      const label =
        obj.label +
        kindTag +
        (obj.alt < 0 ? " ↓" : "") +
        (!p.inFov ? " · " + p.angDist.toFixed(0) + "°" : "");
      ctx.font = (obj.kind === "nakshatra" ? "600 11px" : "700 13px") + " -apple-system, system-ui, sans-serif";
      const tw = ctx.measureText(label).width;
      const lx = px - tw / 2;
      const ly = py - r - 14;
      ctx.globalAlpha = Math.min(1, alpha + 0.15);
      ctx.fillStyle = "rgba(0,0,0,0.62)";
      roundRect(ctx, lx - 6, ly - 12, tw + 12, 20, 8);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(label, lx, ly + 2);

      if (isTarget) {
        ctx.beginPath();
        ctx.arc(px, py, r + 16, 0, Math.PI * 2);
        ctx.strokeStyle = "#ffd27a";
        ctx.lineWidth = 2.5;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    drawRadar(w, h);
    updateHud(nearestPointlike || nearest);
    updateGuide();
    updateObjectList();
    updateDebug();
  }

  function drawEclipticBand(w, h) {
    if (state.heading == null || state.pitch == null || !X() || state.lat == null) return;
    if (typeof Astronomy === "undefined") return;
    const Ex = X();
    const observer = new Astronomy.Observer(state.lat, state.lon, state.elevM || 0);
    const time = Astronomy.MakeTime(new Date());
    ctx.save();
    ctx.strokeStyle = "rgba(255, 210, 122, 0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (let lon = 0; lon <= 360; lon += 4) {
      try {
        const hor = Ex.eclipticToHorizon(lon, 0, time, observer);
        if (hor.altitude < -15) {
          started = false;
          continue;
        }
        const fake = { az: hor.azimuth, alt: hor.altitude };
        const p = project(fake);
        if (!p || !p.inFov) {
          started = false;
          continue;
        }
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else ctx.lineTo(p.x, p.y);
      } catch (_) {
        started = false;
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawRadar(w, h) {
    const cx = w - 58;
    const cy = 108;
    const R = 44;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R);
    ctx.lineTo(cx, cy + R);
    ctx.stroke();

    if (state.heading != null) {
      const fov = viewFov();
      const half = ((fov.h / 2) * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, -Math.PI / 2 - half, -Math.PI / 2 + half);
      ctx.closePath();
      ctx.fillStyle = "rgba(126,182,255,0.18)";
      ctx.fill();
    }

    for (const obj of state.objects) {
      if (obj.alt < 0 || state.heading == null) continue;
      if (obj.kind !== state.activeLayer) continue;
      const dAz = deltaAngle(state.heading, obj.az);
      const rr = R * (1 - Math.max(0, Math.min(90, obj.alt)) / 100);
      const rad = (dAz * Math.PI) / 180;
      const x = cx + Math.sin(rad) * rr;
      const y = cy - Math.cos(rad) * rr;
      ctx.beginPath();
      ctx.arc(x, y, obj.kind === "iss" ? 3.5 : 2.2, 0, Math.PI * 2);
      ctx.fillStyle = obj.color;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.restore();
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function updateHud(nearest) {
    if (state.heading == null || state.pitch == null) {
      els.pointingMain.textContent = "Aim phone at sky";
      els.pointingSub.textContent = state.orientReady
        ? "Wave phone in a figure‑8 for compass"
        : "Allow Motion";
      return;
    }
    const thr = lookAtThreshold();
    const dir = compassLabel(state.heading);
    if (nearest && nearest.angDist < thr && nearest.obj.alt > -1) {
      const o = nearest.obj;
      els.pointingMain.textContent = o.label;
      els.pointingSub.textContent =
        (o.sub || o.kind) +
        " · " +
        nearest.angDist.toFixed(1) +
        "° off center · " +
        dir;
    } else {
      els.pointingMain.textContent =
        dir + " · " + state.pitch.toFixed(0) + "° elev";
      els.pointingSub.textContent =
        nearest && nearest.obj.alt > 0
          ? "Nearest: " +
            nearest.obj.label +
            " (" +
            nearest.obj.kind +
            ") " +
            nearest.angDist.toFixed(0) +
            "° off"
          : "No object near crosshair";
    }
  }

  function updateGuide() {
    const target = state.objects.find((o) => o.id === state.targetId);
    if (!target || state.heading == null || state.pitch == null) {
      els.guideArrow.classList.add("hidden");
      els.lockedBadge.classList.add("hidden");
      els.btnClearTarget?.classList.add("hidden");
      return;
    }
    els.btnClearTarget?.classList.remove("hidden");

    if (target.alt < -2) {
      els.guideArrow.classList.remove("hidden");
      els.lockedBadge.classList.add("hidden");
      const shaft = els.guideArrow.querySelector(".arrow-shaft");
      if (shaft) shaft.style.transform = "rotate(180deg)";
      els.guideText.textContent = target.label + " below horizon";
      els.guideMeta.textContent =
        "Toward " + compassLabel(target.az) + " · alt " + target.alt.toFixed(0) + "°";
      return;
    }

    const p = project(target);
    if (!p) return;

    if (p.angDist < lockThreshold()) {
      els.guideArrow.classList.add("hidden");
      els.lockedBadge.classList.remove("hidden");
      els.lockedName.textContent = "Found · " + target.label;
      els.lockedDetail.textContent =
        (target.sub || "") +
        " · " +
        p.angDist.toFixed(1) +
        "° · " +
        target.alt.toFixed(0) +
        "° up";
      return;
    }

    els.lockedBadge.classList.add("hidden");
    els.guideArrow.classList.remove("hidden");
    const angleDeg = (Math.atan2(p.dAz, p.dAlt) * 180) / Math.PI;
    const shaft = els.guideArrow.querySelector(".arrow-shaft");
    if (shaft) shaft.style.transform = "rotate(" + angleDeg + "deg)";

    const absAz = Math.abs(p.dAz);
    const absAlt = Math.abs(p.dAlt);
    let hint;
    if (absAz > absAlt * 1.2) hint = p.dAz > 0 ? "Turn right" : "Turn left";
    else if (absAlt > absAz * 1.2) hint = p.dAlt > 0 ? "Tilt up" : "Tilt down";
    else
      hint =
        (p.dAz > 0 ? "Right" : "Left") + " + " + (p.dAlt > 0 ? "up" : "down");

    els.guideText.textContent = hint + " → " + target.label;
    els.guideMeta.textContent =
      p.angDist.toFixed(0) +
      "° · " +
      compassLabel(target.az) +
      " · " +
      target.alt.toFixed(0) +
      "° elev" +
      (target.kind ? " · " + target.kind : "");
  }

  const LAYER_COPY = {
    graha: {
      title: "Graha",
      hint: "Nine grahas · tap one for arrow guide",
    },
    nakshatra: {
      title: "Nakṣatra",
      hint: "27 lunar mansions on the ecliptic",
    },
    rasi: {
      title: "Zodiac · Rāśi",
      hint: "12 rāśis · sidereal (Lahiri)",
    },
    iss: {
      title: "ISS",
      hint: "International Space Station · live",
    },
  };

  function objectsForActiveLayer() {
    let items = state.objects.filter((o) => o.kind === state.activeLayer);
    if (state.onlyAbove) {
      items = items.filter((o) => o.alt >= -1);
      // If everything filtered out, still show below-horizon so user sees list
      if (!items.length) {
        items = state.objects.filter((o) => o.kind === state.activeLayer);
      }
    }
    // Sort: above first, then closest to aim, then by name
    items = items.slice().sort((a, b) => {
      const au = a.alt >= 0 ? 0 : 1;
      const bu = b.alt >= 0 ? 0 : 1;
      if (au !== bu) return au - bu;
      if (state.heading != null && state.pitch != null) {
        const da = Math.hypot(deltaAngle(state.heading, a.az), a.alt - state.pitch);
        const db = Math.hypot(deltaAngle(state.heading, b.az), b.alt - state.pitch);
        return da - db;
      }
      return a.label.localeCompare(b.label);
    });
    return items;
  }

  function updateLayerChrome() {
    const copy = LAYER_COPY[state.activeLayer] || LAYER_COPY.graha;
    if (els.listTitle) els.listTitle.textContent = copy.title;
    if (els.layerHint) els.layerHint.textContent = copy.hint;

    els.layerTabs?.forEach((tab) => {
      const layer = tab.getAttribute("data-layer");
      const on = layer === state.activeLayer;
      tab.classList.toggle("active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
    });

    // Counts on tabs (above horizon)
    ["graha", "nakshatra", "rasi", "iss"].forEach((kind) => {
      const n = state.objects.filter((o) => o.kind === kind && o.alt >= 0).length;
      const total = state.objects.filter((o) => o.kind === kind).length;
      const el = document.querySelector('[data-count-for="' + kind + '"]');
      if (el) el.textContent = total ? n + "/" + total : "—";
    });
  }

  function updateObjectList() {
    if (!els.objectList) return;
    updateLayerChrome();

    const items = objectsForActiveLayer();
    const cards = els.objectList.querySelectorAll(".obj-card");

    if (cards.length !== items.length) {
      buildObjectList(items);
      return;
    }

    let mismatch = false;
    items.forEach((obj, i) => {
      if (!cards[i] || cards[i].dataset.id !== obj.id) mismatch = true;
    });
    if (mismatch) {
      buildObjectList(items);
      return;
    }

    const aboveN = items.filter((o) => o.alt >= 0).length;
    if (els.listMeta) {
      els.listMeta.textContent =
        aboveN + " up · " + items.length + " listed · tap to guide";
    }

    items.forEach((obj, i) => {
      const card = cards[i];
      const meta = card.querySelector(".meta");
      const p = project(obj);
      card.classList.toggle("below", obj.alt < 0);
      card.classList.toggle("selected", state.targetId === obj.id);
      card.classList.toggle("in-view", !!(p && p.inFov && obj.alt > -1));
      if (meta) {
        meta.textContent =
          (obj.alt < 0 ? "Below · " : obj.alt.toFixed(0) + "° · ") +
          compassLabel(obj.az) +
          (p && state.heading != null ? " · " + p.angDist.toFixed(0) + "° off" : "");
      }
    });
  }

  function buildObjectList(items) {
    if (!els.objectList) return;
    if (!items) items = objectsForActiveLayer();
    updateLayerChrome();

    const aboveN = items.filter((o) => o.alt >= 0).length;
    if (els.listMeta) {
      els.listMeta.textContent =
        items.length
          ? aboveN + " up · " + items.length + " listed · tap to guide"
          : "Nothing to show";
    }

    els.objectList.innerHTML = "";
    for (const obj of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "obj-card kind-" + obj.kind;
      btn.dataset.id = obj.id;
      btn.setAttribute("role", "option");
      btn.innerHTML =
        '<span class="name"><span class="dot" style="background:' +
        obj.color +
        '"></span><span class="name-text">' +
        obj.label +
        '</span></span>' +
        (obj.sub ? '<span class="sub">' + obj.sub + "</span>" : "") +
        '<span class="meta">—</span>';
      btn.addEventListener("click", () => {
        state.targetId = state.targetId === obj.id ? null : obj.id;
        // If target is in another layer somehow, switch — usually same layer
        if (state.targetId && obj.kind !== state.activeLayer) {
          setActiveLayer(obj.kind);
        }
        updateGuide();
        updateObjectList();
      });
      els.objectList.appendChild(btn);
    }
  }

  function setActiveLayer(layer) {
    if (!LAYER_COPY[layer]) return;
    state.activeLayer = layer;
    // Clear target when switching layers unless it belongs to new layer
    if (state.targetId) {
      const t = state.objects.find((o) => o.id === state.targetId);
      if (!t || t.kind !== layer) {
        state.targetId = null;
      }
    }
    if (layer === "iss") refreshISS(true).catch(() => {});
    updateGuide();
    buildObjectList();
  }

  function updateDebug() {
    if (!els.debugLine) return;
    const fov = viewFov();
    const iss =
      state.iss
        ? " · ISS " + state.iss.alt.toFixed(0) + "°"
        : state.issError
          ? " · ISS err"
          : "";
    els.debugLine.textContent =
      "layer " +
      state.activeLayer +
      " · hdg " +
      (state.heading != null ? state.heading.toFixed(1) : "—") +
      "° · elev " +
      (state.pitch != null ? state.pitch.toFixed(1) : "—") +
      "° · FOV " +
      fov.h.toFixed(0) +
      "° · aya " +
      (state._aya != null ? state._aya.toFixed(2) + "°" : "—") +
      " Lahiri" +
      iss;
  }

  function calibrateToAim() {
    let body = state.objects.find((o) => o.id === state.targetId);
    if (!body || body.alt < -2) {
      body = state.objects.find(
        (o) =>
          o.kind === "graha" &&
          o.alt > 5 &&
          (o.label === "Candra" || o.label === "Śukra" || o.label === "Guru" || o.label === "Sūrya")
      );
    }
    if (!body || state.headingRaw == null || state.pitchRaw == null) {
      setStatus("Center Moon/Venus, select it, then Calibrate", "warn");
      return;
    }
    state.headingOffset = deltaAngle(state.headingRaw, body.az);
    state.pitchOffset = body.alt - state.pitchRaw;
    state.heading = body.az;
    state.pitch = body.alt;
    state.smoothHeading = body.az;
    state.smoothPitch = body.alt;
    if (els.headingOffset) {
      els.headingOffset.value = String(
        Math.max(-45, Math.min(45, Math.round(state.headingOffset)))
      );
      els.headingOffsetVal.textContent =
        (state.headingOffset >= 0 ? "+" : "") + state.headingOffset.toFixed(0) + "°";
    }
    if (els.pitchOffset) {
      els.pitchOffset.value = String(
        Math.max(-30, Math.min(30, Math.round(state.pitchOffset)))
      );
      els.pitchOffsetVal.textContent =
        (state.pitchOffset >= 0 ? "+" : "") + state.pitchOffset.toFixed(0) + "°";
    }
    setStatus("Calibrated on " + body.label, "ok");
  }

  // ── Loop ─────────────────────────────────────────────────────────────

  function tick(ts) {
    if (!state.running) return;
    if (ts - state.lastBodyCompute > 500) {
      computeSky();
      state.lastBodyCompute = ts;
    }
    if (ts - state.lastIssFetch > 4000) {
      refreshISS(false);
    }
    draw();
    requestAnimationFrame(tick);
  }

  async function startAll() {
    // Prevent double-taps
    if (state._starting) return;
    state._starting = true;

    showGateError("");
    if (els.btnGateStart) {
      els.btnGateStart.disabled = true;
      els.btnGateStart.textContent = "Starting…";
    }
    if (els.btnStart) els.btnStart.disabled = true;
    setStatus("Starting…", "warn");

    const notes = [];

    try {
      if (typeof Astronomy === "undefined") {
        throw new Error(
          "Astronomy library failed to load. Check network, then reload the page."
        );
      }
      if (!X()) {
        throw new Error(
          "Sky extras failed to load. Hard-refresh the page (close tab and reopen)."
        );
      }

      // 1) CAMERA FIRST — iOS requires getUserMedia close to the user tap.
      //    Requesting GPS/motion before camera often hangs Safari forever.
      setStatus("Camera…", "warn");
      showGateError("Requesting camera…");
      await withTimeout(startCamera(), 20000, "Camera");

      // 2) Motion / compass (optional if user denies)
      setStatus("Motion / compass…", "warn");
      showGateError("Requesting motion…");
      try {
        await requestOrientationPermission();
        startOrientation();
      } catch (err) {
        startOrientation(); // still listen if events exist without prompt
        notes.push("Compass: " + (err.message || "not granted"));
      }

      // 3) Location (optional fallback)
      setStatus("Location…", "warn");
      showGateError("Requesting location…");
      try {
        await withTimeout(getLocation(), 15000, "Location");
      } catch (err) {
        notes.push("GPS: " + (err.message || "failed"));
        await getLocationFallback();
      }

      // 4) ISS — never block UI
      refreshISS(true).catch(() => {});

      computeSky();
      buildObjectList();
      state.running = true;
      els.gate.classList.add("hidden");

      // Default aim so UI is usable before compass wakes
      if (state.heading == null) {
        state.heading = 0;
        state.pitch = 35;
      }

      setStatus(
        notes.length
          ? "Live (partial) · " + notes.join(" · ")
          : "Live · graha · nakṣatra · rāśi · ISS",
        notes.length ? "warn" : "ok"
      );
      requestAnimationFrame(tick);
    } catch (err) {
      console.error(err);
      const msg = err && err.message ? err.message : String(err);
      showGateError(
        msg +
          "\n\nTips: use Safari · Settings → Safari → Camera/Location/Motion Allow · " +
          "Precise Location On · reload page · try again."
      );
      setStatus("Start failed", "warn");
    } finally {
      state._starting = false;
      if (els.btnGateStart) {
        els.btnGateStart.disabled = false;
        els.btnGateStart.textContent = "Allow & start";
      }
      if (els.btnStart) els.btnStart.disabled = false;
    }
  }

  function init() {
    try {
      resizeCanvas();
    } catch (err) {
      console.error("resizeCanvas", err);
    }
    updateScreenAngle();
    window.addEventListener("resize", () => {
      resizeCanvas();
      updateScreenAngle();
    });

    const app = document.getElementById("app");
    if (app) {
      app.addEventListener("touchstart", onTouchStart, { passive: true });
      app.addEventListener("touchmove", onTouchMove, { passive: false });
      app.addEventListener("touchend", onTouchEnd, { passive: true });
    }

    // Prefer pointerup/click — more reliable on iOS than touch-only paths
    const bindStart = (el) => {
      if (!el) return;
      el.addEventListener("click", (e) => {
        e.preventDefault();
        startAll();
      });
    };
    bindStart(els.btnGateStart);
    bindStart(els.btnStart);

    // Surface load failures on the gate immediately
    if (typeof Astronomy === "undefined") {
      showGateError(
        "Astronomy library not loaded (network/CDN). Connect to the internet and reload."
      );
    } else if (!X()) {
      showGateError("Sky extras not loaded. Hard-refresh the page.");
    }
    els.btnClearTarget?.addEventListener("click", () => {
      state.targetId = null;
      updateGuide();
      updateObjectList();
    });
    els.btnCalibrate?.addEventListener("click", calibrateToAim);

    els.layerTabs?.forEach((tab) => {
      tab.addEventListener("click", () => {
        setActiveLayer(tab.getAttribute("data-layer"));
      });
    });
    els.onlyAbove?.addEventListener("change", () => {
      state.onlyAbove = !!els.onlyAbove.checked;
      buildObjectList();
    });
    updateLayerChrome();

    els.headingOffset?.addEventListener("input", () => {
      const v = Number(els.headingOffset.value) || 0;
      state.headingOffset = v;
      if (state.headingRaw != null) {
        state.heading = norm360(state.headingRaw + v);
        state.smoothHeading = state.heading;
      }
      els.headingOffsetVal.textContent = (v >= 0 ? "+" : "") + v + "°";
    });
    els.pitchOffset?.addEventListener("input", () => {
      const v = Number(els.pitchOffset.value) || 0;
      state.pitchOffset = v;
      if (state.pitchRaw != null) {
        state.pitch = state.pitchRaw + v;
        state.smoothPitch = state.pitch;
      }
      els.pitchOffsetVal.textContent = (v >= 0 ? "+" : "") + v + "°";
    });
    els.zoomSlider?.addEventListener("input", () => applyZoom(Number(els.zoomSlider.value)));
    els.zoomBtns?.forEach((btn) => {
      btn.addEventListener("click", () => applyZoom(Number(btn.getAttribute("data-zoom"))));
    });

    setStatus("Tap Start · grahas · nakṣatras · rāśis · ISS", "muted");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
