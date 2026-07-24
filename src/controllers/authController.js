import bcrypt from 'bcryptjs';
import prisma from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import generateToken from '../utils/generateToken.js';
import { withId } from '../utils/serialize.js';

export const register = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;

  const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (exists) {
    throw new ApiError(400, 'Email is already registered');
  }

  const hashed = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      name,
      email: email.toLowerCase(),
      password: hashed,
      role: role === 'admin' ? 'admin' : 'user',
    },
  });

  const token = generateToken(user.id, user.role);
  const safeUser = withId(user);

  res.status(201).json({
    success: true,
    message: 'Registration successful',
    data: {
      user: {
        id: safeUser.id,
        name: safeUser.name,
        email: safeUser.email,
        role: safeUser.role,
      },
      token,
    },
  });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    throw new ApiError(401, 'Invalid email or password');
  }

  if (!user.isActive) {
    throw new ApiError(403, 'Account is deactivated');
  }

  const token = generateToken(user.id, user.role);

  res.status(200).json({
    success: true,
    message: 'Login successful',
    data: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      token,
    },
  });
});

export const getMe = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: { user: req.user },
  });
});

export const logout = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
});
