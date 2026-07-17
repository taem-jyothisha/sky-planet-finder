# Sky — camera planet finder

Simple web app: point your phone at the sky, see which planet you’re looking at, and follow on-screen arrows to a planet you pick.

## Features

1. **Live camera** (rear) with sky overlay  
2. **In-screen labels** for Sun, Moon, and planets in your view  
3. **“Looking toward”** HUD — names the body near the crosshair  
4. **Find mode** — tap a planet; arrows guide turn left/right and tilt up/down  
5. **Compass trim** slider if your phone compass is a bit off  

## Run on iPhone (recommended)

iPhone Safari **requires HTTPS** for camera + compass. Plain `http://192.168…` will fail.

### Option A — PC + HTTPS tunnel (easiest while developing)

On your computer:

```powershell
cd C:\Users\supra\OneDrive\Codex\sky-app
py -3 -m http.server 8766
# other terminal:
npx --yes localtunnel --port 8766
```

Open the `https://….loca.lt` URL **in Safari** on the iPhone.  
If you see a “tunnel password” / continue page, tap through once.

### Option B — Same Wi‑Fi only (may block camera)

`http://192.168.x.x:8766` — often **blocked** by iOS for camera. Prefer Option A.

### On the iPhone

1. Open the **https** link in **Safari** (not Chrome in-app browsers if possible).
2. Tap **Allow & start**.
3. Allow **Camera**, **Location**, **Motion**.
4. Optional: Share → **Add to Home Screen** → open as full-screen app.
5. Outdoors, hold phone upright, pick a planet, follow the arrow.

### If something is denied

**Settings → Safari** (or Settings → Sky if added to Home Screen) → enable Camera, Location, Motion & Orientation.

### Best results

- Use a **phone**, outdoors, clear sky  
- Hold phone **upright** like a camera viewfinder  
- Grant **camera**, **location**, and **motion/compass**  
- If labels seem rotated, nudge **Compass trim**

## How it works

| Piece | Source |
|--------|--------|
| Planet positions (alt/az) | [astronomy-engine](https://github.com/cosinekitty/astronomy) |
| Where you’re pointing | Device orientation (compass heading + pitch) |
| Labels & arrows | Canvas overlay on the camera video |

Accuracy is good for **finding** planets; it is not a professional theodolite. Compass error is the usual weak point on phones.

## Files

- `index.html` — page shell  
- `styles.css` — UI  
- `app.js` — camera, sensors, sky math, guides  
