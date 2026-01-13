const db = require("../config/db");

exports.getCountries = async (req, res) => {
  try {
    const [countries] = await db.query(`
      SELECT 
        id,
        iso_code,
        name,
        phone_code,
        currency_symbol,
        currency_code
      FROM countries
      ORDER BY name ASC
    `);

    res.status(200).json({
      success: true,
      data: countries,
    });
  } catch (error) {
    console.error("Get Countries Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch countries",
    });
  }
};
