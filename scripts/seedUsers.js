require("dotenv").config();
const bcrypt = require("bcrypt");
const db = require("../config/db");

const USERS = [
  {
    full_name: "Writer One",
    email: "writer@a366.com",
    mobile_number: "9000000001",
    whatsapp: "9000000001",
    university: "A366 University",
    currency_code: "INR",
    password: "writer@123",
    role: "writer",
    country: "IN",
    referal_code: "WRITER-A366",
  },
  {
    full_name: "BDE One",
    email: "bde@a366.com",
    mobile_number: "9000000002",
    whatsapp: "9000000002",
    university: null,
    currency_code: "INR",
    password: "bde@123",
    role: "bde",
    country: "IN",
    referal_code: "BDE-A366",
  },
  {
    full_name: "Admin One",
    email: "admin@a366.com",
    mobile_number: "9000000003",
    whatsapp: "9000000003",
    university: null,
    currency_code: "INR",
    password: "admin@123",
    role: "admin",
    country: "IN",
    referal_code: "ADMIN-A366",
  }
];

async function seed() {
  try {
    for (const user of USERS) {
      const [exists] = await db.query(
        "SELECT user_id FROM users WHERE email = ?",
        [user.email]
      );

      if (exists.length) {
        console.log(`⚠️  ${user.email} already exists — skipped`);
        continue;
      }

      const password_hash = await bcrypt.hash(user.password, 10);

      await db.query(
        `INSERT INTO users 
        (full_name, email, mobile_number, whatsapp, university, currency_code, password_hash, role, is_active, country, referal_code, is_verified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1)`,
        [
          user.full_name,
          user.email,
          user.mobile_number,
          user.whatsapp,
          user.university,
          user.currency_code,
          password_hash,
          user.role,
          user.country,
          user.referal_code
        ]
      );

      console.log(`✅ Seeded ${user.role.toUpperCase()}: ${user.email}`);
    }

    process.exit();
  } catch (err) {
    console.error("❌ Seeding failed", err);
    process.exit(1);
  }
}

seed();
