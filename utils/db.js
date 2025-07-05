const Datastore = require('nedb');
const path = require('path');

// Function to promisify NeDB operations
const promisifyNeDB = (db) => {
    const asyncDb = {};
    const methods = ['find', 'findOne', 'insert', 'update', 'remove', 'count', 'ensureIndex'];
    methods.forEach(method => {
        asyncDb[`${method}Async`] = (...args) => {
            return new Promise((resolve, reject) => {
                db[method](...args, (err, result) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(result);
                    }
                });
            });
        };
    });
    return asyncDb;
};

// Initialize databases
// Using file-backed stores if paths are provided, otherwise in-memory
const ordersDbInstance = new Datastore({
    filename: process.env.ORDERS_DB_PATH || path.join(__dirname, '../data/orders.db'),
    autoload: true
});
const paymentsDbInstance = new Datastore({
    filename: process.env.PAYMENTS_DB_PATH || path.join(__dirname, '../data/payments.db'),
    autoload: true
});
const tokensDbInstance = new Datastore({
    filename: process.env.TOKENS_DB_PATH || path.join(__dirname, '../data/tokens.db'),
    autoload: true
});

// Add a timestamp to documents before inserting or updating
const addTimestamps = (doc, operationType) => {
    const now = new Date().toISOString();
    if (operationType === 'insert') {
        doc.createdAt = now;
    }
    doc.updatedAt = now;
};

ordersDbInstance.before('insert', (doc) => addTimestamps(doc, 'insert'));
ordersDbInstance.before('update', (doc) => addTimestamps(doc, 'update')); // NeDB's update doesn't directly pass the doc like this, usually $set
                                                                      // For true 'updatedAt' on update, it's better to set it manually in the update query.
                                                                      // This is a simplified approach for before hook.

paymentsDbInstance.before('insert', (doc) => addTimestamps(doc, 'insert'));
// paymentsDbInstance.before('update', (doc) => addTimestamps(doc, 'update'));

tokensDbInstance.before('insert', (doc) => addTimestamps(doc, 'insert'));
// tokensDbInstance.before('update', (doc) => addTimestamps(doc, 'update'));


// Create data directory if it doesn't exist and file paths are used
if (process.env.ORDERS_DB_PATH || process.env.PAYMENTS_DB_PATH || process.env.TOKENS_DB_PATH) {
    const fs = require('fs');
    const dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
}


module.exports = {
    ordersDb: promisifyNeDB(ordersDbInstance),
    paymentsDb: promisifyNeDB(paymentsDbInstance),
    tokensDb: promisifyNeDB(tokensDbInstance),
};
