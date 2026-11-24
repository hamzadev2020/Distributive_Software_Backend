import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { JWT_SECRET, ACCESS_TOKEN_EXPIRY } from '../middleware/auth.js';
import { ValidationError, AppError } from '../utils/errors.js';

export class AuthService {
  static async hashPassword(password) {
    return bcrypt.hash(password, 12);
  }

  static async comparePassword(password, hash) {
    return bcrypt.compare(password, hash);
  }

  static generateAccessToken(user) {
    return jwt.sign(
      {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        name: user.name
      },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRY }
    );
  }

  static async login(email, password, ipAddress = '') {
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const waitMinutes = Math.ceil((user.lockedUntil - new Date()) / 60000);
      throw new AppError(`Account is temporarily locked. Try again in ${waitMinutes} minutes.`, 429, 'ACCOUNT_LOCKED');
    }

    const isMatch = await this.comparePassword(password, user.passwordHash);
    if (!isMatch) {
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      if (user.failedLoginAttempts >= 5) {
        user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 min lock
        user.failedLoginAttempts = 0;
      }
      await user.save();
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    // Reset failed attempts on success
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.lastLogin = new Date();
    await user.save();

    const accessToken = this.generateAccessToken(user);

    // Create rotating refresh token
    const rawRefreshToken = crypto.randomBytes(40).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const family = crypto.randomUUID();

    await RefreshToken.create({
      userId: user._id,
      tokenHash,
      family,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      createdByIp: ipAddress
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    };
  }

  static async refresh(rawRefreshToken, ipAddress = '') {
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const existing = await RefreshToken.findOne({ tokenHash });

    if (!existing) {
      throw new AppError('Invalid refresh token', 401, 'INVALID_TOKEN');
    }

    // Reuse detection: If token was already revoked, someone is replaying a stolen token!
    if (existing.revokedAt) {
      // Revoke whole token family immediately!
      await RefreshToken.updateMany({ family: existing.family }, { revokedAt: new Date() });
      throw new AppError('Stolen token reuse detected! All sessions invalidated.', 401, 'TOKEN_REUSE_DETECTED');
    }

    if (existing.expiresAt < new Date()) {
      throw new AppError('Refresh token expired', 401, 'TOKEN_EXPIRED');
    }

    const user = await User.findById(existing.userId);
    if (!user || !user.isActive) {
      throw new AppError('User not found or deactivated', 401, 'UNAUTHORIZED');
    }

    // Rotate refresh token
    const newRawRefreshToken = crypto.randomBytes(40).toString('hex');
    const newTokenHash = crypto.createHash('sha256').update(newRawRefreshToken).digest('hex');

    existing.revokedAt = new Date();
    existing.replacedByTokenHash = newTokenHash;
    await existing.save();

    await RefreshToken.create({
      userId: user._id,
      tokenHash: newTokenHash,
      family: existing.family, // Keep same family
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdByIp: ipAddress
    });

    const newAccessToken = this.generateAccessToken(user);

    return {
      accessToken: newAccessToken,
      refreshToken: newRawRefreshToken
    };
  }
}
