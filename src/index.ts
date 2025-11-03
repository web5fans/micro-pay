import express from 'express';
import { paymentRouter } from './api/payment';
import { initDb } from './db';
import dotenv from 'dotenv';
import { initPlatformAddresses } from './services/ckbService';
import { startPaymentCleanupTask } from './services/paymentCleanupService';
import { startPaymentCheckTask } from './services/paymentCheckService';

// Load environment variables
dotenv.config();

// Create Express application
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.send('OK');
});

// Routes
app.use('/api/payment', paymentRouter);

// Start server
async function startServer() {
  try {
    // Initialize database
    await initDb();
    
    // Initialize platform addresses
    await initPlatformAddresses();
    
    // Start periodic check for incomplete payment records
    // Check every 30 seconds, payments incomplete for more than 60 seconds will be considered timeout
    startPaymentCleanupTask(30, 60);

    // Start periodic check ckb transaction status
    // Check every 20 seconds, payments with status 'transfer' will be checked
    startPaymentCheckTask(20);
    
    app.listen(port, () => {
      console.log(`Server is running at http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
