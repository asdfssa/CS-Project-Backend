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
        'https://tci-thailand.org/backend/journal/list_all_journal',
        {
          start_item: 0,
          offset: 10,
          option: 'ssn',
          search: issn,
          status: ['active', 'name_changed', 'inactive'],
          tiers: [],
          area: [],
          main_area: [],
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0',
            'Origin': 'https://tci-thailand.org',
            'Referer': 'https://tci-thailand.org/journal_list',
          },
          timeout: 15000,
        }
      );

      const journals = response.data?.journals || [];
      if (journals.length === 0) return null;

      return TCIService._parseApiResponse(journals[0], issn);

    } catch (err) {
      throw new Error(`TCI API error: ${err.message}`);
    }
  }

  static _parseApiResponse(journal, issn) {
    const tier = journal['tci_tier'] ? parseInt(journal['tci_tier']) : null;
    const status = journal['status'] || null;
    const isInactive = status === 'inactive';

    return {
      issn: (journal['issn'] || issn).replace(/-/g, '').trim(),
      eissn: journal['eissn'] || null,
      journal_name: journal['name_eng'] || journal['name_local'] || '',
      journal_name_th: journal['name_local'] || null,
      publisher: journal['publisher_eng'] || null,
      publisher_th: journal['publisher_loc'] || null,
      database_source: 'TCI',
      tci_tier: tier,
      tci_status: status,
      tci_inactive: isInactive,
      website: journal['website'] || null,
      main_area: journal['main_area'] || null,
      major_area: journal['major_area'] || null,
      minor_area: journal['minor_area'] || null,
      abbrev_name: journal['abbrev_name'] || null,
      volume_per_year: journal['volume_per_year'] || null,
      issue_per_volume: journal['issue_per_volume'] || null,
      prev_name: journal['prev_name'] || null,
      prev_name_th: journal['prev_name_th'] || null,
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