/**
 * Log Viewer Routes
 * สำหรับแสดง logs ผ่าน web interface
 */
const express = require('express');
const router = express.Router();

// เก็บ logs ใน memory (สำหรับ demo)
let logs = [];
const MAX_LOGS = 1000;

// สีสำหรับแต่ละ log level
const logColors = {
  INFO: '#007bff',
  OK: '#28a745',
  WARN: '#ffc107',
  ERROR: '#dc3545'
};

// Export functions เพื่อให้ server.js เรียกใช้
function addLog(level, args) {
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ');
  
  // Strip ANSI escape codes
  const cleanMessage = message.replace(/\x1b\[[0-9;]*m/g, '');
  
  logs.unshift({
    timestamp: new Date().toISOString(),
    level: level,
    message: cleanMessage,
    color: logColors[level] || '#000'
  });
  
  // จำกัดจำนวน logs
  if (logs.length > MAX_LOGS) {
    logs = logs.slice(0, MAX_LOGS);
  }
}

// Export เพื่อให้ server.js ใช้ override console
module.exports = {
  router,
  addLog,
  setupConsoleOverride: () => {
    const originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error
    };

    console.log = function(...args) {
      originalConsole.log.apply(console, args);
      addLog('INFO', args);
    };

    console.warn = function(...args) {
      originalConsole.warn.apply(console, args);
      addLog('WARN', args);
    };

    console.error = function(...args) {
      originalConsole.error.apply(console, args);
      addLog('ERROR', args);
    };
  }
};

// API endpoints
router.get('/', (req, res) => {
  const { level, limit = 100 } = req.query;
  
  let filteredLogs = logs;
  
  if (level && level !== 'ALL') {
    filteredLogs = logs.filter(log => log.level === level);
  }
  
  res.json({
    logs: filteredLogs.slice(0, parseInt(limit)),
    total: filteredLogs.length
  });
});

router.get('/stats', (req, res) => {
  const stats = {
    total: logs.length,
    INFO: logs.filter(l => l.level === 'INFO').length,
    OK: logs.filter(l => l.level === 'OK').length,
    WARN: logs.filter(l => l.level === 'WARN').length,
    ERROR: logs.filter(l => l.level === 'ERROR').length
  };
  
  res.json(stats);
});

router.delete('/', (req, res) => {
  logs = [];
  res.json({ message: 'Logs cleared' });
});
