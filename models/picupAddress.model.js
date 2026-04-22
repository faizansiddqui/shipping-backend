const mongoose = require('../config/mongo');

const Schema = mongoose.Schema;

const PickupSchema = new Schema({
  // use auto-generated ObjectId as primary id
  user_id: { type: String, required: false },
  address_name: { type: String, required: true },
  contact_name: { type: String, required: true },
  contact_number: { type: String, required: true },
  email: { type: String },
  address_line: { type: String, required: true },
  address_line2: { type: String },
  pincode: { type: String, required: true },
  gstin: { type: String },
  dropship_location: { type: Boolean, default: false },
  use_alt_rto_address: { type: Boolean, default: false },
  create_rto_address: { type: Schema.Types.Mixed },
}, { collection: 'pickup_table', timestamps: true });

module.exports = mongoose.model('PickupTable', PickupSchema);
