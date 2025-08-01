const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { checkout, ADYEN_MERCHANT_ACCOUNT } = require('../config/adyenConfig');
const { ordersDb, addTimestampsToDoc, getUpdateWithTimestamps } = require('../utils/db');

const router = express.Router();

/**
 * @route   POST /api/orders
 * @desc    Create a new payment order with Adyen
 * @access  Public
 * @body    { amount: { value: number, currency: string } }
 */
router.post('/', async (req, res) => {
    try {
        const { amount } = req.body; // Expecting amount = { value: 10000, currency: "USD" }

        if (!amount || !amount.value || !amount.currency) {
            return res.status(400).json({ error: 'Invalid request: amount (value and currency) is required.' });
        }

        const orderId = uuidv4(); // Internal order ID
        const orderRef = `ORDER-${orderId}`; // Unique reference for Adyen

        console.log(`Attempting to create order ${orderRef} for ${amount.value} ${amount.currency}`);

        const orderRequest = {
            merchantAccount: ADYEN_MERCHANT_ACCOUNT,
            amount: amount,
            reference: orderRef,
        };

        // Use the new checkout.orders.createOrder method
        const adyenOrderResponse = await checkout.OrdersApi.orders(orderRequest, { idempotencyKey: orderId });

        console.log(`Adyen /orders response for ${orderRef}:`, JSON.stringify(adyenOrderResponse, null, 2));

        const newOrder = {
            _id: orderId, // NeDB uses _id by default
            adyenOrderPspReference: adyenOrderResponse.pspReference,
            merchantReference: orderRef,
            status: 'open', // Initial status
            totalAmount: adyenOrderResponse.amount, // Amount from Adyen response
            remainingAmount: adyenOrderResponse.remainingAmount,
            currency: adyenOrderResponse.amount.currency,
            expiresAt: adyenOrderResponse.expiresAt, // If not provided in request, Adyen sets it
            orderDataHistory: [adyenOrderResponse.orderData], // Store initial orderData
            partialPaymentPspReferences: [],
        };

        await ordersDb.insertAsync(addTimestampsToDoc(newOrder));

        res.status(201).json({
            orderId: newOrder._id,
            adyenOrderPspReference: newOrder.adyenOrderPspReference,
            merchantReference: newOrder.merchantReference,
            status: newOrder.status,
            totalAmount: newOrder.totalAmount,
            remainingAmount: newOrder.remainingAmount,
            orderData: adyenOrderResponse.orderData, // Current orderData for next payment
            expiresAt: newOrder.expiresAt,
        });

    } catch (err) {
        console.error('Error creating Adyen order:', err);
        const errorMessage = err.message || 'Failed to create order.';
        const errorDetails = err.details || (err.response ? err.response.body : null);
        res.status(err.statusCode || 500).json({
            error: 'Adyen API Error',
            message: errorMessage,
            details: errorDetails,
            pspReference: err.pspReference
        });
    }
});

module.exports = router;