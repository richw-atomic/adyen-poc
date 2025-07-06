const express = require('express');
const { tokensDb } = require('../utils/db');

const router = express.Router();

/**
 * @route   GET /api/stored-payment-methods
 * @desc    Get stored payment methods (tokens) for a shopper from local DB
 * @access  Public (in a real app, this would be authenticated)
 * @query   shopperReference (string, required)
 */
router.get('/', async (req, res) => {
    try {
        const { shopperReference } = req.query;

        if (!shopperReference) {
            return res.status(400).json({ error: 'shopperReference query parameter is required.' });
        }

        // Fetch tokens from our local NeDB store
        const storedTokens = await tokensDb.findAsync({ shopperReference: shopperReference });

        if (!storedTokens || storedTokens.length === 0) {
            return res.status(404).json({ message: 'No stored payment methods found for this shopper.' });
        }

        // Format the response to be somewhat similar to what Adyen might return,
        // or define our own clear format.
        const responseTokens = storedTokens.map(token => ({
            id: token._id, // Our internal ID for this token entry
            adyenRecurringDetailReference: token.adyenRecurringDetailReference,
            brand: token.cardBrand,
            name: token.cardSummary, // Or some other user-friendly name
            lastFour: token.cardSummary, // Assuming cardSummary contains last four digits
            expiryMonth: token.expiryMonth, // Need to store these if available from Adyen
            expiryYear: token.expiryYear,   // Need to store these
            paymentMethodType: token.paymentMethodType,
            shopperReference: token.shopperReference,
            creationDate: token.creationDate,
        }));

        res.status(200).json({ storedPaymentMethods: responseTokens });

    } catch (err) {
        console.error('Error fetching stored payment methods:', err);
        res.status(500).json({ error: 'Failed to fetch stored payment methods.', message: err.message });
    }
});


// Note: Disabling/Deleting a stored payment method would be a DELETE request here.
// For Adyen, you'd call the /disable endpoint with the recurringDetailReference.
// router.delete('/:tokenId', async (req, res) => { ... }); // To delete from our local DB
// router.post('/adyen-disable', async (req, res) => { ... }); // To call Adyen's disable

module.exports = router;
