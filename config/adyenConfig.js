const dotenv = require('dotenv');
const { Client, CheckoutAPI } = require('@adyen/api-library');

dotenv.config();

const ADYEN_API_KEY = process.env.ADYEN_API_KEY;
const ADYEN_MERCHANT_ACCOUNT = process.env.ADYEN_MERCHANT_ACCOUNT;
const ADYEN_HMAC_KEY = process.env.ADYEN_HMAC_KEY;
const ADYEN_CLIENT_KEY = process.env.ADYEN_CLIENT_KEY;

if (!ADYEN_API_KEY) {
    console.error("ERROR: ADYEN_API_KEY is not configured in .env file.");
    // process.exit(1); 
}
if (!ADYEN_MERCHANT_ACCOUNT) {
    console.error("ERROR: ADYEN_MERCHANT_ACCOUNT is not configured in .env file.");
    // process.exit(1);
}
if (!ADYEN_HMAC_KEY) {
    console.error("CRITICAL WARNING: ADYEN_HMAC_KEY is not configured in .env file. Webhook verification WILL BE INSECURE. Ensure this is set for testing and production.");
}

// New, simplified initialization for the latest Adyen library version
const client = new Client({
    apiKey: ADYEN_API_KEY,
    environment: 'TEST', // Explicitly set environment. Use 'LIVE' for production.
});

// CheckoutAPI is the main entry point for all checkout-related APIs
const checkout = new CheckoutAPI(client);

module.exports = {
    checkout, // Export the checkout instance
    ADYEN_MERCHANT_ACCOUNT,
    ADYEN_HMAC_KEY,
    ADYEN_CLIENT_KEY,
};