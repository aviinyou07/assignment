exports.generateOtp = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

exports.getExpiryTime = () =>
  new Date(Date.now() + Number(process.env.OTP_EXPIRY_MINUTES || 5) * 60 * 1000);
