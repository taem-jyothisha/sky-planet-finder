# Navaratna Sabhā — Night-Sky Recognition for Jyotiṣīs

**Convened:** product rethink for Sky AR  
**Lock:** Raman ayanāṃśa only · never Lahiri / KP / other  
**Charge:** What must the app be so a jyotiṣī can *recognize* graha, rāśi, and nakṣatra under the real night sky?

Nine agents spoke in the spirit of Vikramāditya’s Navaratnas. Below: their clash, their consensus, and the joint plan.

---

## The nine seats

| # | Seat | Voice | Charge |
|---|------|--------|--------|
| 1 | **Varāhamihira** | Siddhānta / sky lore | What *is* recognition in jyotiṣa? |
| 2 | **Kālidāsa** | Rasa / field experience | How must the first night *feel*? |
| 3 | **Amara Siṃha** | Nāma / lexicon | Correct speech — no category errors |
| 4 | **Dhanvantari** | Body–mind / load | Eyes, neck, cognitive harm |
| 5 | **Śaṅku** | Yantra / geometry | Instrument, not Maps |
| 6 | **Vetāla Bhaṭṭa** | Red team / illusion | How the app lies |
| 7 | **Ghaṭakarpara** | Minimalism | Smallest sufficient product |
| 8 | **Vararuci** | Rules / ACs | Formal Given/When/Then |
| 9 | **Kṣapaṇaka** | Pramāṇa / ethics | Calculation vs seeing vs recognizing |

---

## The debate (where they clashed)

### 1. Completeness vs revelation
- **Varāhamihira / list completeness:** All 9 grahas must exist as a set (Rāhu/Ketu included).
- **Kālidāsa / Dhanvantari / Ghaṭakarpara:** All 9 *painted on the sky at once* destroys night vision and teaching.
- **Resolution:** **All 9 always in the grantha (Find list).** Sky paint is **sparse**: tonight’s naked-eye lights + selected target. Chāyā grahas in list with honesty, not as hunt-stars.

### 2. Maps layers vs pāṭha sequence
- **Current product:** multi-toggle overlays (Maps).
- **Kālidāsa + Ghaṭakarpara:** first night is **initiation**, not GIS.
- **Śaṅku:** frame (horizon → dīk → ecliptic) before names.
- **Resolution:** Keep Layers as **expert controls**. **Default path is sequenced:**  
  `horizon/spine → rāśi belt → (nakṣatra refine) → graha`  
  Not “everything ON.”

### 3. Two belts at once
- **User desire:** zodiac + nakṣatra overlays.
- **Dhanvantari:** max **3 visual channels** (sky + one teaching object + one focus).
- **Ghaṭakarpara:** two equal belts = two rāgas.
- **Resolution:**  
  - **Teaching default:** rāśi belt ON; nakṣatra as *same spine, finer beads* (dimmer) or second stage.  
  - **Expert:** both ON allowed, with **visual hierarchy** (rāśi = structure, nakṣatra = refinement), not equal neon.

### 4. “Recognized” vs “computed”
- **Kṣapaṇaka:** sphuṭa ≠ pratyakṣa ≠ upamāna (recognition).
- **Vetāla / Amara:** never say “you found Guru” because a pin appeared.
- **Resolution:** Default speech = **gaṇita** (“computed direction”).  
  **Recognition** only after labels-off re-point (exam path) or never in v1 marketing.

### 5. Instrument grade
- **Śaṅku / Vetāla:** magnetic-only is toy; Recognition needs **Align (visual lock)** + residuals.
- **Resolution:** Modes — **Toy / Field / Recognition** — with honest seals; refuse bold labels when sensors degraded.

### 6. ISS, zoom, acceptance boxes in UI
- **Ghaṭakarpara:** cut from identity.
- **Resolution:** ISS demoted or removed from core path; zoom not primary chrome; maker ACs stay in docs, not Layers panel.

---

## Consensus (what the whole court accepts)

1. **Product is a night-sky pāṭhaśālā**, not a planet safari with Sanskrit stickers.  
2. **Raman only** — locked, visible, non-negotiable.  
3. **Ecliptic is the spine** — rāśi and nakṣatra hang on it; grahas are actors on that stage.  
4. **Chāyā-graha honesty** — Rāhu/Ketu = no light; never luminous “find” UX.  
5. **Sūrya honesty** — day/occupation gaṇita; not a night star hunt.  
6. **Align is the dīkṣā of trust** — one bright body (Candra/Śukra) before dense teaching.  
7. **Crosshair is the guru** — “what am I looking at?” beats panel dumps.  
8. **List completeness ≠ sky density** — 9 in Find always; few labels on camera.  
9. **Scaffold then withdraw** — student must still know the sky when the phone is down.  
10. **Prefer silence to false confidence** — degraded sensors → provisional / no claim.

---

## Joint product definition

> **Sky is a handheld yantra that establishes your horizon and aim, shows the ecliptic path under Raman measure, and helps you place grahas in rāśi and nakṣatra — speaking as calculation until your eye can recognize.**

---

## Target experience (first outdoor night)

```
Gate (honest: Raman · not Maps) 
  → Allow sensors/camera/location
  → Align on Candra/Śukra if up
  → Spine + rāśi belt (structure)
  → Crosshair whispers rāśi · nakṣatra under empty aim
  → Tonight’s bright graha or Find → one target
  → Chrome fades · place the light
  → Labels-off optional check
```

**Pass metric (Ghaṭakarpara + Kālidāsa):**  
Within one clear night, user Aligns, pans the belt, places one bright graha, and can say: *“this light is in that rāśi”* without opening Layers twice.

---

## Architecture (Śaṅku layers — build order)

| Layer | Content | Day-1 |
|-------|---------|-------|
| 0 | Time, place, Raman badge | Required |
| 1 | Horizon + vertical | Required |
| 2 | True-ish aim (sensors + Align lock) | Required |
| 3 | Alt-az / FOV honesty | Required |
| 4 | Ecliptic spine + rāśi belt | Required |
| 5 | Graha points (sparse) + Find all 9 | Required |
| 6 | Nakṣatra belt (refine) | Stage 2 |
| 7 | Udaya / lagna direction | Stage 2 |
| 8 | ISS / toys | Optional / demote |

---

## Naming law (Amara Siṃha — short)

| Thing | Say | Never |
|-------|-----|--------|
| Moving body | **Graha** (Sūrya, Candra…) | “Star” for a graha |
| Nodes | **Chāyā-graha · no light** | “Found Rāhu” as a lamp |
| Sign sector | **Rāśi** (Meṣa…) under Raman | Constellation cartoon = rāśi |
| Mansion | **Nakṣatra · pāda** | “You found the constellation” |
| Pin | **Gaṇita** / computed | “Recognized” by default |
| Rising point | **Udaya** | “On screen” = udaya |

---

## Cognitive law (Dhanvantari)

- Max **3 concurrent visual channels:** real sky + one structure teaching layer + one focus cue.  
- Night: dim, warm; no white dashboard.  
- Wrong sky with confidence = **ship blocker**.  
- Progressive: orient → identify → one grammar → meaning (eyes down OK) → expert density.

---

## Formal ACs (Vararuci — P0 extract)

| ID | Criterion |
|----|-----------|
| P0-1 | Session shows **Raman** always; no ayanāṃśa switch |
| P0-2 | Permissions + place/time before bold labels |
| P0-3 | Align/calibration path before “field-grade” claims |
| P0-4 | All 9 grahas in catalogue; above-horizon on sky with tracking |
| P0-5 | Each graha detail: rāśi + °′ · nakṣatra · pāda · visibility class |
| P0-6 | Reticle: rāśi + nakṣatra under aim (valid sky) |
| P0-7 | Below-horizon not painted as visible lights |
| P0-8 | Chāyā-graha never as luminous “found” |
| P0-9 | Degraded sensors → provisional / suspend certainty |
| P0-10 | After Align, pan moves overlays (sensor live) |
| P0-11 | Sandhi: near rāśi/nakṣatra edge → caution if residual large |
| P0-12 | Speech: default *gaṇita*, not *abhijñāna* |

Full formal set can expand from Vararuci’s 22 ACs in the court log.

---

## Kill criteria (Vetāla — ship blockers)

1. Frozen sensors + still “Live” without banner.  
2. Sticky compass falsely locking labels.  
3. Rāhu/Ketu as stars.  
4. “You recognized X” without unaided re-find.  
5. Silent wrong ayanāṃśa.  
6. All layers ON as first outdoor default.  
7. Snap-to-lamp without confusion handling.  
8. No labels-off path.

---

## Phased plan (court decree)

### Phase A — “Yantra that does not lie” (foundation)
1. Sensor fusion: live pan (matrix/gyro); Align as visual lock; residual honesty.  
2. FOV + projection fix; no fake fixed aim.  
3. Raman seal always on.  
4. Speech: gaṇita / chāyā / below horizon.  
5. Remove or bury ISS; strip maker AC from Layers UI.

### Phase B — “Initiation night” (default path)
1. Defaults: **rāśi belt ON**, **nakṣatra OFF or dim**, **graha sparse**.  
2. Gate copy = teaching night, not Maps.  
3. Align first when Candra/Śukra up.  
4. Crosshair = primary teacher.  
5. Find = all 9; sky ≠ all 9 painted.

### Phase C — “Mansion literacy”
1. Nakṣatra belt as refinement on same spine.  
2. Pāda + sandhi honesty.  
3. Udaya marker (pūrva vs ecliptic rise named).  
4. Tonight naked-eye strip only.

### Phase D — “Recognition grade” (optional)
1. Labels-off exam mode.  
2. Mode seals: Toy / Field / Recognition.  
3. Spot-check second object after Align.  
4. Yoga-tārā anchors (later) — non-goal until A–C solid.

---

## What we had misunderstood (court confession)

| We built | They needed |
|----------|-------------|
| Feature-complete AR | **Recognition pedagogy** |
| Inventory of everything ON | **Sequence of seeing** |
| Maps multi-select as identity | **Yantra + optional power** |
| Labels as success | **Unaided knowing as success** |
| Nodes as points to hunt | **Nodes as gaṇita without light** |

---

## Immediate product decisions (for implementers)

| Decision | Value |
|----------|--------|
| Ayanāṃśa | Raman only |
| Default sky | Rāśi belt + sparse graha + crosshair |
| Nakṣatra belt | On by expert / stage 2; or dim under rāśi hierarchy |
| Graha list | Always 9 |
| Graha sky density | Tonight bright + selected + Moon if up |
| ISS | Demote / remove from core |
| Align | Required for Field/Recognition claims |
| “Recognized” copy | Forbidden unless exam pass |
| Max simultaneous visual channels | 3 |

---

## Closing of the sabhā

**Varāhamihira:** Teach the path, then the light.  
**Kālidāsa:** Light one lamp at a time.  
**Amara Siṃha:** Name without category-crime.  
**Dhanvantari:** Do not harm the eye or the memory.  
**Śaṅku:** Be a yantra; show your frame.  
**Vetāla:** Prefer silence to a beautiful lie.  
**Ghaṭakarpara:** Five lamps — the rest is smoke.  
**Vararuci:** No Done without the gates.  
**Kṣapaṇaka:** When the phone is down, knowing must still stand.

*iti navaratna-sabhā-niścayaḥ — thus the decree of the nine.*
