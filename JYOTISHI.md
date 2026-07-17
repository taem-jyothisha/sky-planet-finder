# Jyotishi night-sky recognition — user stories & acceptance criteria

**Ayanāṃśa: Raman only** (never Lahiri / KP / other).

Goal: a practising jyotiṣī can stand outdoors at night, point the phone, and **recognise structure** (rāśi belt, nakṣatra belt) and **place grahas** relative to that structure — not just see random AR dots.

---

## Personas

1. **Field jyotiṣī** — teaches or checks “where is Guru / which nakṣatra is the Moon in?” under the real sky.  
2. **Student** — learning to match śāstra names to lights and the ecliptic band.  
3. **Night observer** — dark/suburban sky; needs naked-eye vs chāyā graha clarity.

---

## User stories → acceptance criteria

### US-1 · See all nine grahas as a complete set
**As a** jyotiṣī, **I want** all nine grahas (Sūrya…Ketu) always listed when I open Graha, **so that** I never wonder if Rāhu/Ketu were omitted.

| ID | Acceptance criterion |
|----|----------------------|
| AC-1.1 | Graha Find list always shows exactly the nine classical grahas in fixed order. |
| AC-1.2 | Each row shows **rāśi + degree**, **nakṣatra + pāda**, altitude/az, and a **visibility badge**. |
| AC-1.3 | Camera overlay can show all nine when Graha layer is ON (below-horizon marked ↓). |

### US-2 · Know what is actually visible tonight
**As a** jyotiṣī, **I want** clear badges for bright / visible / set / chāyā, **so that** I do not hunt for Rāhu as a star.

| ID | AC |
|----|-----|
| AC-2.1 | Rāhu/Ketu badge **Chāyā** + note “not a light”. |
| AC-2.2 | Sūrya marked as daytime / not for night recognition. |
| AC-2.3 | “Tonight (naked-eye)” chips list bright grahas above ~5° with rāśi. |
| AC-2.4 | Moon shows phase / pakṣa hint when available. |

### US-3 · Read the zodiac belt on the sky
**As a** jyotiṣī, **I want** a continuous rāśi band on the camera, **so that** I see the ecliptic as a structure, not 12 disconnected points.

| ID | AC |
|----|-----|
| AC-3.1 | With Zodiac overlay ON, a band ±~8° ecliptic latitude is drawn when in FOV. |
| AC-3.2 | All 12 rāśi names (Raman sidereal) appear on the band when those segments are in view. |
| AC-3.3 | A clear ecliptic “spine” line is visible through the belt. |

### US-4 · Read nakṣatras on the sky
**As a** jyotiṣī, **I want** the 27 nakṣatra segments on the ecliptic, **so that** I can place Candra/grahas in mansion language.

| ID | AC |
|----|-----|
| AC-4.1 | Nakṣatra overlay draws a thinner band with 27 segments when ON. |
| AC-4.2 | Visible segments show mansion names (shortened if needed). |
| AC-4.3 | Graha cards show nakṣatra **and pāda** (1–4). |

### US-5 · “What am I looking at right now?”
**As a** jyotiṣī, **I want** the crosshair to name graha **or** belt rāśi·nakṣatra, **so that** panning teaches recognition.

| ID | AC |
|----|-----|
| AC-5.1 | If a graha is near the crosshair, HUD shows graha + rāśi° + nakṣatra pāda. |
| AC-5.2 | Else if the belt is near aim, HUD shows rāśi · nakṣatra · pāda under crosshair. |
| AC-5.3 | Udaya marker indicates approximate **rising rāśi** direction when available. |

### US-6 · Trust AR against the real sky
**As a** jyotiṣī, **I want** one Align on Candra (or Śukra), **so that** labels sit on real lights.

| ID | AC |
|----|-----|
| AC-6.1 | Align sets heading/elevation offsets from selected/real bright graha. |
| AC-6.2 | After Align, panning moves overlays with the camera (sensors live). |
| AC-6.3 | Ayanāṃśa is **Raman only** (shown in debug / copy). |

### US-7 · Layers stay out of the way
**As a** field user, **I want** Maps-style layers and a list that collapses when guiding.

| ID | AC |
|----|-----|
| AC-7.1 | Multi-select overlays: Graha, Zodiac belt, Nakṣatra, ISS. |
| AC-7.2 | Selecting a target fades large UI; mini dock + edges remain. |
| AC-7.3 | Default: Graha + Zodiac + Nakṣatra ON for teaching mode. |

---

## Non-goals (honest limits)

- Not a telescope plate-solver; compass error needs **Align**.  
- Rāhu/Ketu are never “found as stars”.  
- No Lahiri / KP ayanāṃśa options.  
- Yoga-tārā star catalogs are optional future work (landmark stars per nakṣatra).

---

## Manual test script (10 minutes outdoors)

1. Start · allow Camera, Motion, Location (Precise).  
2. Layers: Graha + Zodiac + Nakṣatra ON.  
3. Find → Graha: count **9** rows; check Rāhu = Chāyā.  
4. Align on Moon if up.  
5. Pan: belts slide; graha labels move.  
6. Put crosshair on empty belt → HUD shows rāśi·nakṣatra.  
7. Put crosshair on Śukra/Guru if up → graha + rāśi + nakṣatra.  
8. Confirm debug ayan line says **Raman**.
