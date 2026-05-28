/**
 * TCIScraper
 * ดึงข้อมูลวารสารจาก TCI ด้วย Web Scraping (Playwright)
 * Port จาก tci_issn_scraper.py
 * ใช้ journals_cache table เดิม (fetch_method = 'Scraping')
 */
const { chromium } = require('playwright');
const db = require('../config/database');
const config = require('../config');

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

    // ไม่พบวารสารใน TCI
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
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      console.log(`[TCIScraper] เปิดหน้า TCI journal_list ISSN: ${issn}`);
      await page.goto('https://tci-thailand.org/journal_list', {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForTimeout(3000);

      await TCIScraper._searchByIssn(page, issn);
      const data = await TCIScraper._extractTciDetails(page, issn);

      // ไม่พบวารสารใน TCI — ไม่บันทึก cache และ return null
      if (!data) return null;

      return data;

    } finally {
      await browser.close();
    }
  }

  static async _searchByIssn(page, issn) {
    await page.waitForSelector('select.chakra-select', { timeout: 5000 });

    const selects = page.locator('select.chakra-select');
    const count = await selects.count();

    let target = null;
    for (let i = 0; i < count; i++) {
      const s = selects.nth(i);
      const hasIssn = await s.locator('option', { hasText: 'ISSN' }).count();
      if (hasIssn > 0) {
        target = s;
        break;
      }
    }

    if (!target) throw new Error('ไม่พบ select ที่มี option ISSN');

    await target.click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await page.waitForSelector("input[placeholder='Search']", { timeout: 3000 });
    const searchInput = page.locator("input[placeholder='Search']").first();
    await searchInput.click();
    await searchInput.fill('');
    await searchInput.type(issn, { delay: 50 });

    const searchButton = page.locator("button:has-text('Search')").first();
    await searchButton.click();

    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(8000);
  }

  static async _extractTciDetails(page, issn) {
    // ตรวจสอบก่อนว่ามีผลลัพธ์หรือไม่ — ถ้าไม่มี return null แทน throw
    const titleLink = page.locator("a.chakra-link[href*='journal_info']").first();
    const found = await titleLink.waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    if (!found) {
      console.log(`[TCIScraper] ไม่พบวารสาร ISSN: ${issn} ใน TCI`);
      return null;
    }

    const cardRoot = titleLink.locator(
      "xpath=ancestor::div[contains(., 'Issues/Year')][1]"
    );

    // ===== ดึงจาก result card ก่อน (tier, issn, status) =====

    // Tier
    let tier = null;
    const tierEl = cardRoot.locator('p', { hasText: 'TIER' });
    if (await tierEl.count() > 0) {
      const tierText = (await tierEl.first().innerText()).trim();
      const m = tierText.match(/TIER[:\s]*(\d+)/i);
      tier = m ? parseInt(m[1]) : null;
    }

    // pISSN / eISSN
    let pissn = null;
    let eissn = null;
    const issnEl = cardRoot.locator('p', { hasText: 'pISSN' });
    if (await issnEl.count() > 0) {
      const issnText = (await issnEl.first().innerText()).trim();
      const mp = issnText.match(/pISSN:\s*([0-9Xx-]+)/);
      if (mp) pissn = mp[1];
      const me = issnText.match(/eISSN:\s*([0-9Xx-]+)/);
      if (me) eissn = me[1];
    }

    // Status
    let status = null;
    const statusEl = cardRoot.locator('span').filter({
      hasText: /Active|Inactive|Ceased|Under review|Name Changed/i,
    });
    if (await statusEl.count() > 0) {
      status = (await statusEl.first().innerText()).trim();
    }

    // ===== คลิกเข้า journal_info page — TCI เปิดใน new tab =====
    const [newPage] = await Promise.all([
      page.context().waitForEvent('page'),
      titleLink.click(),
    ]);
    await newPage.waitForSelector('td.css-twjuam', { timeout: 30000 });

    // Helper: ดึง value จาก label td.css-twjuam → value td.css-1u7ilek
    const getFieldValue = async (labelText) => {
      const rows = newPage.locator('tr.css-0');
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        const label = row.locator('td.css-twjuam');
        if (await label.count() === 0) continue;
        const lt = (await label.first().innerText()).trim();
        if (lt.toLowerCase().includes(labelText.toLowerCase())) {
          const val = row.locator('td.css-1u7ilek');
          if (await val.count() > 0) {
            const v = (await val.first().innerText()).trim();
            return v === '-' ? null : v;
          }
        }
      }
      return null;
    };

    const journalNameEng = await getFieldValue('Name (English)');
    const journalNameTh  = await getFieldValue('Name (Local)');
    const publisherEng   = await getFieldValue('Publisher (English)');
    const publisherTh    = await getFieldValue('Publisher (Local)');
    const website        = await getFieldValue('Website');
    const abbrevEng      = await getFieldValue('Abbreviation (English)');
    const issuePerYear   = await getFieldValue('Issues/Year');
    const subjectArea    = await getFieldValue('Subject Area');
    const subSubjectArea = await getFieldValue('Sub-Subject Area');

    const isInactive = status ? status.toLowerCase() === 'inactive' : false;

    // normalize tci_status ให้ตรงกับ API
    // "Active" → "active", "Active (name changed)" → "name_changed", "Name Changed" → "name_changed"
    const normalizeStatus = (s) => {
      if (!s) return null;
      const lower = s.toLowerCase();
      if (lower.includes('name changed') || lower.includes('name_changed')) return 'name_changed';
      if (lower.includes('inactive')) return 'inactive';
      if (lower.includes('active')) return 'active';
      if (lower.includes('ceased')) return 'ceased';
      if (lower.includes('under review')) return 'under_review';
      return lower.replace(/\s+/g, '_');
    };

    return {
      issn: (pissn || issn).replace(/-/g, '').trim(),
      eissn,
      journal_name: journalNameEng || '',
      journal_name_th: journalNameTh,
      publisher: publisherEng,
      publisher_th: publisherTh,
      database_source: 'TCI',
      tci_tier: tier,
      tci_status: normalizeStatus(status),
      tci_inactive: isInactive,
      website,
      main_area: null,
      major_area: subjectArea,
      minor_area: subSubjectArea,
      abbrev_name: abbrevEng,
      volume_per_year: null,
      issue_per_volume: issuePerYear,
      prev_name: null,
      prev_name_th: null,
      fetch_method: 'Scraping',
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
      main_area:        null,
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