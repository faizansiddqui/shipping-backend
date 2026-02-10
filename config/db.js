require('dotenv').config();
const { Sequelize, DataTypes, Op } = require('sequelize');

const db = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false,
    },
  },
  logging: false,
});

(async () => {
  try {
    await db.authenticate();
    console.log('✅ Database connected successfully!');
  } catch (error) {
    console.error('❌ Unable to connect to database:', error);
  }
})();

module.exports = { db, DataTypes, Op };
