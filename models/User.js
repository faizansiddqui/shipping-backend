const mongoose = require('../config/mongo');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const Schema = mongoose.Schema;

const UserSchema = new Schema({
    _id: { type: String, default: () => uuidv4() },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    name: { type: String },
    pincode: { type: String },
    refreshToken: { type: String },
}, { timestamps: true });

UserSchema.methods.verifyPassword = function (password) {
    return bcrypt.compare(password, this.passwordHash);
};

module.exports = mongoose.model('User', UserSchema);
