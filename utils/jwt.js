const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || '734b344y783y4rh3784trg83nry3478yrj3r7y34n987ryj';
const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES || '15m';

async function signAccessToken(user) {
  const payload = {
    id: user._id || user.id,
    email: user.email,
    name: user.name,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_EXPIRES });
}

async function signRefreshToken(user) {
  const token = uuidv4();
  user.refreshToken = token;
  await user.save();
  return token;
}

function verifyAccessToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

async function getUserFromToken(token) {
  if (!token) return null;
  const decoded = verifyAccessToken(token);
  if (!decoded || !decoded.id) return null;
  try {
    const user = await User.findById(decoded.id).select('-passwordHash -refreshToken');
    return user;
  } catch (err) {
    return null;
  }
}

async function verifyRefreshToken(token) {
  if (!token) return null;
  try {
    const user = await User.findOne({ refreshToken: token }).select('-passwordHash');
    return user;
  } catch (err) {
    return null;
  }
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  getUserFromToken,
  verifyRefreshToken,
};
