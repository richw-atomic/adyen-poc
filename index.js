const express = require('express');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables (already called in adyenConfig.js, but good practice if other .env vars are used here)
dotenv.config();

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


// Import Routes
const orderRoutes = require('./routes/orders');
const sessionsRoutes = require('./routes/sessions');
const paymentRoutes = require('./routes/payments');
const webhookRoutes = require('./routes/webhooks');
const paymentMethodsRoutes = require('./routes/paymentMethods');

// Routes
app.get('/', (req, res) => {
    res.render('index', { clientKey: process.env.ADYEN_CLIENT_KEY || 'YOUR_ADYEN_CLIENT_KEY' });
});
app.get('/advanced/dropin', (req, res) => {
    res.render('advanced-dropin', { clientKey: process.env.ADYEN_CLIENT_KEY || 'YOUR_ADYEN_CLIENT_KEY' });
});
app.get('/sessions/dropin', (req, res) => {
    res.render('sessions-dropin', { clientKey: process.env.ADYEN_CLIENT_KEY || 'YOUR_ADYEN_CLIENT_KEY' });
});
app.get('/advanced/components', (req, res) => {
    res.render('advanced-component', { clientKey: process.env.ADYEN_CLIENT_KEY || 'YOUR_ADYEN_CLIENT_KEY' });
});
app.get('/sessions/components', (req, res) => {
    res.render('sessions-component', { clientKey: process.env.ADYEN_CLIENT_KEY || 'YOUR_ADYEN_CLIENT_KEY' });
});

app.use('/api/orders', orderRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/payment-methods', paymentMethodsRoutes);


// Basic Error Handling
app.use((err, req, res, next) => {
    console.error(`[${new Date().toISOString()}] ERROR:`, err.stack || err);
    res.status(500).json({ error: 'Something went wrong!', message: err.message });
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

module.exports = app; // For potential testing
