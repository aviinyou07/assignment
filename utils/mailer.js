const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: process.env.MAIL_SERVICE,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
});

exports.sendMail = async ({ to, subject, html }) => {
  await transporter.sendMail({
    from: `"A366" <${process.env.MAIL_FROM || process.env.MAIL_USER}>`,
    to,
    subject,
    html
  });
};
