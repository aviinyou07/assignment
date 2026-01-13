const express = require('express');
const router = express.Router();
const controller = require('../controllers/auth.client.controller');

// Registration Flow
router.post('/register/send-otp', controller.sendOtp);
router.post('/register/verify-otp', controller.verifyOtpAndCreate);

// Password-based Login (existing)
router.post('/login', controller.loginClient);

// OTP-based Login Flow (NEW - per requirements)
router.post('/login/request-otp', controller.requestLoginOtp);
router.post('/login/verify-otp', controller.verifyLoginOtp);

module.exports = router;
