const express = require('express');
const bcrypt = require('bcrypt');
const passport = require('../config/passport');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const { sendMail } = require('../utils/brevoMailer');

const router = express.Router();

const isProd = process.env.NODE_ENV === 'production';
const secureCookie = isProd || process.env.COOKIE_SECURE === 'true';
const cookieOption = {
  httpOnly: true,
  secure: secureCookie,
  sameSite: secureCookie ? 'none' : 'lax',
  path: '/',
};

const clearAuthCookies = (res) => {
  res.clearCookie('sb_access_token', { ...cookieOption, maxAge: 0 });
  res.clearCookie('sb_refresh_token', { ...cookieOption, maxAge: 0 });
  res.clearCookie('sb_access_token', { ...cookieOption, secure: false, sameSite: 'lax', maxAge: 0 });
  res.clearCookie('sb_refresh_token', { ...cookieOption, secure: false, sameSite: 'lax', maxAge: 0 });
};

router.post('/signup', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'User already exists' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, passwordHash, name });

    const accessToken = await signAccessToken(user);
    const refreshToken = await signRefreshToken(user);
    const expiresIn = 900;

    res.cookie('sb_access_token', accessToken, { ...cookieOption, maxAge: expiresIn * 1000 });
    res.cookie('sb_refresh_token', refreshToken, { ...cookieOption, maxAge: 15 * 24 * 60 * 60 * 1000 });

    return res.json({ message: 'Signup successful', user: { id: user._id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const ok = await user.verifyPassword(password);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });

    const accessToken = await signAccessToken(user);
    const refreshToken = await signRefreshToken(user);
    const expiresIn = 900;

    res.cookie('sb_access_token', accessToken, { ...cookieOption, maxAge: expiresIn * 1000 });
    res.cookie('sb_refresh_token', refreshToken, { ...cookieOption, maxAge: 15 * 24 * 60 * 60 * 1000 });
    res.json({ message: 'Login successful', user: { id: user._id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Forgot password: generate token and (optionally) return reset link in non-prod
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ success: false, status: 'error', message: 'Email required' });

  try {
    const user = await User.findOne({ email });
    if (!user) {
      // For privacy, do not reveal whether the account exists
      return res.json({ success: true, status: 'notified', message: 'If an account exists, a reset link will be sent.' });
    }

    const token = uuidv4();
    user.passwordResetToken = token;
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${token}`;

    // If Brevo is configured, attempt to send email and report send status
    if (process.env.BREVO_API_KEY) {
      try {
        const subject = 'Reset your password';
        const html = `<p>Hi ${user.name || ''},</p><p>We received a request to reset your password. Click the link below to set a new password (valid for 1 hour):</p><p><a href="${resetLink}">${resetLink}</a></p><p>If you did not request this, you can safely ignore this email.</p>`;
        const text = `Reset your password: ${resetLink}`;
        await sendMail({ to: user.email, subject, html, text });
        return res.json({ success: true, status: 'sent', message: 'Reset link sent to the provided email address.' });
      } catch (emailErr) {
        console.error('Error sending reset email:', emailErr);
        return res.status(500).json({ success: false, status: 'failed', message: 'Failed to send reset link. Please try again later.' });
      }
    }

    // If no email provider is configured, return the generated link only in non-prod/debug for developer convenience
    if (process.env.NODE_ENV !== 'production' || process.env.DEBUG_SEND_RESET_LINK === 'true') {
      return res.json({ success: true, status: 'generated', message: 'Reset link generated', resetLink });
    }

    return res.json({ success: true, status: 'not_configured', message: 'Email service not configured. If an account exists, a reset link will be sent once configured.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ success: false, status: 'error', message: 'Server error' });
  }
});

// Reset password using token
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const user = await User.findOne({ passwordResetToken: token, passwordResetExpires: { $gt: new Date() } });
    if (!user) return res.status(400).json({ error: 'Invalid or expired token' });

    const passwordHash = await bcrypt.hash(password, 10);
    user.passwordHash = passwordHash;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    // also clear refresh token to force re-login
    user.refreshToken = null;
    await user.save();

    return res.json({ message: 'Password reset successful' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies?.sb_refresh_token;
    if (!refreshToken) return res.status(401).json({ error: 'No refresh token' });

    const user = await verifyRefreshToken(refreshToken);
    if (!user) return res.status(401).json({ error: 'Invalid refresh token' });

    const accessToken = await signAccessToken(user);
    const newRefreshToken = await signRefreshToken(user);
    const expiresIn = 900;

    res.cookie('sb_access_token', accessToken, { ...cookieOption, maxAge: expiresIn * 1000 });
    res.cookie('sb_refresh_token', newRefreshToken, { ...cookieOption, maxAge: 15 * 24 * 60 * 60 * 1000 });
    res.json({ message: 'Token refreshed', user: { id: user._id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('Refresh error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const u = req.user;
    if (!u) return res.status(401).json({ error: 'Invalid token' });
    res.json({ user: { id: u._id, email: u.email, name: u.name } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/auth/google', passport.authenticate('google', {
  scope: ['openid', 'profile', 'email'],
  accessType: 'offline',
  prompt: 'consent',
}));

router.get('/auth/google/callback', passport.authenticate('google', {
  failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=auth_failed`,
}), async (req, res) => {
  try {
    const profile = req.user?.profile;
    const email = profile?.emails?.[0]?.value;
    const name = profile?.displayName || '';
    if (!email) return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=no_email`);

    let user = await User.findOne({ email });
    if (!user) {
      // create user without password
      user = await User.create({ email, passwordHash: 'oauth_no_password', name });
    }

    const accessToken = await signAccessToken(user);
    const refreshToken = await signRefreshToken(user);
    const expiresIn = 900;

    res.cookie('sb_access_token', accessToken, { ...cookieOption, maxAge: expiresIn * 1000 });
    res.cookie('sb_refresh_token', refreshToken, { ...cookieOption, maxAge: 15 * 24 * 60 * 60 * 1000 });

    const redirectTo = process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/` : 'http://localhost:3000/';
    res.redirect(redirectTo);
  } catch (err) {
    console.error('Google callback error:', err);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=server_error`);
  }
});

router.post('/logout', async (req, res) => {
  try {
    const refreshToken = req.cookies?.sb_refresh_token;
    if (refreshToken) {
      // clear refreshToken from user if any
      const user = await User.findOne({ refreshToken });
      if (user) {
        user.refreshToken = null;
        await user.save();
      }
    }
    clearAuthCookies(res);
    res.json({ message: 'Logged out' });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports = router;
