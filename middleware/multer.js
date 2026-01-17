const multer = require('multer');
const path = require('path');
const fs = require('fs');

// =======================
// ENSURE UPLOAD DIRECTORY EXISTS
// =======================
const uploadDir = path.join(__dirname, '..', 'uploads', 'queries');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// =======================
// STORAGE CONFIG
// =======================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },

  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/\s+/g, '_');
    const uniqueName = `${base}_${Date.now()}${ext}`;
    cb(null, uniqueName);
  }
});

// =======================
// FILE FILTER (SECURITY)
// =======================
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error('Invalid file type. Only PDF, DOC, DOCX, JPG, PNG are allowed'),
      false
    );
  }
};

// =======================
// MULTER INSTANCE
// =======================
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB
  }
});

module.exports = upload;
