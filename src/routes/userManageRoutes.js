/**
 * User Management Routes
 * Base path: /api/manage/users
 * เข้าได้: Admin, SuperAdmin, Staff
 */
const express = require('express');
const AdminController = require('../controllers/AdminController');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();

router.use(requireAuth);
router.use(requireRole('Admin', 'SuperAdmin', 'Staff'));

router.get('/',                AdminController.getUsers);
router.post('/single',         AdminController.createUser);
router.post('/import',         AdminController.importUsers);
router.patch('/:id/approve',   AdminController.approveUser);
router.patch('/:id/suspend',   AdminController.suspendUser);
router.patch('/:id/activate',  AdminController.activateUser);
router.patch('/:id/advisors',  AdminController.updateAdvisors);
router.patch('/:id',           AdminController.updateUser);

module.exports = router;
