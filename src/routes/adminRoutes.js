/**
 * Admin Routes
 * Base path: /api/admin
 * เฉพาะ Admin และ SuperAdmin เท่านั้น
 */
const express = require('express');
const AdminController = require('../controllers/AdminController');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

router.use(requireAuth);
router.use(requireRole('Admin', 'SuperAdmin'));

// ภาพรวมสถิติ
router.get('/stats', AdminController.getStats);

// จัดการผู้ใช้
router.get('/users',                 AdminController.getUsers);
router.post('/users/single',         AdminController.createUser);
router.post('/users/import',         AdminController.importUsers);
router.patch('/users/:id/approve',   AdminController.approveUser);
router.patch('/users/:id/suspend',   AdminController.suspendUser);
router.patch('/users/:id/activate',  AdminController.activateUser);
router.patch('/users/:id/advisors', AdminController.updateAdvisors);
router.patch('/users/:id',          AdminController.updateUser);
router.get('/logs', AdminController.getLogs);

// จัดการ Admin
router.post('/admins',              AdminController.createAdmin);
router.patch('/admins/:id/suspend', AdminController.suspendAdmin);
router.patch('/admins/:id/activate',AdminController.activateAdmin);
router.patch('/admins/:id',         AdminController.updateAdmin);
router.delete('/admins/:id',        AdminController.deleteAdmin);
module.exports = router;