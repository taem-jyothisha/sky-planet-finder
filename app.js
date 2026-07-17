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
    layerBtns: document.querySelectorAll("[data-layer]"),
    listTitle: $("listTitle"),
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
    layers: { graha: true, nakshatra: true, rasi: true, iss: true },
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

  async function requestOrientationPermission() {
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== "granted") {
        throw new Error(
          "Motion / compass denied. Settings → Safari → Motion & Orientation → Allow."
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

  async function getLocation() {
    if (!navigator.geolocation) throw new Error("Geolocation not available.");
    const first = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 25000,
        maximumAge: 0,
      });
    });
    applyGeo(first);
    if (state.geoWatchId != null) navigator.geolocation.clearWatch(state.geoWatchId);
    state.geoWatchId = navigator.geolocation.watchPosition(applyGeo, () => {}, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 20000,
    });
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
    if (!state.layers.iss) return;
    if (!force && performance.now() - state.lastIssFetch < 4000) return;
    if (state.lat == null) return;
    state.lastIssFetch = performance.now();
    try {
      const iss = await X().fetchISS();
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

    // ── Grahas ──
    if (state.layers.graha) {
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
    }

    // ── Rāśis (center of each 30° sidereal sign on ecliptic) ──
    if (state.layers.rasi) {
      Ex.RASIS.forEach((r, i) => {
        const sidCenter = i * 30 + 15;
        const trop = Ex.siderealToTropical(sidCenter, time);
        try {
          const hor = Ex.eclipticToHorizon(trop, 0, time, observer);
          out.push({
            id: "rasi:" + r.id,
            kind: "rasi",
            label: r.label,
            sub: r.en + " · center",
            color: "hsl(" + (i * 30) + " 70% 70%)",
            az: hor.azimuth,
            alt: hor.altitude,
            mag: null,
            sidLon: sidCenter,
            region: true,
          });
        } catch (_) {}
      });
    }

    // ── Nakṣatras (center of each 13°20' mansion) ──
    if (state.layers.nakshatra) {
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
            sub: "Nakṣatra " + (i + 1) + "/27",
            color: "hsl(" + ((i * 13.3 + 180) % 360) + " 65% 72%)",
            az: hor.azimuth,
            alt: hor.altitude,
            mag: null,
            sidLon: sidCenter,
            region: true,
          });
        } catch (_) {}
      });
    }

    // ── ISS ──
    if (state.layers.iss && state.iss) {
      out.push({
        id: "iss",
        kind: "iss",
        label: "ISS",
        sub:
          (state.iss.alt > 0 ? "Above horizon" : "Below") +
          " · " +
          Math.round(state.iss.rangeKm || 0) +
          " km · " +
          (state.iss.visibility || ""),
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

    // Ecliptic guide (sample points)
    if (state.layers.rasi || state.layers.nakshatra) {
      drawEclipticBand(w, h);
    }

    let nearest = null;
    let nearestPointlike = null;

    for (const obj of state.objects) {
      if (obj.alt < -12) continue;
      const p = project(obj);
      if (!p) continue;

      if (!nearest || p.angDist < nearest.angDist) nearest = { obj, ...p };

      const pointlike = obj.kind === "graha" || obj.kind === "iss";
      if (pointlike && (!nearestPointlike || p.angDist < nearestPointlike.angDist)) {
        nearestPointlike = { obj, ...p };
      }

      const isTarget = obj.id === state.targetId;
      const drawIt =
        p.inFov ||
        isTarget ||
        (pointlike && p.angDist < 30) ||
        (obj.kind === "rasi" && p.angDist < 18) ||
        (obj.kind === "nakshatra" && p.angDist < 14);

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
      if (obj.kind === "nakshatra" && !state.layers.nakshatra) continue;
      // Only show graha, iss, rasi centers on radar (less clutter)
      if (obj.kind === "nakshatra") continue;
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

  function updateObjectList() {
    if (!els.objectList) return;
    const chips = els.objectList.querySelectorAll(".planet-chip");
    // Rebuild if count/kind filter changed
    const visible = state.objects.filter((o) => {
      if (o.kind === "graha") return state.layers.graha;
      if (o.kind === "nakshatra") return state.layers.nakshatra;
      if (o.kind === "rasi") return state.layers.rasi;
      if (o.kind === "iss") return state.layers.iss;
      return true;
    });

    // Only list: all grahas, ISS, rasis; nakshatras above horizon or all if few
    const listItems = visible.filter((o) => {
      if (o.kind === "nakshatra") return o.alt > -5;
      return true;
    });

    if (chips.length !== listItems.length) {
      buildObjectList(listItems);
      return;
    }
    listItems.forEach((obj, i) => {
      const chip = chips[i];
      if (!chip || chip.dataset.id !== obj.id) {
        buildObjectList(listItems);
        return;
      }
      const meta = chip.querySelector(".meta");
      const p = project(obj);
      chip.classList.toggle("below", obj.alt < 0);
      chip.classList.toggle("selected", state.targetId === obj.id);
      chip.classList.toggle("in-view", !!(p && p.inFov && obj.alt > -1));
      if (meta) {
        meta.textContent =
          (obj.alt < 0 ? "Below · " : obj.alt.toFixed(0) + "° · ") +
          compassLabel(obj.az) +
          (p && state.heading != null ? " · " + p.angDist.toFixed(0) + "°" : "");
      }
    });
  }

  function buildObjectList(items) {
    if (!els.objectList) return;
    if (!items) {
      items = state.objects.filter((o) => {
        if (o.kind === "nakshatra") return o.alt > -5 && state.layers.nakshatra;
        if (o.kind === "graha") return state.layers.graha;
        if (o.kind === "rasi") return state.layers.rasi;
        if (o.kind === "iss") return state.layers.iss;
        return true;
      });
    }
    els.objectList.innerHTML = "";
    for (const obj of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "planet-chip kind-" + obj.kind;
      btn.dataset.id = obj.id;
      btn.innerHTML =
        '<span class="name"><span class="dot" style="background:' +
        obj.color +
        '"></span>' +
        obj.label +
        '</span><span class="kind-tag">' +
        obj.kind +
        '</span><span class="meta">—</span>';
      btn.addEventListener("click", () => {
        state.targetId = state.targetId === obj.id ? null : obj.id;
        updateGuide();
        updateObjectList();
      });
      els.objectList.appendChild(btn);
    }
  }

  function updateDebug() {
    if (!els.debugLine) return;
    const fov = viewFov();
    const iss =
      state.iss && state.layers.iss
        ? " · ISS " + state.iss.alt.toFixed(0) + "°"
        : state.issError
          ? " · ISS err"
          : "";
    els.debugLine.textContent =
      "hdg " +
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
    showGateError("");
    els.btnGateStart.disabled = true;
    els.btnStart.disabled = true;
    setStatus("Permissions…", "warn");
    try {
      if (!X()) throw new Error("SkyExtras failed to load.");
      await requestOrientationPermission();
      startOrientation();
      setStatus("High-accuracy GPS…", "warn");
      await getLocation();
      setStatus("Camera…", "warn");
      await startCamera();
      await refreshISS(true);
      computeSky();
      buildObjectList();
      state.running = true;
      els.gate.classList.add("hidden");
      setStatus("Live · graha · nakṣatra · rāśi · ISS", "ok");
      requestAnimationFrame(tick);
    } catch (err) {
      console.error(err);
      showGateError(err.message || String(err));
      setStatus("Start failed", "warn");
      els.btnGateStart.disabled = false;
      els.btnStart.disabled = false;
    }
  }

  function syncLayerButtons() {
    els.layerBtns?.forEach((btn) => {
      const layer = btn.getAttribute("data-layer");
      btn.setAttribute("aria-pressed", state.layers[layer] ? "true" : "false");
      btn.classList.toggle("active", !!state.layers[layer]);
    });
    if (els.listTitle) {
      const on = Object.entries(state.layers)
        .filter(([, v]) => v)
        .map(([k]) => k);
      els.listTitle.textContent = "Find · " + (on.join(" · ") || "none");
    }
  }

  function init() {
    resizeCanvas();
    updateScreenAngle();
    window.addEventListener("resize", () => {
      resizeCanvas();
      updateScreenAngle();
    });

    const app = document.getElementById("app");
    app.addEventListener("touchstart", onTouchStart, { passive: true });
    app.addEventListener("touchmove", onTouchMove, { passive: false });
    app.addEventListener("touchend", onTouchEnd, { passive: true });

    els.btnGateStart.addEventListener("click", startAll);
    els.btnStart.addEventListener("click", startAll);
    els.btnClearTarget?.addEventListener("click", () => {
      state.targetId = null;
      updateGuide();
      updateObjectList();
    });
    els.btnCalibrate?.addEventListener("click", calibrateToAim);

    els.layerBtns?.forEach((btn) => {
      btn.addEventListener("click", () => {
        const layer = btn.getAttribute("data-layer");
        state.layers[layer] = !state.layers[layer];
        // Keep at least one layer on
        if (!Object.values(state.layers).some(Boolean)) state.layers[layer] = true;
        syncLayerButtons();
        computeSky();
        buildObjectList();
      });
    });
    syncLayerButtons();

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
