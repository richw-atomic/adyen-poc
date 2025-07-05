const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { checkout, ADYEN_MERCHANT_ACCOUNT } = require('../config/adyenConfig');
const { ordersDb, paymentsDb, tokensDb, addTimestampsToDoc, getUpdateWithTimestamps } = require('../utils/db');

const router = express.Router();

/**
 * @route   POST /api/payments
 * @desc    Make a partial or full payment for an order
 * @access  Public
 * @body    { orderId: string, amount: { value: number, currency: string }, paymentMethod: object, (optional) storePaymentMethod: boolean, (optional) shopperReference: string for tokenization, (optional) browserInfo: object for 3DS, (optional) returnUrl: string for client post-3DS redirect }
 */
router.post('/', async (req, res) => {
    try {
        // For 3DS testing with Postman, browserInfo should be like:
        // { "userAgent": "Mozilla/5.0...", "acceptHeader": "application/json, text/plain, */*", "language": "en-US", "screenWidth": 1920, "screenHeight": 1080, "timeZoneOffset": 0, "colorDepth": 24 }
        const { orderId, amount, paymentMethod, storePaymentMethod, shopperReference, browserInfo, returnUrl: clientReturnUrl } = req.body;

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

        if (order.status !== 'open' && order.status !== 'processing') { // Assuming 'processing' if some payments made
             return res.status(400).json({ error: `Order status is '${order.status}', cannot make further payments.` });
        }

        if (amount.value > order.remainingAmount.value) {
            return res.status(400).json({ error: `Payment amount ${amount.value} exceeds remaining order amount ${order.remainingAmount.value}.`});
        }
        if (amount.currency !== order.currency) {
            return res.status(400).json({ error: `Payment currency ${amount.currency} does not match order currency ${order.currency}.`});
        }

        const paymentId = uuidv4();
        const paymentMerchantRef = `PAYMENT-${paymentId}-FOR-ORDER-${order.merchantReference}`;
        // Construct the returnUrl for Adyen, which should point back to our server for /payments/details
        // The actual clientReturnUrl (where the user's browser ends up) will be handled after Adyen redirects back to us.
        const serverReturnUrl = `${req.protocol}://${req.get('host')}/api/payments/details/${paymentId}`;


        const paymentPayload = {
            merchantAccount: ADYEN_MERCHANT_ACCOUNT,
            amount: amount,
            reference: paymentMerchantRef,
            paymentMethod: paymentMethod, // e.g., { type: "scheme", encryptedCardNumber: "...", ... } or { type: "scheme", storedPaymentMethodId: "..." }
            order: {
                pspReference: order.adyenOrderPspReference,
                orderData: order.orderDataHistory[order.orderDataHistory.length - 1], // Get the latest orderData
            },
            // Required for 3D Secure 2
            authenticationData: {
                threeDSRequestData: {
                    nativeThreeDS: 'preferred', // or 'required' if you only want native
                },
            },
            browserInfo: browserInfo, // Required for some 3DS flows e.g. { userAgent: "...", acceptHeader: "...", language: "...", screenHeight: ..., screenWidth: ..., timeZoneOffset: ..., colorDepth: ... }
            returnUrl: serverReturnUrl, // Adyen will redirect here after 3DS / challenge
            channel: 'Web', // Required for some 3DS scenarios
            origin: `${req.protocol}://${req.get('host')}` // Your website's origin
        };

        if (storePaymentMethod) {
            paymentPayload.storePaymentMethod = true;
            paymentPayload.shopperReference = shopperReference;
            paymentPayload.shopperInteraction = 'Ecommerce'; // Or 'ContAuth' for recurring, 'Moto' etc.
            paymentPayload.recurringProcessingModel = 'CardOnFile'; // Or 'Subscription', 'UnscheduledCardOnFile'
        }

        if (paymentMethod.type === 'scheme' && paymentMethod.storedPaymentMethodId) {
             // If using a token, shopperInteraction and recurringProcessingModel are often needed.
            paymentPayload.shopperInteraction = 'Ecommerce'; // Or ContAuth if it's a recurring payment initiated by merchant
            paymentPayload.recurringProcessingModel = 'CardOnFile'; // Or the appropriate model
            if (shopperReference) paymentPayload.shopperReference = shopperReference; // Required when making a payment with a token
        }


        console.log(`Attempting Adyen /payments for order ${order.merchantReference}, payment ${paymentMerchantRef}:`, JSON.stringify(paymentPayload, null, 2));
        const adyenPaymentResponse = await checkout.payments(paymentPayload);
        console.log(`Adyen /payments response for ${paymentMerchantRef}:`, JSON.stringify(adyenPaymentResponse, null, 2));

        // Store payment attempt
        const newPayment = {
            _id: paymentId,
            adyenPaymentPspReference: adyenPaymentResponse.pspReference, // May be null if action is required first
            orderId: order._id,
            merchantReference: paymentMerchantRef,
            amount: amount,
            status: adyenPaymentResponse.resultCode || 'pendingAction', // Authorised, Refused, Error, ChallengeShopper, RedirectShopper
            paymentMethodType: paymentMethod.type,
            action: adyenPaymentResponse.action || null,
            resultCode: adyenPaymentResponse.resultCode || null,
            refusalReason: adyenPaymentResponse.refusalReason || null,
            shopperReference: storePaymentMethod ? shopperReference : null,
            clientReturnUrl: clientReturnUrl, // Store the original client return URL to use after /details
            // Timestamps will be added by addTimestampsToDoc
        };
        await paymentsDb.insertAsync(addTimestampsToDoc(newPayment));

        // Update order with new remaining amount and orderData from payment response
        // This happens regardless of whether the payment is immediately Authorised or requires an action
        // The actual "paid" status of the order is confirmed via AUTHORISATION webhook.
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
                        status: 'processing', // Mark as processing as a payment has been attempted
                    },
                    $push: { orderDataHistory: updatedOrderData }
                })
            );
        }


        // Handle tokenization if payment was successful and token was created
        if (storePaymentMethod &&
            (adyenPaymentResponse.resultCode === 'Authorised' || adyenPaymentResponse.resultCode === 'Received') && // Received for some APMs
            adyenPaymentResponse.additionalData && adyenPaymentResponse.additionalData.recurringDetailReference) {

            const tokenData = {
                _id: uuidv4(),
                shopperReference: shopperReference,
                adyenRecurringDetailReference: adyenPaymentResponse.additionalData.recurringDetailReference,
                cardBrand: adyenPaymentResponse.additionalData['paymentMethodVariant'] || paymentMethod.type,
                cardSummary: adyenPaymentResponse.additionalData['cardSummary'] || 'N/A', // e.g., last 4 digits
                paymentMethodType: paymentMethod.type, // e.g. "scheme"
                    // creationDate will be set by addTimestampsToDoc (as createdAt)
                // Potentially store more from additionalData if useful (e.g., expiryDate, cardBin)
            };
                await tokensDb.insertAsync(addTimestampsToDoc(tokenData));
            console.log(`Token ${tokenData.adyenRecurringDetailReference} stored for shopper ${shopperReference}`);
        }

        res.status(200).json({
            paymentId: newPayment._id,
            orderId: order._id,
            pspReference: adyenPaymentResponse.pspReference, // Adyen's PSP reference for this specific payment attempt
            resultCode: adyenPaymentResponse.resultCode,
            action: adyenPaymentResponse.action, // If 3DS or redirect is needed
            refusalReason: adyenPaymentResponse.refusalReason,
            orderStatus: { // Current status of the order after this payment attempt
                remainingAmount: updatedRemainingAmount,
                orderData: updatedOrderData, // The newest orderData
            },
            message: "Payment initiated. Further action may be required."
        });

    } catch (err) {
        console.error('Error making Adyen payment:', err);
        const errorMessage = err.message || 'Failed to process payment.';
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

/**
 * @route   POST /api/payments/details/:paymentId
 * @desc    Handle the redirect from Adyen after 3DS or other challenges (submits /payments/details)
 * @access  Public
 * @body    { details: object } (from Adyen redirect query/body parameters like MD, PaRes or threeDSResult) OR { payload: string } for some redirects
 */
router.post('/details/:paymentId', async (req, res) => {
    try {
        const internalPaymentId = req.params.paymentId;
        const detailsFromAdyen = req.body.details || (req.body.payload ? { payload: req.body.payload } : req.body) ; // Adyen sends details in various ways

        if (!internalPaymentId || !detailsFromAdyen || Object.keys(detailsFromAdyen).length === 0) {
            return res.status(400).json({ error: 'Missing paymentId or details from Adyen redirect.' });
        }

        const paymentAttempt = await paymentsDb.findOneAsync({ _id: internalPaymentId });
        if (!paymentAttempt) {
            return res.status(404).json({ error: 'Payment attempt not found.' });
        }
        // Retrieve the original order to get the latest orderData if needed by /payments/details
        // Though typically /payments/details uses paymentData from the original /payments response action object
        const order = await ordersDb.findOneAsync({ _id: paymentAttempt.orderId });
         if (!order) {
            return res.status(404).json({ error: 'Associated order not found for payment details submission.' });
        }


        const paymentDetailsPayload = {
            paymentData: paymentAttempt.action ? paymentAttempt.action.paymentData : undefined, // From original /payments response action
            details: detailsFromAdyen, // Data from Adyen's redirect (e.g., MD, PaRes or threeDSResult)
        };

        console.log(`Attempting Adyen /payments/details for payment ${internalPaymentId}:`, JSON.stringify(paymentDetailsPayload, null, 2));
        const adyenDetailsResponse = await checkout.paymentsDetails(paymentDetailsPayload);
        console.log(`Adyen /payments/details response for payment ${internalPaymentId}:`, JSON.stringify(adyenDetailsResponse, null, 2));

        // Update our payment record
        await paymentsDb.updateAsync(
            { _id: internalPaymentId },
            { $set: {
                getUpdateWithTimestamps({ $set: {
                    status: adyenDetailsResponse.resultCode || 'pendingWebhook',
                    resultCode: adyenDetailsResponse.resultCode,
                    refusalReason: adyenDetailsResponse.refusalReason,
                    adyenPaymentPspReference: adyenDetailsResponse.pspReference || paymentAttempt.adyenPaymentPspReference, // Update if it was missing
                    action: null, // Clear previous action
                }})
            );

        // Update order with new remaining amount and orderData from /payments/details response if available
        // The final confirmation usually comes from AUTHORISATION webhook.
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
                        // status will be updated by webhook
                    },
                    $push: { orderDataHistory: updatedOrderData }
                })
            );
        }

        // Handle tokenization if payment was successful and token was created (can also happen after /details)
        if (paymentAttempt.shopperReference && // implies storePaymentMethod was true
            (adyenDetailsResponse.resultCode === 'Authorised' || adyenDetailsResponse.resultCode === 'Received') &&
            adyenDetailsResponse.additionalData && adyenDetailsResponse.additionalData.recurringDetailReference) {

            // Check if token already exists for this shopperReference and recurringDetailReference to avoid duplicates
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
                    // creationDate will be set by addTimestampsToDoc (as createdAt)
                };
                await tokensDb.insertAsync(addTimestampsToDoc(tokenData));
                console.log(`Token ${tokenData.adyenRecurringDetailReference} stored for shopper ${paymentAttempt.shopperReference} after /details call.`);
            }
        }

        // Redirect client if clientReturnUrl was provided
        if (paymentAttempt.clientReturnUrl) {
            // Append result to the clientReturnUrl (or use a more structured approach)
            const redirectUrl = new URL(paymentAttempt.clientReturnUrl);
            redirectUrl.searchParams.append('paymentId', internalPaymentId);
            redirectUrl.searchParams.append('resultCode', adyenDetailsResponse.resultCode);
            if (adyenDetailsResponse.pspReference) {
                 redirectUrl.searchParams.append('pspReference', adyenDetailsResponse.pspReference);
            }
            if (adyenDetailsResponse.refusalReason) {
                redirectUrl.searchParams.append('refusalReason', adyenDetailsResponse.refusalReason);
            }
            console.log(`Redirecting client to: ${redirectUrl.toString()}`);
            return res.redirect(redirectUrl.toString());
        }


        // If no clientReturnUrl, just respond with JSON
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

        // Try to redirect to clientReturnUrl with error if available
        const internalPaymentId = req.params.paymentId;
        if (internalPaymentId) {
            const paymentAttempt = await paymentsDb.findOneAsync({ _id: internalPaymentId });
            if (paymentAttempt && paymentAttempt.clientReturnUrl) {
                const redirectUrl = new URL(paymentAttempt.clientReturnUrl);
                redirectUrl.searchParams.append('paymentId', internalPaymentId);
                redirectUrl.searchParams.append('resultCode', 'Error');
                redirectUrl.searchParams.append('errorMessage', errorMessage);
                console.log(`Redirecting client to error URL: ${redirectUrl.toString()}`);
                return res.redirect(redirectUrl.toString());
            }
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
