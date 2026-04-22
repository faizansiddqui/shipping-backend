const mongoose = require('../config/mongo');

const Schema = mongoose.Schema;

const OrderSchema = new Schema({
    orderId: { type: String, required: true, unique: true },
    status: { type: String, enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'ON_WAY', 'RTO', 'DELIVERED'], default: 'PENDING' },
    selectShippingCharges: { type: Number },
    selectedCourierName: { type: String },
    selectedFreightMode: { type: String },
    orderDate: { type: String },
    pickupAddressName: { type: String },
    pickupLocation: { type: Schema.Types.Mixed },
    storeName: { type: String, default: 'DEFAULT' },
    billingIsShipping: { type: Boolean },
    shippingAddress: { type: Schema.Types.Mixed, required: true },
    orderItems: { type: [Schema.Types.Mixed], required: true },
    paymentMethod: { type: String, enum: ['COD', 'PREPAID'], required: true },
    shippingCharges: { type: Number },
    totalOrderValue: { type: Number, required: true },
    prepaidAmount: { type: Number },
    packageDetails: { type: Schema.Types.Mixed, required: true },
    user_id: { type: String, required: true },
    awb_number: { type: String },
    label_url: { type: String },
    label_pending: { type: Boolean, default: false },
    rapid_shipment_id: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('OrderTable', OrderSchema);
