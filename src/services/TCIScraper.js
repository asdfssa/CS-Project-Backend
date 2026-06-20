/**
 * TCIScraper
 * ดึงข้อมูลวารสารจาก TCI ด้วย Web Scraping (Playwright)
 * ใช้ journals_cache table เดิม (fetch_method = 'Scraping')
 */
const { chromium } = require('playwright');
const db = require('../config/database');
const config = require('../config');

const TCI_BASE = 'https://www.tci-thaijo.org';

class TCIScraper {

  // ===== Public =====

  static async getJournalByIssn(issn) {
    const cleanIssn = issn.trim();

    // 1. เช็ค cache ก่อน
    const cached = await TCIScraper._getFromCache(cleanIssn);
    if (cached) {
      const ageInDays = (Date.now() - new Date(cached.last_updated)) / (1000 * 60 * 60 * 24);
      if (ageInDays < config.scopus.cacheExpiryDays) {
        return { ...TCIScraper._formatCachedResult(cached), fromCache: true };
      }
    }

    // 2. Scrape จาก TCI
    const result = await TCIScraper._scrape(cleanIssn);

    if (!result) return null;

    // 3. Save/Update cache
    await TCIScraper._saveToCache(cleanIssn, result);

    return { ...result, fromCache: false };
  }

  // ===== Scraping =====

  static async _scrape(issn) {
    const browser = await chromium.launch({
      headless: config.scraper.headless,
      slowMo: config.scraper.slowMo,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    try {
      console.log(`[TCIScraper] เปิดหน้า TCI journals ISSN: ${issn}`);
      await page.goto(`${TCI_BASE}/journals`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);

      // ค้นหาด้วย ISSN
      const card = await TCIScraper._searchAndFindCard(page, issn);
      if (!card) {
        console.log(`[TCIScraper] ไม่พบวารสาร ISSN: ${issn} ใน TCI`);
        return null;
      }

      // ดึงข้อมูลจาก card ใน search results
      const cardData = await TCIScraper._extractFromCard(card, issn);

      // ถ้ามี acronym ให้เปิด detail page เพื่อดึงข้อมูลเพิ่ม
      if (cardData.acronym) {
        const detailData = await TCIScraper._extractFromDetailPage(page, cardData.acronym);
        const merged = { ...cardData, ...detailData, fetch_method: 'Scraping' };
        // ถ้า detail page มี pISSN ให้อัพเดท issn field
        if (merged.issn_from_detail) merged.issn = merged.issn_from_detail;
        delete merged.acronym;
        delete merged.issn_from_detail;
        return merged;
      }

      const { acronym: _a, ...rest } = cardData;
      return { ...rest, fetch_method: 'Scraping' };

    } finally {
      await browser.close();
    }
  }

  static async _searchAndFindCard(page, issn) {
    // พิมพ์ ISSN ในช่องค้นหา
    const searchInput = page.locator('input[placeholder="ค้นหาวารสาร..."]');
    await searchInput.waitFor({ state: 'visible', timeout: 10000 });
    await searchInput.fill(issn);

    // รอให้ journal cards โหลด (API debounce ~500ms + network)
    const cardLocator = page.locator('.journal-card');
    const appeared = await cardLocator.first().waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true).catch(() => false);

    if (!appeared) return null;

    await page.waitForTimeout(1000);

    // normalize ISSN ที่ค้นหา
    const normalizedIssn = issn.replace(/-/g, '').toLowerCase();

    // หา card ที่ตรงกับ ISSN
    const cards = cardLocator;
    const count = await cards.count();

    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const metaText = await card.locator('.journal-card__meta').allInnerTexts();
      const combined = metaText.join(' ').replace(/-/g, '').toLowerCase();
      if (combined.includes(normalizedIssn)) return card;
    }

    // ถ้าหาไม่เจอจาก meta ให้ใช้ card แรก (กรณี search ให้ผลเดียว)
    if (count === 1) return cards.first();

    return null;
  }

  static async _extractFromCard(card, issn) {
    const nameTH = await card.locator('.journal-card__title').first().innerText().catch(() => '');
    const nameEN = await card.locator('.journal-card__subtitle').first().innerText().catch(() => '');

    // meta rows: [0] = acronym (มี icon 'label'), [1] = ISSN info, [2] = date
    const metaItems = await card.locator('.journal-card__meta').allInnerTexts();

    // acronym อยู่ใน meta ที่มี material icon 'label' นำหน้า
    // innerText ของ <i class="q-icon">label</i>JBPE จะได้ "labelJBPE"
    // ต้องดึง text node โดยตรงเพื่อตัด icon text ออก
    let acronym = null;
    const metaDivs = card.locator('.journal-card__meta');
    const metaCount = await metaDivs.count();
    for (let i = 0; i < metaCount; i++) {
      const textOnly = await metaDivs.nth(i).evaluate(el => {
        return [...el.childNodes]
          .filter(n => n.nodeType === Node.TEXT_NODE)
          .map(n => n.textContent.trim())
          .join('').trim();
      });
      if (textOnly && /^[A-Z][A-Z0-9_-]{1,15}$/i.test(textOnly)) {
        acronym = textOnly;
        break;
      }
      // กรณีที่ text อยู่ใน div ลูก (ไม่มี icon)
      const innerDiv = metaDivs.nth(i).locator('div').first();
      if (await innerDiv.count() > 0) continue; // meta นี้มี div ลูก = ISSN row
    }

    // Tier
    let tier = null;
    const tierText = await card.locator('.tier-badge').first().innerText().catch(() => '');
    const tierMatch = tierText.match(/(\d+)/);
    if (tierMatch) tier = parseInt(tierMatch[1]);

    // ISSN จาก meta text
    let eissn = null;
    let pissn = null;
    for (const text of metaItems) {
      const eMatch = text.match(/eISSN[:\s]*([0-9]{4}-?[0-9]{3}[0-9X])/i);
      if (eMatch) eissn = eMatch[1].replace(/-/g, '');
      const pMatch = text.match(/pISSN[:\s]*([0-9]{4}-?[0-9]{3}[0-9X])/i);
      if (pMatch) pissn = pMatch[1].replace(/-/g, '');
    }

    const fallbackIssn = issn.replace(/-/g, '').trim();

    return {
      issn: pissn || fallbackIssn,
      eissn: eissn || null,
      journal_name: nameEN.trim() || '',
      journal_name_th: nameTH.trim() || null,
      publisher: null,
      publisher_th: null,
      database_source: 'TCI',
      tci_tier: tier,
      tci_status: 'active',
      tci_inactive: false,
      website: null,
      main_area: null,
      major_area: null,
      minor_area: null,
      abbrev_name: acronym,
      acronym,
      volume_per_year: null,
      issue_per_volume: null,
      prev_name: null,
      prev_name_th: null,
    };
  }

  static async _extractFromDetailPage(page, acronym) {
    await page.goto(`${TCI_BASE}/journals/${acronym}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // รอให้ meta rows โหลด
    await page.locator('.journal-meta-row').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

    // ดึง meta rows ทั้งหมด (label → value)
    const metaMap = {};
    const rows = page.locator('.journal-meta-row');
    const rowCount = await rows.count();
    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const label = await row.locator('.meta-label').first().innerText().catch(() => '');
      const value = await row.locator('.text-body2').first().innerText().catch(() => '');
      if (label) metaMap[label.trim()] = value.trim();
    }

    // Tier จาก detail page
    let tier = null;
    const tierText = await page.locator('.tier-badge').first().innerText().catch(() => '');
    const tierMatch = tierText.match(/(\d+)/);
    if (tierMatch) tier = parseInt(tierMatch[1]);

    // Status: enabled = true unless tier badge is missing
    const isEnabled = tier !== null;

    // Website: link ไปยัง "ต้นฉบับวารสาร"
    let website = null;
    const websiteLink = page.locator('a[href*="tci-thaijo.org/index.php"]').first();
    const wsFound = await websiteLink.waitFor({ state: 'attached', timeout: 3000 }).then(() => true).catch(() => false);
    if (wsFound) website = await websiteLink.getAttribute('href');

    return {
      tci_tier: tier,
      tci_status: isEnabled ? 'active' : 'inactive',
      tci_inactive: !isEnabled,
      website,
      main_area: metaMap['หมวดหมู่'] || null,
      eissn: metaMap['eISSN'] ? metaMap['eISSN'].replace(/-/g, '') : null,
      issn_from_detail: metaMap['pISSN'] ? metaMap['pISSN'].replace(/-/g, '') : null,
    };
  }

  // ===== Cache =====

  static async _getFromCache(issn) {
    const cleanIssn = issn.replace('-', '').trim();
    const [rows] = await db.query(
      `SELECT * FROM journal_watch.journals_cache
       WHERE issn = ? AND database_source = 'TCI'
       LIMIT 1`,
      [cleanIssn]
    );
    return rows[0] || null;
  }

  static async _saveToCache(issn, data) {
    if (!data) return;
    const cleanIssn = issn.replace('-', '').trim();

    await db.query(
      `INSERT INTO journal_watch.journals_cache
        (issn, eissn, journal_name, journal_name_th, publisher, publisher_th,
         database_source, website, abbrev_name,
         tci_tier, tci_inactive, tci_status, tci_subject_area,
         minor_area, main_area, issue_per_volume, volume_per_year,
         prev_name, prev_name_th, fetch_method, last_updated)
       VALUES (?, ?, ?, ?, ?, ?, 'TCI', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         eissn            = VALUES(eissn),
         journal_name     = VALUES(journal_name),
         journal_name_th  = VALUES(journal_name_th),
         publisher        = VALUES(publisher),
         publisher_th     = VALUES(publisher_th),
         website          = VALUES(website),
         abbrev_name      = VALUES(abbrev_name),
         tci_tier         = VALUES(tci_tier),
         tci_inactive     = VALUES(tci_inactive),
         tci_status       = VALUES(tci_status),
         tci_subject_area = VALUES(tci_subject_area),
         minor_area       = VALUES(minor_area),
         main_area        = VALUES(main_area),
         issue_per_volume = VALUES(issue_per_volume),
         volume_per_year  = VALUES(volume_per_year),
         prev_name        = VALUES(prev_name),
         prev_name_th     = VALUES(prev_name_th),
         fetch_method     = VALUES(fetch_method),
         last_updated     = NOW()`,
      [
        cleanIssn,
        data.eissn || null,
        data.journal_name,
        data.journal_name_th || null,
        data.publisher || null,
        data.publisher_th || null,
        data.website || null,
        data.abbrev_name || null,
        data.tci_tier ? String(data.tci_tier) : null,
        data.tci_inactive ? 1 : 0,
        data.tci_status || null,
        data.major_area || null,
        data.minor_area || null,
        data.main_area || null,
        data.issue_per_volume || null,
        data.volume_per_year || null,
        data.prev_name || null,
        data.prev_name_th || null,
        data.fetch_method || 'Scraping',
      ]
    );
  }

  static _formatCachedResult(cached) {
    return {
      issn:             cached.issn,
      eissn:            cached.eissn || null,
      journal_name:     cached.journal_name,
      journal_name_th:  cached.journal_name_th || null,
      publisher:        cached.publisher || null,
      publisher_th:     cached.publisher_th || null,
      database_source:  'TCI',
      website:          cached.website || null,
      abbrev_name:      cached.abbrev_name || null,
      tci_tier:         cached.tci_tier ? parseInt(cached.tci_tier) : null,
      tci_status:       cached.tci_status || null,
      tci_inactive:     cached.tci_inactive === 1,
      main_area:        cached.main_area || null,
      major_area:       cached.tci_subject_area || null,
      minor_area:       cached.minor_area || null,
      volume_per_year:  null,
      issue_per_volume: cached.issue_per_volume || null,
      prev_name:        null,
      prev_name_th:     null,
      fetch_method:     cached.fetch_method,
    };
  }
}

module.exports = TCIScraper;
