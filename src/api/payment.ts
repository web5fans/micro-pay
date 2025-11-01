import express, { Request, Response } from 'express';
import { preparePayment, completeTransfer } from '../services/paymentService';
import { getPaymentById, getPaymentsBySender } from '../models/payment';
import { getAccountsByPaymentId, getAccountsByReceiver } from '../models/account';

export const paymentRouter = express.Router();

// Payment preparation endpoint
paymentRouter.post('/prepare', async (req: Request, res: Response) => {
  try {
    console.log('Request body:', req.body);
    const { sender, receiver, amount, splitReceivers, info } = req.body;
    
    // Validate request parameters
    if (!sender || !receiver || !amount) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    // Validate splitReceivers format
    if (splitReceivers && Array.isArray(splitReceivers)) {
      for (const item of splitReceivers) {
        if (!item.address || typeof item.splitRate !== 'number' || item.splitRate < 0 || item.splitRate > 100) {
          return res.status(400).json({ error: 'Invalid splitReceivers format. Each item must have address and splitRate (0-100)' });
        }
      }
    }

    // Calculate splitRate sum
    const totalSplitRate = splitReceivers ? splitReceivers.reduce((sum: number, item: { splitRate: number; }) => sum + item.splitRate, 0) : 0;
    if (totalSplitRate >= 100) {
      return res.status(400).json({ error: 'splitRate sum must be less than 100' });
    }
    
    // Prepare payment
    const result = await preparePayment(sender, receiver, amount, splitReceivers, info);
    
    res.json(result);
  } catch (error) {
    console.error('Error in prepare payment endpoint:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Transfer endpoint
paymentRouter.post('/transfer', async (req: Request, res: Response) => {
  try {
    const { payment_id, signed_tx } = req.body;
    
    // Validate request parameters
    if (!payment_id || !signed_tx) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    // Complete transfer
    const result = await completeTransfer(payment_id, signed_tx);
    
    res.json(result);
  } catch (error) {
    console.error('Error in transfer endpoint:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Query payment record by payment id
paymentRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const paymentId = parseInt(req.params.id);
    
    // Get payment record
    const payment = await getPaymentById(paymentId);
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    
    // Get split account records
    const accounts = await getAccountsByPaymentId(paymentId);
    
    // Remove platform_address_index field from payment object
    const { platform_address_index, ...paymentWithoutIndex } = payment;
    
    res.json({
      payment: paymentWithoutIndex,
      accounts
    });
  } catch (error) {
    console.error('Error in get payment by id endpoint:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Query payment records by sender address
paymentRouter.get('/sender/:address', async (req: Request, res: Response) => {
  try {
    const address = req.params.address;
    
    // Get payment records
    const payments = await getPaymentsBySender(address);
    
    // Remove platform_address_index field from each payment record
    const paymentsWithoutIndex = payments.map(payment => {
      const { platform_address_index, ...paymentWithoutIndex } = payment;
      return paymentWithoutIndex;
    });
    
    res.json(paymentsWithoutIndex);
  } catch (error) {
    console.error('Error in get payments by sender endpoint:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Query payment records by receiver address
paymentRouter.get('/receiver/:address', async (req: Request, res: Response) => {
  try {
    const address = req.params.address;
    
    // Get payment records
    const payments = await getAccountsByReceiver(address);
    
    res.json(payments);
  } catch (error) {
    console.error('Error in get accounts by receiver endpoint:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
