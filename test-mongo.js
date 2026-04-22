require('dotenv').config();
const mongoose = require('./config/mongo');

(async () => {
  try {
    // Wait a moment for the connection to establish
    const state = mongoose.connection.readyState;
    console.log('Mongoose connection readyState:', state);
    // Print host info if connected
    if (state === 1) console.log('MongoDB connected to', mongoose.connection.client.s.url || mongoose.connection.hosts);
    process.exit(0);
  } catch (err) {
    console.error('Mongo test error:', err.message || err);
    process.exit(1);
  }
})();
