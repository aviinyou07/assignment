const express = require('express');
const router = express.Router();
const { getAllBDEs } = require('../controllers/bdeController');

router.get('/getall', getAllBDEs);

module.exports = router;
