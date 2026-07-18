/**
 * Raman Sky Guide — grahas, nakṣatras, rāśis, constellations
 * Raman ayanāṃśa only · planetarium + AR · iPhone-tuned
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
    btnRecalibrate: $("btnRecalibrate"),
    btnRecalibrateMenu: $("btnRecalibrateMenu"),
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
    drawerScrim: $("drawerScrim"),
    brandWatermark: $("brandWatermark"),
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
    infoCard: $("infoCard"),
    infoTitle: $("infoTitle"),
    infoSub: $("infoSub"),
    infoBody: $("infoBody"),
    btnCloseInfo: $("btnCloseInfo"),
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
    starNames: $("starNames"),
    tonightStrip: $("tonightStrip"),
  };

  if (!els.canvas) {
    console.error("skyCanvas missing — app cannot start");
  }
  const ctx = els.canvas ? els.canvas.getContext("2d") : null;

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
    /** Which overlays are drawn (multi-select, Maps-style) */
    overlays: {
      map: true, // planetarium black sky (reference look) vs camera AR
      graha: true,
      rasi: false, // off by default — reference is red ecliptic only
      nakshatra: false,
      stars: true, // figure art + cyan sticks + field stars
      iss: false,
    },
    showStarNames: true,
    starCache: {}, // name -> {az, alt, mag, name, nak}
    starCacheAt: 0,
    fieldCache: [], // background field stars {az,alt,mag}
    fieldCacheAt: 0,
    /** Which list Find opens (last focused layer) */
    activeLayer: "graha",
    onlyAbove: false,
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
    if (!els.statusChip) return;
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
   * Effective FOV after object-fit:cover + zoom.
   * Phones often report landscape video buffers while UI is portrait —
   * we match buffer axes to the upright display before computing cover crop.
   */
  function viewFov() {
    const z = Math.max(0.5, state.zoom || 1);
    const vid = els.camera;
    let vw = (vid && vid.videoWidth) || 1920;
    let vh = (vid && vid.videoHeight) || 1080;
    const { w: sw, h: sh } = cssSize();
    const screenAspect = sw / Math.max(1, sh);

    // If buffer is landscape but screen is portrait (or vice versa), swap buffer axes
    // so "width" matches the displayed upright frame after CSS cover.
    let videoAspect = vw / Math.max(1, vh);
    if (
      (screenAspect < 1 && videoAspect > 1.15) ||
      (screenAspect > 1.15 && videoAspect < 1)
    ) {
      const t = vw;
      vw = vh;
      vh = t;
      videoAspect = vw / Math.max(1, vh);
    }

    // Base optical FOV on the wider sensor axis ≈ BASE_H at 1×
    const fullW = BASE_H_FOV_1X / z;
    const fullH =
      ((2 * Math.atan(Math.tan(((fullW / 2) * Math.PI) / 180) * (vh / vw))) *
        180) /
      Math.PI;

    // object-fit: cover visible fractions
    const scale = Math.max(sw / vw, sh / vh);
    const visibleWFrac = Math.min(1, sw / (vw * scale));
    const visibleHFrac = Math.min(1, sh / (vh * scale));

    // Clamp so portrait never collapses to ~15° (kills AR)
    const h = Math.max(40, Math.min(100, fullW * visibleWFrac));
    const v = Math.max(50, Math.min(120, fullH * visibleHFrac));

    return { h, v, fullW, fullH, videoAspect, screenAspect, z };
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
    const vv = window.visualViewport;
    if (vv && vv.width && vv.height) {
      return { w: Math.round(vv.width), h: Math.round(vv.height) };
    }
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

  function applyAim(headingRaw, pitchRaw, source) {
    if (headingRaw == null || pitchRaw == null) return;
    if (Number.isNaN(headingRaw) || Number.isNaN(pitchRaw)) return;

    const prevH = state.headingRaw;
    const prevP = state.pitchRaw;
    const dH = prevH == null ? 99 : Math.abs(deltaAngle(prevH, headingRaw));
    const dP = prevP == null ? 99 : Math.abs(pitchRaw - prevP);
    const moved = dH + dP > 0.12;

    state.headingRaw = headingRaw;
    state.pitchRaw = Math.max(-89, Math.min(89, pitchRaw));
    state.orientSource = source || state.orientSource || "?";
    state.orientReady = true;
    state.orientEventCount = (state.orientEventCount || 0) + 1;
    // Only mark "fresh orient sample" when values actually change (enables gyro rescue)
    if (moved) {
      state.lastOrientTs = performance.now();
      state.lastAimMoveTs = performance.now();
    }

    // Fast tracking — high alpha so pan feels live
    const hTarget = norm360(headingRaw + state.headingOffset + (state.northBias || 0));
    const pTarget = state.pitchRaw + state.pitchOffset;
    state.smoothHeading = smoothAngle(state.smoothHeading, hTarget, 0.85);
    state.smoothPitch = smoothLinear(state.smoothPitch, pTarget, 0.85);
    state.heading = state.smoothHeading;
    state.pitch = state.smoothPitch;
  }

  function compassToLookAz(compass) {
    let c = compass;
    if (state.screenAngle === 90) c = norm360(c + 90);
    else if (state.screenAngle === -90 || state.screenAngle === 270)
      c = norm360(c - 90);
    else if (state.screenAngle === 180) c = norm360(c + 180);
    return c;
  }

  /** Slow north bias from compass — NEVER per-event 15% mix (that freezes iOS) */
  function maybeUpdateNorthBias(matrixAz, compass) {
    if (compass == null) return;
    const now = performance.now();
    if (state._lastBiasTs && now - state._lastBiasTs < 500) return;
    const acc =
      typeof state._lastCompassAccuracy === "number"
        ? state._lastCompassAccuracy
        : 1;
    if (acc < 0) return; // iOS: unreliable

    const c = compassToLookAz(compass);
    // Sticky compass: ignore if unchanged while we are moving
    if (
      state._lastCompassUsed != null &&
      Math.abs(deltaAngle(state._lastCompassUsed, c)) < 0.2
    ) {
      return;
    }
    state._lastCompassUsed = c;
    state._lastBiasTs = now;

    // Bias maps matrix az → compass az; apply slowly
    const err = deltaAngle(matrixAz + (state.northBias || 0), c);
    state.northBias = (state.northBias || 0) + err * 0.08;
  }

  function onOrientation(e) {
    // Prefer a single stream: absolute events win when flagged
    if (e && e.absolute === false && state._preferAbsolute) return;

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
    if (typeof e.webkitCompassAccuracy === "number") {
      state._lastCompassAccuracy = e.webkitCompassAccuracy;
    }
    if (e.absolute === true) state._preferAbsolute = true;

    if (beta == null && gamma == null && compass == null && alpha == null) return;

    const b = beta != null ? beta : state._lastBeta != null ? state._lastBeta : 90;
    const g = gamma != null ? gamma : state._lastGamma != null ? state._lastGamma : 0;
    if (beta != null) state._lastBeta = beta;
    if (gamma != null) state._lastGamma = gamma;
    if (alpha != null) state._lastAlpha = alpha;
    if (compass != null) state._lastCompass = compass;
    if (gamma != null) state.roll = gamma;

    // LIVE yaw/pitch from matrix when alpha exists (relative or absolute).
    // Absolute north via slow northBias from compass — not per-frame mix.
    if (alpha != null) {
      const aim = rearCameraAzAlt(alpha, b, g, state.screenAngle);
      if (compass != null && Math.abs(aim.alt) < 65) {
        maybeUpdateNorthBias(aim.az, compass);
      }
      applyAim(aim.az, aim.alt, compass != null ? "matrix" : "matrix");
      return;
    }

    if (compass != null) {
      // iOS often omits useful alpha: use compass for yaw + tilt for pitch
      const aim = rearCameraAzAlt(state._lastAlpha || 0, b, g, state.screenAngle);
      applyAim(compassToLookAz(compass), aim.alt, "compass+tilt");
      return;
    }

    // Tilt-only: still update pitch
    const aim = rearCameraAzAlt(state._lastAlpha || 0, b, g, state.screenAngle);
    const h = state.headingRaw != null ? state.headingRaw : aim.az;
    applyAim(h, aim.alt, "tilt-only");
  }

  function onMotion(e) {
    const now = performance.now();
    const prev = state._lastMotionTs || now;
    let dt = (now - prev) / 1000;
    state._lastMotionTs = now;
    if (dt <= 0 || dt > 0.25) dt = 0.016;

    // Gravity pitch backup when orientation is dead
    const ag = e.accelerationIncludingGravity;
    if (ag && (state.headingRaw == null || now - (state.lastAimMoveTs || 0) > 400)) {
      const ax = ag.x || 0;
      const ay = ag.y || 0;
      const az = ag.z || 0;
      // Rough camera elevation from gravity (portrait-ish)
      const gpitch =
        (Math.atan2(-az, Math.sqrt(ax * ax + ay * ay)) * 180) / Math.PI;
      if (state.headingRaw != null) {
        applyAim(state.headingRaw, gpitch, "gravity");
      }
    }

    const rr = e.rotationRate;
    if (!rr) return;

    const ra = typeof rr.alpha === "number" && !Number.isNaN(rr.alpha) ? rr.alpha : 0;
    const rb = typeof rr.beta === "number" && !Number.isNaN(rr.beta) ? rr.beta : 0;
    const rg = typeof rr.gamma === "number" && !Number.isNaN(rr.gamma) ? rr.gamma : 0;
    const gyroSpin = Math.abs(ra) + Math.abs(rb) + Math.abs(rg);
    if (gyroSpin < 4) return;

    // Rescue when aim values are flat even if orient events keep firing
    const aimAge = now - (state.lastAimMoveTs || 0);
    if (aimAge < 100 && gyroSpin < 25) return;

    let yawRate = 0;
    let pitchRate = 0;
    const ang = state.screenAngle || 0;
    if (ang === 0 || ang === 180) {
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

    const gain = aimAge > 200 ? 1.15 : 0.7;
    const h0 = state.headingRaw != null ? state.headingRaw : 0;
    const p0 = state.pitchRaw != null ? state.pitchRaw : 30;
    applyAim(
      norm360(h0 + yawRate * dt * gain),
      Math.max(-89, Math.min(89, p0 + pitchRate * dt * gain)),
      "gyro"
    );
  }

  function startOrientation() {
    if (state._listenersAttached) return;
    state._listenersAttached = true;
    state.orientEventCount = 0;
    state.motionEventCount = 0;
    state.northBias = state.northBias || 0;

    const opts = { passive: true };
    window.addEventListener("deviceorientation", onOrientation, opts);
    // Only use absolute if it actually fires with absolute:true (handler checks)
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

    scheduleSensorHealthCheck();
  }

  function scheduleSensorHealthCheck() {
    setTimeout(() => {
      if (!state.running) return;
      const moved = performance.now() - (state.lastAimMoveTs || 0) < 3000;
      if ((state.orientEventCount || 0) < 2 && (state.motionEventCount || 0) < 2) {
        setStatus("No sensors. Turn on Motion in Safari Settings, then tap ◎", "warn");
      } else if (!moved && !state.orientReady) {
        setStatus("Wave the phone in a figure-8", "warn");
      } else if (state.orientReady) {
        setStatus("Sensors live", "ok");
      }
    }, 2800);
  }

  /**
   * Recalibrate iPhone inputs: re-ask motion permission, reset compass bias,
   * soft-reset aim smoothing, refresh GPS. Then user should figure‑8 + Align.
   * Must be invoked from a user gesture (tap).
   */
  async function recalibrateSensors() {
    const btn = els.btnRecalibrate;
    if (btn) {
      btn.classList.add("spinning");
      btn.classList.remove("flash-ok");
    }
    setStatus("Recalibrating…", "warn");

    // Reset fusion state so a stale north bias cannot stick
    state.northBias = 0;
    state.headingOffset = 0;
    state.pitchOffset = 0;
    state.smoothHeading = null;
    state.smoothPitch = null;
    state.headingRaw = null;
    state.pitchRaw = null;
    state.heading = null;
    state.pitch = null;
    state.orientReady = false;
    state.orientEventCount = 0;
    state.motionEventCount = 0;
    state._lastCompass = null;
    state.lastAimMoveTs = 0;
    try {
      localStorage.removeItem("skyAlign");
    } catch (_) {}

    if (els.headingOffset) {
      els.headingOffset.value = "0";
      if (els.headingOffsetVal) els.headingOffsetVal.textContent = "0°";
    }
    if (els.pitchOffset) {
      els.pitchOffset.value = "0";
      if (els.pitchOffsetVal) els.pitchOffsetVal.textContent = "0°";
    }

    try {
      // Re-request sensors inside this tap (iOS)
      await beginSensorPermissionsInGesture();
    } catch (err) {
      setStatus("Allow Motion in Safari Settings", "warn");
    }

    // Ensure listeners are running
    if (!state._listenersAttached) {
      startOrientation();
    } else {
      scheduleSensorHealthCheck();
    }
    updateScreenAngle();

    // Fresh GPS fix
    try {
      await withTimeout(getLocation(), 10000, "Location");
    } catch (_) {
      try {
        await getLocationFallback();
      } catch (__) {}
    }

    // Nudge sky recompute
    state.lastBodyCompute = 0;
    state.starCacheAt = 0;
    state.fieldCacheAt = 0;

    setStatus("Wave phone in a figure-8, then Align on the Moon", "ok");
    els.alignBanner?.classList.remove("hidden");
    if (btn) {
      btn.classList.remove("spinning");
      btn.classList.add("flash-ok");
      setTimeout(() => btn.classList.remove("flash-ok"), 1600);
    }
  }

  /**
   * MUST be called synchronously inside the user tap (before any await).
   * Returns a Promise for the permission results.
   */
  function beginSensorPermissionsInGesture() {
    const tasks = [];
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      tasks.push(
        DeviceOrientationEvent.requestPermission().catch((e) => {
          throw e;
        })
      );
    } else {
      tasks.push(Promise.resolve("granted"));
    }
    if (
      typeof DeviceMotionEvent !== "undefined" &&
      typeof DeviceMotionEvent.requestPermission === "function"
    ) {
      tasks.push(
        DeviceMotionEvent.requestPermission().catch(() => "denied")
      );
    } else {
      tasks.push(Promise.resolve("granted"));
    }
    return Promise.all(tasks);
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
        setStatus("Rough location. Turn on Precise GPS.", "warn");
        return true;
      }
    } catch (_) {}
    // Last resort: still open app (user can recalibrate); use equator default only as last resort
    state.lat = state.lat ?? 20;
    state.lon = state.lon ?? 78;
    state.accM = 99999;
    setLocChip();
    setStatus("No GPS. Set Precise Location in Settings.", "warn");
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
    // Stop previous stream so Restart works on iOS
    if (state.stream) {
      try {
        state.stream.getTracks().forEach((t) => t.stop());
      } catch (_) {}
      state.stream = null;
      state.videoTrack = null;
      if (els.camera) els.camera.srcObject = null;
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

  // ── Fixed stars / constellations ─────────────────────────────────────

  function S() {
    return window.SkyStars;
  }

  function Art() {
    return window.SkyArt;
  }

  /** Horizon from J2000 RA hours / Dec deg (DefineStar slot) */
  function raDecToHorizon(ra, dec, time, observer) {
    Astronomy.DefineStar(Astronomy.Body.Star1, ra, dec, 100);
    const equ = Astronomy.Equator(Astronomy.Body.Star1, time, observer, true, true);
    return Astronomy.Horizon(time, observer, equ.ra, equ.dec, "normal");
  }

  /** Recompute star alt/az every ~2s (stars move slowly with sky) */
  function computeStars() {
    if (state.lat == null || typeof Astronomy === "undefined" || !S()) return;
    const now = performance.now();
    if (state.starCacheAt && now - state.starCacheAt < 2000) return;

    const observer = new Astronomy.Observer(state.lat, state.lon, state.elevM || 0);
    const time = Astronomy.MakeTime(new Date());
    const cache = {};
    const stars = S().STARS;

    for (const key of Object.keys(stars)) {
      const s = stars[key];
      try {
        const hor = raDecToHorizon(s.ra, s.dec, time, observer);
        cache[key] = {
          id: "star:" + key,
          kind: "star",
          key,
          label: s.name,
          az: hor.azimuth,
          alt: hor.altitude,
          mag: s.mag,
          nak: s.nak || null,
          color: s.mag <= 0.5 ? "#ffffff" : s.mag <= 1.5 ? "#e8f0ff" : "#c8d4f0",
        };
      } catch (err) {
        /* skip star */
      }
    }
    state.starCache = cache;
    state.starCacheAt = now;
  }

  /** Dense background field for planetarium (like reference black sky) */
  function computeFieldStars() {
    if (state.lat == null || typeof Astronomy === "undefined" || !Art()) return;
    const now = performance.now();
    if (state.fieldCacheAt && now - state.fieldCacheAt < 3000) return;
    const observer = new Astronomy.Observer(state.lat, state.lon, state.elevM || 0);
    const time = Astronomy.MakeTime(new Date());
    const out = [];
    for (const s of Art().FIELD) {
      try {
        const hor = raDecToHorizon(s.ra, s.dec, time, observer);
        if (hor.altitude < -8) continue;
        out.push({ az: hor.azimuth, alt: hor.altitude, mag: s.mag });
      } catch (_) {}
    }
    state.fieldCache = out;
    state.fieldCacheAt = now;
  }

  function applyCameraVisibility() {
    if (!els.camera) return;
    // Planetarium map = pure black sky (reference). AR = live camera.
    els.camera.style.opacity = state.overlays.map ? "0" : "1";
    document.body.classList.toggle("planetarium", !!state.overlays.map);
  }

  /**
   * Planetarium backdrop: solid night + milky dust + field stars.
   */
  function drawPlanetariumSky(w, h) {
    ctx.save();
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, w, h);
    // Deep-space blue dust
    const g = ctx.createRadialGradient(w * 0.5, h * 0.4, h * 0.02, w * 0.5, h * 0.5, h * 0.85);
    g.addColorStop(0, "rgba(30, 40, 70, 0.4)");
    g.addColorStop(0.4, "rgba(12, 18, 36, 0.2)");
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Milky Way band (stronger — reference Scorpius / multi-planet shots)
    ctx.save();
    ctx.translate(w * 0.5, h * 0.48);
    ctx.rotate(-0.65);
    const mw = ctx.createLinearGradient(0, -h * 0.22, 0, h * 0.22);
    mw.addColorStop(0, "rgba(100, 120, 180, 0)");
    mw.addColorStop(0.35, "rgba(140, 150, 200, 0.07)");
    mw.addColorStop(0.5, "rgba(200, 190, 220, 0.11)");
    mw.addColorStop(0.65, "rgba(140, 150, 200, 0.07)");
    mw.addColorStop(1, "rgba(100, 120, 180, 0)");
    ctx.fillStyle = mw;
    ctx.fillRect(-w * 1.2, -h * 0.25, w * 2.4, h * 0.5);
    // Dust mottling
    ctx.globalAlpha = 0.04;
    for (let i = 0; i < 40; i++) {
      const x = ((i * 97) % 200) / 200 * w * 2 - w;
      const y = ((i * 53) % 100) / 100 * h * 0.4 - h * 0.2;
      ctx.beginPath();
      ctx.arc(x, y, 20 + (i % 7) * 4, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 ? "#c8d0ff" : "#fff8e8";
      ctx.fill();
    }
    ctx.restore();
    ctx.restore();
  }

  function drawFieldStars(w, h) {
    if (!state.overlays.stars) return;
    if (state.heading == null || state.pitch == null) return;
    computeFieldStars();
    ctx.save();
    for (const s of state.fieldCache || []) {
      const p = project(s);
      if (!p || !p.inFov) continue;
      const r = s.mag <= 4 ? 1.35 : s.mag <= 4.8 ? 1.0 : 0.7;
      const a = s.mag <= 4 ? 0.85 : s.mag <= 5 ? 0.55 : 0.32;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(230, 235, 255, " + a + ")";
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * White constellation figure art (Scorpius scorpion etc.) in RA/Dec.
   * This is the big visual difference vs plain stick figures.
   */
  function drawConstellationArt(w, h) {
    if (!state.overlays.stars || !Art() || typeof Astronomy === "undefined") return;
    if (state.heading == null || state.pitch == null || state.lat == null) return;
    const observer = new Astronomy.Observer(state.lat, state.lon, state.elevM || 0);
    const time = Astronomy.MakeTime(new Date());

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    for (const fig of Art().FIGURES) {
      let anyIn = false;
      const projectedPaths = [];
      for (const path of fig.paths) {
        const pts = [];
        for (const [ra, dec] of path) {
          try {
            const hor = raDecToHorizon(ra, dec, time, observer);
            if (hor.altitude < -12) {
              pts.push(null);
              continue;
            }
            const p = project({ az: hor.azimuth, alt: hor.altitude });
            if (!p) {
              pts.push(null);
              continue;
            }
            if (p.inFov || p.angDist < 45) {
              pts.push(p);
              if (p.inFov) anyIn = true;
            } else pts.push(null);
          } catch (_) {
            pts.push(null);
          }
        }
        projectedPaths.push(pts);
      }
      if (!anyIn) continue;

      const strokeA = state.overlays.map ? 0.92 : 0.7;
      for (const pts of projectedPaths) {
        // Draw continuous segments (break on null)
        let started = false;
        ctx.beginPath();
        for (const p of pts) {
          if (!p) {
            started = false;
            continue;
          }
          if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
          } else ctx.lineTo(p.x, p.y);
        }
        // Soft white glow underlay
        ctx.strokeStyle = "rgba(255, 255, 255, " + strokeA * 0.22 + ")";
        ctx.lineWidth = state.overlays.map ? 4.5 : 3.2;
        ctx.stroke();
        // Crisp white figure line
        started = false;
        ctx.beginPath();
        for (const p of pts) {
          if (!p) {
            started = false;
            continue;
          }
          if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
          } else ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = "rgba(255, 255, 255, " + strokeA + ")";
        ctx.lineWidth = state.overlays.map ? 1.55 : 1.25;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * Cyan stick figures + bright named star dots (over white art).
   */
  function drawConstellations(w, h) {
    if (!state.overlays.stars || !S()) return;
    if (state.heading == null || state.pitch == null) return;
    computeStars();
    const cache = state.starCache || {};
    const showNames = state.showStarNames !== false;
    const map = !!state.overlays.map;

    ctx.save();
    for (const c of S().CONSTELLATIONS) {
      let anyIn = false;
      const segs = [];
      for (const [a, b] of c.lines) {
        const sa = cache[a];
        const sb = cache[b];
        if (!sa || !sb) continue;
        if (sa.alt < -5 && sb.alt < -5) continue;
        const pa = project(sa);
        const pb = project(sb);
        if (!pa || !pb) continue;
        if (!pa.inFov && !pb.inFov && pa.angDist > 40 && pb.angDist > 40) continue;
        segs.push([pa, pb]);
        if (pa.inFov || pb.inFov) anyIn = true;
      }
      if (!segs.length) continue;

      const lineAlpha = anyIn ? (map ? 0.95 : 0.8) : 0.3;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      for (const [pa, pb] of segs) {
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.strokeStyle = "rgba(70, 160, 255, " + lineAlpha * 0.4 + ")";
        ctx.lineWidth = map ? 6 : 4;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.strokeStyle = "rgba(70, 175, 255, " + lineAlpha + ")";
        ctx.lineWidth = map ? 2.2 : 1.7;
        ctx.stroke();
      }

      const pts = [];
      for (const [pa, pb] of segs) {
        if (pa.inFov) pts.push(pa);
        if (pb.inFov) pts.push(pb);
      }
      if (pts.length >= 2 && map) {
        let sx = 0;
        let sy = 0;
        for (const p of pts) {
          sx += p.x;
          sy += p.y;
        }
        const cx = sx / pts.length;
        const cy = sy / pts.length - 18;
        const lab = c.label;
        ctx.font = "600 12px -apple-system, system-ui, sans-serif";
        const tw = ctx.measureText(lab).width;
        ctx.fillStyle = "rgba(180, 210, 255, 0.55)";
        ctx.fillText(lab, cx - tw / 2, cy);
      }
    }

    // Bright catalog stars — glowing white
    for (const key of Object.keys(cache)) {
      const s = cache[key];
      if (s.alt < -3) continue;
      const p = project(s);
      if (!p || (!p.inFov && p.angDist > 35)) continue;

      const r = map
        ? s.mag <= 0
          ? 5.5
          : s.mag <= 1
            ? 4.4
            : s.mag <= 2
              ? 3.2
              : s.mag <= 3
                ? 2.4
                : 1.7
        : s.mag <= 0
          ? 4.5
          : s.mag <= 1
            ? 3.5
            : s.mag <= 2
              ? 2.6
              : s.mag <= 3
                ? 2
                : 1.4;

      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.5);
      g.addColorStop(0, "rgba(255,255,255,0.75)");
      g.addColorStop(0.3, "rgba(210,230,255,0.28)");
      g.addColorStop(1, "rgba(100,160,255,0)");
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 3.5, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      if (map && s.mag <= 1.0) drawStarSpike(p.x, p.y, r, s.mag);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();

      const showThisName =
        showNames &&
        !map &&
        p.inFov &&
        (s.mag <= 1.4 || s.nak || key === "Polaris" || key === "Sirius" || key === "Antares");
      if (showThisName) {
        const text = s.nak ? s.label + " · " + s.nak : s.label;
        ctx.font = "600 10px -apple-system, system-ui, sans-serif";
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        roundRect(ctx, p.x + r + 3, p.y - 7, tw + 6, 14, 4);
        ctx.fill();
        ctx.fillStyle = "rgba(235, 240, 255, 0.95)";
        ctx.fillText(text, p.x + r + 6, p.y + 3);
      }
    }
    ctx.restore();
  }

  /**
   * Red ecliptic spine (reference style) — always when stars or rāśi on.
   * Distinct from the multi-color rāśi band fill.
   */
  function drawEclipticSpine(w, h) {
    if (state.heading == null || state.pitch == null || !X() || state.lat == null) return;
    if (typeof Astronomy === "undefined") return;
    // Tropical ecliptic path in horizon coords (true sky path of Sun)
    // Use sidereal samples via Raman → tropical for jyotiṣī continuity
    const Ex = X();
    const observer = new Astronomy.Observer(state.lat, state.lon, state.elevM || 0);
    const time = Astronomy.MakeTime(new Date());

    const pts = [];
    for (let sid = 0; sid <= 360; sid += 1.5) {
      const p = projectSiderealEcliptic(sid, 0, Ex, time, observer);
      if (p && (p.inFov || p.angDist < 28)) pts.push(p);
      else if (pts.length) {
        strokeEclipticSegment(pts);
        pts.length = 0;
      }
    }
    if (pts.length >= 2) strokeEclipticSegment(pts);
  }

  function strokeEclipticSegment(pts) {
    if (pts.length < 2) return;
    ctx.save();
    // Soft red glow underlay
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = "rgba(255, 40, 55, 0.35)";
    ctx.lineWidth = 5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
    // Crisp red spine
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = "rgba(255, 45, 60, 0.92)";
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Floating compass badges (N / NE / E / SE …) in FOV — like reference SE pill.
   */
  function drawCompassBadges(w, h) {
    if (state.heading == null || state.pitch == null) return;
    const dirs = [
      { az: 0, lab: "N" },
      { az: 45, lab: "NE" },
      { az: 90, lab: "E" },
      { az: 135, lab: "SE" },
      { az: 180, lab: "S" },
      { az: 225, lab: "SW" },
      { az: 270, lab: "W" },
      { az: 315, lab: "NW" },
    ];
    // Place slightly above geometric horizon so they sit near the ecliptic band
    const alts = [6, 14];
    ctx.save();
    for (const d of dirs) {
      let best = null;
      for (const alt of alts) {
        const p = project({ az: d.az, alt });
        if (p && p.inFov && (!best || p.angDist < best.angDist)) best = p;
      }
      if (!best) continue;
      // Prefer badges not dead-center (avoid clutter on aim crosshair)
      if (best.angDist < 8) continue;
      drawDirBadge(best.x, best.y, d.lab);
    }
    ctx.restore();
  }

  function drawDirBadge(x, y, lab) {
    const padX = lab.length > 1 ? 10 : 8;
    const padY = 5;
    ctx.font = "700 11px -apple-system, system-ui, sans-serif";
    const tw = ctx.measureText(lab).width;
    const bw = tw + padX * 2;
    const bh = 16 + padY;
    const bx = x - bw / 2;
    const by = y - bh / 2;
    // Rounded hex-ish pill (reference SE badge)
    ctx.beginPath();
    const r = 5;
    roundRect(ctx, bx, by, bw, bh, r);
    ctx.fillStyle = "rgba(12, 14, 20, 0.72)";
    ctx.fill();
    ctx.strokeStyle = "rgba(230, 235, 245, 0.88)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // Inner hairline
    roundRect(ctx, bx + 1.5, by + 1.5, bw - 3, bh - 3, r - 1);
    ctx.strokeStyle = "rgba(180, 190, 210, 0.35)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = "rgba(245, 248, 255, 0.95)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(lab, x, y + 0.5);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  /**
   * Saturn (Śani) — large ringed globe like the reference screenshot.
   * Map mode uses exaggerated size (Sky Guide style, not true angular size).
   */
  function drawSaturnMarker(px, py, r, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const tilt = -0.42;
    const ringRx = r * 2.15;
    const ringRy = r * 0.55;

    // Soft planetary glow
    const glow = ctx.createRadialGradient(px, py, r * 0.2, px, py, r * 2.8);
    glow.addColorStop(0, "rgba(255, 230, 170, 0.2)");
    glow.addColorStop(0.5, "rgba(180, 150, 80, 0.08)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.arc(px, py, r * 2.8, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    // Far half of rings (behind globe)
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(tilt);
    ctx.beginPath();
    ctx.ellipse(0, 0, ringRx, ringRy, 0, Math.PI, Math.PI * 2);
    ctx.strokeStyle = "rgba(200, 180, 130, 0.55)";
    ctx.lineWidth = r * 0.22;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, ringRx * 0.82, ringRy * 0.82, 0, Math.PI, Math.PI * 2);
    ctx.strokeStyle = "rgba(160, 140, 95, 0.65)";
    ctx.lineWidth = r * 0.12;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, ringRx * 1.08, ringRy * 1.08, 0, Math.PI, Math.PI * 2);
    ctx.strokeStyle = "rgba(230, 210, 160, 0.4)";
    ctx.lineWidth = r * 0.08;
    ctx.stroke();
    ctx.restore();

    // Globe with bands
    const g = ctx.createRadialGradient(
      px - r * 0.35,
      py - r * 0.4,
      r * 0.08,
      px,
      py,
      r
    );
    g.addColorStop(0, "#fff2c8");
    g.addColorStop(0.25, "#f0d090");
    g.addColorStop(0.55, color || "#d4b06a");
    g.addColorStop(0.85, "#a88840");
    g.addColorStop(1, "#6a5428");
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    // atmospheric bands
    for (const [oy, rh, a] of [
      [-0.25, 0.14, 0.12],
      [0.05, 0.2, 0.18],
      [0.28, 0.12, 0.14],
    ]) {
      ctx.beginPath();
      ctx.ellipse(px, py + r * oy, r * 0.92, r * rh, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(120, 90, 40, " + a + ")";
      ctx.fill();
    }
    // terminator soft edge
    const term = ctx.createLinearGradient(px - r, py, px + r, py);
    term.addColorStop(0, "rgba(0,0,0,0.25)");
    term.addColorStop(0.45, "rgba(0,0,0,0)");
    term.addColorStop(1, "rgba(40, 30, 10, 0.15)");
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = term;
    ctx.fill();

    // Near half of rings (in front of globe)
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(tilt);
    ctx.beginPath();
    ctx.ellipse(0, 0, ringRx, ringRy, 0, 0, Math.PI);
    ctx.strokeStyle = "rgba(245, 225, 175, 0.95)";
    ctx.lineWidth = r * 0.24;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, ringRx * 0.82, ringRy * 0.82, 0, 0, Math.PI);
    ctx.strokeStyle = "rgba(170, 145, 95, 0.85)";
    ctx.lineWidth = r * 0.14;
    ctx.stroke();
    // Cassini-ish dark gap
    ctx.beginPath();
    ctx.ellipse(0, 0, ringRx * 0.93, ringRy * 0.93, 0, 0, Math.PI);
    ctx.strokeStyle = "rgba(40, 30, 15, 0.55)";
    ctx.lineWidth = r * 0.05;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, ringRx * 1.08, ringRy * 1.08, 0, 0, Math.PI);
    ctx.strokeStyle = "rgba(255, 240, 200, 0.55)";
    ctx.lineWidth = r * 0.09;
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  /** Exaggerated planet radius for map mode (Sky Map reference look) */
  function grahaDrawRadius(obj) {
    const map = !!state.overlays.map;
    const z = Math.max(0.6, Math.min(state.zoom || 1, 4));
    const s = Math.sqrt(z);
    if (obj.label === "Sūrya") return map ? 26 * s : 16;
    if (obj.label === "Candra" || obj.id === "graha:Moon") return map ? 38 * s : 16;
    if (obj.label === "Śani" || obj.id === "graha:Saturn") return map ? 36 * s : 14;
    if (obj.label === "Guru" || obj.id === "graha:Jupiter") return map ? 40 * s : 14;
    if (obj.label === "Maṅgala" || obj.id === "graha:Mars") return map ? 16 * s : 10;
    if (obj.label === "Śukra" || obj.id === "graha:Venus") return map ? 14 * s : 10;
    if (obj.kind === "iss") return map ? 28 * s : 12;
    if (obj.mag != null && obj.mag < 0) return map ? 14 : 11;
    return map ? 11 : 8;
  }

  const OBJECT_BLURB = {
    "graha:Sun": "The Sun. Daytime body.",
    "graha:Moon": "The Moon. Best object to Align on.",
    "graha:Mars": "Mars. Reddish when bright.",
    "graha:Mercury": "Mercury. Low near the Sun. Hard to catch.",
    "graha:Jupiter": "Jupiter. Bright. Bands if you look carefully.",
    "graha:Venus": "Venus. Brightest planet. Good Align target.",
    "graha:Saturn": "Saturn. Steady pale light. Rings need a telescope.",
    "graha:Rahu": "Rāhu. North lunar node. Not a light.",
    "graha:Ketu": "Ketu. South lunar node. Not a light.",
    iss: "International Space Station. Moves fast across the sky.",
    "const:scorpius": "Scorpius. Hook shape. Red Antares is Jyeṣṭhā.",
    "const:libra": "Libra. The scales. Between Virgo and Scorpius.",
    "const:virgo": "Virgo. Spica is Citrā.",
    "const:orion": "Orion. Three belt stars in a row.",
    "const:leo": "Leo. Sickle head. Regulus is Maghā.",
    "const:ursa_major": "Ursa Major. Big Dipper points toward Polaris.",
  };

  const OBJECT_EN = {
    "graha:Sun": "SUN",
    "graha:Moon": "MOON",
    "graha:Mars": "MARS",
    "graha:Mercury": "MERCURY",
    "graha:Jupiter": "JUPITER",
    "graha:Venus": "VENUS",
    "graha:Saturn": "SATURN",
    "graha:Rahu": "RĀHU",
    "graha:Ketu": "KETU",
    iss: "INTERNATIONAL SPACE STATION",
  };

  function objectInfoCopy(obj) {
    if (!obj) return null;
    const isConst = obj.id && String(obj.id).indexOf("const:") === 0;
    const en = OBJECT_EN[obj.id] || (obj.label || "").toUpperCase();
    const kind =
      obj.kind === "iss"
        ? "SPACE STATION"
        : isConst || obj.kind === "stars"
          ? "CONSTELLATION"
          : obj.kind === "star"
            ? "STAR"
            : obj.kind === "nakshatra"
              ? "NAKṢATRA"
              : obj.kind === "rasi"
                ? "RĀŚI"
                : "PLANET";
    const horiz = obj.alt > 0 ? "ABOVE HORIZON" : "BELOW HORIZON";
    let sub = kind + ", " + horiz;
    if (obj.rasi) sub += " · " + obj.rasi;
    if (obj.nakshatra) sub += " · " + obj.nakshatra;
    const body =
      OBJECT_BLURB[obj.id] ||
      obj.detail ||
      obj.sub ||
      "If the marker is off, Align on the Moon.";
    return { title: en, sub, body };
  }

  function updateInfoCard(obj) {
    if (!els.infoCard) return;
    if (!obj) {
      els.infoCard.classList.add("hidden");
      return;
    }
    const copy = objectInfoCopy(obj);
    if (els.infoTitle) els.infoTitle.textContent = copy.title;
    if (els.infoSub) els.infoSub.textContent = copy.sub;
    if (els.infoBody) els.infoBody.textContent = copy.body;
    els.infoCard.classList.remove("hidden");
  }

  function drawJupiterMarker(px, py, r, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const glow = ctx.createRadialGradient(px, py, r * 0.2, px, py, r * 2.2);
    glow.addColorStop(0, "rgba(255, 210, 140, 0.25)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.arc(px, py, r * 2.2, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
    // Base disc
    const g = ctx.createRadialGradient(px - r * 0.3, py - r * 0.35, r * 0.1, px, py, r);
    g.addColorStop(0, "#f5e0b8");
    g.addColorStop(0.4, "#d4a86a");
    g.addColorStop(1, "#8a6230");
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    // Belts
    const bands = [
      [-0.45, 0.1, "rgba(180, 100, 50, 0.45)"],
      [-0.22, 0.12, "rgba(220, 160, 90, 0.35)"],
      [0.02, 0.16, "rgba(160, 80, 40, 0.5)"],
      [0.28, 0.11, "rgba(200, 140, 70, 0.4)"],
      [0.48, 0.08, "rgba(140, 70, 35, 0.45)"],
    ];
    for (const [oy, rh, col] of bands) {
      ctx.beginPath();
      ctx.ellipse(px, py + r * oy, r * 0.95, r * rh, 0, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
    }
    // Great Red Spot hint
    ctx.beginPath();
    ctx.ellipse(px + r * 0.25, py + r * 0.12, r * 0.18, r * 0.1, 0.2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(190, 70, 40, 0.55)";
    ctx.fill();
    ctx.restore();
  }

  function drawMoonMarker(px, py, r, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const glow = ctx.createRadialGradient(px, py, r * 0.3, px, py, r * 2.4);
    glow.addColorStop(0, "rgba(220, 230, 255, 0.35)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.arc(px, py, r * 2.4, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
    const g = ctx.createRadialGradient(px - r * 0.35, py - r * 0.4, r * 0.15, px, py, r);
    g.addColorStop(0, "#f4f6fa");
    g.addColorStop(0.45, "#c8cdd8");
    g.addColorStop(1, "#6a7080");
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    // Craters
    const craters = [
      [-0.25, -0.2, 0.18],
      [0.2, 0.1, 0.22],
      [-0.1, 0.35, 0.12],
      [0.35, -0.25, 0.1],
      [0.05, -0.4, 0.08],
    ];
    for (const [ox, oy, rr] of craters) {
      ctx.beginPath();
      ctx.arc(px + r * ox, py + r * oy, r * rr, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(80, 90, 110, 0.28)";
      ctx.fill();
      ctx.strokeStyle = "rgba(40, 45, 55, 0.25)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // Mare patches
    ctx.beginPath();
    ctx.ellipse(px - r * 0.15, py + r * 0.05, r * 0.35, r * 0.28, 0.3, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(90, 100, 120, 0.22)";
    ctx.fill();
    ctx.restore();
  }

  function drawIssMarker(px, py, r, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(px, py);
    const s = r / 28;
    ctx.scale(s, s);
    // Solar arrays (blue)
    ctx.fillStyle = "#3a6cff";
    ctx.fillRect(-48, -6, 28, 12);
    ctx.fillRect(-48, 8, 28, 12);
    ctx.fillRect(20, -6, 28, 12);
    ctx.fillRect(20, 8, 28, 12);
    // Boom
    ctx.strokeStyle = "#c8d0e0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-50, 0);
    ctx.lineTo(50, 0);
    ctx.stroke();
    // Modules
    ctx.fillStyle = "#e8eef8";
    ctx.fillRect(-14, -8, 28, 16);
    ctx.fillStyle = "#b0b8c8";
    ctx.fillRect(-8, -14, 10, 8);
    ctx.fillRect(2, 6, 12, 8);
    // Crosshair ring around model is drawn by caller
    ctx.restore();
  }

  function drawStarSpike(px, py, r, mag) {
    if (mag > 1.2) return;
    const len = r * (mag <= 0 ? 4.5 : mag <= 0.5 ? 3.2 : 2.2);
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px - len, py);
    ctx.lineTo(px + len, py);
    ctx.moveTo(px, py - len);
    ctx.lineTo(px, py + len);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.moveTo(px - len * 0.7, py - len * 0.7);
    ctx.lineTo(px + len * 0.7, py + len * 0.7);
    ctx.moveTo(px + len * 0.7, py - len * 0.7);
    ctx.lineTo(px - len * 0.7, py + len * 0.7);
    ctx.stroke();
    ctx.restore();
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
        const rasi = Ex.rasiName(sidLon);
        const nak = Ex.nakshatraName(sidLon);
        const pada = Ex.nakshatraPada(sidLon);
        const degR = Ex.degreeInRasi(sidLon);
        const role = Ex.grahaSkyRole(g, alt, mag);
        let moonExtra = null;
        if (g.body === "Moon") moonExtra = Ex.moonPhaseInfo(time);
        if (moonExtra && moonExtra.mag != null) mag = moonExtra.mag;

        const degStr = degR.toFixed(1) + "°";
        out.push({
          id: "graha:" + g.id,
          kind: "graha",
          grahaId: g.id,
          label: g.label,
          en: g.en,
          sub:
            rasi +
            " " +
            degStr +
            " · " +
            nak +
            " pāda " +
            pada +
            (role.badge ? " · " + role.badge : ""),
          detail:
            (moonExtra
              ? moonExtra.shape + " · " + moonExtra.paksha + " pakṣa · "
              : "") + role.note,
          color: g.color,
          az,
          alt,
          mag,
          sidLon,
          tropLon,
          rasi,
          nakshatra: nak,
          pada,
          degInRasi: degR,
          skyRole: role,
          isNode: !!(g.node || g.id === "Rahu" || g.id === "Ketu"),
          moon: moonExtra,
        });
      } catch (err) {
        console.warn("graha", g.id, err);
      }
    }

    // Rising ecliptic ≈ sky lagna direction (for recognition of “east / rising rāśi”)
    try {
      const rise = Ex.findRisingEcliptic(time, observer);
      if (rise) {
        const sid = Ex.tropicalToSidereal(rise.tropLon, time);
        state.skyLagna = {
          az: rise.az,
          alt: rise.alt,
          tropLon: rise.tropLon,
          sidLon: sid,
          rasi: Ex.rasiName(sid),
          nakshatra: Ex.nakshatraName(sid),
          pada: Ex.nakshatraPada(sid),
        };
      } else state.skyLagna = null;
    } catch (_) {
      state.skyLagna = null;
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
          color: "hsl(" + (i * 30) + ", 70%, 70%)",
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
          color: "hsl(" + Math.round((i * 13.3 + 180) % 360) + ", 65%, 72%)",
          az: hor.azimuth,
          alt: hor.altitude,
          mag: null,
          sidLon: sidCenter,
          region: true,
        });
      } catch (_) {}
    });

    // Always include ISS row so the layer is never empty
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
    } else {
      out.push({
        id: "iss",
        kind: "iss",
        label: "ISS",
        sub: state.issError ? "Feed error · retry" : "Loading live position…",
        color: "#6dffa8",
        az: state.heading != null ? state.heading : 0,
        alt: -90,
        mag: null,
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
    if (!els.canvas || !ctx) return;
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
    if (!ctx) return;
    const { w, h } = cssSize();
    ctx.clearRect(0, 0, w, h);

    // Planetarium map = black sky (reference). AR = transparent over camera.
    if (state.overlays.map) {
      drawPlanetariumSky(w, h);
    }

    // Sensor dead → tell user overlays cannot track
    if (!state.orientReady) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(w * 0.1, h * 0.42, w * 0.8, 48);
      ctx.fillStyle = "#ffd27a";
      ctx.font = "700 14px -apple-system, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Waiting for motion… pan the phone", w / 2, h * 0.42 + 30);
      ctx.textAlign = "start";
    }

    // Layer order matches Sky Guide-style reference:
    // field stars → white figure art → cyan sticks → bright stars → red ecliptic → grahas
    if (state.overlays.stars) {
      drawFieldStars(w, h);
      drawConstellationArt(w, h);
      drawConstellations(w, h);
    }

    // Red ecliptic spine
    if (state.overlays.stars || state.overlays.rasi || state.overlays.nakshatra || state.overlays.map) {
      drawEclipticSpine(w, h);
    }

    // Optional gaṇita belts (off by default in map mode for cleaner look)
    if (state.overlays.rasi) drawZodiacBelt(w, h);
    if (state.overlays.nakshatra) drawNakshatraBelt(w, h);

    // Floating N/NE/E/SE… badges
    drawCompassBadges(w, h);

    let nearest = null;
    let nearestPointlike = null;

    // Lagna / udaya marker (eastern ecliptic rise)
    if (state.skyLagna && state.orientReady) {
      const lp = project({
        az: state.skyLagna.az,
        alt: Math.max(state.skyLagna.alt, 0.5),
      });
      if (lp && (lp.inFov || lp.angDist < 70)) {
        let x = lp.x;
        let y = lp.y;
        if (!lp.inFov) {
          const c = clampToFrame(lp.x, lp.y, w, h, 20);
          x = c.x;
          y = c.y;
        }
        ctx.save();
        ctx.strokeStyle = "rgba(109, 255, 168, 0.85)";
        ctx.fillStyle = "rgba(109, 255, 168, 0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y - 16);
        ctx.lineTo(x, y + 10);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y - 16);
        ctx.lineTo(x - 6, y - 6);
        ctx.lineTo(x + 6, y - 6);
        ctx.closePath();
        ctx.fill();
        const lab = "Udaya · " + state.skyLagna.rasi;
        ctx.font = "700 11px -apple-system, system-ui, sans-serif";
        const tw = ctx.measureText(lab).width;
        ctx.fillStyle = "rgba(0,0,0,0.65)";
        roundRect(ctx, x - tw / 2 - 4, y + 12, tw + 8, 16, 5);
        ctx.fill();
        ctx.fillStyle = "#6dffa8";
        ctx.fillText(lab, x - tw / 2, y + 24);
        ctx.restore();
      }
    }

    // Point markers: all 9 grahas when overlay on + ISS + selected target
    const points = state.objects.filter((o) => {
      if (o.id === state.targetId) return true;
      if (o.kind === "graha" && state.overlays.graha) return true;
      if (o.kind === "iss" && state.overlays.iss) return true;
      return false;
    });

    for (const obj of points) {
      const p = project(obj);
      if (!p) continue;

      if (obj.kind === "graha" || obj.kind === "iss") {
        if (!nearest || p.angDist < nearest.angDist) nearest = { obj, ...p };
        if (!nearestPointlike || p.angDist < nearestPointlike.angDist) {
          nearestPointlike = { obj, ...p };
        }
      }

      const isTarget = obj.id === state.targetId;
      // All 9 grahas: show if in FOV, near FOV, or selected; below-horizon get edge hint when selected
      const drawIt =
        isTarget ||
        p.inFov ||
        (obj.kind === "graha" && p.angDist < 55) ||
        (obj.kind === "iss" && p.angDist < 45);

      if (!drawIt) continue;

      let px = p.x;
      let py = p.y;
      if ((isTarget || (obj.kind === "graha" && !p.inFov && p.angDist < 80)) && !p.inFov) {
        const clamped = clampToFrame(p.x, p.y, w, h, 24);
        px = clamped.x;
        py = clamped.y;
      } else if (!p.inFov) {
        continue;
      }

      const r = grahaDrawRadius(obj);

      const alpha = p.inFov ? 1 : isTarget ? 0.9 : obj.alt < 0 ? 0.45 : 0.55;
      ctx.save();
      ctx.globalAlpha = alpha;

      const isSaturn = obj.label === "Śani" || obj.id === "graha:Saturn";
      const isJupiter = obj.label === "Guru" || obj.id === "graha:Jupiter";
      const isMoon = obj.label === "Candra" || obj.id === "graha:Moon";
      const isIss = obj.kind === "iss";

      if (isSaturn) {
        drawSaturnMarker(px, py, r, obj.color, alpha);
      } else if (isJupiter) {
        drawJupiterMarker(px, py, r, alpha);
      } else if (isMoon) {
        drawMoonMarker(px, py, r, alpha);
      } else if (isIss) {
        drawIssMarker(px, py, r, alpha);
      } else {
        ctx.beginPath();
        ctx.arc(px, py, r + 10, 0, Math.PI * 2);
        ctx.fillStyle = obj.color.length === 7 ? obj.color + "44" : "rgba(255,255,255,0.15)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = obj.color;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.stroke();
        if (obj.isNode) {
          ctx.beginPath();
          ctx.arc(px, py, r + 4, 0, Math.PI * 2);
          ctx.strokeStyle = obj.color;
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
      }

      // Floating labels only in AR / non-map — map uses bottom info card
      if (!state.overlays.map || (!isTarget && p.angDist > 12)) {
        if (!state.overlays.map) {
          const badge = obj.skyRole && obj.skyRole.badge ? obj.skyRole.badge : "";
          const label =
            obj.label +
            (obj.alt < 0 ? " ↓" : "") +
            (obj.rasi ? " · " + obj.rasi : "");
          const line2 =
            (badge ? badge + " · " : "") +
            (obj.mag != null ? "m" + obj.mag.toFixed(1) : "");
          ctx.font = "700 12px -apple-system, system-ui, sans-serif";
          const tw = Math.max(
            ctx.measureText(label).width,
            line2 ? ctx.measureText(line2).width : 0
          );
          const lx = px - tw / 2;
          const ly = py - r - (line2 ? 28 : 14);
          ctx.globalAlpha = Math.min(1, alpha + 0.2);
          ctx.fillStyle = "rgba(0,0,0,0.72)";
          roundRect(ctx, lx - 6, ly - 12, tw + 12, line2 ? 32 : 20, 8);
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.fillText(label, lx, ly + 2);
          if (line2) {
            ctx.font = "600 10px -apple-system, system-ui, sans-serif";
            ctx.fillStyle = "rgba(255,210,122,0.95)";
            ctx.fillText(line2, lx, ly + 15);
          }
        }
      }

      // Target / focus reticle — thin white circle (Sky Map style)
      if (isTarget || (state.overlays.map && p.angDist < 8 && p.inFov && (isJupiter || isSaturn || isMoon || isIss))) {
        ctx.globalAlpha = 1;
        const rr = Math.max(r * 1.35, r + 14);
        ctx.beginPath();
        ctx.arc(px, py, rr, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.92)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.restore();
    }

    drawRadar(w, h);
    const focus = nearestPointlike || nearest;
    updateHud(focus);
    // Info card: selected target, else object under crosshair (map look)
    if (state.targetId) {
      const t = state.objects.find((o) => o.id === state.targetId);
      updateInfoCard(t || null);
    } else if (
      focus &&
      focus.obj &&
      focus.angDist < lookAtThreshold() &&
      (focus.obj.kind === "graha" || focus.obj.kind === "iss")
    ) {
      updateInfoCard(focus.obj);
    } else {
      updateInfoCard(null);
    }
    updateGuide();
    if (state.findOpen) updateObjectList();
    else updateLayerChrome();
    updateDebug();
  }

  /** Project sidereal ecliptic lon/lat (Raman) → screen point or null */
  function projectSiderealEcliptic(sidLon, eclLat, Ex, time, observer) {
    try {
      const trop = Ex.siderealToTropical(sidLon, time);
      const hor = Ex.eclipticToHorizon(trop, eclLat, time, observer);
      if (hor.altitude < -25) return null;
      return project({ az: hor.azimuth, alt: hor.altitude });
    } catch (_) {
      return null;
    }
  }

  /**
   * Zodiac belt: thick band ±8° ecliptic latitude, 12 rāśi segments (Raman).
   */
  function drawZodiacBelt(w, h) {
    if (state.heading == null || state.pitch == null || !X() || state.lat == null) return;
    if (typeof Astronomy === "undefined") return;
    const Ex = X();
    const observer = new Astronomy.Observer(state.lat, state.lon, state.elevM || 0);
    const time = Astronomy.MakeTime(new Date());
    const step = 3;
    const halfW = 8; // degrees ecliptic latitude half-width

    ctx.save();
    for (let i = 0; i < 12; i++) {
      const sid0 = i * 30;
      const sid1 = (i + 1) * 30;
      const top = [];
      const bot = [];
      for (let s = sid0; s <= sid1 + 0.001; s += step) {
        const sid = Math.min(s, sid1);
        const pt = projectSiderealEcliptic(sid, halfW, Ex, time, observer);
        const pb = projectSiderealEcliptic(sid, -halfW, Ex, time, observer);
        if (pt && pt.inFov) top.push(pt);
        if (pb && pb.inFov) bot.push(pb);
      }
      if (top.length < 2 || bot.length < 2) continue;

      // Segment fill
      const hue = i * 30;
      ctx.beginPath();
      ctx.moveTo(top[0].x, top[0].y);
      for (let k = 1; k < top.length; k++) ctx.lineTo(top[k].x, top[k].y);
      for (let k = bot.length - 1; k >= 0; k--) ctx.lineTo(bot[k].x, bot[k].y);
      ctx.closePath();
      ctx.fillStyle = "hsla(" + hue + ", 70%, 60%, 0.16)";
      ctx.fill();
      ctx.strokeStyle = "hsla(" + hue + ", 80%, 70%, 0.55)";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Center line + label at segment mid
      const mid = projectSiderealEcliptic(sid0 + 15, 0, Ex, time, observer);
      if (mid && mid.inFov) {
        const name = Ex.RASIS[i].label;
        ctx.font = "700 12px -apple-system, system-ui, sans-serif";
        const tw = ctx.measureText(name).width;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        roundRect(ctx, mid.x - tw / 2 - 5, mid.y - 9, tw + 10, 18, 6);
        ctx.fill();
        ctx.fillStyle = "hsla(" + hue + ", 90%, 85%, 1)";
        ctx.fillText(name, mid.x - tw / 2, mid.y + 4);
      }
    }

    // Spine drawn separately as red ecliptic (drawEclipticSpine) — avoid double gold line
    ctx.restore();
  }

  /**
   * Nakṣatra band: thinner strip ±5° with 27 mansion labels (Raman).
   */
  function drawNakshatraBelt(w, h) {
    if (state.heading == null || state.pitch == null || !X() || state.lat == null) return;
    if (typeof Astronomy === "undefined") return;
    const Ex = X();
    const observer = new Astronomy.Observer(state.lat, state.lon, state.elevM || 0);
    const time = Astronomy.MakeTime(new Date());
    const width = 360 / 27;
    const step = 2;
    const halfW = 5;

    ctx.save();
    for (let i = 0; i < 27; i++) {
      const sid0 = i * width;
      const sid1 = (i + 1) * width;
      const top = [];
      const bot = [];
      for (let s = sid0; s <= sid1 + 0.001; s += step) {
        const sid = Math.min(s, sid1);
        const pt = projectSiderealEcliptic(sid, halfW, Ex, time, observer);
        const pb = projectSiderealEcliptic(sid, -halfW, Ex, time, observer);
        if (pt && pt.inFov) top.push(pt);
        if (pb && pb.inFov) bot.push(pb);
      }
      if (top.length < 2 || bot.length < 2) continue;

      const hue = Math.round((i * 13.333 + 200) % 360);
      ctx.beginPath();
      ctx.moveTo(top[0].x, top[0].y);
      for (let k = 1; k < top.length; k++) ctx.lineTo(top[k].x, top[k].y);
      for (let k = bot.length - 1; k >= 0; k--) ctx.lineTo(bot[k].x, bot[k].y);
      ctx.closePath();
      ctx.fillStyle = "hsla(" + hue + ", 55%, 55%, 0.12)";
      ctx.fill();
      ctx.strokeStyle = "hsla(" + hue + ", 70%, 75%, 0.4)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Boundary tick at start of mansion
      const edge = projectSiderealEcliptic(sid0, 0, Ex, time, observer);
      if (edge && edge.inFov) {
        ctx.beginPath();
        ctx.arc(edge.x, edge.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = "hsla(" + hue + ", 80%, 80%, 0.9)";
        ctx.fill();
      }

      const mid = projectSiderealEcliptic(sid0 + width / 2, 0, Ex, time, observer);
      if (mid && mid.inFov) {
        const name = Ex.NAKSHATRAS[i];
        // Shorten long names for readability
        const short =
          name.length > 10 ? name.replace("Pūrva ", "P.").replace("Uttara ", "U.") : name;
        ctx.font = "600 10px -apple-system, system-ui, sans-serif";
        const tw = ctx.measureText(short).width;
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        roundRect(ctx, mid.x - tw / 2 - 4, mid.y + 6, tw + 8, 15, 5);
        ctx.fill();
        ctx.fillStyle = "hsla(" + hue + ", 85%, 88%, 1)";
        ctx.fillText(short, mid.x - tw / 2, mid.y + 17);
      }
    }
    ctx.restore();
  }

  function drawRadar(w, h) {
    // Clean fullscreen: no corner radar chrome
    if (document.body.classList.contains("clean-ui")) return;
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
      if (obj.kind === "graha" && !state.overlays.graha) continue;
      if (obj.kind === "iss" && !state.overlays.iss) continue;
      if (obj.kind === "rasi" || obj.kind === "nakshatra") continue;
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

  /**
   * Jyotishi “what am I looking at?” under the crosshair.
   * AC: given aim, show graha and/or rāśi + nakṣatra of that sky direction.
   */
  function skyContextAtAim() {
    if (state.heading == null || state.pitch == null || !X() || state.lat == null)
      return null;
    if (typeof Astronomy === "undefined") return null;
    // Approximate: map aim alt/az back is hard; use nearest ecliptic sample in FOV cone
    const Ex = X();
    const observer = new Astronomy.Observer(state.lat, state.lon, state.elevM || 0);
    const time = Astronomy.MakeTime(new Date());
    let best = null;
    for (let sid = 0; sid < 360; sid += 2) {
      try {
        const trop = Ex.siderealToTropical(sid, time);
        const hor = Ex.eclipticToHorizon(trop, 0, time, observer);
        const dAz = deltaAngle(state.heading, hor.azimuth);
        const dAlt = hor.altitude - state.pitch;
        const dist = Math.hypot(dAz, dAlt);
        if (!best || dist < best.dist) {
          best = {
            dist,
            sidLon: sid,
            rasi: Ex.rasiName(sid),
            nak: Ex.nakshatraName(sid),
            pada: Ex.nakshatraPada(sid),
            deg: Ex.degreeInRasi(sid),
          };
        }
      } catch (_) {}
    }
    if (!best || best.dist > 18) return null;
    return best;
  }

  function updateHud(nearest) {
    if (state.heading == null || state.pitch == null) {
      if (els.pointingMain) els.pointingMain.textContent = "Aim phone at sky";
      if (els.pointingSub)
        els.pointingSub.textContent = state.orientReady
          ? "Wave phone in a figure-8, then Align"
          : "Allow Motion, then pan";
      return;
    }
    const thr = lookAtThreshold();
    const dir = compassLabel(state.heading);
    const ctxSky = skyContextAtAim();
    const lag = state.skyLagna;

    if (nearest && nearest.angDist < thr && nearest.obj) {
      const o = nearest.obj;
      if (els.pointingMain) {
        els.pointingMain.textContent =
          o.label +
          (o.skyRole && o.skyRole.badge ? " · " + o.skyRole.badge : "");
      }
      if (els.pointingSub) {
        els.pointingSub.textContent =
          (o.rasi || "") +
          (o.degInRasi != null ? " " + o.degInRasi.toFixed(1) + "°" : "") +
          (o.nakshatra ? " · " + o.nakshatra : "") +
          (o.pada ? " p" + o.pada : "") +
          " · " +
          nearest.angDist.toFixed(1) +
          "° · " +
          dir;
      }
      return;
    }

    if (ctxSky) {
      if (els.pointingMain)
        els.pointingMain.textContent =
          ctxSky.rasi + " · " + ctxSky.nak + " p" + ctxSky.pada;
      if (els.pointingSub)
        els.pointingSub.textContent =
          "Belt under crosshair · " +
          ctxSky.deg.toFixed(1) +
          "° in rāśi · " +
          dir +
          " " +
          state.pitch.toFixed(0) +
          "°" +
          (lag ? " · udaya ≈ " + lag.rasi : "");
      return;
    }

    if (els.pointingMain)
      els.pointingMain.textContent =
        dir + " · " + state.pitch.toFixed(0) + "° elev";
    if (els.pointingSub)
      els.pointingSub.textContent =
        (nearest && nearest.obj
          ? "Nearest " +
            nearest.obj.label +
            " " +
            nearest.angDist.toFixed(0) +
            "° · "
          : "") +
        (lag ? "Udaya rāśi ≈ " + lag.rasi : "Open Layers · Align on Moon");
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
          p.angDist.toFixed(1) +
          "° off · elev " +
          target.alt.toFixed(0) +
          "°. Align if still wrong.";
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
    map: {
      title: "Planetarium",
      hint: "Black sky map",
    },
    graha: {
      title: "Graha",
      hint: "All nine. Tap one to guide.",
    },
    nakshatra: {
      title: "Nakṣatra",
      hint: "27 mansions on the ecliptic",
    },
    rasi: {
      title: "Zodiac",
      hint: "12 rāśis on the ecliptic",
    },
    stars: {
      title: "Constellations",
      hint: "Figures and bright stars",
    },
    iss: {
      title: "ISS",
      hint: "Live position",
    },
  };

  function objectsForActiveLayer() {
    // Constellation list = named patterns + yoga-tārā anchors
    if (state.activeLayer === "stars") {
      if (!S()) return [];
      computeStars();
      const cache = state.starCache || {};
      const items = S().CONSTELLATIONS.map((c) => {
        // centroid alt/az from member stars above horizon
        let n = 0;
        let az = 0;
        let alt = 0;
        const names = new Set();
        for (const [a, b] of c.lines) {
          names.add(a);
          names.add(b);
        }
        for (const k of names) {
          const s = cache[k];
          if (!s || s.alt < -10) continue;
          az += s.az;
          alt += s.alt;
          n++;
        }
        if (!n) {
          return {
            id: "const:" + c.id,
            kind: "stars",
            label: c.label,
            sub: c.hint + " · below horizon",
            detail: "Pan until it rises. Align if labels drift.",
            color: "#a8c0ff",
            az: 0,
            alt: -90,
            skyRole: { badge: "Set", code: "set" },
          };
        }
        return {
          id: "const:" + c.id,
          kind: "stars",
          label: c.label,
          sub: c.hint,
          detail:
            OBJECT_BLURB["const:" + c.id] ||
            "Sky pattern. Not a rāśi boundary.",
          color: "#a8c0ff",
          az: az / n,
          alt: alt / n,
          skyRole: {
            badge: alt / n > 5 ? "Up" : "Low",
            code: alt / n > 5 ? "visible" : "horizon",
          },
        };
      });
      // Put up patterns first
      items.sort((a, b) => (b.alt > 0 ? 1 : 0) - (a.alt > 0 ? 1 : 0) || b.alt - a.alt);
      return items;
    }

    let items = state.objects.filter((o) => o.kind === state.activeLayer);
    // Graha layer: ALWAYS all 9 (never hide below-horizon from the list)
    if (state.activeLayer === "graha") {
      // stable order: Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn, Rahu, Ketu
      const order = [
        "graha:Sun",
        "graha:Moon",
        "graha:Mars",
        "graha:Mercury",
        "graha:Jupiter",
        "graha:Venus",
        "graha:Saturn",
        "graha:Rahu",
        "graha:Ketu",
      ];
      items = order
        .map((id) => state.objects.find((o) => o.id === id))
        .filter(Boolean);
      return items;
    }
    if (state.onlyAbove) {
      const up = items.filter((o) => o.alt >= -1);
      if (up.length) items = up;
    }
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
    if (els.layerHint) {
      if (state.activeLayer === "graha") {
        els.layerHint.textContent = "All nine. Tap to guide.";
      } else {
        els.layerHint.textContent = copy.hint;
      }
    }
    if (els.findFabLabel) {
      const map = {
        map: "Map",
        graha: "Graha",
        nakshatra: "Nakṣatra",
        rasi: "Zodiac",
        stars: "Stars",
        iss: "ISS",
      };
      els.findFabLabel.textContent = map[state.activeLayer] || "Find";
    }
    // Title bar for public brand (if present)
    if (document.title !== "Raman Sky Guide") document.title = "Raman Sky Guide";

    els.layerCards?.forEach((card) => {
      const layer = card.getAttribute("data-layer");
      const on = !!state.overlays[layer];
      card.classList.toggle("active", on);
      card.setAttribute("aria-pressed", on ? "true" : "false");
      const badge = card.querySelector(".lc-on");
      if (badge) badge.textContent = on ? "ON" : "OFF";
    });
  }

  function toggleOverlay(layer) {
    if (!(layer in state.overlays)) return;
    state.overlays[layer] = !state.overlays[layer];
    // Keep at least one overlay on
    if (!Object.values(state.overlays).some(Boolean)) {
      state.overlays[layer] = true;
    }
    state.activeLayer = layer === "map" ? "graha" : layer;
    if (layer === "iss") refreshISS(true).catch(() => {});
    if (layer === "map") applyCameraVisibility();
    updateLayerChrome();
    if (state.findOpen) buildObjectList();
  }

  function updateDrawerScrim() {
    const any = state.layersOpen || state.findOpen;
    els.drawerScrim?.classList.toggle("hidden", !any);
    els.drawerScrim?.setAttribute("aria-hidden", any ? "false" : "true");
  }

  function setLayersOpen(open) {
    state.layersOpen = !!open;
    els.layerPanel?.classList.toggle("hidden", !open);
    els.btnLayers?.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      state.findOpen = false;
      els.findPanel?.classList.add("hidden");
      els.btnFind?.setAttribute("aria-expanded", "false");
    }
    updateDrawerScrim();
  }

  function setFindOpen(open) {
    state.findOpen = !!open;
    els.findPanel?.classList.toggle("hidden", !open);
    els.btnFind?.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      state.layersOpen = false;
      els.layerPanel?.classList.add("hidden");
      els.btnLayers?.setAttribute("aria-expanded", "false");
      buildObjectList();
    }
    updateDrawerScrim();
  }

  function closeAllDrawers() {
    setLayersOpen(false);
    setFindOpen(false);
  }

  /** When a target is selected, collapse panels — keep sky fullscreen */
  function syncGuidingUi() {
    const guiding = !!state.targetId && state.running;
    document.body.classList.toggle("guiding", guiding);
    if (guiding) {
      closeAllDrawers();
      // Dock optional — keep clean; info card carries the focus
      els.guideDock?.classList.add("hidden");
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

  function renderTonightStrip() {
    if (!els.tonightStrip) return;
    els.tonightStrip.innerHTML = "";
    if (state.activeLayer !== "graha") {
      els.tonightStrip.hidden = true;
      return;
    }
    els.tonightStrip.hidden = false;
    const bright = state.objects.filter(
      (o) =>
        o.kind === "graha" &&
        o.skyRole &&
        (o.skyRole.code === "bright" || o.skyRole.code === "visible") &&
        o.alt > 5
    );
    if (!bright.length) {
      const tip = document.createElement("span");
      tip.className = "tonight-chip";
      tip.textContent = "No bright graha up right now";
      tip.style.borderStyle = "dashed";
      els.tonightStrip.appendChild(tip);
      return;
    }
    const lab = document.createElement("span");
    lab.className = "tonight-chip";
    lab.style.borderColor = "rgba(255,210,122,0.4)";
    lab.style.color = "#ffd27a";
    lab.textContent = "Tonight (naked-eye)";
    els.tonightStrip.appendChild(lab);
    for (const o of bright) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tonight-chip";
      b.textContent =
        o.label + (o.rasi ? " · " + o.rasi : "") + " · " + o.alt.toFixed(0) + "°";
      b.addEventListener("click", () => {
        state.targetId = o.id;
        state.overlays.graha = true;
        updateGuide();
        syncGuidingUi();
        buildObjectList();
      });
      els.tonightStrip.appendChild(b);
    }
  }

  function buildObjectList(items) {
    if (!els.objectList) return;
    if (!items) items = objectsForActiveLayer();
    updateLayerChrome();
    renderTonightStrip();

    const aboveN = items.filter((o) => o.alt >= 0).length;
    if (els.listMeta) {
      if (state.activeLayer === "graha") {
        els.listMeta.textContent =
          "All 9 · " +
          aboveN +
          " above horizon · Raman · badges = sky recognition";
      } else {
        els.listMeta.textContent = items.length
          ? aboveN + " up · " + items.length + " listed · tap to guide"
          : "Nothing to show";
      }
    }

    els.objectList.className =
      "object-grid" +
      (state.activeLayer === "graha" ? " graha-grid" : "");
    els.objectList.innerHTML = "";
    for (const obj of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "obj-card kind-" + obj.kind;
      btn.dataset.id = obj.id;
      btn.setAttribute("role", "option");
      const roleBadge =
        obj.skyRole && obj.skyRole.badge
          ? '<span class="role-badge role-' +
            (obj.skyRole.code || "") +
            '">' +
            obj.skyRole.badge +
            "</span>"
          : "";
      btn.innerHTML =
        '<span class="name"><span class="dot" style="background:' +
        obj.color +
        '"></span><span class="name-text">' +
        obj.label +
        "</span>" +
        roleBadge +
        "</span>" +
        (obj.sub ? '<span class="sub">' + obj.sub + "</span>" : "") +
        (obj.detail
          ? '<span class="detail">' + obj.detail + "</span>"
          : "") +
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
    // Ensure this overlay is on when focusing Find list
    state.overlays[layer] = true;
    if (state.targetId) {
      const t = state.objects.find((o) => o.id === state.targetId);
      if (!t || t.kind !== layer) state.targetId = null;
    }
    if (layer === "iss") refreshISS(true).catch(() => {});
    updateLayerChrome();
    updateGuide();
    buildObjectList();
    syncGuidingUi();
    if (state.running && ctx) draw();
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
      setStatus("Pick the Moon or Venus, center it, then Align", "warn");
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
    setStatus("Aligned on " + body.label, "ok");
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
    try {
      if (ts - state.lastBodyCompute > 500) {
        computeSky();
        if (state.overlays.stars) computeStars();
        state.lastBodyCompute = ts;
      }
      if (ts - state.lastIssFetch > 4000) {
        refreshISS(false);
      }
      if (ctx) draw();
    } catch (err) {
      console.error("tick", err);
      setStatus("Draw error: " + ((err && err.message) || err), "warn");
    }
    // Always re-schedule even if draw throws — otherwise AR dies forever
    requestAnimationFrame(tick);
  }

  async function startAll() {
    if (state._starting) return;
    state._starting = true;
    state.running = false; // stop prior rAF ownership until we restart

    showGateError("");
    if (els.gate) els.gate.classList.remove("hidden");
    if (els.btnGateStart) {
      els.btnGateStart.disabled = true;
      els.btnGateStart.textContent = "Starting…";
    }
    if (els.btnStart) els.btnStart.disabled = true;
    setStatus("Starting…", "warn");

    const notes = [];

    // CRITICAL iOS: fire requestPermission() in this click turn BEFORE any await
    let sensorPermPromise = null;
    try {
      sensorPermPromise = beginSensorPermissionsInGesture();
    } catch (err) {
      notes.push("Motion prompt: " + ((err && err.message) || err));
      sensorPermPromise = Promise.resolve(["denied", "denied"]);
    }

    try {
      if (!window.isSecureContext) {
        throw new Error("Need HTTPS (open the github.io link in Safari).");
      }
      if (typeof Astronomy === "undefined") {
        throw new Error("Astronomy library failed to load. Check network, reload.");
      }
      if (!X()) {
        throw new Error("Sky extras failed to load. Hard-refresh (close tab).");
      }
      if (!ctx) throw new Error("Canvas missing.");

      // Camera still needs to be early for getUserMedia UX
      setStatus("Camera…", "warn");
      showGateError("Requesting camera…");
      await withTimeout(startCamera(), 20000, "Camera");

      // Await motion permissions started in the gesture
      setStatus("Motion…", "warn");
      showGateError("Waiting for motion permission…");
      try {
        const perms = await withTimeout(sensorPermPromise, 45000, "Motion permission");
        const o = perms && perms[0];
        if (o && o !== "granted") {
          notes.push("Motion denied");
        }
      } catch (err) {
        notes.push("Motion: " + ((err && err.message) || "timeout"));
      }
      startOrientation();

      setStatus("Location…", "warn");
      showGateError("Requesting location…");
      try {
        await withTimeout(getLocation(), 15000, "Location");
      } catch (err) {
        notes.push("GPS: " + ((err && err.message) || "failed"));
        await getLocationFallback();
      }

      refreshISS(true).catch(() => {});
      computeSky();
      buildObjectList();
      state.running = true;
      els.gate.classList.add("hidden");
      document.body.classList.add("running", "clean-ui");
      closeAllDrawers();

      setStatus(
        notes.length ? "Live with limits: " + notes.join(", ") : "Live. Pan the sky.",
        notes.length ? "warn" : "ok"
      );
      syncGuidingUi();
      requestAnimationFrame(tick);
    } catch (err) {
      console.error(err);
      const msg = err && err.message ? err.message : String(err);
      if (els.gate) els.gate.classList.remove("hidden");
      showGateError(
        msg + "\n\nIn Safari, allow Camera, Location, and Motion. Turn Precise Location on. Reload."
      );
      setStatus("Start failed", "warn");
      state.running = false;
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
    applyCameraVisibility(); // planetarium map ON by default (reference look)
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
    } else if (!S() || !Art()) {
      showGateError("Star/art catalogs not loaded. Hard-refresh (?v=14).");
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
    const onRecal = (e) => {
      e.preventDefault();
      recalibrateSensors().catch(() => {});
    };
    els.btnRecalibrate?.addEventListener("click", onRecal);
    els.btnRecalibrateMenu?.addEventListener("click", (e) => {
      onRecal(e);
      setLayersOpen(false);
    });
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
      card.addEventListener("click", (ev) => {
        const layer = card.getAttribute("data-layer");
        toggleOverlay(layer);
        // Stay in menu so user can toggle multiple layers; map is view-only
        if (layer !== "map") state.activeLayer = layer;
        updateLayerChrome();
      });
    });
    els.onlyAbove?.addEventListener("change", () => {
      state.onlyAbove = !!els.onlyAbove.checked;
      buildObjectList();
    });
    els.starNames?.addEventListener("change", () => {
      state.showStarNames = !!els.starNames.checked;
    });
    els.btnCloseInfo?.addEventListener("click", () => {
      state.targetId = null;
      updateInfoCard(null);
      syncGuidingUi();
    });
    els.drawerScrim?.addEventListener("click", () => closeAllDrawers());
    // Escape / back-feel: close drawers on empty sky tap when open
    document.getElementById("app")?.addEventListener("click", (ev) => {
      if (!state.layersOpen && !state.findOpen) return;
      const t = ev.target;
      if (!t || !t.closest) return;
      if (t.closest(".map-panel, .find-panel, .chrome-btn, .info-card, .gate")) return;
      closeAllDrawers();
    });

    window.visualViewport?.addEventListener("resize", () => {
      resizeCanvas();
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

    setStatus("Tap Allow & start", "muted");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
