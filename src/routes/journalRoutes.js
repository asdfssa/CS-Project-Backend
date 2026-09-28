/**
 * Journal Routes
 * Base path: /api/journal
 */
const express = require('express');
const JournalController = require('../controllers/JournalController');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();

// ===== API Routes =====
router.get('/scopus', requireAuth, JournalController.searchScopus);
router.get('/tci',    requireAuth, JournalController.searchTci);

// ===== Scraping Routes =====
router.get('/scopus/scrape', requireAuth, JournalController.scrapeScopus);
router.get('/tci/scrape',    requireAuth, JournalController.scrapeTci);

// ===== Utility =====
router.get('/proxy-status', requireAuth, JournalController.proxyStatus);

module.exports = router;