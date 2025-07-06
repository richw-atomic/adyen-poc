const express = require('express');
const { hmacValidator } = require('@adyen/api-library');
const { ADYEN_HMAC_KEY } = require('../config/adyenConfig');
const { ordersDb, paymentsDb, tokensDb, getUpdateWithTimestamps } = require('../utils/db');

const router = express.Router();

// Initialize HMAC validator
const validator = new hmacValidator();

/**
 * @route   POST /api/webhooks
 * @desc    Handle Adyen webhook notifications
 * @access  Public (secured by HMAC)
 */
router.post('/', async (req, res) => {
    console.log(`Webhook received: ${new Date().toISOString()}`);
    // console.log('Webhook Headers:', JSON.stringify(req.headers, null, 2));

    // req.body is a Buffer because of express.raw() middleware
    let notificationRequest;
    try {
        if (typeof req.body === 'string') {
            notificationRequest = JSON.parse(req.body.toString());
        } else {
            notificationRequest = req.body;
        }
        // console.log('Webhook Body:', JSON.stringify(notificationRequest, null, 2));
    } catch (e) {
        console.error('Error parsing webhook body:', e);
        return res.status(400).send('Invalid JSON body');
    }

    const { notificationItems } = notificationRequest;

    if (!notificationItems || !Array.isArray(notificationItems)) {
        console.warn('Webhook received with no notificationItems.');
        return res.status(400).send('Invalid webhook format: Missing notificationItems.');
    }

    // Process each notification item
    for (const notificationWrapper of notificationItems) {
        const notification = notificationWrapper.NotificationRequestItem;
        const { eventCode, success, pspReference, merchantReference, amount, reason } = notification;

        // HMAC validation for each notification item
        if (!ADYEN_HMAC_KEY) {
            console.warn("ADYEN_HMAC_KEY not configured. Skipping HMAC validation. THIS IS INSECURE.");
        } else {
            try {
                // The validate method expects the notification item and the HMAC key
                const isHmacValid = validator.validateHMAC(notification, ADYEN_HMAC_KEY);
                if (!isHmacValid) {
                    console.error(`Webhook HMAC validation failed for PSP: ${pspReference}.`);
                    return res.status(401).send('HMAC validation failed');
                }
            } catch (e) {
                console.error(`Error during HMAC validation for PSP: ${pspReference}:`, e);
                return res.status(401).send('HMAC validation error');
            }
        }

        console.log(`Processing webhook event: ${eventCode} for PSP: ${pspReference}, MerchantRef: ${merchantReference}, Success: ${success}`);

        try {
            switch (eventCode) {
                case 'ORDER_OPENED':
                    console.log(`ORDER_OPENED: PSP ${pspReference}, MerchantRef ${merchantReference}`);
                    const orderOpened = await ordersDb.findOneAsync({ adyenOrderPspReference: pspReference });
                    if (orderOpened) {
                        await ordersDb.updateAsync({ _id: orderOpened._id }, getUpdateWithTimestamps({ $set: { status: 'open' } }));
                        console.log(`Order ${orderOpened._id} status confirmed as open.`);
                    } else {
                        console.warn(`ORDER_OPENED for unknown Adyen PSP Reference: ${pspReference}`);
                    }
                    break;

                case 'ORDER_CLOSED':
                    console.log(`ORDER_CLOSED: PSP ${pspReference}, MerchantRef ${merchantReference}, Success: ${success}`);
                    const orderToClose = await ordersDb.findOneAsync({ adyenOrderPspReference: pspReference });
                    if (orderToClose) {
                        const newStatus = success === 'true' || success === true ? 'paid' : 'cancelled';
                        await ordersDb.updateAsync(
                            { _id: orderToClose._id },
                            getUpdateWithTimestamps({ $set: { status: newStatus } })
                        );
                        console.log(`Order ${orderToClose._id} status updated to ${newStatus}.`);
                        if (newStatus === 'paid') {
                             await ordersDb.updateAsync(
                                 { _id: orderToClose._id },
                                 getUpdateWithTimestamps({ $set: { remainingAmount: { value: 0, currency: orderToClose.currency } }})
                             );
                             console.log(`Order ${orderToClose._id} remaining amount set to 0.`);
                        }
                    } else {
                        console.warn(`ORDER_CLOSED for unknown Adyen PSP Reference: ${pspReference}`);
                    }
                    break;

                case 'AUTHORISATION':
                    console.log(`AUTHORISATION: PSP ${pspReference}, MerchantRef ${merchantReference}, Amount: ${amount.value} ${amount.currency}, Success: ${success}, Reason: ${reason}`);
                    const paymentToUpdate = await paymentsDb.findOneAsync({ $or: [{ adyenPaymentPspReference: pspReference }, { merchantReference: merchantReference }] });

                    if (paymentToUpdate) {
                        const paymentStatus = success === 'true' || success === true ? 'authorised' : 'refused';
                        await paymentsDb.updateAsync(
                            { _id: paymentToUpdate._id },
                            getUpdateWithTimestamps({ $set: {
                                status: paymentStatus,
                                adyenPaymentPspReference: pspReference,
                                refusalReason: success === 'true' || success === true ? null : reason
                            }})
                        );
                        console.log(`Payment ${paymentToUpdate._id} status updated to ${paymentStatus}.`);

                        if (paymentStatus === 'authorised') {
                            await ordersDb.updateAsync(
                                { _id: paymentToUpdate.orderId },
                                getUpdateWithTimestamps({
                                    $addToSet: { partialPaymentPspReferences: pspReference },
                                    $set: { status: 'processing' }
                                })
                            );
                            console.log(`Order ${paymentToUpdate.orderId} updated with authorised payment ${pspReference}.`);
                        }
                    } else {
                        console.warn(`AUTHORISATION webhook for unknown payment PSP/MerchantRef: ${pspReference} / ${merchantReference}`);
                    }
                    break;

                case 'CANCELLATION':
                    console.log(`CANCELLATION: PSP ${pspReference}, MerchantRef ${merchantReference}, Reason: ${reason}`);
                    const paymentToCancel = await paymentsDb.findOneAsync({ adyenPaymentPspReference: pspReference });
                     if (paymentToCancel) {
                        await paymentsDb.updateAsync(
                            { _id: paymentToCancel._id },
                            getUpdateWithTimestamps({ $set: { status: 'cancelled', refusalReason: reason }})
                        );
                        console.log(`Payment ${paymentToCancel._id} status updated to cancelled.`);
                    } else {
                        console.warn(`CANCELLATION webhook for unknown payment PSP: ${pspReference}`);
                    }
                    break;

                case 'REFUND':
                     console.log(`REFUND: PSP ${pspReference}, MerchantRef ${merchantReference}, Amount: ${amount.value} ${amount.currency}, Success: ${success}, Reason: ${reason}`);
                    break;

                default:
                    console.log(`Received unhandled eventCode: ${eventCode} for PSP: ${pspReference}`);
            }
        } catch (dbError) {
            console.error(`Error processing webhook event ${eventCode} for PSP ${pspReference}:`, dbError);
        }
    }

    res.status(200).send('[accepted]');
});

module.exports = router;