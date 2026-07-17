/**
 * Bright stars + constellation stick figures for night-sky recognition.
 * Coordinates: J2000 RA (hours), Dec (degrees). Magnitudes approximate.
 *
 * Note: These are *tārā* (fixed stars) and Western stick figures as LANDMARKS —
 * not rāśi boundaries. Rāśi/nakṣatra measure remains Raman ecliptic (astro-extras).
 */
(function (global) {
  "use strict";

  /** @type {Record<string,{ra:number,dec:number,mag:number,name:string,nak?:string}>} */
  const STARS = {
    // Navigation
    Polaris: { ra: 2.5303, dec: 89.2641, mag: 2.0, name: "Polaris" },
    // Orion
    Betelgeuse: { ra: 5.9195, dec: 7.4071, mag: 0.5, name: "Betelgeuse" },
    Rigel: { ra: 5.2423, dec: -8.2016, mag: 0.1, name: "Rigel" },
    Bellatrix: { ra: 5.4189, dec: 6.3497, mag: 1.6, name: "Bellatrix" },
    Mintaka: { ra: 5.5334, dec: -0.2991, mag: 2.2, name: "Mintaka" },
    Alnilam: { ra: 5.6036, dec: -1.2019, mag: 1.7, name: "Alnilam" },
    Alnitak: { ra: 5.6793, dec: -1.9426, mag: 1.8, name: "Alnitak" },
    Saiph: { ra: 5.7959, dec: -9.6696, mag: 2.1, name: "Saiph" },
    Meissa: { ra: 5.5856, dec: 9.9342, mag: 3.5, name: "Meissa" },
    // Taurus / nakṣatra anchors
    Aldebaran: { ra: 4.5987, dec: 16.5093, mag: 0.9, name: "Aldebaran", nak: "Rohiṇī" },
    Elnath: { ra: 5.4382, dec: 28.6075, mag: 1.7, name: "Elnath" },
    Alcyone: { ra: 3.7914, dec: 24.1051, mag: 2.9, name: "Alcyone", nak: "Kṛttikā" },
    // Canis
    Sirius: { ra: 6.7525, dec: -16.7161, mag: -1.5, name: "Sirius" },
    Procyon: { ra: 7.6550, dec: 5.2250, mag: 0.4, name: "Procyon" },
    // Gemini
    Castor: { ra: 7.5766, dec: 31.8883, mag: 1.6, name: "Castor" },
    Pollux: { ra: 7.7553, dec: 28.0262, mag: 1.1, name: "Pollux" },
    // Leo
    Regulus: { ra: 10.1395, dec: 11.9672, mag: 1.4, name: "Regulus", nak: "Maghā" },
    Denebola: { ra: 11.8177, dec: 14.5721, mag: 2.1, name: "Denebola" },
    Algieba: { ra: 10.3329, dec: 19.8415, mag: 2.0, name: "Algieba" },
    // Virgo
    Spica: { ra: 13.4199, dec: -11.1613, mag: 1.0, name: "Spica", nak: "Citrā" },
    // Bootes
    Arcturus: { ra: 14.2610, dec: 19.1824, mag: -0.1, name: "Arcturus" },
    // Scorpius
    Antares: { ra: 16.4901, dec: -26.4319, mag: 1.1, name: "Antares", nak: "Jyeṣṭhā" },
    Shaula: { ra: 17.5601, dec: -37.1038, mag: 1.6, name: "Shaula" },
    Sargas: { ra: 17.6219, dec: -42.9978, mag: 1.9, name: "Sargas" },
    Dschubba: { ra: 16.0056, dec: -22.6217, mag: 2.3, name: "Dschubba" },
    // Sagittarius teapot
    KausAustralis: { ra: 18.4029, dec: -34.3843, mag: 1.8, name: "Kaus Austr." },
    Nunki: { ra: 18.9211, dec: -26.2967, mag: 2.0, name: "Nunki" },
    Ascella: { ra: 19.1114, dec: -29.8801, mag: 2.6, name: "Ascella" },
    KausMedia: { ra: 18.3499, dec: -29.8281, mag: 2.7, name: "Kaus Media" },
    KausBorealis: { ra: 18.4662, dec: -25.4217, mag: 2.8, name: "Kaus Bor." },
    // Capricornus (dim but outline)
    DenebAlgedi: { ra: 21.7840, dec: -16.1273, mag: 2.9, name: "Deneb Alg." },
    Dabih: { ra: 20.3502, dec: -14.7819, mag: 3.1, name: "Dabih" },
    // Aquila / Lyra / Cygnus — Summer Triangle
    Altair: { ra: 19.8464, dec: 8.8683, mag: 0.8, name: "Altair" },
    Vega: { ra: 18.6156, dec: 38.7837, mag: 0.0, name: "Vega" },
    Deneb: { ra: 20.6905, dec: 45.2803, mag: 1.3, name: "Deneb" },
    // Auriga
    Capella: { ra: 5.2782, dec: 45.9980, mag: 0.1, name: "Capella" },
    // Ursa Major — Big Dipper (pointer to Polaris)
    Dubhe: { ra: 11.0621, dec: 61.7510, mag: 1.8, name: "Dubhe" },
    Merak: { ra: 11.0307, dec: 56.3824, mag: 2.4, name: "Merak" },
    Phecda: { ra: 11.8972, dec: 53.6948, mag: 2.4, name: "Phecda" },
    Megrez: { ra: 12.2571, dec: 57.0326, mag: 3.3, name: "Megrez" },
    Alioth: { ra: 12.9004, dec: 55.9598, mag: 1.8, name: "Alioth" },
    Mizar: { ra: 13.3987, dec: 54.9254, mag: 2.3, name: "Mizar" },
    Alkaid: { ra: 13.7923, dec: 49.3133, mag: 1.9, name: "Alkaid" },
    // Cassiopeia
    Schedar: { ra: 0.6751, dec: 56.5373, mag: 2.2, name: "Schedar" },
    Caph: { ra: 0.1529, dec: 59.1498, mag: 2.3, name: "Caph" },
    GammaCas: { ra: 0.9451, dec: 60.7167, mag: 2.5, name: "γ Cas" },
    Ruchbah: { ra: 1.4302, dec: 60.2353, mag: 2.7, name: "Ruchbah" },
    Segin: { ra: 1.9066, dec: 63.6701, mag: 3.4, name: "Segin" },
    // Pegasus square (partial)
    Markab: { ra: 23.0793, dec: 15.2053, mag: 2.5, name: "Markab" },
    Scheat: { ra: 23.0629, dec: 28.0828, mag: 2.4, name: "Scheat" },
    Algenib: { ra: 0.2206, dec: 15.1836, mag: 2.8, name: "Algenib" },
    Alpheratz: { ra: 0.1398, dec: 29.0904, mag: 2.1, name: "Alpheratz" },
    // Andromeda
    Mirach: { ra: 1.1622, dec: 35.6206, mag: 2.1, name: "Mirach" },
    // Libra
    Zubenelgenubi: { ra: 14.8479, dec: -16.0418, mag: 2.8, name: "Zubenelg." },
    Zubeneschamali: { ra: 15.2835, dec: -9.3829, mag: 2.6, name: "Zubenesch." },
    // Cancer
    AsellusBorealis: { ra: 8.7214, dec: 21.4685, mag: 4.7, name: "Asellus N" },
    AsellusAustralis: { ra: 8.7448, dec: 18.1543, mag: 3.9, name: "Asellus S" },
    // Aries
    Hamal: { ra: 2.1195, dec: 23.4624, mag: 2.0, name: "Hamal" },
    Sheratan: { ra: 1.9107, dec: 20.8080, mag: 2.6, name: "Sheratan" },
    // Pisces (faint)
    Alrescha: { ra: 2.0341, dec: 2.7637, mag: 3.8, name: "Alrescha" },
    // Corvus (near Virgo)
    GienahCorvi: { ra: 12.2634, dec: -17.5419, mag: 2.6, name: "Gienah" },
    // Hydra
    Alphard: { ra: 9.4598, dec: -8.6586, mag: 2.0, name: "Alphard" },
    // Crux / southern if visible
    Acrux: { ra: 12.4433, dec: -63.0991, mag: 0.8, name: "Acrux" },
    // Fomalhaut
    Fomalhaut: { ra: 22.9608, dec: -29.6222, mag: 1.2, name: "Fomalhaut" },
    // Achernar
    Achernar: { ra: 1.6286, dec: -57.2368, mag: 0.5, name: "Achernar" },
    // Canopus
    Canopus: { ra: 6.3992, dec: -52.6957, mag: -0.7, name: "Canopus" },
  };

  /**
   * Stick figures: list of [starA, starB] edges.
   * Drawn only as landmarks for pratyakṣa — not as rāśi.
   */
  const CONSTELLATIONS = [
    {
      id: "orion",
      label: "Orion",
      hint: "Hunter · belt of 3",
      lines: [
        ["Betelgeuse", "Bellatrix"],
        ["Bellatrix", "Mintaka"],
        ["Mintaka", "Alnilam"],
        ["Alnilam", "Alnitak"],
        ["Alnitak", "Saiph"],
        ["Saiph", "Rigel"],
        ["Rigel", "Mintaka"],
        ["Betelgeuse", "Meissa"],
        ["Bellatrix", "Meissa"],
        ["Betelgeuse", "Alnitak"],
      ],
    },
    {
      id: "taurus",
      label: "Taurus",
      hint: "V · Aldebaran · Pleiades",
      lines: [
        ["Aldebaran", "Elnath"],
        ["Aldebaran", "Alcyone"],
      ],
    },
    {
      id: "gemini",
      label: "Gemini",
      hint: "Castor · Pollux",
      lines: [["Castor", "Pollux"]],
    },
    {
      id: "leo",
      label: "Leo",
      hint: "Sickle · Regulus",
      lines: [
        ["Regulus", "Algieba"],
        ["Algieba", "Denebola"],
      ],
    },
    {
      id: "virgo",
      label: "Virgo",
      hint: "Spica",
      lines: [["Spica", "Arcturus"]],
    },
    {
      id: "scorpius",
      label: "Scorpius",
      hint: "Hook · Antares",
      lines: [
        ["Dschubba", "Antares"],
        ["Antares", "Shaula"],
        ["Shaula", "Sargas"],
      ],
    },
    {
      id: "sagittarius",
      label: "Sagittarius",
      hint: "Teapot",
      lines: [
        ["KausBorealis", "KausMedia"],
        ["KausMedia", "KausAustralis"],
        ["KausAustralis", "Ascella"],
        ["Ascella", "Nunki"],
        ["Nunki", "KausBorealis"],
        ["KausMedia", "Nunki"],
      ],
    },
    {
      id: "ursa_major",
      label: "Ursa Major",
      hint: "Big Dipper · points to Polaris",
      lines: [
        ["Dubhe", "Merak"],
        ["Merak", "Phecda"],
        ["Phecda", "Megrez"],
        ["Megrez", "Alioth"],
        ["Alioth", "Mizar"],
        ["Mizar", "Alkaid"],
        ["Megrez", "Dubhe"],
      ],
    },
    {
      id: "cassiopeia",
      label: "Cassiopeia",
      hint: "W shape",
      lines: [
        ["Caph", "Schedar"],
        ["Schedar", "GammaCas"],
        ["GammaCas", "Ruchbah"],
        ["Ruchbah", "Segin"],
      ],
    },
    {
      id: "summer_triangle",
      label: "Summer Triangle",
      hint: "Vega · Deneb · Altair",
      lines: [
        ["Vega", "Deneb"],
        ["Deneb", "Altair"],
        ["Altair", "Vega"],
      ],
    },
    {
      id: "canis_major",
      label: "Canis Major",
      hint: "Sirius",
      lines: [["Sirius", "Procyon"]],
    },
    {
      id: "pegasus",
      label: "Pegasus",
      hint: "Great Square",
      lines: [
        ["Markab", "Scheat"],
        ["Scheat", "Alpheratz"],
        ["Alpheratz", "Algenib"],
        ["Algenib", "Markab"],
      ],
    },
    {
      id: "aries",
      label: "Aries",
      hint: "Hamal",
      lines: [["Hamal", "Sheratan"]],
    },
    {
      id: "libra",
      label: "Libra",
      hint: "Scales",
      lines: [["Zubenelgenubi", "Zubeneschamali"]],
    },
    {
      id: "capricornus",
      label: "Capricornus",
      hint: "Sea-goat (dim)",
      lines: [["Dabih", "DenebAlgedi"]],
    },
  ];

  /** Yoga-tārā style anchors for nakṣatra learning */
  const NAK_ANCHORS = [
    { star: "Alcyone", nak: "Kṛttikā", note: "Pleiades cluster" },
    { star: "Aldebaran", nak: "Rohiṇī", note: "Eye of the Bull" },
    { star: "Betelgeuse", nak: "Ārdrā", note: "Orion shoulder (near)" },
    { star: "Pollux", nak: "Punarvasu", note: "Gemini" },
    { star: "Regulus", nak: "Maghā", note: "Heart of Leo" },
    { star: "Spica", nak: "Citrā", note: "Virgo ear of grain" },
    { star: "Arcturus", nak: "Svātī", note: "Bootes (near Svātī)" },
    { star: "Antares", nak: "Jyeṣṭhā", note: "Heart of Scorpius" },
    { star: "Vega", nak: "Abhijit*", note: "Bright summer marker" },
    { star: "Altair", nak: "Śravaṇa", note: "Aquila" },
    { star: "Fomalhaut", nak: "P. Bhādrapadā*", note: "Lonely autumn star" },
  ];

  global.SkyStars = {
    STARS,
    CONSTELLATIONS,
    NAK_ANCHORS,
  };
})(typeof window !== "undefined" ? window : globalThis);
