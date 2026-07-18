# Raman Sky Guide

Point your phone at the night sky. Identify **grahas**, **nakṣatras**, **rāśis**, and constellations.

**Ayanāṃśa: Raman only** (Swiss Ephemeris `SIDM_RAMAN`). Other ayanāṃśas are not used.

## Live

**https://taem-jyothisha.github.io/sky-planet-finder/?v=16**

Open in **Safari** (iPhone) → **Allow & start** → optional: Share → **Add to Home Screen**.

Repo: https://github.com/taem-jyothisha/sky-planet-finder

## How it feels

1. **Clean fullscreen** sky after start (no clutter).
2. Tap **☰** (top left) → layers, zoom, align, compass trim.
3. Tap **⌕** (top right) → find grahas / constellations / ISS.
4. Tap a target → guide + bottom info card.
5. **Planetarium** mode = black sky map; turn it off for camera AR.

## Features

- Planetarium map with constellation figure art + cyan sticks  
- All 9 grahas (Raman rāśi / nakṣatra / pāda)  
- Zodiac & nakṣatra belts (optional layers)  
- Large planet markers (Jupiter, Saturn, Moon, …)  
- ISS live position  
- Align on Moon/Venus when compass drifts  

## iPhone setup

1. Open the **https** link in **Safari**.
2. Tap **Allow & start** → Camera, Location, Motion.
3. Optional: **Add to Home Screen** for fullscreen.
4. Outdoors, pan slowly. Use **Align** once if labels drift.

**Settings → Safari** (or the home-screen app) → enable Camera, Location, Motion & Orientation. Prefer **Precise Location**.

## How it works

| Piece | Source |
|--------|--------|
| Planet / star positions | [astronomy-engine](https://github.com/cosinekitty/astronomy) |
| Aim | Device orientation (compass + pitch) |
| Sidereal measure | Raman ayanāṃśa only (`astro-extras.js`) |
| Overlays | Canvas on camera or black planetarium |

Accuracy is for **recognition and learning**, not a survey instrument. Compass error is the usual limit on phones.

## Files

- `index.html` — shell, gate, drawers  
- `styles.css` — clean fullscreen UI  
- `app.js` — sensors, projection, draw loop  
- `astro-extras.js` — Raman, grahas, belts  
- `stars-constellations.js` — stick figures  
- `constellation-art.js` — white figure art  
- `manifest.json` — PWA “Raman Sky Guide”  

## License / sharing

Built for public sharing by the Raman Sky Guide project. Keep Raman-only ayanāṃśa if you fork.
