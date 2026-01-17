const express = require('express');
const router = express.Router();

const securityController = require('../controllers/client.security.controller');
const { authGuard } = require('../middleware/auth.middleware');

// EMAIL
router.post('/email/request-otp', authGuard('client'), securityController.requestEmailOtp);
router.post('/email/verify-otp', authGuard('client'), securityController.verifyEmailOtp);

router.post('/delete-account', authGuard('client'), securityController.deleteUserAccount);


// MOBILE
router.post('/mobile/request-otp', authGuard('client'), securityController.requestMobileOtp);
router.post('/mobile/verify-otp', authGuard('client'), securityController.verifyMobileOtp);

// PASSWORD
router.post('/password/request-otp', authGuard('client'), securityController.requestPasswordOtp);
router.post('/password/verify-otp', authGuard('client'), securityController.verifyPasswordOtp);

module.exports = router;
