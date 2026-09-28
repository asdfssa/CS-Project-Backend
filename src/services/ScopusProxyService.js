/**
 * ScopusProxyService
 * จัดการ API Key Rotation + Rate Limit Tracking
 * รองรับหลาย key แบบ Round-robin
 */
const config = require('../config');

class ScopusProxyService {
  constructor() {
    this.keys = config.scopus.apiKeys.map((key, index) => ({
      key,
      index,
      weeklyUsage: 0,       // จำนวนครั้งที่ใช้ในสัปดาห์นี้
      weeklyLimit: 20000,
      lastResetAt: new Date(),
      isAvailable: true,
    }));
    this.currentIndex = 0;

    // Reset usage ทุก 7 วัน
    setInterval(() => this._resetWeeklyUsage(), 7 * 24 * 60 * 60 * 1000);
  }

  /**
   * ดึง key ถัดไปแบบ Round-robin
   * ข้าม key ที่หมด quota หรือไม่ available
   */
  getNextKey() {
    const total = this.keys.length;
    let attempts = 0;

    while (attempts < total) {
      const keyObj = this.keys[this.currentIndex];
      this.currentIndex = (this.currentIndex + 1) % total;

      if (keyObj.isAvailable && keyObj.weeklyUsage < keyObj.weeklyLimit) {
        return keyObj;
      }
      attempts++;
    }

    throw new Error('All Scopus API keys have exceeded their weekly quota');
  }

  /**
   * เพิ่มนับ usage หลังใช้ key
   */
  incrementUsage(keyIndex) {
    if (this.keys[keyIndex]) {
      this.keys[keyIndex].weeklyUsage++;
    }
  }

  /**
   * Mark key ว่าไม่ available ชั่วคราว (เช่น เจอ 429)
   * จะ reset กลับมาใน 1 ชั่วโมง
   */
  markKeyUnavailable(keyIndex) {
    if (this.keys[keyIndex]) {
      this.keys[keyIndex].isAvailable = false;
      setTimeout(() => {
        if (this.keys[keyIndex]) {
          this.keys[keyIndex].isAvailable = true;
        }
      }, 60 * 60 * 1000); // 1 ชั่วโมง
    }
  }

  /**
   * ดูสถานะ keys ทั้งหมด (สำหรับ admin dashboard)
   */
  getStatus() {
    return this.keys.map(k => ({
      index: k.index,
      weeklyUsage: k.weeklyUsage,
      weeklyLimit: k.weeklyLimit,
      remaining: k.weeklyLimit - k.weeklyUsage,
      isAvailable: k.isAvailable,
      lastResetAt: k.lastResetAt,
      keyPreview: k.key ? `${k.key.slice(0, 6)}...${k.key.slice(-4)}` : 'N/A',
    }));
  }

  _resetWeeklyUsage() {
    this.keys.forEach(k => {
      k.weeklyUsage = 0;
      k.lastResetAt = new Date();
      k.isAvailable = true;
    });
    console.log('[ScopusProxy] Weekly usage reset');
  }
}

// Singleton instance
module.exports = new ScopusProxyService();