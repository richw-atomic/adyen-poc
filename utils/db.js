const Datastore = require('nedb');
const path = require('path');
const fs = require('fs');

// Function to promisify NeDB operations
const promisifyNeDB = (db) => {
    const asyncDb = {};
    const methods = ['find', 'findOne', 'insert', 'update', 'remove', 'count', 'ensureIndex', 'loadDatabase'];
    methods.forEach(method => {
        asyncDb[`${method}Async`] = (...args) => {
            return new Promise((resolve, reject) => {
                // For loadDatabase, the callback is just (err)
                if (method === 'loadDatabase') {
                    db[method](err => {
                        if (err) reject(err);
                        else resolve();
                    });
                } else {
                    db[method](...args, (err, result) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(result);
                        }
                    });
                }
            });
        };
    });
    return asyncDb;
};

// Create data directory if it doesn't exist and file paths are used
const dataDir = path.join(__dirname, '../data');
if (process.env.ORDERS_DB_PATH || process.env.PAYMENTS_DB_PATH || process.env.TOKENS_DB_PATH) {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
        console.log(`Created data directory: ${dataDir}`);
    }
}

// Initialize databases
const ordersDbInstance = new Datastore({
    filename: process.env.ORDERS_DB_PATH || path.join(dataDir, 'orders.db'),
    autoload: true
});
const paymentsDbInstance = new Datastore({
    filename: process.env.PAYMENTS_DB_PATH || path.join(dataDir, 'payments.db'),
    autoload: true
});
const tokensDbInstance = new Datastore({
    filename: process.env.TOKENS_DB_PATH || path.join(dataDir, 'tokens.db'),
    autoload: true
});

// Log if databases are file-backed or in-memory
const dbPaths = {
    orders: process.env.ORDERS_DB_PATH || (fs.existsSync(dataDir) ? path.join(dataDir, 'orders.db') : 'in-memory'),
    payments: process.env.PAYMENTS_DB_PATH || (fs.existsSync(dataDir) ? path.join(dataDir, 'payments.db') : 'in-memory'),
    tokens: process.env.TOKENS_DB_PATH || (fs.existsSync(dataDir) ? path.join(dataDir, 'tokens.db') : 'in-memory')
};

console.log('NeDB ordersDb location:', dbPaths.orders.includes('in-memory') && !process.env.ORDERS_DB_PATH ? 'in-memory' : dbPaths.orders);
console.log('NeDB paymentsDb location:', dbPaths.payments.includes('in-memory') && !process.env.PAYMENTS_DB_PATH ? 'in-memory' : dbPaths.payments);
console.log('NeDB tokensDb location:', dbPaths.tokens.includes('in-memory') && !process.env.TOKENS_DB_PATH ? 'in-memory' : dbPaths.tokens);


// Manual timestamp functions
const addTimestampsToDoc = (doc) => {
    const now = new Date().toISOString();
    doc.updatedAt = now;
    if (!doc.createdAt) { // Only set createdAt if it's a new document
        doc.createdAt = now;
    }
    return doc;
};

const getUpdateWithTimestamps = (updateQuery) => {
    const now = new Date().toISOString();
    if (!updateQuery.$set) {
        updateQuery.$set = {};
    }
    updateQuery.$set.updatedAt = now;

    // If you have an $setOnInsert operator, you could add createdAt there.
    // However, NeDB's update operation doesn't distinguish between insert and update in the same way as MongoDB's upsert.
    // For an upsert scenario, you'd typically check if the doc exists first, or handle createdAt at application level.
    // For simple updates, just updatedAt is fine. createdAt is set on insert.
    return updateQuery;
};


module.exports = {
    ordersDb: promisifyNeDB(ordersDbInstance),
    paymentsDb: promisifyNeDB(paymentsDbInstance),
    tokensDb: promisifyNeDB(tokensDbInstance),
    addTimestampsToDoc,
    getUpdateWithTimestamps
};
