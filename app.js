/**
 * Sky — AR finder: grahas, nakṣatras, rāśis, ISS
 * iPhone-tuned · high-accuracy GPS · zoom · calibrate
 */
(() => {
  "use strict";

  const X = () => window.SkyExtras;
  // iPhone main (~24mm) horizontal FOV ≈ 60–65° on full uncropped frame at 1×
  const BASE_H_FOV_1X = 60;

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
    btnLayers: $("btnLayers"),
    btnFind: $("btnFind"),
    btnCloseLayers: $("btnCloseLayers"),
    btnCloseFind: $("btnCloseFind"),
    btnDockExpand: $("btnDockExpand"),
    btnDockClear: $("btnDockClear"),
    btnDockLayers: $("btnDockLayers"),
    mapControls: $("mapControls"),
    layerPanel: $("layerPanel"),
    findPanel: $("findPanel"),
    guideDock: $("guideDock"),
    dockTarget: $("dockTarget"),
    dockHint: $("dockHint"),
    findFabLabel: $("findFabLabel"),
    statusChip: $("statusChip"),
    locChip: $("locChip"),
    objectList: $("objectList"),
    pointingHud: $("pointingHud"),
    pointingMain: $("pointingMain"),
    pointingSub: $("pointingSub"),
    guidePanel: $("guidePanel"),
    guidePrimary: $("guidePrimary"),
    guideSecondary: $("guideSecondary"),
    guideDelta: $("guideDelta"),
    edgeLeft: $("edgeLeft"),
    edgeRight: $("edgeRight"),
    edgeUp: $("edgeUp"),
    edgeDown: $("edgeDown"),
    lockedBadge: $("lockedBadge"),
    lockedName: $("lockedName"),
    lockedDetail: $("lockedDetail"),
    alignBanner: $("alignBanner"),
    headingOffset: $("headingOffset"),
    headingOffsetVal: $("headingOffsetVal"),
    pitchOffset: $("pitchOffset"),
    pitchOffsetVal: $("pitchOffsetVal"),
    zoomVal: $("zoomVal"),
    zoomBtns: document.querySelectorAll("[data-zoom]"),
    zoomSlider: $("zoomSlider"),
    debugLine: $("debugLine"),
    layerCards: document.querySelectorAll(".layer-card[data-layer]"),
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
    /** UI: layers panel / find panel open */
    layersOpen: false,
    findOpen: false,
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

  /**
   * Effective FOV of what's visible on screen after object-fit:cover + zoom.
   * Critical for AR alignment — wrong FOV = labels slide off the real sky.
   */
  function viewFov() {
    const z = Math.max(0.5, state.zoom || 1);
    const vid = els.camera;
    const vw = vid.videoWidth || 1920;
    const vh = vid.videoHeight || 1080;
    const { w: sw, h: sh } = cssSize();
    const videoAspect = vw / Math.max(1, vh);
    const screenAspect = sw / Math.max(1, sh);

    // Full-frame camera FOV at this zoom (uncropped stream)
    const fullH = BASE_H_FOV_1X / z;
    const fullV =
      ((2 * Math.atan(Math.tan(((fullH / 2) * Math.PI) / 180) / videoAspect)) *
        180) /
      Math.PI;

    // object-fit: cover — only a center crop of the video is visible
    let visibleHFrac = 1;
    let visibleVFrac = 1;
    if (videoAspect > screenAspect) {
      // sides cropped
      visibleHFrac = screenAspect / videoAspect;
      visibleVFrac = 1;
    } else {
      // top/bottom cropped
      visibleHFrac = 1;
      visibleVFrac = videoAspect / screenAspect;
    }

    return {
      h: fullH * visibleHFrac,
      v: fullV * visibleVFrac,
      fullH,
      fullV,
      videoAspect,
      screenAspect,
    };
  }

  /**
   * Rear-camera azimuth (0=N, CW) + altitude (0=horizon, +up) from DeviceOrientation.
   * Device frame: X right, Y top-of-screen, Z out of screen toward user.
   * Rear camera looks along −Z. Formula from W3C/Opera deviceorientation compass notes.
   */
  function rearCameraAzAlt(alpha, beta, gamma, screenOrientDeg) {
    const a = (((alpha || 0) % 360) * Math.PI) / 180;
    const b = ((beta || 0) * Math.PI) / 180;
    const g = ((gamma || 0) * Math.PI) / 180;

    const cA = Math.cos(a);
    const sA = Math.sin(a);
    const cB = Math.cos(b);
    const sB = Math.sin(b);
    const cG = Math.cos(g);
    const sG = Math.sin(g);

    // World components of the "out the back of the device" vector
    let rA = -cA * sG - sA * sB * cG;
    let rB = -sA * sG + cA * sB * cG;
    let rC = -cB * cG;

    // Screen orientation (portrait/landscape) rotation around device Z
    const o = ((screenOrientDeg || 0) * Math.PI) / 180;
    const cO = Math.cos(o);
    const sO = Math.sin(o);
    const east = rA * cO - rB * sO;
    const north = rA * sO + rB * cO;
    const up = rC;

    // Azimuth: atan2(east, north) → 0° north, clockwise positive
    let az = (Math.atan2(east, north) * 180) / Math.PI;
    if (az < 0) az += 360;

    // Altitude: elevation of look vector above horizon
    const horiz = Math.sqrt(east * east + north * north);
    let alt = (Math.atan2(up, horiz) * 180) / Math.PI;
    alt = Math.max(-89, Math.min(89, alt));

    return { az, alt, east, north, up };
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

  function applyAim(headingRaw, pitchRaw, source) {
    if (headingRaw == null || pitchRaw == null) return;
    if (Number.isNaN(headingRaw) || Number.isNaN(pitchRaw)) return;

    state.headingRaw = headingRaw;
    state.pitchRaw = Math.max(-89, Math.min(89, pitchRaw));
    state.orientSource = source || state.orientSource || "?";
    state.orientReady = true;
    state.lastOrientTs = performance.now();
    state.orientEventCount = (state.orientEventCount || 0) + 1;

    // Light smoothing only — must still track pan in real time
    const hTarget = norm360(headingRaw + state.headingOffset);
    const pTarget = state.pitchRaw + state.pitchOffset;
    state.smoothHeading = smoothAngle(state.smoothHeading, hTarget, 0.72);
    state.smoothPitch = smoothLinear(state.smoothPitch, pTarget, 0.72);
    state.heading = state.smoothHeading;
    state.pitch = state.smoothPitch;
  }

  function onOrientation(e) {
    updateScreenAngle();
    state._gotOrientEvent = true;

    const beta = typeof e.beta === "number" && !Number.isNaN(e.beta) ? e.beta : null;
    const gamma =
      typeof e.gamma === "number" && !Number.isNaN(e.gamma) ? e.gamma : null;
    const alpha =
      typeof e.alpha === "number" && !Number.isNaN(e.alpha) ? e.alpha : null;
    const compass =
      typeof e.webkitCompassHeading === "number" &&
      !Number.isNaN(e.webkitCompassHeading)
        ? e.webkitCompassHeading
        : null;

    // Need at least tilt (beta) for pitch; gamma may be 0 (valid)
    if (beta == null && gamma == null && compass == null && alpha == null) {
      return;
    }

    const b = beta != null ? beta : state._lastBeta != null ? state._lastBeta : 90;
    const g = gamma != null ? gamma : state._lastGamma != null ? state._lastGamma : 0;
    if (beta != null) state._lastBeta = beta;
    if (gamma != null) state._lastGamma = gamma;
    if (alpha != null) state._lastAlpha = alpha;
    if (compass != null) state._lastCompass = compass;

    // LIVE tracking: prefer alpha+beta+gamma matrix (updates as you pan).
    // iOS often freezes webkitCompassHeading — do NOT rely on it alone for motion.
    let heading;
    let pitch;
    let source;

    if (alpha != null) {
      const aim = rearCameraAzAlt(alpha, b, g, state.screenAngle);
      heading = aim.az;
      pitch = aim.alt;
      source = "matrix";

      // Optional slow north correction from compass (doesn't freeze live motion)
      if (compass != null && Math.abs(aim.alt) < 70) {
        let c = compass;
        if (state.screenAngle === 90) c = norm360(c + 90);
        else if (state.screenAngle === -90 || state.screenAngle === 270)
          c = norm360(c - 90);
        else if (state.screenAngle === 180) c = norm360(c + 180);
        // Blend 15% toward compass for absolute north, 85% live matrix
        heading = norm360(heading + deltaAngle(heading, c) * 0.15);
        source = "matrix+compass";
      }
    } else if (compass != null) {
      // No alpha: iOS-style — compass for yaw, matrix pitch with last/0 alpha
      const aim = rearCameraAzAlt(state._lastAlpha || 0, b, g, state.screenAngle);
      heading = compass;
      if (state.screenAngle === 90) heading = norm360(heading + 90);
      else if (state.screenAngle === -90 || state.screenAngle === 270)
        heading = norm360(heading - 90);
      else if (state.screenAngle === 180) heading = norm360(heading + 180);
      pitch = aim.alt;
      source = "compass+tilt";
    } else {
      // Tilt only — still update pitch so vertical pan works
      const aim = rearCameraAzAlt(state._lastAlpha || 0, b, g, state.screenAngle);
      heading = state.headingRaw != null ? state.headingRaw : aim.az;
      pitch = aim.alt;
      source = "tilt-only";
    }

    if (gamma != null) state.roll = gamma;
    applyAim(heading, pitch, source);
  }

  /**
   * Gyro: keep overlays moving when compass/orientation is sticky on iOS.
   * rotationRate is deg/s in device frame.
   */
  function onMotion(e) {
    const now = performance.now();
    const prev = state._lastMotionTs || now;
    let dt = (now - prev) / 1000;
    state._lastMotionTs = now;
    if (dt <= 0 || dt > 0.25) dt = 0.016;

    const rr = e.rotationRate;
    if (!rr) return;

    const ra = typeof rr.alpha === "number" && !Number.isNaN(rr.alpha) ? rr.alpha : 0;
    const rb = typeof rr.beta === "number" && !Number.isNaN(rr.beta) ? rr.beta : 0;
    const rg = typeof rr.gamma === "number" && !Number.isNaN(rr.gamma) ? rr.gamma : 0;
    const gyroSpin = Math.abs(ra) + Math.abs(rb) + Math.abs(rg);
    if (gyroSpin < 3) return; // idle noise

    const orientAge = now - (state.lastOrientTs || 0);
    // If matrix orientation is healthy and recent, skip gyro (avoid double-count)
    if (orientAge < 120 && state.orientSource === "matrix") return;
    if (orientAge < 120 && state.orientSource === "matrix+compass") return;

    let yawRate = 0;
    let pitchRate = 0;
    const ang = state.screenAngle || 0;
    if (ang === 0 || ang === 180) {
      // Portrait viewfinder: turn left/right ~ alpha; tilt up/down ~ beta
      yawRate = -ra;
      pitchRate = -rb;
    } else if (ang === 90) {
      yawRate = -rb;
      pitchRate = rg;
    } else if (ang === -90 || ang === 270) {
      yawRate = rb;
      pitchRate = -rg;
    } else {
      yawRate = -ra;
      pitchRate = -rb;
    }

    // Stronger when orientation is stale or compass-only
    const gain =
      orientAge > 250 ? 1.0 : state.orientSource === "compass+tilt" ? 0.85 : 0.5;

    const h0 = state.headingRaw != null ? state.headingRaw : 0;
    const p0 = state.pitchRaw != null ? state.pitchRaw : 30;
    applyAim(
      norm360(h0 + yawRate * dt * gain),
      Math.max(-89, Math.min(89, p0 + pitchRate * dt * gain)),
      orientAge > 250 ? "gyro" : "gyro+orient"
    );
  }

  function startOrientation() {
    if (state._orientStarted) return;
    state._orientStarted = true;
    state.orientEventCount = 0;
    state.motionEventCount = 0;

    const opts = { capture: true, passive: true };
    window.addEventListener("deviceorientation", onOrientation, opts);
    window.addEventListener("deviceorientationabsolute", onOrientation, opts);
    window.addEventListener(
      "devicemotion",
      (e) => {
        state.motionEventCount = (state.motionEventCount || 0) + 1;
        onMotion(e);
      },
      opts
    );
    window.addEventListener("orientationchange", updateScreenAngle);
    if (screen.orientation) {
      screen.orientation.addEventListener("change", updateScreenAngle);
    }

    // Watchdog: warn if sensors never move overlays
    setTimeout(() => {
      if (!state.running) return;
      if ((state.orientEventCount || 0) < 3 && (state.motionEventCount || 0) < 3) {
        setStatus(
          "Sensors quiet — allow Motion & Orientation; wave phone in a figure‑8",
          "warn"
        );
      }
    }, 2500);
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
    const aya = Ex.ramanAyanamsa(time);
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

  /**
   * Project sky az/alt → screen pixels.
   * Optical center = screen center (must match crosshair).
   * Linear degrees→pixels is fine within ~half FOV; clamp far off-screen.
   */
  function project(obj) {
    if (state.heading == null || state.pitch == null) return null;
    const dAz = deltaAngle(state.heading, obj.az);
    const dAlt = obj.alt - state.pitch;
    const { w, h } = cssSize();
    const fov = viewFov();

    // Pixels per degree (from center)
    const ppdX = w / fov.h;
    const ppdY = h / fov.v;

    const x = w / 2 + dAz * ppdX;
    const y = h / 2 - dAlt * ppdY;
    const angDist = Math.hypot(dAz, dAlt);
    const margin = 1.02;
    const inFov =
      Math.abs(dAz) < (fov.h / 2) * margin &&
      Math.abs(dAlt) < (fov.v / 2) * margin;
    return { x, y, dAz, dAlt, angDist, inFov, fov, ppdX, ppdY };
  }

  /** Keep marker on-screen edge with a direction tick if off-FOV */
  function clampToFrame(x, y, w, h, pad) {
    const p = pad || 28;
    const cx = w / 2;
    const cy = h / 2;
    // Leave room for zoom bar / floating fabs only
    const top = p + 56;
    const bottom = h - (p + 72);
    const left = p;
    const right = w - p;

    if (x >= left && x <= right && y >= top && y <= bottom) {
      return { x, y, clipped: false };
    }

    // Ray from center to (x,y), intersect usable rect
    const dx = x - cx;
    const dy = y - cy;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
      return { x: cx, y: cy, clipped: false };
    }

    let tMin = Infinity;
    // left/right
    if (dx > 0) tMin = Math.min(tMin, (right - cx) / dx);
    else if (dx < 0) tMin = Math.min(tMin, (left - cx) / dx);
    // top/bottom
    if (dy > 0) tMin = Math.min(tMin, (bottom - cy) / dy);
    else if (dy < 0) tMin = Math.min(tMin, (top - cy) / dy);

    if (!Number.isFinite(tMin) || tMin < 0) tMin = 0.4;
    tMin = Math.min(tMin, 1) * 0.92;
    return { x: cx + dx * tMin, y: cy + dy * tMin, clipped: true };
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

    // Always overlay active layer on camera (+ selected target)
    const drawList = state.objects.filter(
      (o) => o.kind === state.activeLayer || o.id === state.targetId
    );

    for (const obj of drawList) {
      // Keep near-horizon objects; only skip deep below unless selected
      if (obj.alt < -8 && obj.id !== state.targetId) continue;
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
      // Show everything in/near the viewfinder — overlays must feel dense like a sky map
      const drawIt =
        isTarget ||
        p.inFov ||
        p.angDist < (obj.kind === "nakshatra" ? 22 : obj.kind === "rasi" ? 28 : 40);

      if (!drawIt) continue;

      // True projected position; soft-edge only if off the usable frame
      const clamped = clampToFrame(p.x, p.y, w, h, 24);
      const px = clamped.x;
      const py = clamped.y;

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
    if (state.findOpen) updateObjectList();
    else updateLayerChrome();
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

  function setEdge(el, on, label) {
    if (!el) return;
    el.classList.toggle("on", !!on);
    el.setAttribute("aria-hidden", on ? "false" : "true");
    if (label != null) el.textContent = label;
  }

  function updateGuide() {
    const target = state.objects.find((o) => o.id === state.targetId);
    const clearEdges = () => {
      setEdge(els.edgeLeft, false, "◀");
      setEdge(els.edgeRight, false, "▶");
      setEdge(els.edgeUp, false, "▲");
      setEdge(els.edgeDown, false, "▼");
    };

    if (!target || state.heading == null || state.pitch == null) {
      els.guidePanel?.classList.add("hidden");
      els.lockedBadge?.classList.add("hidden");
      els.btnClearTarget?.classList.add("hidden");
      els.alignBanner?.classList.add("hidden");
      clearEdges();
      return;
    }
    els.btnClearTarget?.classList.remove("hidden");

    if (target.alt < -2) {
      els.lockedBadge?.classList.add("hidden");
      els.guidePanel?.classList.remove("hidden");
      clearEdges();
      setEdge(els.edgeDown, true, "▼ below");
      if (els.guidePrimary) els.guidePrimary.textContent = target.label + " is below the horizon";
      if (els.guideSecondary)
        els.guideSecondary.textContent =
          "Face " + compassLabel(target.az) + " (" + target.az.toFixed(0) + "°) when it rises";
      if (els.guideDelta) els.guideDelta.textContent = "alt " + target.alt.toFixed(0) + "°";
      return;
    }

    const p = project(target);
    if (!p) return;

    // Locked on — on screen near center
    if (p.angDist < lockThreshold() && p.inFov) {
      els.guidePanel?.classList.add("hidden");
      els.lockedBadge?.classList.remove("hidden");
      clearEdges();
      if (els.lockedName) els.lockedName.textContent = "Aligned · " + target.label;
      if (els.lockedDetail)
        els.lockedDetail.textContent =
          "Within " +
          p.angDist.toFixed(1) +
          "° of crosshair · " +
          target.alt.toFixed(0) +
          "° elev · tap Align if still off real sky";
      els.alignBanner?.classList.remove("hidden");
      return;
    }

    els.lockedBadge?.classList.add("hidden");
    els.guidePanel?.classList.remove("hidden");
    els.alignBanner?.classList.add("hidden");

    // Edge cues — only the dominant directions (much clearer than a spinning arrow)
    const azThr = 4;
    const altThr = 4;
    const left = p.dAz < -azThr;
    const right = p.dAz > azThr;
    const up = p.dAlt > altThr;
    const down = p.dAlt < -altThr;

    setEdge(
      els.edgeLeft,
      left,
      left ? "◀ " + Math.abs(p.dAz).toFixed(0) + "°" : "◀"
    );
    setEdge(
      els.edgeRight,
      right,
      right ? Math.abs(p.dAz).toFixed(0) + "° ▶" : "▶"
    );
    setEdge(els.edgeUp, up, up ? "▲ " + Math.abs(p.dAlt).toFixed(0) + "°" : "▲");
    setEdge(
      els.edgeDown,
      down,
      down ? "▼ " + Math.abs(p.dAlt).toFixed(0) + "°" : "▼"
    );

    const parts = [];
    if (left) parts.push("turn left " + Math.abs(p.dAz).toFixed(0) + "°");
    if (right) parts.push("turn right " + Math.abs(p.dAz).toFixed(0) + "°");
    if (up) parts.push("tilt up " + Math.abs(p.dAlt).toFixed(0) + "°");
    if (down) parts.push("tilt down " + Math.abs(p.dAlt).toFixed(0) + "°");

    if (els.guidePrimary)
      els.guidePrimary.textContent = parts.length
        ? parts.join(" · ")
        : "Move slowly toward " + target.label;
    if (els.guideSecondary)
      els.guideSecondary.textContent =
        target.label +
        " · " +
        compassLabel(target.az) +
        " " +
        target.az.toFixed(0) +
        "° · elev " +
        target.alt.toFixed(0) +
        "°";
    if (els.guideDelta)
      els.guideDelta.textContent = p.angDist.toFixed(0) + "° from crosshair";

    if (els.dockHint && state.targetId) {
      els.dockHint.textContent = p.angDist.toFixed(0) + "° away · tap to list";
    }
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
      hint: "12 rāśis · sidereal Raman only",
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
    if (els.findFabLabel) {
      els.findFabLabel.textContent =
        state.activeLayer === "graha"
          ? "Graha"
          : state.activeLayer === "nakshatra"
            ? "Nakṣatra"
            : state.activeLayer === "rasi"
              ? "Zodiac"
              : "ISS";
    }

    els.layerCards?.forEach((card) => {
      const layer = card.getAttribute("data-layer");
      card.classList.toggle("active", layer === state.activeLayer);
    });
  }

  function setLayersOpen(open) {
    state.layersOpen = !!open;
    els.layerPanel?.classList.toggle("hidden", !open);
    els.btnLayers?.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) setFindOpen(false);
  }

  function setFindOpen(open) {
    state.findOpen = !!open;
    els.findPanel?.classList.toggle("hidden", !open);
    els.btnFind?.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      setLayersOpen(false);
      buildObjectList();
    }
  }

  /** When a target is selected, collapse panels (Maps-style clean view) */
  function syncGuidingUi() {
    const guiding = !!state.targetId && state.running;
    document.body.classList.toggle("guiding", guiding);
    if (guiding) {
      setLayersOpen(false);
      setFindOpen(false);
      els.guideDock?.classList.remove("hidden");
      els.pointingHud?.classList.add("dim");
      const t = state.objects.find((o) => o.id === state.targetId);
      if (els.dockTarget) els.dockTarget.textContent = t ? t.label : "Target";
      if (els.dockHint) {
        const p = t && project(t);
        els.dockHint.textContent = p
          ? p.angDist.toFixed(0) + "° away · tap to list"
          : "Guiding · tap for list";
      }
    } else {
      els.guideDock?.classList.add("hidden");
      els.pointingHud?.classList.remove("dim");
    }
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
        if (state.targetId && obj.kind !== state.activeLayer) {
          state.activeLayer = obj.kind;
        }
        updateGuide();
        updateObjectList();
        syncGuidingUi();
      });
      els.objectList.appendChild(btn);
    }
  }

  function setActiveLayer(layer) {
    if (!LAYER_COPY[layer]) return;
    state.activeLayer = layer;
    if (state.targetId) {
      const t = state.objects.find((o) => o.id === state.targetId);
      if (!t || t.kind !== layer) state.targetId = null;
    }
    if (layer === "iss") refreshISS(true).catch(() => {});
    updateLayerChrome();
    updateGuide();
    buildObjectList();
    syncGuidingUi();
    // Keep overlays refreshing immediately
    if (state.running) draw();
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
      " Raman · " +
      (state.orientSource || "no-sensor") +
      " · ev " +
      (state.orientEventCount || 0) +
      "/" +
      (state.motionEventCount || 0) +
      iss;
  }

  /**
   * Align AR to the real sky: user puts the real Moon (etc.) under the crosshair,
   * we set offsets so model az/alt match current device aim.
   */
  function calibrateToAim() {
    let body = state.objects.find((o) => o.id === state.targetId);
    if (!body || body.alt < -2) {
      body = state.objects.find(
        (o) =>
          o.kind === "graha" &&
          o.alt > 5 &&
          (o.label === "Candra" ||
            o.label === "Śukra" ||
            o.label === "Guru" ||
            o.label === "Sūrya")
      );
    }
    if (!body || state.headingRaw == null || state.pitchRaw == null) {
      setStatus("Select Moon/Venus, put the real one in the crosshair, tap Align", "warn");
      if (els.alignBanner) {
        els.alignBanner.classList.remove("hidden");
      }
      return;
    }

    // Current raw device aim should equal body sky position after offset
    state.headingOffset = deltaAngle(state.headingRaw, body.az);
    state.pitchOffset = body.alt - state.pitchRaw;
    state.heading = body.az;
    state.pitch = body.alt;
    state.smoothHeading = body.az;
    state.smoothPitch = body.alt;

    // Persist for session
    try {
      localStorage.setItem(
        "skyAlign",
        JSON.stringify({
          headingOffset: state.headingOffset,
          pitchOffset: state.pitchOffset,
          at: Date.now(),
        })
      );
    } catch (_) {}

    if (els.headingOffset) {
      const hv = Math.max(-60, Math.min(60, Math.round(state.headingOffset)));
      els.headingOffset.min = "-60";
      els.headingOffset.max = "60";
      els.headingOffset.value = String(hv);
      els.headingOffsetVal.textContent =
        (state.headingOffset >= 0 ? "+" : "") + state.headingOffset.toFixed(0) + "°";
    }
    if (els.pitchOffset) {
      const pv = Math.max(-40, Math.min(40, Math.round(state.pitchOffset)));
      els.pitchOffset.min = "-40";
      els.pitchOffset.max = "40";
      els.pitchOffset.value = String(pv);
      els.pitchOffsetVal.textContent =
        (state.pitchOffset >= 0 ? "+" : "") + state.pitchOffset.toFixed(0) + "°";
    }
    setStatus("Aligned on " + body.label + " · overlays should match now", "ok");
    els.alignBanner?.classList.add("hidden");
  }

  function loadSavedAlign() {
    try {
      const raw = localStorage.getItem("skyAlign");
      if (!raw) return;
      const data = JSON.parse(raw);
      // Expire after 12 hours (compass bias drifts)
      if (data.at && Date.now() - data.at > 12 * 3600 * 1000) return;
      if (typeof data.headingOffset === "number") state.headingOffset = data.headingOffset;
      if (typeof data.pitchOffset === "number") state.pitchOffset = data.pitchOffset;
    } catch (_) {}
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
          : "Live · Layers · Find",
        notes.length ? "warn" : "ok"
      );
      // Show find list once so overlays + list are obvious
      setFindOpen(true);
      syncGuidingUi();
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
    loadSavedAlign();
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
    const clearTarget = () => {
      state.targetId = null;
      updateGuide();
      updateObjectList();
      syncGuidingUi();
    };

    els.btnClearTarget?.addEventListener("click", clearTarget);
    els.btnDockClear?.addEventListener("click", clearTarget);
    els.btnCalibrate?.addEventListener("click", calibrateToAim);
    $("btnAlignQuick")?.addEventListener("click", calibrateToAim);

    els.btnLayers?.addEventListener("click", () => setLayersOpen(!state.layersOpen));
    els.btnCloseLayers?.addEventListener("click", () => setLayersOpen(false));
    els.btnFind?.addEventListener("click", () => setFindOpen(!state.findOpen));
    els.btnCloseFind?.addEventListener("click", () => setFindOpen(false));
    els.btnDockExpand?.addEventListener("click", () => setFindOpen(true));
    els.btnDockLayers?.addEventListener("click", () => {
      document.body.classList.remove("guiding");
      setLayersOpen(true);
    });

    els.layerCards?.forEach((card) => {
      card.addEventListener("click", () => {
        setActiveLayer(card.getAttribute("data-layer"));
        setLayersOpen(false);
        setFindOpen(true);
      });
    });
    els.onlyAbove?.addEventListener("change", () => {
      state.onlyAbove = !!els.onlyAbove.checked;
      buildObjectList();
    });

    // Tap empty sky (canvas) to re-open controls when guiding
    els.canvas?.addEventListener("click", () => {
      if (state.targetId) {
        // brief reveal of map controls
        els.mapControls?.classList.add("force-show");
        setTimeout(() => els.mapControls?.classList.remove("force-show"), 2500);
      }
    });

    updateLayerChrome();
    syncGuidingUi();

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
