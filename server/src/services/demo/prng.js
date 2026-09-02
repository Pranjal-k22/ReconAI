/**
 * Simple, fast, deterministic Seeded Pseudo-Random Number Generator (Mulberry32).
 * Guarantees identical output sequences across any environment given the same seed string.
 */

function stringToSeed(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return hash >>> 0;
}

export class SeededRandom {
  constructor(seedString = "RECONAI_DEMO_2026") {
    this.seed = stringToSeed(seedString);
    this.state = this.seed;
  }

  // Returns a pseudo-random float in range [0, 1)
  next() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Returns integer in range [min, max] inclusive
  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  // Picks one random item from array deterministically
  choice(array) {
    if (!array || array.length === 0) return null;
    const index = Math.floor(this.next() * array.length);
    return array[index];
  }
}

export default SeededRandom;
