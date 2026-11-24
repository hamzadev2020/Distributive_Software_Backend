import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { DbConfig } from './config/config.js';

// Route imports
import authRoutes from './routes/auth.routes.js';
import vendorRoutes from './routes/vendor.routes.js';
import productRoutes from './routes/product.routes.js';
import warehouseRoutes from './routes/warehouse.routes.js';
import stockRoutes from './routes/stock.routes.js';
import orderRoutes from './routes/order.routes.js';
import dispatchRoutes from './routes/dispatch.routes.js';
import invoiceRoutes from './routes/invoice.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import returnRoutes from './routes/return.routes.js';
import reportRoutes from './routes/report.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';

import { errorHandler } from './middleware/errorHandler.js';

dotenv.config();

export const app = express();

// Security & Parsing Middlewares
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Health Check with Replica Set status inspection
app.get('/health', async (req, res) => {
  const isConnected = mongoose.connection.readyState === 1;
  const isReplicaSet = Boolean(mongoose.connection.db?.serverConfig?.isReplicaSet?.() ?? true);

  if (!isConnected) {
    return res.status(503).json({
      status: 'DOWN',
      database: 'DISCONNECTED',
      replicaSet: false
    });
  }

  res.json({
    status: 'UP',
    database: 'CONNECTED',
    replicaSet: isReplicaSet,
    timestamp: new Date().toISOString()
  });
});

// Ensure Database is connected for serverless invocations (Vercel)
app.use(async (req, res, next) => {
  if (mongoose.connection.readyState === 0) {
    try {
      await DbConfig();
    } catch (err) {
      console.error('Failed to connect to DB in serverless invocation:', err);
    }
  }
  next();
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/products', productRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/dispatch', dispatchRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/returns', returnRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Central Error Handler
app.use(errorHandler);

export default app;

const Port = process.env.PORT || 5000;

if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  DbConfig().then(() => {
    app.listen(Port, () => {
      console.log(`Distribution Management Server running on http://localhost:${Port}`);
    });
  });
}
