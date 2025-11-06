import express, { Request, Response } from 'express';
import { preparePayment, completeTransfer } from '../services/paymentService';
import { getPaymentById, getPaymentsBySender } from '../models/payment';
import { getAccountsByPaymentId, getAccountsByReceiver } from '../models/account';
import { ErrorCode } from './errorCodes';

export const paymentRouter = express.Router();

// Payment preparation endpoint
paymentRouter.post('/prepare', async (req: Request, res: Response) => {
  try {
    console.log('prepare Request body:', req.body);
    const { sender, receiver, amount, splitReceivers, info } = req.body;
    
    // Validate request parameters
    if (!sender || typeof sender !== 'string' || !receiver || typeof receiver !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid parameters', code: ErrorCode.VALIDATION_ERROR });
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount', code: ErrorCode.VALIDATION_ERROR });
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
      return res.status(400).json({ error: 'splitRate sum must be less than 100', code: ErrorCode.VALIDATION_ERROR });
    }
    
    // Prepare payment
    const result = await preparePayment(sender, receiver, amount, splitReceivers, info);
    
    res.json(result);
  } catch (error) {
    console.error('Error in prepare payment endpoint:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    // Unique violation due to concurrent active payment
    if ((error as any)?.code === '23505') {
      return res.status(409).json({ error: 'Sender has an active payment', code: ErrorCode.DUPLICATE_ACTIVE_PAYMENT });
    }
    // Business conflicts and resource errors
    if (message.includes('incomplete payment')) {
      return res.status(409).json({ error: message, code: ErrorCode.INCOMPLETE_PAYMENT_EXISTS });
    }
    if (message.includes('does not have enough balance')) {
      return res.status(422).json({ error: message, code: ErrorCode.INSUFFICIENT_BALANCE });
    }
    if (message.includes('No available platform address')) {
      return res.status(503).json({ error: message, code: ErrorCode.NO_PLATFORM_ADDRESS });
    }
    // Default to internal error
    res.status(500).json({ error: message, code: ErrorCode.INTERNAL_ERROR });
  }
});

// Transfer endpoint
paymentRouter.post('/transfer', async (req: Request, res: Response) => {
  try {
    console.log('transfer Request body:', req.body);
    const { payment_id, signed_tx } = req.body;
    
    // Validate request parameters
    if (!payment_id || typeof payment_id !== 'number' || !signed_tx || typeof signed_tx !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid parameters', code: ErrorCode.VALIDATION_ERROR });
    }
    
    // Complete transfer
    const result = await completeTransfer(payment_id, signed_tx);
    
    res.json(result);
  } catch (error) {
    console.error('Error in transfer endpoint:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    // State mismatch: not in prepare when trying to transfer
    if (message === 'Payment not in prepare') {
      return res.status(409).json({ error: message, code: ErrorCode.STATE_MISMATCH });
    }
    // External transaction processing error
    if (message.toLowerCase().includes('transaction') || message.toLowerCase().includes('send')) {
      return res.status(502).json({ error: message, code: ErrorCode.CHAIN_ERROR });
    }
    res.status(500).json({ error: message, code: ErrorCode.INTERNAL_ERROR });
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

    // remove platform_address_indexes field from each account object
    const accountsWithoutIndex = accounts.map(account => {
      const { platform_address_indexes, ...accountWithoutIndex } = account;
      return accountWithoutIndex;
    });
    
    res.json({
      payment: paymentWithoutIndex,
      accounts: accountsWithoutIndex
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
    
    // Get account records
    const accounts = await getAccountsByReceiver(address);
    
    // Remove platform_address_indexes field from each account record
    const accountsWithoutIndex = accounts.map(account => {
      const { platform_address_indexes, ...accountWithoutIndex } = account;
      return accountWithoutIndex;
    });
    
    res.json(accountsWithoutIndex);
  } catch (error) {
    console.error('Error in get accounts by receiver endpoint:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
