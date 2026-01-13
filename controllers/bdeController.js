const db = require('../config/db');

exports.getAllBDEs = async (req, res) => {
    try {
        const [rows] = await db.query(
            `
            SELECT 
                user_id AS id,
                full_name AS name
            FROM users
            WHERE role = 'bde'
              AND is_active = 1
            ORDER BY full_name ASC
            `
        );

        res.status(200).json({
            success: true,
            count: rows.length,
            data: rows
        });

    } catch (error) {
        console.error('🔥 Error fetching BDEs:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch BDE list'
        });
    }
};
