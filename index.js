const express = require('express');
const dotenv = require('dotenv');
const { Client, Config, CheckoutAPI } = require('@adyen/api-library');
const path = require('path');

// Load environment variables (already called in adyenConfig.js, but good practice if other .env vars are used here)
dotenv.config();

const { checkout, ADYEN_MERCHANT_ACCOUNT, ADYEN_HMAC_KEY } = require('./config/adyenConfig'); // Import Adyen checkout instance and specific vars

const app = express();
const port = process.env.PORT || 3000;

// Setup proxy
app.set('trust proxy', true); // Trust the first proxy (useful if behind a reverse proxy)

// Setup view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware for webhooks to get raw body for HMAC validation
app.use('/api/webhooks', express.raw({ type: 'application/json' }));

// Basic request logging middleware
// app.use((req, res, next) => {
//     console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
//     if (req.body && Object.keys(req.body).length > 0) {
//         console.log('Request Body:', JSON.stringify(req.body, null, 2));
//     }
//     next();
// });

// DB instances are now managed in utils/db.js
// const Datastore = require('nedb');
// const ordersDb = new Datastore();
// const paymentsDb = new Datastore();
// const tokensDb = new Datastore();

// Import Routes
const orderRoutes = require('./routes/orders');
const paymentRoutes = require('./routes/payments');
const webhookRoutes = require('./routes/webhooks');
const storedPaymentMethodsRoutes = require('./routes/storedPaymentMethods');

// IMPORTANT for Webhooks:
// If express.json() is used globally (like below), HMAC validation requiring the raw request body
// for webhooks needs special handling. Either:
// 1. Use `express.raw({ type: 'application/json' })` for the webhook route *before* this global `express.json()`.
// 2. Or, ensure the HMAC validation logic can correctly re-serialize the parsed req.body to match Adyen's signed string.
//    This is error-prone. Using the raw body is safer.
// For this POC, the HMAC in webhooks.js is a placeholder.

// Routes
app.get('/', (req, res) => {
    res.render('index', { clientKey: process.env.ADYEN_CLIENT_KEY || 'YOUR_ADYEN_CLIENT_KEY' });
});

app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/stored-payment-methods', storedPaymentMethodsRoutes);


// Basic Error Handling
app.use((err, req, res, next) => {
    console.error(`[${new Date().toISOString()}] ERROR:`, err.stack || err);
    res.status(500).json({ error: 'Something went wrong!', message: err.message });
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

module.exports = app; // For potential testing
