const { db, DataTypes } = require('../config/db');

const OrderTable = db.define('OrderTable', {
    orderId: {
        type: DataTypes.STRING,
        primaryKey: true,
        unique: true,
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'ON_WAY', 'RTO', 'DELIVERED'),
        allowNull: false,
        defaultValue: 'PENDING'
    },

    selectShippingCharges: {
        type: DataTypes.FLOAT,
        allowNull: true
    },
    selectedCourierName: {
        type: DataTypes.STRING,
        allowNull: true
    },
    selectedFreightMode: {
        type: DataTypes.STRING,
        allowNull: true
    },
    orderDate: {
        type: DataTypes.STRING,
        allowNull: false
    },
    // Pickup details
    pickupAddressName: {
        type: DataTypes.STRING,
        allowNull: true  // conditionally mandatory
    },
    pickupLocation: {
        type: DataTypes.JSON, // contactName, pickupName, email, etc.
        allowNull: true
    },
    storeName: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "DEFAULT"
    },

    // Billing/Shipping
    billingIsShipping: {
        type: DataTypes.BOOLEAN,
        allowNull: false
    },
    shippingAddress: {
        type: DataTypes.JSON, // { firstName, addressLine1, pinCode, phone, ... }
        allowNull: false
    },

    // Order Items
    orderItems: {
        type: DataTypes.JSON, // [{ itemName, sku, units, unitPrice, tax, ... }]
        allowNull: false
    },

    // Payment details
    paymentMethod: {
        type: DataTypes.ENUM('COD', "PREPAID"),
        allowNull: false
    },
    shippingCharges: {
        type: DataTypes.FLOAT,
        allowNull: true
    },

    totalOrderValue: {
        type: DataTypes.FLOAT,
        allowNull: false
    },
    prepaidAmount: {
        type: DataTypes.FLOAT,
        allowNull: true
    },

    // Package details
    packageDetails: {
        type: DataTypes.JSON, // { packageLength, packageBreadth, packageHeight, packageWeight }
        allowNull: false
    },

    user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'user_id'
    },

    awb_number: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    label_url: {
        type: DataTypes.STRING(2048),
        allowNull: true,
    },
    label_pending: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
    },
    rapid_shipment_id: {
        type: DataTypes.STRING,
        allowNull: true,
    },

}, {
    timestamps: true, // adds createdAt, updatedAt
    freezeTableName: true // prevents plural names like "OrderTables"
});

module.exports = OrderTable;
