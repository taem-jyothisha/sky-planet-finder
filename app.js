/**
 * Sky — camera AR planet finder
 * Uses astronomy-engine for alt/az, device orientation for aiming.
 */
(() => {
  "use strict";

  const BODIES = [
    { id: "Sun", label: "Sun", color: "#ffd27a", body: "Sun" },
    { id: "Moon", label: "Moon", color: "#e8eefc", body: "Moon" },
    { id: "Mercury", label: "Mercury", color: "#c4b8a8", body: "Mercury" },
    { id: "Venus", label: "Venus", color: "#f5e6c8", body: "Venus" },
    { id: "Mars", label: "Mars", color: "#ff7a5c", body: "Mars" },
    { id: "Jupiter", label: "Jupiter", color: "#f0b878", body: "Jupiter" },
    { id: "Saturn", label: "Saturn", color: "#e8d090", body: "Saturn" },
    { id: "Uranus", label: "Uranus", color: "#7ec8d8", body: "Uranus" },
    { id: "Neptune", label: "Neptune", color: "#5a8fff", body: "Neptune" },
  ];

  // Approximate phone camera FOV (degrees). Good enough for guidance.
  const H_FOV = 58;
  const V_FOV = 42;
  // Within this of crosshair = "looking at"
  const LOOK_AT_DEG = 8;
  // Within this of center = locked on target
  const LOCK_DEG = 6;

  const $ = (id) => document.getElementById(id);

  const els = {
    camera: $("camera"),
    canvas: $("skyCanvas"),
    gate: $("gate"),
    gateError: $("gateError"),
    btnGateStart: $("btnGateStart"),
    btnStart: $("btnStart"),
    btnClearTarget: $("btnClearTarget"),
    statusChip: $("statusChip"),
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
  };

  const ctx = els.canvas.getContext("2d");

  const state = {
    stream: null,
    lat: null,
    lon: null,
    heading: null, // degrees, 0=N, clockwise
    pitch: null, // altitude of camera view, 0=horizon, 90=zenith
    roll: 0,
    headingOffset: 0,
    targetId: null,
    bodies: [], // {id, label, color, az, alt, mag?}
    running: false,
    orientReady: false,
    lastFrame: 0,
  };

  function setStatus(text, kind) {
    els.statusChip.textContent = text;
    els.statusChip.className = "chip " + (kind || "muted");
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

  /** Smallest signed angle from a to b in (-180, 180] */
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

  // ── Sensors ──────────────────────────────────────────────────────────

  async function requestOrientationPermission() {
    // iOS 13+: must run from a user tap (our Start button).
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== "granted") {
        throw new Error(
          "Motion / compass denied. Settings → Safari → Motion & Orientation Access → allow, then reload and tap Start."
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

  function onOrientation(e) {
    // Heading: prefer webkitCompassHeading (true north, degrees clockwise from N)
    let heading = null;
    if (typeof e.webkitCompassHeading === "number" && !Number.isNaN(e.webkitCompassHeading)) {
      heading = e.webkitCompassHeading;
    } else if (typeof e.alpha === "number" && e.alpha != null) {
      // Absolute orientation: alpha is degrees from north (implementation varies).
      // Common: compass = (360 - alpha) when absolute is true, else crude fallback.
      const abs = e.absolute === true;
      heading = abs ? norm360(360 - e.alpha) : norm360(360 - e.alpha);
    }

    if (heading != null) {
      state.heading = norm360(heading + state.headingOffset);
      state.orientReady = true;
    }

    // Pitch → camera altitude when holding phone as a viewfinder (portrait-ish).
    // beta: 0 = flat face-up, 90 = upright. Looking up: tilt back → beta decreases.
    // altitude ≈ 90 - beta  → upright horizon (0°), flat → zenith (90°).
    if (typeof e.beta === "number" && e.beta != null) {
      let pitch = 90 - e.beta;
      // Landscape: fold in gamma a bit for better feel
      if (typeof e.gamma === "number" && Math.abs(e.gamma) > 45 && window.innerWidth > window.innerHeight) {
        // phone on side: use gamma as elevation proxy
        pitch = Math.abs(e.gamma) - 0; // rough
        pitch = Math.max(-20, Math.min(90, 90 - Math.abs(e.beta)));
      }
      state.pitch = Math.max(-30, Math.min(95, pitch));
    }
    if (typeof e.gamma === "number") state.roll = e.gamma || 0;
  }

  function startOrientation() {
    window.addEventListener("deviceorientation", onOrientation, true);
    window.addEventListener("deviceorientationabsolute", onOrientation, true);
  }

  async function getLocation() {
    if (!navigator.geolocation) {
      throw new Error("Geolocation not available on this device.");
    }
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          state.lat = pos.coords.latitude;
          state.lon = pos.coords.longitude;
          resolve(pos);
        },
        (err) => reject(new Error(err.message || "Location denied")),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
      );
    });
  }

  async function startCamera() {
    if (!window.isSecureContext) {
      throw new Error(
        "iPhone Safari needs HTTPS for camera. Open the secure link (not plain http:// on Wi‑Fi), or use the tunnel URL from your computer."
      );
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Camera API not available in this browser.");
    }
    const tries = [
      {
        audio: false,
        video: {
          facingMode: { exact: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      },
      {
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
        },
      },
      { audio: false, video: true },
    ];
    let lastErr = null;
    for (const constraints of tries) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        state.stream = stream;
        els.camera.setAttribute("playsinline", "");
        els.camera.setAttribute("webkit-playsinline", "");
        els.camera.muted = true;
        els.camera.srcObject = stream;
        await els.camera.play().catch(() => {});
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(
      (lastErr && lastErr.message) ||
        "Camera permission denied. In Settings → Safari → Camera, allow access, then reload."
    );
  }

  // ── Astronomy ────────────────────────────────────────────────────────

  function computeBodies() {
    if (state.lat == null || state.lon == null || typeof Astronomy === "undefined") {
      return;
    }
    const observer = new Astronomy.Observer(state.lat, state.lon, 0);
    const time = Astronomy.MakeTime(new Date());
    const out = [];

    for (const b of BODIES) {
      try {
        const equ = Astronomy.Equator(b.body, time, observer, true, true);
        const hor = Astronomy.Horizon(time, observer, equ.ra, equ.dec, "normal");
        let mag = null;
        try {
          // Illumination provides mag for planets
          if (b.body !== "Sun" && b.body !== "Moon") {
            const illum = Astronomy.Illumination(b.body, time);
            mag = illum.mag;
          }
        } catch (_) {
          /* ignore */
        }
        out.push({
          id: b.id,
          label: b.label,
          color: b.color,
          az: hor.azimuth,
          alt: hor.altitude,
          mag,
        });
      } catch (err) {
        console.warn("body fail", b.id, err);
      }
    }
    state.bodies = out;
  }

  // ── Screen projection ────────────────────────────────────────────────

  function project(body) {
    if (state.heading == null || state.pitch == null) return null;
    const dAz = deltaAngle(state.heading, body.az);
    const dAlt = body.alt - state.pitch;
    const w = els.canvas.width;
    const h = els.canvas.height;
    const x = w / 2 + (dAz / (H_FOV / 2)) * (w / 2);
    const y = h / 2 - (dAlt / (V_FOV / 2)) * (h / 2);
    const angDist = Math.hypot(dAz, dAlt);
    return { x, y, dAz, dAlt, angDist, inFov: Math.abs(dAz) < H_FOV / 2 && Math.abs(dAlt) < V_FOV / 2 };
  }

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    els.canvas.width = Math.round(w * dpr);
    els.canvas.height = Math.round(h * dpr);
    els.canvas.style.width = w + "px";
    els.canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ── Draw ─────────────────────────────────────────────────────────────

  function draw() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    // Soft vignette so labels pop
    const g = ctx.createRadialGradient(w / 2, h * 0.42, h * 0.1, w / 2, h * 0.42, h * 0.7);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.25)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    let nearest = null;

    for (const body of state.bodies) {
      if (body.alt < -5) continue; // well below horizon
      const p = project(body);
      if (!p) continue;

      if (!nearest || p.angDist < nearest.angDist) {
        nearest = { body, ...p };
      }

      if (!p.inFov && body.id !== state.targetId) continue;

      // Marker
      const r = body.id === "Sun" ? 14 : body.id === "Moon" ? 12 : 8;
      const alpha = p.inFov ? 1 : 0.35;

      ctx.save();
      ctx.globalAlpha = alpha;

      // Glow
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 10, 0, Math.PI * 2);
      ctx.fillStyle = body.color + "33";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = body.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.stroke();

      // Label
      const label = body.label + (body.alt < 0 ? " (set)" : "");
      ctx.font = "700 13px system-ui, sans-serif";
      const tw = ctx.measureText(label).width;
      const lx = p.x - tw / 2;
      const ly = p.y - r - 14;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      roundRect(ctx, lx - 6, ly - 12, tw + 12, 20, 8);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(label, lx, ly + 2);

      // Highlight selected
      if (body.id === state.targetId) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 16, 0, Math.PI * 2);
        ctx.strokeStyle = "#ffd27a";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();
    }

    updateHud(nearest);
    updateGuide();
    updatePlanetChips();
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
        ? "Waiting for compass…"
        : "Compass / motion not ready yet";
      return;
    }

    const dir = compassLabel(state.heading);
    const elev =
      state.pitch < 5
        ? "near horizon"
        : state.pitch > 70
          ? "nearly overhead"
          : state.pitch.toFixed(0) + "° up";

    if (nearest && nearest.angDist < LOOK_AT_DEG && nearest.body.alt > -1) {
      els.pointingMain.textContent = nearest.body.label;
      els.pointingSub.textContent =
        "You're looking at this · " +
        dir +
        " · alt " +
        nearest.body.alt.toFixed(0) +
        "°" +
        (nearest.body.mag != null ? " · mag " + nearest.body.mag.toFixed(1) : "");
    } else {
      els.pointingMain.textContent = dir + " sky";
      els.pointingSub.textContent =
        elev +
        " · heading " +
        state.heading.toFixed(0) +
        "°" +
        (nearest && nearest.body.alt > 0
          ? " · nearest " + nearest.body.label + " " + nearest.angDist.toFixed(0) + "° off"
          : "");
    }
  }

  function updateGuide() {
    const target = state.bodies.find((b) => b.id === state.targetId);
    if (!target || state.heading == null || state.pitch == null) {
      els.guideArrow.classList.add("hidden");
      els.lockedBadge.classList.add("hidden");
      els.btnClearTarget.classList.add("hidden");
      return;
    }
    els.btnClearTarget.classList.remove("hidden");

    if (target.alt < -2) {
      els.guideArrow.classList.remove("hidden");
      els.lockedBadge.classList.add("hidden");
      const shaft = els.guideArrow.querySelector(".arrow-shaft");
      if (shaft) shaft.style.transform = "rotate(180deg)";
      els.guideText.textContent = target.label + " is below horizon";
      els.guideMeta.textContent =
        "Az " + target.az.toFixed(0) + "° " + compassLabel(target.az) + " · alt " + target.alt.toFixed(0) + "°";
      return;
    }

    const p = project(target);
    if (!p) return;

    const locked = p.angDist < LOCK_DEG && p.inFov;
    if (locked) {
      els.guideArrow.classList.add("hidden");
      els.lockedBadge.classList.remove("hidden");
      els.lockedName.textContent = "Found · " + target.label;
      els.lockedDetail.textContent =
        "Centered in view · " +
        compassLabel(target.az) +
        " · " +
        target.alt.toFixed(0) +
        "° above horizon";
      return;
    }

    els.lockedBadge.classList.add("hidden");
    els.guideArrow.classList.remove("hidden");

    // Arrow points toward where user should move the phone.
    // Screen: +dAz = target is to the right → rotate arrow right-ish
    // CSS rotation: 0 = up. atan2(x, y) with y up.
    const angleRad = Math.atan2(p.dAz, p.dAlt);
    const angleDeg = (angleRad * 180) / Math.PI;
    const shaft = els.guideArrow.querySelector(".arrow-shaft");
    if (shaft) shaft.style.transform = "rotate(" + angleDeg + "deg)";

    const absAz = Math.abs(p.dAz);
    const absAlt = Math.abs(p.dAlt);
    let hint;
    if (absAz > absAlt) {
      hint = p.dAz > 0 ? "Turn right" : "Turn left";
    } else {
      hint = p.dAlt > 0 ? "Tilt up" : "Tilt down";
    }
    if (absAz > 8 && absAlt > 8) {
      hint =
        (p.dAz > 0 ? "Right" : "Left") +
        " + " +
        (p.dAlt > 0 ? "up" : "down");
    }

    els.guideText.textContent = hint + " for " + target.label;
    els.guideMeta.textContent =
      p.angDist.toFixed(0) +
      "° away · " +
      compassLabel(target.az) +
      " · alt " +
      target.alt.toFixed(0) +
      "°";
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
          ? "Below horizon · " + compassLabel(body.az)
          : body.alt.toFixed(0) + "° · " + compassLabel(body.az) +
            (p && state.heading != null ? " · " + p.angDist.toFixed(0) + "° off" : "");
      }
    });
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

  // ── Loop ─────────────────────────────────────────────────────────────

  function tick(ts) {
    if (!state.running) return;
    if (ts - state.lastFrame > 1000) {
      computeBodies();
      state.lastFrame = ts;
    }
    draw();
    requestAnimationFrame(tick);
  }

  async function startAll() {
    showGateError("");
    els.btnGateStart.disabled = true;
    els.btnStart.disabled = true;
    setStatus("Requesting permissions…", "warn");

    try {
      await requestOrientationPermission();
      startOrientation();
      setStatus("Getting location…", "warn");
      await getLocation();
      setStatus("Starting camera…", "warn");
      await startCamera();
      computeBodies();
      state.running = true;
      els.gate.classList.add("hidden");
      setStatus(
        state.lat.toFixed(2) + "°, " + state.lon.toFixed(2) + "° · live",
        "ok"
      );
      requestAnimationFrame(tick);

      // Desktop / no compass fallback: use fixed heading from north-ish
      setTimeout(() => {
        if (state.heading == null) {
          state.heading = 0;
          state.pitch = 30;
          setStatus("No compass — using demo aim (phone outdoors is better)", "warn");
        }
      }, 2500);
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
    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 200));

    els.btnGateStart.addEventListener("click", startAll);
    els.btnStart.addEventListener("click", startAll);
    els.btnClearTarget.addEventListener("click", () => {
      state.targetId = null;
      updateGuide();
      updatePlanetChips();
    });

    els.headingOffset.addEventListener("input", () => {
      const v = Number(els.headingOffset.value) || 0;
      // Apply delta relative to previous offset
      const prev = state.headingOffset;
      state.headingOffset = v;
      if (state.heading != null) {
        state.heading = norm360(state.heading - prev + v);
      }
      els.headingOffsetVal.textContent = (v >= 0 ? "+" : "") + v + "°";
    });

    // Precompute with default location if we can't get GPS yet (for chip layout)
    if (typeof Astronomy !== "undefined") {
      // rough: will refresh after GPS
      state.lat = state.lat ?? 12.97;
      state.lon = state.lon ?? 77.59;
      computeBodies();
      updatePlanetChips();
    }

    setStatus("Tap Start to open sky view", "muted");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
