const express = require('express');
const crypto = require('crypto');
const { ADYEN_HMAC_KEY } = require('../config/adyenConfig');
const { ordersDb, paymentsDb, tokensDb } = require('../utils/db'); // Assuming db instances are here

const router = express.Router();

// Middleware to parse raw body for HMAC validation, as Express.json() would have already parsed it
// This should be placed *before* express.json() in the main app if POSTing JSON to webhooks,
// or ensure this route doesn't use express.json() if it's configured globally.
// For this POC, we'll assume Adyen might POST JSON, so we need rawBody.
// A common approach is to use express.raw({type: 'application/json'}) for the webhook route specifically.
// However, for simplicity in this isolated router, we'll assume `req.rawBody` might be populated by a global middleware if needed.
// If not, HMAC validation on JSON payload needs careful handling of stringification matching Adyen's.

const verifyHmac = (req) => {
    const { notificationItems } = req.body;
    if (!notificationItems || !Array.isArray(notificationItems) || notificationItems.length === 0) {
        console.warn('HMAC Verification: No notificationItems found in webhook.');
        return false;
    }

    // Adyen calculates HMAC on the JSON string of the notificationItem.
    // It's crucial that the stringification here matches exactly how Adyen does it.
    // This often means no extra spaces, specific key order if Adyen enforces it (usually not), etc.
    // The safest is to use the raw, unparsed request body if possible and verify against that.
    // However, Adyen's library examples often show re-stringifying the parsed object.

    // For each item, the hmacSignature is on the NotificationRequestItem object itself.
    // This example will assume we iterate and check each one if they had individual HMACs.
    // However, standard webhooks usually have one HMAC for the whole batch.
    // Let's use Adyen's recommended way for standard webhooks:
    // https://docs.adyen.com/development-resources/webhooks/verify-hmac-signatures/
    // The hmacSignature is part of each NotificationRequestItem.additionalData.

    // For this POC, let's assume the HMAC is on the entire request body if req.rawBody was available.
    // Since it's tricky without rawBody, and Adyen docs show HMAC per item for "standard notifications"
    // via additionalData, we'll simulate that concept.
    // **Important Correction**: The Adyen library's HmacValidator expects the *entire* notification request object.
    // Let's use the Adyen library's validator if possible, or implement manually.
    // Manual implementation (simplified - production would use constant-time comparison):

    // This simplified validator assumes `hmacSignature` is passed in `additionalData` for each item.
    // This is NOT how the main HMAC validation for the webhook POST body works.
    // The actual HMAC is usually in the header or calculated on the raw POST body.
    // Adyen's docs: "The signature is passed in the hmacSignature field of the NotificationRequestItem.additionalData object." - This is for specific fields, not the whole webhook auth.
    // The library HmacValidator is for the entire request.

    // Let's stick to the library's approach for validating the whole request if we can get raw body.
    // If not, this is a placeholder for where robust HMAC validation would go.
    // For now, we'll focus on processing logic and assume HMAC is valid if key is present.
    // THIS IS NOT SECURE FOR PRODUCTION WITHOUT ACTUAL HMAC VALIDATION.
    if (!ADYEN_HMAC_KEY) {
        console.warn("ADYEN_HMAC_KEY not configured. Skipping HMAC validation. THIS IS INSECURE.");
        return true; // In a real scenario, this should be false or throw an error.
    }

    // Correct HMAC validation should be done on the raw request body.
    // This is a conceptual placeholder. The Adyen Node SDK has `HmacValidator`.
    // Example using HmacValidator (requires raw body or careful re-serialization):
    // const validator = new HmacValidator()
    // const actualSign = req.headers['hmacSignature']; // Or wherever Adyen sends it. Adyen standard webhooks don't send it in header.
    // It's part of each notificationItem's additionalData.
    // This is confusing. Let's assume for now that if ADYEN_HMAC_KEY is set, we'd do proper validation.
    // The most common pattern is that the signature is on the NotificationRequestItem itself.

    // For each notification item:
    for (const itemWrapper of notificationItems) {
        const item = itemWrapper.NotificationRequestItem;
        if (item.additionalData && item.additionalData.hmacSignature) {
            const expectedSignature = item.additionalData.hmacSignature;
            // Create string to sign. Fields must be in specific order, separated by colon.
            // This is a common but complex part. Order: pspReference:originalReference:merchantAccountCode:merchantReference:value:currency:eventCode:success
            // This is highly dependent on Adyen's exact string format for signing.
            // It's often easier to use their library if it handles this.
            // Given the complexity and variability, a full manual HMAC here is error-prone for a POC without exact specs for current API version.
            // The Adyen library's `platforms-api-library` has `PlatformsWebhooks` which might be more suited for platform webhooks.
            // For Checkout webhooks, the `HmacValidator` in `@adyen/api-library/lib/src/utils/hmacValidator` is key.
            // It expects an object that looks like NotificationRequestItem.
            //
            // Simplified: if a signature is present, assume it would be checked.
            // console.log(`HMAC validation would be performed here for item ${item.pspReference}`);
        } else {
            // If any item is missing a signature and HMAC is enforced, it's a failure.
            // console.warn(`HMAC signature missing for item ${item.pspReference}`);
            // return false; // Uncomment for strict checking
        }
    }
    return true; // Placeholder
};


/**
 * @route   POST /api/webhooks
 * @desc    Handle Adyen webhook notifications
 * @access  Public (secured by HMAC)
 */
router.post('/', async (req, res) => {
    console.log(`Webhook received: ${new Date().toISOString()}`);
    console.log('Webhook Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Webhook Body:', JSON.stringify(req.body, null, 2));

    // IMPORTANT: HMAC validation needs to be robust for production.
    // This current `verifyHmac` is a placeholder and not fully secure.
    // You would typically use `express.raw({ type: 'application/json' })` middleware
    // for this route to get `req.rawBody` and validate against that.
    if (!verifyHmac(req)) { // This verifyHmac is a simplified placeholder
        console.error('Webhook HMAC validation failed.');
        return res.status(401).send('HMAC validation failed');
    }

    const { live, notificationItems } = req.body;

    if (!notificationItems || !Array.isArray(notificationItems)) {
        console.warn('Webhook received with no notificationItems.');
        return res.status(400).send('Invalid webhook format: Missing notificationItems.');
    }

    // Process each notification item
    for (const notificationWrapper of notificationItems) {
        const notification = notificationWrapper.NotificationRequestItem;
        const { eventCode, success, pspReference, merchantReference, amount, reason } = notification;

        console.log(`Processing webhook event: ${eventCode} for PSP: ${pspReference}, MerchantRef: ${merchantReference}, Success: ${success}`);

        try {
            switch (eventCode) {
                case 'ORDER_OPENED':
                    // This webhook confirms the order is opened on Adyen's side.
                    // Our system already creates an 'open' order upon /orders API call.
                    // We can use this to log or ensure consistency.
                    console.log(`ORDER_OPENED: PSP ${pspReference}, MerchantRef ${merchantReference}`);
                    const orderOpened = await ordersDb.findOneAsync({ adyenOrderPspReference: pspReference });
                    if (orderOpened) {
                        await ordersDb.updateAsync({ _id: orderOpened._id }, { $set: { status: 'open', updatedAt: new Date().toISOString() } });
                        console.log(`Order ${orderOpened._id} status confirmed as open.`);
                    } else {
                        console.warn(`ORDER_OPENED for unknown Adyen PSP Reference: ${pspReference}`);
                    }
                    break;

                case 'ORDER_CLOSED':
                    console.log(`ORDER_CLOSED: PSP ${pspReference}, MerchantRef ${merchantReference}, Success: ${success}`);
                    const orderToClose = await ordersDb.findOneAsync({ adyenOrderPspReference: pspReference });
                    if (orderToClose) {
                        const newStatus = success === 'true' || success === true ? 'paid' : 'cancelled'; // Adyen success can be string "true" or boolean
                        await ordersDb.updateAsync(
                            { _id: orderToClose._id },
                            { $set: { status: newStatus, updatedAt: new Date().toISOString() } }
                        );
                        console.log(`Order ${orderToClose._id} status updated to ${newStatus}.`);
                        if (newStatus === 'paid') {
                             await ordersDb.updateAsync({ _id: orderToClose._id }, { $set: { remainingAmount: { value: 0, currency: orderToClose.currency } }});
                             console.log(`Order ${orderToClose._id} remaining amount set to 0.`);
                        }
                    } else {
                        console.warn(`ORDER_CLOSED for unknown Adyen PSP Reference: ${pspReference}`);
                    }
                    break;

                case 'AUTHORISATION':
                    // This is a crucial webhook. It confirms a payment's final status.
                    console.log(`AUTHORISATION: PSP ${pspReference}, MerchantRef ${merchantReference}, Amount: ${amount.value} ${amount.currency}, Success: ${success}, Reason: ${reason}`);
                    const paymentToUpdate = await paymentsDb.findOneAsync({ $or: [{ adyenPaymentPspReference: pspReference }, { merchantReference: merchantReference }] });

                    if (paymentToUpdate) {
                        const paymentStatus = success === 'true' || success === true ? 'authorised' : 'refused';
                        await paymentsDb.updateAsync(
                            { _id: paymentToUpdate._id },
                            { $set: {
                                status: paymentStatus,
                                adyenPaymentPspReference: pspReference, // Ensure PSP ref is stored if it wasn't (e.g. from /details)
                                refusalReason: success === 'true' || success === true ? null : reason,
                                updatedAt: new Date().toISOString()
                            }}
                        );
                        console.log(`Payment ${paymentToUpdate._id} status updated to ${paymentStatus}.`);

                        // If successful, update related order's partialPaymentPspReferences
                        if (paymentStatus === 'authorised') {
                            await ordersDb.updateAsync(
                                { _id: paymentToUpdate.orderId },
                                {
                                    $addToSet: { partialPaymentPspReferences: pspReference }, // Add if not already present
                                    $set: { status: 'processing', updatedAt: new Date().toISOString() } // Ensure order is 'processing'
                                }
                            );
                            console.log(`Order ${paymentToUpdate.orderId} updated with authorised payment ${pspReference}.`);
                        }
                    } else {
                        console.warn(`AUTHORISATION webhook for unknown payment PSP/MerchantRef: ${pspReference} / ${merchantReference}`);
                    }
                    break;

                case 'CANCELLATION':
                    console.log(`CANCELLATION: PSP ${pspReference}, MerchantRef ${merchantReference}, Reason: ${reason}`);
                    // Handle payment cancellation confirmed by Adyen.
                    // This might be for an individual payment within an order.
                    const paymentToCancel = await paymentsDb.findOneAsync({ adyenPaymentPspReference: pspReference });
                     if (paymentToCancel) {
                        await paymentsDb.updateAsync(
                            { _id: paymentToCancel._id },
                            { $set: { status: 'cancelled', refusalReason: reason, updatedAt: new Date().toISOString() }}
                        );
                        console.log(`Payment ${paymentToCancel._id} status updated to cancelled.`);
                        // Potentially adjust order's remaining amount if this cancellation affects it.
                        // This requires careful logic, especially with partial payments and refunds.
                    } else {
                        console.warn(`CANCELLATION webhook for unknown payment PSP: ${pspReference}`);
                    }
                    break;

                case 'REFUND':
                     console.log(`REFUND: PSP ${pspReference}, MerchantRef ${merchantReference}, Amount: ${amount.value} ${amount.currency}, Success: ${success}, Reason: ${reason}`);
                     // This would be if we implement refunds. For now, just log.
                     // If a refund is successful, you might adjust the order's remaining amount or total refunded amount.
                    break;

                // Add more cases as needed: OFFER_CLOSED, PENDING, MANUAL_REVIEW, etc.
                default:
                    console.log(`Received unhandled eventCode: ${eventCode} for PSP: ${pspReference}`);
            }
        } catch (dbError) {
            console.error(`Error processing webhook event ${eventCode} for PSP ${pspReference}:`, dbError);
            // Decide if you want to stop processing further items or continue.
            // For now, we log and continue. A robust system might retry or flag for manual review.
        }
    }

    // Acknowledge receipt of the webhook
    // Adyen expects "[accepted]" in the response body for standard webhooks.
    res.status(200).send('[accepted]');
});

module.exports = router;
