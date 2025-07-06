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

        console.log(checkout.OrdersApi);

        // Use the new checkout.orders.createOrder method
        const adyenOrderResponse = await checkout.OrdersApi.orders(orderRequest);

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

/**
 * @route   POST /api/orders/:orderId/cancel
 * @desc    Cancel an entire order with Adyen
 * @access  Public
 * @param   orderId (internal order ID)
 */
router.post('/:orderId/cancel', async (req, res) => {
    try {
        const { orderId } = req.params;

        const order = await ordersDb.findOneAsync({ _id: orderId });
        if (!order) {
            return res.status(404).json({ error: 'Order not found.' });
        }

        if (order.status === 'cancelled' || order.status === 'paid') {
            return res.status(400).json({ error: `Order status is '${order.status}', cannot cancel.` });
        }

        const cancelPayload = {
            merchantAccount: ADYEN_MERCHANT_ACCOUNT,
            order: {
                pspReference: order.adyenOrderPspReference,
                orderData: order.orderDataHistory[order.orderDataHistory.length - 1], // Latest orderData
            }
        };

        console.log(`Attempting to cancel Adyen order ${order.adyenOrderPspReference}:`, JSON.stringify(cancelPayload, null, 2));
        // Use the new checkout.orders.cancelOrder method
        const adyenCancelResponse = await checkout.ordersApi.cancelOrder(cancelPayload);
        console.log(`Adyen /orders/cancel response for ${order.adyenOrderPspReference}:`, JSON.stringify(adyenCancelResponse, null, 2));

        await ordersDb.updateAsync(
            { _id: orderId },
            getUpdateWithTimestamps({ $set: { status: 'cancelling' } })
        );

        res.status(200).json({
            orderId: order._id,
            adyenCancelPspReference: adyenCancelResponse.pspReference, // PSP reference of the cancellation request
            status: 'cancelling',
            message: `Order cancellation initiated. PSP Reference: ${adyenCancelResponse.pspReference}. Final status will be updated via webhook.`
        });

    } catch (err) {
        console.error('Error cancelling Adyen order:', err);
        const errorMessage = err.message || 'Failed to cancel order.';
        let errorDetails = null;
        if (err.response && err.response.body) {
            try {
                errorDetails = JSON.parse(err.response.body);
            } catch (parseError) {
                errorDetails = err.response.body;
            }
        } else {
            errorDetails = err.details;
        }
        res.status(err.statusCode || 500).json({
            error: 'Adyen API Error',
            message: errorMessage,
            details: errorDetails,
            pspReference: errorDetails ? errorDetails.pspReference : (err.pspReference || null)
        });
    }
});


module.exports = router;