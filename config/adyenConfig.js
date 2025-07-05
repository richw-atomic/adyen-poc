const dotenv = require('dotenv');
const { Config, Client, CheckoutAPI } = require('@adyen/api-library');

dotenv.config();

const ADYEN_API_KEY = process.env.ADYEN_API_KEY;
const ADYEN_MERCHANT_ACCOUNT = process.env.ADYEN_MERCHANT_ACCOUNT;
const ADYEN_HMAC_KEY = process.env.ADYEN_HMAC_KEY;
const ADYEN_CLIENT_KEY = process.env.ADYEN_CLIENT_KEY; // Though not used in backend directly for calls, good for consistency

if (!ADYEN_API_KEY) {
    console.error("ERROR: ADYEN_API_KEY is not configured in .env file.");
    // process.exit(1); // Or handle more gracefully depending on desired app behavior
}
if (!ADYEN_MERCHANT_ACCOUNT) {
    console.error("ERROR: ADYEN_MERCHANT_ACCOUNT is not configured in .env file.");
    // process.exit(1);
}
if (!ADYEN_HMAC_KEY) {
    console.error("CRITICAL WARNING: ADYEN_HMAC_KEY is not configured in .env file. Webhook verification WILL BE INSECURE and would fail with a real validator. Ensure this is set for testing and production.");
}


const adyenConfig = new Config();
adyenConfig.apiKey = ADYEN_API_KEY;
adyenConfig.merchantAccount = ADYEN_MERCHANT_ACCOUNT;
// Note: Environment for Adyen SDK (e.g., 'TEST' or 'LIVE') is typically inferred from the API key format
// or set via adyenConfig.setEnvironment('TEST'); if needed.
// For Checkout API, it's usually derived from the API key.

const client = new Client({ config: adyenConfig });
const checkout = new CheckoutAPI(client);

module.exports = {
    client,
    checkout,
    ADYEN_MERCHANT_ACCOUNT,
    ADYEN_HMAC_KEY,
    ADYEN_CLIENT_KEY,
    // It's generally better not to export the raw API key if not needed elsewhere
};
