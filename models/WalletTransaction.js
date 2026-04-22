const mongoose = require('../config/mongo');

const Schema = mongoose.Schema;

const WalletTransactionSchema = new Schema({
  user_id: { type: String, required: true, index: true },
  amount: { type: Number, required: true },
  description: { type: String },
  payment_id: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('WalletTransaction', WalletTransactionSchema);
