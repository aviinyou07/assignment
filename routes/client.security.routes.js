const express = require('express');
const router = express.Router();

const securityController = require('../controllers/client.security.controller');
const clientAuth = require('../middlewares/client.auth.middleware');

// EMAIL
router.post('/email/request-otp', clientAuth, securityController.requestEmailOtp);
router.post('/email/verify-otp', clientAuth, securityController.verifyEmailOtp);

// MOBILE
router.post('/mobile/request-otp', clientAuth, securityController.requestMobileOtp);
router.post('/mobile/verify-otp', clientAuth, securityController.verifyMobileOtp);

// PASSWORD
router.post('/password/request-otp', clientAuth, securityController.requestPasswordOtp);
router.post('/password/verify-otp', clientAuth, securityController.verifyPasswordOtp);

module.exports = router;
