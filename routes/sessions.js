const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { checkout, ADYEN_MERCHANT_ACCOUNT } = require('../config/adyenConfig');
const { sessionsDb, addTimestampsToDoc, getUpdateWithTimestamps } = require('../utils/db');

const router = express.Router();

/**
 * @route   POST /api/sessions
 * @desc    Create a new payment session with Adyen
 * @access  Public
 * @body    { amount: { value: number, currency: string } }
 */
router.post('/', async (req, res) => {
    try {
        const { amount, path } = req.body; // Expecting amount = { value: 10000, currency: "USD" } path = 'sessions/dropin' or 'sessions/component'

        if (!amount || !amount.value || !amount.currency) {
            return res.status(400).json({ error: 'Invalid request: amount (value and currency) is required.' });
        }

        const orderId = uuidv4(); // Internal order ID
        const orderRef = `ORDER-${orderId}`; // Unique reference for Adyen

        console.log(`Attempting to create session ${orderRef} for ${amount.value} ${amount.currency}`);

        const sessionRequest = {
            merchantAccount: ADYEN_MERCHANT_ACCOUNT,
            amount: amount,
            reference: orderRef,
            returnUrl: `${process.env.BASE_URL || 'http://localhost:3000'}/${path}`,
        };

        const adyenSessionsResponse = await checkout.PaymentsApi.sessions(sessionRequest, { idempotencyKey: orderId });

        console.log(`Adyen /sessions response for ${orderRef}:`, JSON.stringify(adyenSessionsResponse, null, 2));

        const newOrder = {
            _id: orderId, // NeDB uses _id by default
            sessionData: adyenSessionsResponse.sessionData,
            id: adyenSessionsResponse.id,
        };

        await sessionsDb.insertAsync(addTimestampsToDoc(newOrder));

        res.status(201).json({
            id: newOrder.id,
            sessionData: newOrder.sessionData,
        });

    } catch (err) {
        console.error('Error creating Adyen session:', err);
        const errorMessage = err.message || 'Failed to create session.';
        const errorDetails = err.details || (err.response ? err.response.body : null);
        res.status(err.statusCode || 500).json({
            error: 'Adyen API Error',
            message: errorMessage,
            details: errorDetails,
        });
    }
});

module.exports = router;