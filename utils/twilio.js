const twilio = require('twilio');
const logger = require('./logger');

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_NUMBER,
  TWILIO_SMS_NUMBER,
  DEFAULT_COUNTRY_CODE
} = process.env;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
  logger.error('Twilio credentials not configured. TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN missing.');
}

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

function normalizePhoneNumber(to) {
  if (!to) throw new Error('Phone number is required');
  const trimmed = String(to).trim();
  if (trimmed.startsWith('+')) return trimmed;
  if (DEFAULT_COUNTRY_CODE) {
    const cc = String(DEFAULT_COUNTRY_CODE).replace(/^\+/, '');
    return `+${cc}${trimmed}`;
  }
  throw new Error('Phone number must be in E.164 format (start with +) or set DEFAULT_COUNTRY_CODE');
}

async function sendOTPWhatsApp(to, otp) {
  try {
    const phoneNumber = normalizePhoneNumber(to);
    if (!TWILIO_WHATSAPP_NUMBER) throw new Error('TWILIO_WHATSAPP_NUMBER not configured');

    const message = await client.messages.create({
      from: `whatsapp:${TWILIO_WHATSAPP_NUMBER}`,
      to: `whatsapp:${phoneNumber}`,
      body: `Your A366 verification code is: ${otp}. Valid for 10 minutes.`
    });

    logger.info(`WhatsApp OTP sent to ${phoneNumber}: ${message.sid}`);
    return message;
  } catch (error) {
    logger.error(`WhatsApp OTP send error: ${error.message || error}`);
    throw error;
  }
}


async function sendOTPSMS(to, otp) {
  try {
    const phoneNumber = normalizePhoneNumber(to);
    if (!TWILIO_SMS_NUMBER) throw new Error('TWILIO_SMS_NUMBER not configured');

    const message = await client.messages.create({
      from: TWILIO_SMS_NUMBER,
      to: phoneNumber,
      body: `Your A366 verification code is: ${otp}. Valid for 10 minutes.`
    });

    logger.info(`SMS OTP sent to ${phoneNumber}: ${message.sid}`);
    return message;
  } catch (error) {
    logger.error(`SMS OTP send error: ${error.message || error}`);
    throw error;
  }
}

module.exports = {
  client,
  sendOTPWhatsApp,
  sendOTPSMS
};
