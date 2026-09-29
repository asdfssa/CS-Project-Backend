/**
 * ScopusProxyService
 * จัดการ API Key Rotation + Rate Limit Tracking
 * รองรับหลาย key แบบ Round-robin
 *
 * Rate limit จริงมี 2 ชั้น (ยืนยันด้วยการยิงทดสอบจริง — ดู scripts/scopus-*-result-*.json):
 *   1. Per-second throttle ต่อ key — Elsevier ตัด 429 ที่ ~6 concurrent req/sec ต่อ key
 *      (นับเองใน memory ล้วนๆ เพราะ Elsevier ไม่มี header บอกเรตนี้)
 *   2. Weekly quota ต่อ key (20000 req/สัปดาห์) — อ่านจาก header X-RateLimit-*
 *      หลังทุก response แทนการนับเอง (นับเอง imprecise กว่า อ่านจาก Elsevier ตรงๆ)
 *
 * State persist ลงไฟล์ JSON (write-through, atomic write) เพื่อให้รอด restart —
 * ด้วยเหตุนี้ต้องเลิกใช้ setInterval/setTimeout (ไม่รอด restart) เปลี่ยนเป็น
 * lazy-check เทียบ timestamp ทุกครั้งที่ getNextKey() ถูกเรียกแทน
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

// ponytail: ตัวเลขจาก burst test จริง (เจอ 429 ครั้งแรกที่ concurrent request ตัวที่ 6)
// ถ้า Elsevier เปลี่ยนเรต ต้องรัน scripts/test-scopus-rate-limit-burst.js ใหม่แล้วปรับเลขนี้
const PER_SECOND_LIMIT = 5;
const UNAVAILABLE_MS = 60 * 60 * 1000; // 1 ชม. — คงพฤติกรรมเดิมตอนเจอ 429 จริง
const DEFAULT_WEEKLY_LIMIT = 20000;

const STATE_DIR = path.join(__dirname, '..', '..', 'data');
const STATE_FILE = path.join(STATE_DIR, 'scopus-proxy-state.json');

class ScopusProxyService {
  constructor() {
    const persisted = this._loadState();

    this.keys = config.scopus.apiKeys.map((key, index) => {
      const saved = persisted[key] || {};
      return {
        key,
        index,
        weeklyLimit: saved.weeklyLimit ?? DEFAULT_WEEKLY_LIMIT,
        weeklyRemaining: saved.weeklyRemaining ?? DEFAULT_WEEKLY_LIMIT,
        weeklyResetAt: saved.weeklyResetAt ?? null, // unix seconds จาก header X-RateLimit-Reset
        unavailableUntil: saved.unavailableUntil ?? null, // ms epoch, null = available
        recentRequestTimestamps: [], // per-second throttle — ไม่ persist ตั้งใจ (transient)
      };
    });
    this.currentIndex = 0;
    this._writeQueue = Promise.resolve(); // serialize เขียนไฟล์กันไฟล์ state พัง
  }

  /**
   * ดึง key ถัดไปแบบ Round-robin
   * ข้าม key ที่: ล็อกจาก 429 จริงอยู่ / หมด weekly quota / ชน per-second throttle
   */
  async getNextKey() {
    const total = this.keys.length;
    let attempts = 0;

    while (attempts < total) {
      const keyObj = this.keys[this.currentIndex];
      this.currentIndex = (this.currentIndex + 1) % total;
      attempts++;

      if (this._isLocked(keyObj)) continue;
      if (keyObj.weeklyRemaining !== null && keyObj.weeklyRemaining <= 0) {
        // weekly reset ผ่านไปแล้วตาม header เดิม แต่ยังไม่มี response ใหม่มา update —
        // ให้ลองใหม่ได้ ปล่อยให้ response ถัดไปแก้ตัวเลขให้ถูกต้องเอง
        if (keyObj.weeklyResetAt && Date.now() / 1000 >= keyObj.weeklyResetAt) {
          keyObj.weeklyRemaining = keyObj.weeklyLimit;
        } else {
          continue;
        }
      }
      if (this._isThrottled(keyObj)) continue;

      return keyObj;
    }

    throw new Error('All Scopus API keys are throttled, rate-limited, or out of quota');
  }

  /**
   * เพิ่มนับ usage หลังใช้ key สำเร็จ
   * rateLimitHeaders: axios response.headers (lowercase keys) — ใช้ค่าจาก Elsevier
   * แทนการนับเอง เพราะแม่นกว่า (ยืนยันแล้วจากการทดสอบยิงจริง 500 request ไม่มี drift)
   */
  async incrementUsage(keyIndex, rateLimitHeaders = null) {
    const keyObj = this.keys[keyIndex];
    if (!keyObj) return;

    keyObj.recentRequestTimestamps.push(Date.now());

    if (rateLimitHeaders) {
      const limit = parseInt(rateLimitHeaders['x-ratelimit-limit'], 10);
      const remaining = parseInt(rateLimitHeaders['x-ratelimit-remaining'], 10);
      const reset = parseInt(rateLimitHeaders['x-ratelimit-reset'], 10);
      if (!isNaN(limit)) keyObj.weeklyLimit = limit;
      if (!isNaN(remaining)) keyObj.weeklyRemaining = remaining;
      if (!isNaN(reset)) keyObj.weeklyResetAt = reset;
    }

    await this._persist();
  }

  /**
   * Mark key ว่าไม่ available ชั่วคราว (เจอ 429 จริงหลังหลุดรอด throttle แล้ว)
   * ใช้ timestamp แทน setTimeout เพื่อให้รอด restart (lazy-check ใน getNextKey/_isLocked)
   */
  async markKeyUnavailable(keyIndex) {
    const keyObj = this.keys[keyIndex];
    if (!keyObj) return;
    keyObj.unavailableUntil = Date.now() + UNAVAILABLE_MS;
    await this._persist();
  }

  /**
   * ดูสถานะ keys ทั้งหมด (สำหรับ admin dashboard)
   */
  getStatus() {
    return this.keys.map(k => ({
      index: k.index,
      weeklyUsage: k.weeklyLimit - k.weeklyRemaining,
      weeklyLimit: k.weeklyLimit,
      remaining: k.weeklyRemaining,
      weeklyResetAt: k.weeklyResetAt,
      isAvailable: !this._isLocked(k),
      keyPreview: k.key ? `${k.key.slice(0, 6)}...${k.key.slice(-4)}` : 'N/A',
    }));
  }

  // ===== Internal =====

  _isLocked(keyObj) {
    return keyObj.unavailableUntil !== null && Date.now() < keyObj.unavailableUntil;
  }

  _isThrottled(keyObj) {
    const now = Date.now();
    keyObj.recentRequestTimestamps = keyObj.recentRequestTimestamps.filter(t => now - t < 1000);
    return keyObj.recentRequestTimestamps.length >= PER_SECOND_LIMIT;
  }

  _loadState() {
    try {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      return JSON.parse(raw);
    } catch (_) {
      return {}; // ไม่มีไฟล์ (first run) หรือไฟล์เสีย — เริ่มจาก default ทั้งหมด
    }
  }

  async _persist() {
    const snapshot = {};
    for (const k of this.keys) {
      snapshot[k.key] = {
        weeklyLimit: k.weeklyLimit,
        weeklyRemaining: k.weeklyRemaining,
        weeklyResetAt: k.weeklyResetAt,
        unavailableUntil: k.unavailableUntil,
      };
    }

    // serialize เขียนไฟล์ผ่าน queue กันสอง request พร้อมกันเขียนแข่งกันจนไฟล์พัง
    this._writeQueue = this._writeQueue.then(() => this._writeAtomic(snapshot));
    return this._writeQueue;
  }

  async _writeAtomic(snapshot) {
    await fs.promises.mkdir(STATE_DIR, { recursive: true });
    const tmpFile = `${STATE_FILE}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmpFile, JSON.stringify(snapshot, null, 2));
    await fs.promises.rename(tmpFile, STATE_FILE); // rename เป็น atomic operation
  }
}

// Singleton instance
module.exports = new ScopusProxyService();
