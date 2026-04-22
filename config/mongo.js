require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;

mongoose.set('strictQuery', false);

if (!MONGO_URI) {
    console.warn('MONGO_URI not set — skipping MongoDB auto-connect. Set MONGO_URI in .env to enable DB.');
    module.exports = mongoose;
} else {
    async function connect() {
        try {
            await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
            console.log('✅ MongoDB connected');
        } catch (err) {
            console.error('❌ MongoDB connection error:', err.message || err);
            process.exit(1);
        }
    }
    connect();
    module.exports = mongoose;
}
