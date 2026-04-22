const mongoose = require('../config/mongo');

const Schema = mongoose.Schema;

const WalletSchema = new Schema({
    user_id: { type: String, required: true, index: true },
    wallet_balance: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Wallet', WalletSchema);
