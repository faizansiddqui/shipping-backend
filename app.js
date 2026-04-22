const express = require('express');

const cookieParser = require('cookie-parser');
const passport = require('passport');
const session = require('express-session');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const router = express.Router();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const isProd = process.env.NODE_ENV === 'production';
const sessionCookie = {
  httpOnly: true,
  secure: isProd || process.env.COOKIE_SECURE === 'true',
  sameSite: isProd ? 'none' : 'lax',
  path: '/',
};

app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback_secret_key',
  resave: false,
  saveUninitialized: false, // do not set session cookie for anonymous requests
  cookie: sessionCookie,
}));

app.use(passport.initialize());
app.use(passport.session());

module.exports = { app, router };
