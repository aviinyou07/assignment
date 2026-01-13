const masterCountriesRouter = require('express').Router();
const masterCountriesController = require('../controllers/master Countries');

masterCountriesRouter.get('/', masterCountriesController.getCountries);

module.exports = masterCountriesRouter;