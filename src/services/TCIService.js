/**
 * TCIService
 * ดึงข้อมูลวารสารจาก TCI API
 * ใช้ journals_cache table สำหรับ caching
 */
const axios = require('axios');
const db = require('../config/database');
const config = require('../config');

class TCIService {

  static async getJournalByIssn(issn) {
    const cleanIssn = issn.trim();

    // 1. เช็ค cache ก่อน
    const cached = await TCIService._getFromCache(cleanIssn);
    if (cached) {
      const ageInDays = (Date.now() - new Date(cached.last_updated)) / (1000 * 60 * 60 * 24);
      if (ageInDays < config.scopus.cacheExpiryDays) {
        return { ...TCIService._formatCachedResult(cached), fromCache: true };
      }
    }

    // 2. Fetch จาก TCI API
    const apiResult = await TCIService._fetchFromApi(cleanIssn);

    // 3. Save/Update cache
    await TCIService._saveToCache(cleanIssn, apiResult);

    return { ...apiResult, fromCache: false };
  }

  static async _fetchFromApi(issn) {
    try {
      const response = await axios.post(
        'https://www.tci-thaijo.org/api/v1/journals/search',
        {
          q: issn,
          enabled: true,
          page: 1,
          per_page: 20,
          sort: 'date_created_desc',
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
            'Origin': 'https://www.tci-thaijo.org',
            'Referer': 'https://www.tci-thaijo.org/journals',
          },
          timeout: 15000,
        }
      );

      const hits = response.data?.hits || [];
      if (hits.length === 0) return null;

      // หา exact match ของ ISSN ก่อน (ทั้ง print_issn และ online_issn)
      const normalizedIssn = issn.replace(/-/g, '').toLowerCase();
      const exact = hits.find(j => {
        const print = (j.print_issn || '').replace(/-/g, '').toLowerCase();
        const online = (j.online_issn || '').replace(/-/g, '').toLowerCase();
        return print === normalizedIssn || online === normalizedIssn;
      });

      const journal = exact || hits[0];
      return TCIService._parseApiResponse(journal, issn);

    } catch (err) {
      throw new Error(`TCI API error: ${err.message}`);
    }
  }

  static _parseApiResponse(journal, issn) {
    const tier = journal['tier'] ? parseInt(journal['tier']) : null;
    const isEnabled = journal['enabled'] !== false;

    // online_issn คือ eissn, print_issn คือ issn
    const printIssn = (journal['print_issn'] || '').replace(/-/g, '').trim();
    const onlineIssn = (journal['online_issn'] || '').replace(/-/g, '').trim();
    const fallbackIssn = issn.replace(/-/g, '').trim();

    return {
      issn: printIssn || fallbackIssn,
      eissn: onlineIssn || null,
      journal_name: journal['names']?.['en_US'] || journal['names']?.['th_TH'] || '',
      journal_name_th: journal['names']?.['th_TH'] || null,
      publisher: null,
      publisher_th: null,
      database_source: 'TCI',
      tci_tier: tier,
      tci_status: isEnabled ? 'active' : 'inactive',
      tci_inactive: !isEnabled,
      website: journal['journal_url'] || null,
      main_area: journal['category'] || null,
      major_area: null,
      minor_area: null,
      abbrev_name: journal['acronym'] || null,
      volume_per_year: null,
      issue_per_volume: null,
      prev_name: null,
      prev_name_th: null,
      fetch_method: 'API',
    };
  }

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
        data.fetch_method || 'API',
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
      volume_per_year:  cached.volume_per_year || null,
      issue_per_volume: cached.issue_per_volume || null,
      prev_name:        cached.prev_name || null,
      prev_name_th:     cached.prev_name_th || null,
      fetch_method:     cached.fetch_method,
    };
  }
}

module.exports = TCIService;