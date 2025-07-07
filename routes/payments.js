const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { checkout, ADYEN_MERCHANT_ACCOUNT } = require('../config/adyenConfig');
const { ordersDb, paymentsDb, tokensDb, addTimestampsToDoc, getUpdateWithTimestamps } = require('../utils/db');


const router = express.Router();

/**
 * @route   POST /api/payments
 * @desc    Make a partial or full payment for an order
 * @access  Public
 */
router.post('/', async (req, res) => {
    try {
        const { orderId, amount, paymentMethod, storePaymentMethod, shopperReference, browserInfo, returnUrl } = req.body;

        if (!orderId || !amount || !amount.value || !amount.currency || !paymentMethod) {
            return res.status(400).json({ error: 'Invalid request: orderId, amount (value and currency), and paymentMethod are required.' });
        }

        if (storePaymentMethod && !shopperReference) {
            return res.status(400).json({ error: 'shopperReference is required when storePaymentMethod is true.' });
        }

        const order = await ordersDb.findOneAsync({ _id: orderId });
        if (!order) {
            return res.status(404).json({ error: 'Order not found.' });
        }

        if (order.status !== 'open' && order.status !== 'processing') {
             return res.status(400).json({ error: `Order status is '${order.status}', cannot make further payments.` });
        }

        if (amount.value > order.remainingAmount.value) {
            return res.status(400).json({ error: `Payment amount ${amount.value} exceeds remaining order amount ${order.remainingAmount.value}.`});
        }
        if (amount.currency !== order.currency) {
            return res.status(400).json({ error: `Payment currency ${amount.currency} does not match order currency ${order.currency}.`});
        }

        const paymentId = uuidv4();
        const paymentMerchantRef = `PAYMENT-${paymentId}`;
        const paymentPayload = {
            merchantAccount: ADYEN_MERCHANT_ACCOUNT,
            amount: amount,
            reference: paymentMerchantRef,
            paymentMethod: paymentMethod,
            order: {
                pspReference: order.adyenOrderPspReference,
                orderData: order.orderDataHistory[order.orderDataHistory.length - 1],
            },
            authenticationData: {
                threeDSRequestData: {
                    nativeThreeDS: 'preferred',
                },
            },
            browserInfo: browserInfo,
            returnUrl,
            channel: 'Web',
            origin: `${req.protocol}://${req.get('host')}`
        };

        if (storePaymentMethod) {
            paymentPayload.shopperReference = shopperReference;
            paymentPayload.shopperInteraction = 'Ecommerce';
            paymentPayload.recurringProcessingModel = 'CardOnFile';
        }

        if (paymentMethod.type === 'scheme' && paymentMethod.storedPaymentMethodId) {
            paymentPayload.shopperInteraction = 'Ecommerce';
            paymentPayload.recurringProcessingModel = 'CardOnFile';
            if (shopperReference) paymentPayload.shopperReference = shopperReference;
        }

        console.log(`Attempting Adyen /payments for order ${order.merchantReference}, payment ${paymentMerchantRef}`);
        
        // Use the new checkout.paymentsApi.payment method
        const adyenPaymentResponse = await checkout.PaymentsApi.payments(paymentPayload);
        
        console.log(`Adyen /payments response for ${paymentMerchantRef}:`, adyenPaymentResponse.resultCode);

        const newPayment = {
            _id: paymentId,
            adyenPaymentPspReference: adyenPaymentResponse.pspReference,
            orderId: order._id,
            merchantReference: paymentMerchantRef,
            amount: amount,
            status: adyenPaymentResponse.resultCode || 'pendingAction',
            paymentMethodType: paymentMethod.type,
            action: adyenPaymentResponse.action || null,
            resultCode: adyenPaymentResponse.resultCode || null,
            refusalReason: adyenPaymentResponse.refusalReason || null,
            shopperReference: storePaymentMethod ? shopperReference : null,
            clientReturnUrl: returnUrl,
        };
        await paymentsDb.insertAsync(addTimestampsToDoc(newPayment));

        let updatedOrderData = order.orderDataHistory[order.orderDataHistory.length - 1];
        let updatedRemainingAmount = order.remainingAmount;

        if (adyenPaymentResponse.order) {
            updatedOrderData = adyenPaymentResponse.order.orderData;
            updatedRemainingAmount = adyenPaymentResponse.order.remainingAmount;

            await ordersDb.updateAsync(
                { _id: order._id },
                getUpdateWithTimestamps({
                    $set: {
                        remainingAmount: updatedRemainingAmount,
                        status: 'processing',
                    },
                    $push: { orderDataHistory: updatedOrderData }
                })
            );
        }

        if (storePaymentMethod &&
            (adyenPaymentResponse.resultCode === 'Authorised' || adyenPaymentResponse.resultCode === 'Received') &&
            adyenPaymentResponse.additionalData && adyenPaymentResponse.additionalData.recurringDetailReference) {

            const tokenData = {
                _id: uuidv4(),
                shopperReference: shopperReference,
                adyenRecurringDetailReference: adyenPaymentResponse.additionalData.recurringDetailReference,
                cardBrand: adyenPaymentResponse.additionalData['paymentMethodVariant'] || paymentMethod.type,
                cardSummary: adyenPaymentResponse.additionalData['cardSummary'] || 'N/A',
                paymentMethodType: paymentMethod.type,
            };
            await tokensDb.insertAsync(addTimestampsToDoc(tokenData));
            console.log(`Token ${tokenData.adyenRecurringDetailReference} stored for shopper ${shopperReference}`);
        }

        res.status(200).json({
            paymentId: newPayment._id,
            orderId: order._id,
            pspReference: adyenPaymentResponse.pspReference,
            resultCode: adyenPaymentResponse.resultCode,
            action: adyenPaymentResponse.action,
            refusalReason: adyenPaymentResponse.refusalReason,
            orderStatus: {
                remainingAmount: updatedRemainingAmount,
                orderData: updatedOrderData,
            },
            message: "Payment initiated. Further action may be required."
        });

    } catch (err) {
        console.error('Error making Adyen payment:', err);
        const errorMessage = err.message || 'Failed to process payment.';
        const errorDetails = err.details || null;
        const statusCode = err.statusCode || 500;

        res.status(statusCode).json({
            error: 'Adyen API Error',
            message: errorMessage,
            details: errorDetails,
            pspReference: err.pspReference || null
        });
    }
});

/**
 * @route   POST /api/payments/details/:paymentId
 * @desc    Handle the redirect from Adyen after 3DS or other challenges
 */
router.all('/details/:paymentId', async (req, res) => {
    console.log(`Request received with method ${req.method} for /payments/details/${req.params.paymentId}`);
    try {
        const internalPaymentId = req.params.paymentId;
        const detailsFromAdyen = req.body.details || (req.body.payload ? { payload: req.body.payload } : req.body);

        if (!internalPaymentId || !detailsFromAdyen || Object.keys(detailsFromAdyen).length === 0) {
            return res.status(400).json({ error: 'Missing paymentId or details from Adyen redirect.' });
        }

        const paymentAttempt = await paymentsDb.findOneAsync({ _id: internalPaymentId });
        if (!paymentAttempt) {
            return res.status(404).json({ error: 'Payment attempt not found.' });
        }
        
        const order = await ordersDb.findOneAsync({ _id: paymentAttempt.orderId });
         if (!order) {
            return res.status(404).json({ error: 'Associated order not found for payment details submission.' });
        }

        const paymentDetailsPayload = {
            paymentData: paymentAttempt.action ? paymentAttempt.action.paymentData : undefined,
            details: detailsFromAdyen,
        };

        console.log(`Attempting Adyen /payments/details for payment ${internalPaymentId}:`, JSON.stringify(paymentDetailsPayload, null, 2));
        
        // Use the new checkout.paymentsApi.submitPaymentDetails method
        const adyenDetailsResponse = await checkout.PaymentsApi.paymentsDetails(paymentDetailsPayload);
        
        console.log(`Adyen /payments/details response for payment ${internalPaymentId}:`, JSON.stringify(adyenDetailsResponse, null, 2));

        await paymentsDb.updateAsync(
            { _id: internalPaymentId },
            getUpdateWithTimestamps({
                $set: {
                    status: adyenDetailsResponse.resultCode || 'pendingWebhook',
                    resultCode: adyenDetailsResponse.resultCode,
                    refusalReason: adyenDetailsResponse.refusalReason,
                    adyenPaymentPspReference: adyenDetailsResponse.pspReference || paymentAttempt.adyenPaymentPspReference,
                    action: null,
                }
            })
        );

        let updatedOrderData = order.orderDataHistory[order.orderDataHistory.length - 1];
        let updatedRemainingAmount = order.remainingAmount;

        if (adyenDetailsResponse.order) {
            updatedOrderData = adyenDetailsResponse.order.orderData;
            updatedRemainingAmount = adyenDetailsResponse.order.remainingAmount;

            await ordersDb.updateAsync(
                { _id: order._id },
                getUpdateWithTimestamps({
                    $set: {
                        remainingAmount: updatedRemainingAmount,
                    },
                    $push: { orderDataHistory: updatedOrderData }
                })
            );
        }

        if (paymentAttempt.shopperReference &&
            (adyenDetailsResponse.resultCode === 'Authorised' || adyenDetailsResponse.resultCode === 'Received') &&
            adyenDetailsResponse.additionalData && adyenDetailsResponse.additionalData.recurringDetailReference) {

            const existingToken = await tokensDb.findOneAsync({
                shopperReference: paymentAttempt.shopperReference,
                adyenRecurringDetailReference: adyenDetailsResponse.additionalData.recurringDetailReference
            });

            if (!existingToken) {
                const tokenData = {
                    _id: uuidv4(),
                    shopperReference: paymentAttempt.shopperReference,
                    adyenRecurringDetailReference: adyenDetailsResponse.additionalData.recurringDetailReference,
                    cardBrand: adyenDetailsResponse.additionalData['paymentMethodVariant'] || paymentAttempt.paymentMethodType,
                    cardSummary: adyenDetailsResponse.additionalData['cardSummary'] || 'N/A',
                    paymentMethodType: paymentAttempt.paymentMethodType,
                };
                await tokensDb.insertAsync(addTimestampsToDoc(tokenData));
                console.log(`Token ${tokenData.adyenRecurringDetailReference} stored for shopper ${paymentAttempt.shopperReference} after /details call.`);
            }
        }

        res.status(200).json({
            paymentId: internalPaymentId,
            orderId: paymentAttempt.orderId,
            pspReference: adyenDetailsResponse.pspReference,
            resultCode: adyenDetailsResponse.resultCode,
            refusalReason: adyenDetailsResponse.refusalReason,
            orderStatus: {
                remainingAmount: updatedRemainingAmount,
                orderData: updatedOrderData,
            },
            message: "Payment details submitted. Final status will be confirmed via webhook."
        });

    } catch (err) {
        console.error('Error processing Adyen payment details:', err);
        const errorMessage = err.message || 'Failed to process payment details.';
        const errorDetails = err.details || null;
        const statusCode = err.statusCode || 500;

        res.status(statusCode).json({
            error: 'Adyen API Error',
            message: errorMessage,
            details: errorDetails,
            pspReference: err.pspReference || null
        });
    }
});

module.exports = router;