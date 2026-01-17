const express = require('express');
const router = express.Router();
const clientController = require('../controllers/client.profile.controller');
const { authGuard } = require('../middleware/auth.middleware');

// Client authentication - only 'client' role can access
router.get('/profile', authGuard('client'), clientController.getProfile);
router.post('/password', authGuard('client'), clientController.updatePassword);

router.patch('/profile', authGuard('client'), clientController.updateProfile);

module.exports = router;
