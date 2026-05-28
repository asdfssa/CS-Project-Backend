/**
 * ScopusService
 * ดึงข้อมูลวารสารจาก Scopus API
 * Port มาจาก Python script + Key Rotation + Caching
 */
const axios = require('axios');
const db = require('../config/database');
const config = require('../config');
const scopusProxy = require('./ScopusProxyService');

class ScopusService {

  static async getJournalByIssn(issn) {
    const cleanIssn = issn.replace('-', '').trim();

    const cached = await ScopusService._getFromCache(cleanIssn);
    if (cached) {
      const ageInDays = (Date.now() - new Date(cached.last_updated)) / (1000 * 60 * 60 * 24);
      if (ageInDays < config.scopus.cacheExpiryDays) {
        return { ...ScopusService._formatCachedResult(cached), fromCache: true };
      }
    }

    const apiResult = await ScopusService._fetchFromApi(cleanIssn);
    await ScopusService._saveToCache(cleanIssn, apiResult);
    return { ...apiResult, fromCache: false };
  }

  static async _fetchFromApi(issn) {
    const keyObj = scopusProxy.getNextKey();

    try {
      const response = await axios.get(
        `${config.scopus.baseUrl}/content/serial/title/issn/${issn}`,
        {
          headers: {
            'X-ELS-APIKey': keyObj.key,
            'Accept': 'application/json',
          },
          params: {
            view: 'STANDARD',
            field: 'dc:title,prism:issn,prism:eIssn,dc:publisher,prism:aggregationType,openaccess,SNIP,SJR,citeScoreYearInfo,subject-area,coverageStartYear,coverageEndYear,H-Index',
          },
          timeout: 15000,
        }
      );

      scopusProxy.incrementUsage(keyObj.index);
      const data = response.data['serial-metadata-response'];

      if (!data || !data.entry || !data.entry[0]) {
        return null;
      }

      return ScopusService._parseApiResponse(data.entry[0], issn);

    } catch (err) {
      if (err.response?.status === 429) {
        scopusProxy.markKeyUnavailable(keyObj.index);
        return ScopusService._fetchFromApi(issn);
      }
      if (err.response?.status === 404) {
        return null;
      }
      throw new Error(`Scopus API error: ${err.message}`);
    }
  }

  // ===== Helpers (port จาก Python) =====

  static _computeQuartile(percentile) {
    if (percentile === null || percentile === undefined) return null;
    const p = parseFloat(percentile);
    if (isNaN(p)) return null;
    if (p >= 75) return 'Q1';
    if (p >= 50) return 'Q2';
    if (p >= 25) return 'Q3';
    return 'Q4';
  }

  static _safeGetCiteScoreYearInfoList(entry) {
    const raw = entry?.citeScoreYearInfoList;
    const result = [];

    if (!raw) return result;

    const extractCs = (cs) => {
      if (Array.isArray(cs)) result.push(...cs);
      else if (cs && typeof cs === 'object') result.push(cs);
    };

    if (Array.isArray(raw)) {
      raw.forEach(item => {
        if (item?.citeScoreYearInfo) extractCs(item.citeScoreYearInfo);
      });
    } else if (typeof raw === 'object') {
      extractCs(raw.citeScoreYearInfo);
    }

    return result;
  }

  static _safeGetCiteScoreInfoList(csy) {
    const raw = csy?.citeScoreInformationList;
    const result = [];

    if (!raw) return result;

    const extractCs = (cs) => {
      if (Array.isArray(cs)) result.push(...cs);
      else if (cs && typeof cs === 'object') result.push(cs);
    };

    if (Array.isArray(raw)) {
      raw.forEach(item => {
        if (item?.citeScoreInfo) extractCs(item.citeScoreInfo);
      });
    } else if (typeof raw === 'object') {
      extractCs(raw.citeScoreInfo);
    }

    return result;
  }

  static _parseApiResponse(entry, issn) {
    // Subject Areas
    const saRaw = entry['subject-area'] || [];
    const subjectAreas = (Array.isArray(saRaw) ? saRaw : [saRaw])
      .filter(a => a && a['$'])
      .map(a => ({
        abbrev: a['@abbrev'],
        code: a['@code'],
        area: a['$'],
      }));

    // SJR
    const sjrList = entry['SJRList']?.SJR || [];
    const sjrArr = Array.isArray(sjrList) ? sjrList : [sjrList];
    const sjrValue = sjrArr.length > 0 ? parseFloat(sjrArr[sjrArr.length - 1]['$']) : null;

    // SNIP
    const snipList = entry['SNIPList']?.SNIP || [];
    const snipArr = Array.isArray(snipList) ? snipList : [snipList];
    const snipValue = snipArr.length > 0 ? parseFloat(snipArr[snipArr.length - 1]['$']) : null;

    // Coverage + Discontinued
    const coverageStartYear = entry['coverageStartYear'] || null;
    const coverageEndYear = entry['coverageEndYear'] || null;
    const currentYear = new Date().getFullYear();
    const isDiscontinued = coverageEndYear ? parseInt(coverageEndYear) < currentYear - 1 : false;

    // CiteScore + Quartile
    let citeScore = null;
    let bestQuartile = null;
    let bestPercentile = null;
    let rankings = [];

    const csyList = ScopusService._safeGetCiteScoreYearInfoList(entry);
    if (csyList.length > 0) {
      const completeYears = csyList.filter(y => String(y['@status'] || '').toLowerCase() === 'complete');
      const targetYear = completeYears.length > 0 ? completeYears[0] : csyList[0];
      const year = targetYear['@year'];
      citeScore = targetYear['citeScore'] || null;

      const csInfoList = ScopusService._safeGetCiteScoreInfoList(targetYear);

      if (csInfoList.length > 0) {
        const csInfo = csInfoList[0];
        citeScore = csInfo['citeScore'] || targetYear['citeScore'] || null;
        let csrList = csInfo['citeScoreSubjectRank'] || [];
        if (!Array.isArray(csrList)) csrList = [csrList];

        const codeToArea = {};
        subjectAreas.forEach(sa => {
          if (sa.code) {
            codeToArea[sa.code] = sa.area;
            codeToArea[String(parseInt(sa.code))] = sa.area;
          }
        });

        rankings = csrList
          .filter(r => r && typeof r === 'object')
          .map(r => {
            const code = r['subjectCode'] || r['asjcCode'];
            const percentile = r['percentile'] !== undefined ? parseFloat(r['percentile']) : null;
            return {
              year,
              asjcCode: code,
              field: codeToArea[code] || null,
              rank: r['rank'] || null,
              percentile: isNaN(percentile) ? null : percentile,
              quartile: ScopusService._computeQuartile(percentile),
            };
          });

        if (rankings.length > 0) {
          const best = rankings.reduce((prev, curr) => {
            const pp = prev.percentile ?? -1;
            const cp = curr.percentile ?? -1;
            return cp > pp ? curr : prev;
          });
          bestPercentile = best.percentile;
          bestQuartile = best.quartile;
        }
      }
    }

    return {
      issn,
      journal_name: entry['dc:title'] || '',
      publisher: entry['dc:publisher'] || null,
      database_source: 'Scopus',
      scopus_quartile_data: rankings.length > 0 ? rankings : null,
      scopus_best_quartile: bestQuartile,
      scopus_best_percentile: bestPercentile,
      scopus_h_index: null,
      scopus_citescore: citeScore ? parseFloat(citeScore) : null,
      scopus_sjr: sjrValue,
      scopus_snip: snipValue,
      scopus_discontinued: isDiscontinued,
      subject_areas: subjectAreas.length > 0 ? subjectAreas : null,
      coverage_start_year: coverageStartYear,
      coverage_end_year: coverageEndYear,
      fetch_method: 'API',
    };
  }

  static async _getFromCache(issn) {
    const [rows] = await db.query(
      `SELECT * FROM journal_watch.journals_cache WHERE issn = ? AND database_source = 'Scopus' LIMIT 1`,
      [issn]
    );
    return rows[0] || null;
  }

  static async _saveToCache(issn, data) {
    if (!data) return;

    await db.query(
      `INSERT INTO journal_watch.journals_cache
        (issn, journal_name, publisher, database_source, scopus_quartile_data,
         scopus_best_quartile, scopus_best_percentile, scopus_h_index,
         scopus_citescore, scopus_sjr, scopus_snip, scopus_discontinued,
         coverage_start_year, coverage_end_year, subject_areas,
         fetch_method, last_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         journal_name           = VALUES(journal_name),
         publisher              = VALUES(publisher),
         scopus_quartile_data   = VALUES(scopus_quartile_data),
         scopus_best_quartile   = VALUES(scopus_best_quartile),
         scopus_best_percentile = VALUES(scopus_best_percentile),
         scopus_h_index         = VALUES(scopus_h_index),
         scopus_citescore       = VALUES(scopus_citescore),
         scopus_sjr             = VALUES(scopus_sjr),
         scopus_snip            = VALUES(scopus_snip),
         scopus_discontinued    = VALUES(scopus_discontinued),
         coverage_start_year    = VALUES(coverage_start_year),
         coverage_end_year      = VALUES(coverage_end_year),
         subject_areas          = VALUES(subject_areas),
         fetch_method           = VALUES(fetch_method),
         last_updated           = NOW()`,
      [
        issn,
        data.journal_name,
        data.publisher || null,
        data.database_source || 'Scopus',
        data.scopus_quartile_data ? JSON.stringify(data.scopus_quartile_data) : null,
        data.scopus_best_quartile,
        data.scopus_best_percentile ?? null,
        data.scopus_h_index,
        data.scopus_citescore,
        data.scopus_sjr,
        data.scopus_snip ?? null,
        data.scopus_discontinued ? 1 : 0,
        data.coverage_start_year || null,
        data.coverage_end_year || null,
        data.subject_areas ? JSON.stringify(data.subject_areas) : null,
        data.fetch_method || 'API',
      ]
    );
  }

  static _formatCachedResult(cached) {
    return {
      issn:                   cached.issn,
      journal_name:           cached.journal_name,
      publisher:              cached.publisher || null,
      database_source:        cached.database_source,
      scopus_quartile_data:   cached.scopus_quartile_data
        ? (typeof cached.scopus_quartile_data === 'string'
            ? JSON.parse(cached.scopus_quartile_data)
            : cached.scopus_quartile_data)
        : null,
      scopus_best_quartile:   cached.scopus_best_quartile,
      scopus_best_percentile: cached.scopus_best_percentile ?? null,
      scopus_h_index:         cached.scopus_h_index,
      scopus_citescore:       cached.scopus_citescore ? parseFloat(cached.scopus_citescore) : null,
      scopus_sjr:             cached.scopus_sjr ? parseFloat(cached.scopus_sjr) : null,
      scopus_snip:            cached.scopus_snip ? parseFloat(cached.scopus_snip) : null,
      scopus_discontinued:    cached.scopus_discontinued === 1,
      subject_areas:          cached.subject_areas
        ? (typeof cached.subject_areas === 'string'
            ? JSON.parse(cached.subject_areas)
            : cached.subject_areas)
        : null,
      coverage_start_year:    cached.coverage_start_year || null,
      coverage_end_year:      cached.coverage_end_year || null,
      fetch_method:           cached.fetch_method,
    };
  }
}

module.exports = ScopusService;