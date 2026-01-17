const masterCountriesRouter = require('express').Router();
const masterCountriesController = require('../controllers/master.countries.controller');

masterCountriesRouter.get('/', masterCountriesController.getCountries);

module.exports = masterCountriesRouter;