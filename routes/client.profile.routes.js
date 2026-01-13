const express = require('express');
const router = express.Router();
const clientController = require('../controllers/client.profile.controller');
const clientAuth = require('../middlewares/client.auth.middleware');

router.get('/profile', clientAuth, clientController.getProfile);
router.patch('/profile', clientAuth, clientController.updateProfile);

module.exports = router;
