const express = require('express');
const router = express.Router();
const controller = require('../controllers/auth.client.controller');

// Step 1: Send OTP
router.post('/register/send-otp', controller.sendOtp);

// Step 2: Verify OTP & create account
router.post('/register/verify-otp', controller.verifyOtpAndCreate);

// Login
router.post('/login', controller.loginClient);

module.exports = router;
