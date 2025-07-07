const express = require('express');
const { checkout, ADYEN_MERCHANT_ACCOUNT } = require('../config/adyenConfig');
const { tokensDb } = require('../utils/db');

const router = express.Router();

/**
 * @route POST /api/payment-methods
 * @desc Get available payment methods for the payment request
 * @access Public
 */
router.post('/', async (req, res) => {
    try {
        const { amount } = req.body; // Expecting amount = { value: 10000, currency: "USD" }
        const paymentMethodsRequest = {
            merchantAccount: ADYEN_MERCHANT_ACCOUNT,
            amount: {
                currency: amount.currency,
                value: amount.value,
            },
        }
        const paymentMethods = await checkout.PaymentsApi.paymentMethods(paymentMethodsRequest, { idempotencyKey: "UUID" });
        res.status(200).json(paymentMethods);
    } catch (error) {
        console.error('Error fetching payment methods:', err);
        res.status(500).json({ error: 'Failed to fetch payment methods.', message: err.message });
    }
});

module.exports = router;
