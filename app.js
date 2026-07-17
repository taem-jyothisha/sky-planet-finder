/**
 * Sky — camera AR planet finder (iPhone 15 Pro Max tuned)
 * High-accuracy GPS · true-sky alt/az · zoom-aware FOV · one-tap calibrate
 */
(() => {
  "use strict";

  const BODIES = [
    { id: "Sun", label: "Sun", color: "#ffd27a", body: "Sun", priority: 1 },
    { id: "Moon", label: "Moon", color: "#e8eefc", body: "Moon", priority: 1 },
    { id: "Venus", label: "Venus", color: "#f5e6c8", body: "Venus", priority: 2 },
    { id: "Jupiter", label: "Jupiter", color: "#f0b878", body: "Jupiter", priority: 2 },
    { id: "Mars", label: "Mars", color: "#ff7a5c", body: "Mars", priority: 3 },
    { id: "Saturn", label: "Saturn", color: "#e8d090", body: "Saturn", priority: 3 },
    { id: "Mercury", label: "Mercury", color: "#c4b8a8", body: "Mercury", priority: 4 },
    { id: "Uranus", label: "Uranus", color: "#7ec8d8", body: "Uranus", priority: 5 },
    { id: "Neptune", label: "Neptune", color: "#5a8fff", body: "Neptune", priority: 5 },
  ];

  // iPhone main camera ~24mm ≈ 60–65° horizontal FOV at 1×
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
    planetList: $("planetList"),
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
    zoomMin: 1,
    zoomMax: 5,
    hardwareZoom: false,
    targetId: null,
    bodies: [],
    running: false,
    orientReady: false,
    lastBodyCompute: 0,
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
    const acc =
      state.accM != null ? " ±" + Math.round(state.accM) + "m" : "";
    els.locChip.textContent =
      state.lat.toFixed(5) +
      ", " +
      state.lon.toFixed(5) +
      acc +
      (state.elevM ? " · " + Math.round(state.elevM) + "m" : "");
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
    const d = deltaAngle(prev, next);
    return norm360(prev + d * alpha);
  }

  function smoothLinear(prev, next, alpha) {
    if (prev == null || Number.isNaN(prev)) return next;
    return prev + (next - prev) * alpha;
  }

  function viewFov() {
    // Zoom in → narrower FOV (optical or digital)
    const z = Math.max(0.5, state.zoom || 1);
    return {
      h: BASE_H_FOV / z,
      v: BASE_V_FOV / z,
    };
  }

  function lookAtThreshold() {
    // Tighter ID when zoomed in
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
    if (so && typeof so.angle === "number") {
      state.screenAngle = so.angle;
    } else if (typeof window.orientation === "number") {
      state.screenAngle = window.orientation;
    } else {
      state.screenAngle = window.innerWidth > window.innerHeight ? 90 : 0;
    }
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
          "Motion / compass denied. Settings → Safari → Motion & Orientation → Allow, then reload."
        );
      }
    }
    if (
      typeof DeviceMotionEvent !== "undefined" &&
      typeof DeviceMotionEvent.requestPermission === "function"
    ) {
      try {
        await DeviceMotionEvent.requestPermission();
      } catch (_) {
        /* optional */
      }
    }
  }

  /**
   * Convert deviceorientation → camera heading (az) + pitch (alt).
   * Tuned for rear camera as viewfinder on iPhone (portrait + landscape).
   * webkitCompassHeading is preferred on iOS (degrees clockwise from north).
   */
  function onOrientation(e) {
    updateScreenAngle();
    const beta = typeof e.beta === "number" ? e.beta : null;
    const gamma = typeof e.gamma === "number" ? e.gamma : null;
    const alpha = typeof e.alpha === "number" ? e.alpha : null;

    // --- Heading ---
    let heading = null;
    if (
      typeof e.webkitCompassHeading === "number" &&
      !Number.isNaN(e.webkitCompassHeading)
    ) {
      // iOS: heading of the top of the device; for camera viewfinder upright
      // this is the direction the camera faces when held like a camera.
      heading = e.webkitCompassHeading;
      // Landscape: top of device is not the camera forward direction.
      // When landscape-left (angle 90), camera forward ≈ heading + 90, etc.
      const ang = state.screenAngle;
      if (ang === 90) heading = norm360(heading + 90);
      else if (ang === -90 || ang === 270) heading = norm360(heading - 90);
      else if (ang === 180) heading = norm360(heading + 180);
    } else if (alpha != null) {
      // Absolute-ish fallback (Android / desktop)
      heading = norm360(360 - alpha);
      const ang = state.screenAngle;
      if (ang === 90) heading = norm360(heading + 90);
      else if (ang === -90 || ang === 270) heading = norm360(heading - 90);
    }

    // --- Pitch (camera altitude) ---
    // Portrait upright: beta≈90 → horizon (0°). Tilt back (look up): beta↓ → pitch↑.
    // pitch = 90 - beta  (rear camera, portrait)
    // Landscape: mix beta/gamma.
    let pitch = null;
    if (beta != null) {
      const ang = state.screenAngle;
      if (ang === 0 || ang === 180) {
        pitch = 90 - beta;
      } else if (ang === 90) {
        // landscape-left: gamma dominates elevation
        pitch = gamma != null ? -gamma : 90 - beta;
      } else if (ang === -90 || ang === 270) {
        pitch = gamma != null ? gamma : 90 - beta;
      } else {
        pitch = 90 - beta;
      }
      pitch = Math.max(-40, Math.min(95, pitch));
    }

    if (heading != null) {
      state.headingRaw = heading;
      const withOff = norm360(heading + state.headingOffset);
      state.smoothHeading = smoothAngle(state.smoothHeading, withOff, 0.35);
      state.heading = state.smoothHeading;
      state.orientReady = true;
    }
    if (pitch != null) {
      state.pitchRaw = pitch;
      const withOff = pitch + state.pitchOffset;
      state.smoothPitch = smoothLinear(state.smoothPitch, withOff, 0.35);
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
    computeBodies();
    if (state.accM != null && state.accM < 50) {
      setStatus("GPS locked ±" + Math.round(state.accM) + "m", "ok");
    } else if (state.accM != null) {
      setStatus("GPS refining ±" + Math.round(state.accM) + "m…", "warn");
    }
  }

  async function getLocation() {
    if (!navigator.geolocation) {
      throw new Error("Geolocation not available.");
    }
    // First fix: force fresh high-accuracy reading (Pro GPS + Wi‑Fi assist)
    const first = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 25000,
        maximumAge: 0,
      });
    });
    applyGeo(first);

    // Keep watching — iPhone improves accuracy after a few seconds outdoors
    if (state.geoWatchId != null) {
      navigator.geolocation.clearWatch(state.geoWatchId);
    }
    state.geoWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        // Prefer more accurate fixes
        if (state.accM == null || pos.coords.accuracy <= state.accM + 5) {
          applyGeo(pos);
        } else {
          // still accept if much fresher and reasonable
          applyGeo(pos);
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
    );
  }

  // ── Camera + zoom (iPhone 15 Pro Max) ────────────────────────────────

  async function startCamera() {
    if (!window.isSecureContext) {
      throw new Error("Need HTTPS (GitHub Pages link) for camera on iPhone.");
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
          frameRate: { ideal: 30 },
        },
      },
      {
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      },
      { audio: false, video: { facingMode: "environment" } },
    ];

    let lastErr = null;
    for (const constraints of tries) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
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
    throw new Error(
      lastErr?.message ||
        "Camera denied. Settings → Safari → Camera → Allow."
    );
  }

  function setupZoomFromTrack() {
    const track = state.videoTrack;
    if (!track || typeof track.getCapabilities !== "function") {
      state.hardwareZoom = false;
      state.zoomMin = 0.5;
      state.zoomMax = 8;
      syncZoomUi();
      return;
    }
    const caps = track.getCapabilities() || {};
    if (caps.zoom) {
      state.hardwareZoom = true;
      state.zoomMin = caps.zoom.min ?? 1;
      state.zoomMax = Math.min(caps.zoom.max ?? 5, 15);
      const settings = track.getSettings ? track.getSettings() : {};
      if (settings.zoom) state.zoom = settings.zoom;
      else state.zoom = Math.max(state.zoomMin, 1);
    } else {
      // Digital zoom fallback — iPhone Safari often exposes zoom on Pro models
      state.hardwareZoom = false;
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
    syncZoomUi();
    applyZoom(state.zoom);
  }

  async function applyZoom(z) {
    z = Math.max(state.zoomMin, Math.min(state.zoomMax, Number(z) || 1));
    state.zoom = z;

    const track = state.videoTrack;
    if (track && state.hardwareZoom) {
      try {
        await track.applyConstraints({ advanced: [{ zoom: z }] });
        // CSS: no extra scale when hardware zoom works
        els.camera.style.transform = "scale(1)";
      } catch (_) {
        // digital fallback
        els.camera.style.transform = "scale(" + Math.max(1, z) + ")";
        els.camera.style.transformOrigin = "center center";
      }
    } else {
      // Digital zoom: scale video; FOV model uses state.zoom
      const s = Math.max(0.5, z);
      els.camera.style.transform = "scale(" + s + ")";
      els.camera.style.transformOrigin = "center center";
    }
    syncZoomUi();
  }

  function syncZoomUi() {
    if (els.zoomVal) {
      els.zoomVal.textContent =
        (Math.round(state.zoom * 10) / 10) +
        "×" +
        (state.hardwareZoom ? " · optical" : " · digital");
    }
    if (els.zoomSlider && String(els.zoomSlider.value) !== String(state.zoom)) {
      els.zoomSlider.value = String(state.zoom);
    }
    els.zoomBtns?.forEach((btn) => {
      const v = Number(btn.getAttribute("data-zoom"));
      btn.classList.toggle("active", Math.abs(v - state.zoom) < 0.15);
    });
  }

  // Pinch zoom
  let pinchStartDist = null;
  let pinchStartZoom = 1;

  function touchDist(t0, t1) {
    const dx = t0.clientX - t1.clientX;
    const dy = t0.clientY - t1.clientY;
    return Math.hypot(dx, dy);
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
      const d = touchDist(ev.touches[0], ev.touches[1]);
      const scale = d / pinchStartDist;
      applyZoom(pinchStartZoom * scale);
    }
  }
  function onTouchEnd(ev) {
    if (ev.touches.length < 2) pinchStartDist = null;
  }

  // ── Astronomy ────────────────────────────────────────────────────────

  function computeBodies() {
    if (state.lat == null || state.lon == null || typeof Astronomy === "undefined") {
      return;
    }
    const elev = state.elevM || 0;
    const observer = new Astronomy.Observer(state.lat, state.lon, elev);
    const time = Astronomy.MakeTime(new Date());
    const out = [];

    for (const b of BODIES) {
      try {
        // ofdate=true, aberration=true — best apparent place for observers
        const equ = Astronomy.Equator(b.body, time, observer, true, true);
        const hor = Astronomy.Horizon(time, observer, equ.ra, equ.dec, "normal");
        let mag = null;
        try {
          if (b.body === "Moon") {
            // Moon apparent magnitude rough via illumination phase
            const illum = Astronomy.Illumination(b.body, time);
            mag = illum.mag;
          } else if (b.body !== "Sun") {
            const illum = Astronomy.Illumination(b.body, time);
            mag = illum.mag;
          } else {
            mag = -26.7;
          }
        } catch (_) {
          /* ignore */
        }
        out.push({
          id: b.id,
          label: b.label,
          color: b.color,
          priority: b.priority,
          az: hor.azimuth,
          alt: hor.altitude,
          mag,
        });
      } catch (err) {
        console.warn("body fail", b.id, err);
      }
    }
    // Prefer brighter / higher priority when sorting for HUD
    out.sort((a, b) => {
      const am = a.mag ?? 99;
      const bm = b.mag ?? 99;
      if (am !== bm) return am - bm;
      return a.priority - b.priority;
    });
    state.bodies = out;
  }

  // ── Screen projection (CSS pixels — fixed DPR bug) ───────────────────

  function project(body) {
    if (state.heading == null || state.pitch == null) return null;
    const dAz = deltaAngle(state.heading, body.az);
    const dAlt = body.alt - state.pitch;
    const { w, h } = cssSize();
    const fov = viewFov();
    // object-fit: cover — video fills screen; FOV maps to full frame
    const x = w / 2 + (dAz / (fov.h / 2)) * (w / 2);
    const y = h / 2 - (dAlt / (fov.v / 2)) * (h / 2);
    const angDist = Math.hypot(dAz, dAlt);
    const inFov =
      Math.abs(dAz) < fov.h / 2 * 1.05 && Math.abs(dAlt) < fov.v / 2 * 1.05;
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

    // Center reticle altitude tick (horizon aid)
    if (state.pitch != null) {
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w * 0.35, h * 0.42);
      ctx.lineTo(w * 0.65, h * 0.42);
      ctx.stroke();
    }

    let nearest = null;
    let nearestBright = null;

    for (const body of state.bodies) {
      if (body.alt < -8) continue;
      const p = project(body);
      if (!p) continue;

      if (!nearest || p.angDist < nearest.angDist) {
        nearest = { body, ...p };
      }
      // Bright enough naked-eye (mag < 2.5) for "looking at"
      const bright = body.mag == null || body.mag < 2.5 || body.id === "Moon" || body.id === "Sun";
      if (bright && (!nearestBright || p.angDist < nearestBright.angDist)) {
        nearestBright = { body, ...p };
      }

      // Draw if in FOV, or selected target, or near edge for guidance
      const drawIt = p.inFov || body.id === state.targetId || p.angDist < 25;
      if (!drawIt) continue;

      const r =
        body.id === "Sun" ? 16 : body.id === "Moon" ? 14 : body.mag != null && body.mag < 0 ? 11 : 8;
      const alpha = p.inFov ? 1 : 0.4;

      ctx.save();
      ctx.globalAlpha = alpha;

      // Clamp label position into view for off-screen targets
      const px = Math.max(24, Math.min(w - 24, p.x));
      const py = Math.max(80, Math.min(h - 180, p.y));

      ctx.beginPath();
      ctx.arc(px, py, r + 12, 0, Math.PI * 2);
      ctx.fillStyle = body.color + "40";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = body.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.stroke();

      const magStr = body.mag != null ? " · m" + body.mag.toFixed(1) : "";
      const label =
        body.label +
        (body.alt < 0 ? " ↓" : "") +
        (p.inFov ? "" : " · " + p.angDist.toFixed(0) + "°") +
        magStr;
      ctx.font = "700 14px -apple-system, system-ui, sans-serif";
      const tw = ctx.measureText(label).width;
      const lx = px - tw / 2;
      const ly = py - r - 16;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      roundRect(ctx, lx - 7, ly - 13, tw + 14, 22, 9);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(label, lx, ly + 3);

      if (body.id === state.targetId) {
        ctx.beginPath();
        ctx.arc(px, py, r + 18, 0, Math.PI * 2);
        ctx.strokeStyle = "#ffd27a";
        ctx.lineWidth = 2.5;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();
    }

    // Mini radar (always on) — shows where planets are relative to aim
    drawRadar(w, h);

    updateHud(nearestBright || nearest);
    updateGuide();
    updatePlanetChips();
    updateDebug();
  }

  function drawRadar(w, h) {
    const cx = w - 58;
    const cy = 100 + (parseInt(getComputedStyle(document.documentElement).getPropertyValue("--safe-t")) || 0);
    const R = 44;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.stroke();
    // cross
    ctx.beginPath();
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R);
    ctx.lineTo(cx, cy + R);
    ctx.stroke();

    // FOV wedge
    if (state.heading != null) {
      const fov = viewFov();
      const half = ((fov.h / 2) * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, -Math.PI / 2 - half, -Math.PI / 2 + half);
      ctx.closePath();
      ctx.fillStyle = "rgba(126,182,255,0.2)";
      ctx.fill();
    }

    for (const body of state.bodies) {
      if (body.alt < 0) continue;
      if (state.heading == null) break;
      const dAz = deltaAngle(state.heading, body.az);
      // map ±90° az to radar edge; alt → radius (zenith center-ish, horizon edge)
      const rr = R * (1 - Math.max(0, Math.min(90, body.alt)) / 100);
      const rad = ((dAz) * Math.PI) / 180;
      // 0 dAz = up on radar
      const x = cx + Math.sin(rad) * rr;
      const y = cy - Math.cos(rad) * rr;
      ctx.beginPath();
      ctx.arc(x, y, body.mag != null && body.mag < 0 ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = body.color;
      ctx.fill();
    }
    // center = your aim
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
        ? "Waiting for compass… wave phone in a figure‑8"
        : "Compass not ready — allow Motion";
      return;
    }

    const dir = compassLabel(state.heading);
    const thr = lookAtThreshold();
    const elev = state.pitch.toFixed(0) + "° elev";

    if (nearest && nearest.angDist < thr && nearest.body.alt > -1) {
      els.pointingMain.textContent = nearest.body.label;
      els.pointingSub.textContent =
        "Likely this · " +
        nearest.angDist.toFixed(1) +
        "° from center · " +
        dir +
        " · " +
        nearest.body.alt.toFixed(0) +
        "° alt" +
        (nearest.body.mag != null ? " · mag " + nearest.body.mag.toFixed(1) : "");
    } else {
      const hint =
        nearest && nearest.body.alt > 0
          ? "Nearest " +
            nearest.body.label +
            " " +
            nearest.angDist.toFixed(0) +
            "° off · tap it below or calibrate"
          : "No planet near crosshair";
      els.pointingMain.textContent = dir + " · " + elev;
      els.pointingSub.textContent =
        "hdg " + state.heading.toFixed(0) + "° · " + hint;
    }
  }

  function updateGuide() {
    const target = state.bodies.find((b) => b.id === state.targetId);
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
      els.guideText.textContent = target.label + " is below horizon";
      els.guideMeta.textContent =
        "Rises toward " +
        compassLabel(target.az) +
        " · az " +
        target.az.toFixed(0) +
        "° · alt " +
        target.alt.toFixed(0) +
        "°";
      return;
    }

    const p = project(target);
    if (!p) return;

    const locked = p.angDist < lockThreshold();
    if (locked) {
      els.guideArrow.classList.add("hidden");
      els.lockedBadge.classList.remove("hidden");
      els.lockedName.textContent = "Found · " + target.label;
      els.lockedDetail.textContent =
        p.angDist.toFixed(1) +
        "° from center · " +
        compassLabel(target.az) +
        " · " +
        target.alt.toFixed(0) +
        "° up · zoom to confirm";
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
    if (absAz > absAlt * 1.2) {
      hint = p.dAz > 0 ? "Turn right" : "Turn left";
    } else if (absAlt > absAz * 1.2) {
      hint = p.dAlt > 0 ? "Tilt up" : "Tilt down";
    } else {
      hint =
        (p.dAz > 0 ? "Right" : "Left") +
        " + " +
        (p.dAlt > 0 ? "up" : "down");
    }

    els.guideText.textContent = hint + " → " + target.label;
    els.guideMeta.textContent =
      p.angDist.toFixed(0) +
      "° away · aim " +
      compassLabel(target.az) +
      " · " +
      target.alt.toFixed(0) +
      "° elev";
  }

  function updatePlanetChips() {
    const chips = els.planetList.querySelectorAll(".planet-chip");
    chips.forEach((chip) => {
      const id = chip.dataset.id;
      const body = state.bodies.find((b) => b.id === id);
      if (!body) return;
      const meta = chip.querySelector(".meta");
      const below = body.alt < 0;
      chip.classList.toggle("below", below);
      chip.classList.toggle("selected", state.targetId === id);
      const p = project(body);
      chip.classList.toggle("in-view", !!(p && p.inFov && body.alt > -1));
      if (meta) {
        meta.textContent = below
          ? "Below · " + compassLabel(body.az)
          : body.alt.toFixed(0) +
            "° " +
            compassLabel(body.az) +
            (p && state.heading != null ? " · " + p.angDist.toFixed(0) + "°" : "") +
            (body.mag != null ? " · m" + body.mag.toFixed(1) : "");
      }
    });
  }

  function updateDebug() {
    if (!els.debugLine) return;
    const fov = viewFov();
    els.debugLine.textContent =
      "aim hdg " +
      (state.heading != null ? state.heading.toFixed(1) : "—") +
      "° · elev " +
      (state.pitch != null ? state.pitch.toFixed(1) : "—") +
      "° · FOV " +
      fov.h.toFixed(0) +
      "×" +
      fov.v.toFixed(0) +
      " · z" +
      state.zoom.toFixed(1) +
      (state.accM != null ? " · GPS±" + Math.round(state.accM) + "m" : "");
  }

  function buildPlanetList() {
    els.planetList.innerHTML = "";
    for (const b of BODIES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "planet-chip";
      btn.dataset.id = b.id;
      btn.setAttribute("role", "option");
      btn.innerHTML =
        '<span class="name"><span class="dot" style="background:' +
        b.color +
        ";color:" +
        b.color +
        '"></span>' +
        b.label +
        '</span><span class="meta">—</span>';
      btn.addEventListener("click", () => {
        state.targetId = state.targetId === b.id ? null : b.id;
        updateGuide();
        updatePlanetChips();
      });
      els.planetList.appendChild(btn);
    }
  }

  /**
   * One-tap calibrate: assumes the selected target (or nearest bright body)
   * is currently under the crosshair. Adjusts heading + pitch offsets.
   */
  function calibrateToAim() {
    let body = state.bodies.find((b) => b.id === state.targetId);
    if (!body || body.alt < -2) {
      // Prefer Moon / Venus / Jupiter if up
      body =
        state.bodies.find(
          (b) =>
            b.alt > 5 &&
            (b.id === "Moon" || b.id === "Venus" || b.id === "Jupiter" || b.id === "Sun")
        ) || state.bodies.find((b) => b.alt > 10);
    }
    if (!body || state.headingRaw == null || state.pitchRaw == null) {
      setStatus("Pick a visible planet, center it, then Calibrate", "warn");
      return;
    }
    // We want project(body) → center, so heading should equal body.az, pitch = body.alt
    // heading = headingRaw + headingOffset  => offset = body.az - headingRaw
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
    setStatus("Calibrated on " + body.label + " — keep phone level", "ok");
  }

  // ── Loop ─────────────────────────────────────────────────────────────

  function tick(ts) {
    if (!state.running) return;
    if (ts - state.lastBodyCompute > 400) {
      computeBodies();
      state.lastBodyCompute = ts;
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
      await requestOrientationPermission();
      startOrientation();
      setStatus("High-accuracy GPS…", "warn");
      await getLocation();
      setStatus("Rear camera…", "warn");
      await startCamera();
      computeBodies();
      state.running = true;
      els.gate.classList.add("hidden");
      setLocChip();
      setStatus("Live · pinch to zoom · calibrate on Moon if off", "ok");
      requestAnimationFrame(tick);

      setTimeout(() => {
        if (state.heading == null) {
          setStatus("Wave iPhone in a figure‑8 to wake compass", "warn");
        }
      }, 3000);
    } catch (err) {
      console.error(err);
      showGateError(err.message || String(err));
      setStatus("Start failed", "warn");
      els.btnGateStart.disabled = false;
      els.btnStart.disabled = false;
    }
  }

  // ── Wire UI ──────────────────────────────────────────────────────────

  function init() {
    buildPlanetList();
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
      updatePlanetChips();
    });
    els.btnCalibrate?.addEventListener("click", calibrateToAim);

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

    els.zoomSlider?.addEventListener("input", () => {
      applyZoom(Number(els.zoomSlider.value));
    });
    els.zoomBtns?.forEach((btn) => {
      btn.addEventListener("click", () => {
        applyZoom(Number(btn.getAttribute("data-zoom")));
      });
    });

    // Do NOT seed a fake city location — wait for real GPS
    setStatus("Tap Start · needs GPS + Motion + Camera", "muted");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
