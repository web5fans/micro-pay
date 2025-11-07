import express, { Request, Response } from 'express';
import { preparePayment, completeTransfer } from '../services/paymentService';
import { getPaymentById, getPaymentsBySenderPaged, countPaymentsByDid, getPaymentsByDidSorted } from '../models/payment';
import { getAccountsByPaymentId, getAccountsByReceiverPaged, countAccountsByDid, getAccountsByDidSorted } from '../models/account';
import { ErrorCode } from './errorCodes';

export const paymentRouter = express.Router();

// Payment preparation endpoint
paymentRouter.post('/prepare', async (req: Request, res: Response) => {
  try {
    console.log('prepare Request body:', req.body);
    const { sender, receiver, amount, splitReceivers, info, senderDid, receiverDid } = req.body;
    
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
    const result = await preparePayment(sender, receiver, amount, splitReceivers, info, senderDid ?? null, receiverDid ?? null);
    
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
    const { paymentId, signedTx } = req.body;
    
    // Validate request parameters
    if (!paymentId || typeof paymentId !== 'number' || !signedTx || typeof signedTx !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid parameters', code: ErrorCode.VALIDATION_ERROR });
    }
    
    // Complete transfer
    const result = await completeTransfer(paymentId, signedTx);
    
    res.json({
      paymentId: result.paymentId,
      txHash: result.txHash,
      status: result.status,
    });
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

// Unified DID query endpoint
paymentRouter.get('/did/:did', async (req: Request, res: Response) => {
  try {
    const { did } = req.params;
    const { limit = '20', offset = '0' } = req.query as Record<string, string>;

    // Basic validation
    if (!did || typeof did !== 'string' || did.length > 200) {
      return res.status(400).json({ error: 'Invalid DID', code: ErrorCode.VALIDATION_ERROR });
    }
    const limitNum = Number(limit);
    const offsetNum = Number(offset);
    if (!Number.isInteger(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({ error: 'Invalid limit (1-100)', code: ErrorCode.VALIDATION_ERROR });
    }
    if (!Number.isInteger(offsetNum) || offsetNum < 0) {
      return res.status(400).json({ error: 'Invalid offset (>=0)', code: ErrorCode.VALIDATION_ERROR });
    }

    // Fetch enough results from each side, merge-sort by created_at desc, then paginate
    const need = limitNum + offsetNum;
    const [payments, accounts] = await Promise.all([
      getPaymentsByDidSorted(did, need),
      getAccountsByDidSorted(did, need)
    ]);

    let i = 0, j = 0;
    const merged: Array<{ type: 'payment' | 'account'; id: number; sender: string | null; receiver: string | null; amount: number; info: string | null; status: number; tx_hash: string | null; created_at: Date }> = [];
    while ((i < payments.length || j < accounts.length) && merged.length < need) {
      const p = i < payments.length ? payments[i] : null;
      const a = j < accounts.length ? accounts[j] : null;
      if (p && (!a || p.created_at >= (a as any).created_at)) {
        merged.push({ type: 'payment', id: p.id, sender: p.sender, receiver: null, amount: p.amount, info: p.info, status: p.status, tx_hash: p.tx_hash, created_at: p.created_at });
        i++;
      } else if (a) {
        merged.push({ type: 'account', id: a.id, sender: null, receiver: a.receiver, amount: a.amount, info: a.info, status: a.status, tx_hash: a.tx_hash, created_at: a.created_at });
        j++;
      } else {
        break;
      }
    }

    const sliced = merged.slice(offsetNum, offsetNum + limitNum);
    const [paymentCount, accountCount] = await Promise.all([
      countPaymentsByDid(did),
      countAccountsByDid(did)
    ]);
    const count = paymentCount + accountCount;

    res.json({
      items: sliced.map((r) => ({
        type: r.type,
        id: r.id,
        sender: r.sender ?? undefined,
        receiver: r.receiver,
        amount: r.amount,
        info: r.info,
        status: r.status,
        txHash: r.tx_hash,
        createdAt: r.created_at,
      })),
      pagination: { limit: limitNum, offset: offsetNum, count }
    });
  } catch (error) {
    console.error('Error in DID query endpoint:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message, code: ErrorCode.INTERNAL_ERROR });
  }
});

// Query payment record by payment id
paymentRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const paymentId = Number.parseInt(req.params.id);
    if (!Number.isFinite(paymentId) || paymentId <= 0) {
      return res.status(400).json({ error: 'Invalid payment id', code: ErrorCode.VALIDATION_ERROR });
    }
    
    // Get payment record
    const payment = await getPaymentById(paymentId);
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found', code: ErrorCode.NOT_FOUND });
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
    const limit = Number.parseInt(String(req.query.limit ?? '20'));
    const offset = Number.parseInt(String(req.query.offset ?? '0'));
    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'Invalid address', code: ErrorCode.VALIDATION_ERROR });
    }
    if (!Number.isFinite(limit) || limit <= 0 || limit > 100) {
      return res.status(400).json({ error: 'Invalid limit (1-100)', code: ErrorCode.VALIDATION_ERROR });
    }
    if (!Number.isFinite(offset) || offset < 0) {
      return res.status(400).json({ error: 'Invalid offset (>=0)', code: ErrorCode.VALIDATION_ERROR });
    }
    
    // Get payment records paged
    const payments = await getPaymentsBySenderPaged(address, limit, offset);
    
    // Remove platform_address_index field from each payment record
    const paymentsWithoutIndex = payments.map(payment => {
      const { platform_address_index, ...paymentWithoutIndex } = payment;
      return paymentWithoutIndex;
    });
    
    res.json({ items: paymentsWithoutIndex, pagination: { limit, offset, count: paymentsWithoutIndex.length } });
  } catch (error) {
    console.error('Error in get payments by sender endpoint:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message, code: ErrorCode.INTERNAL_ERROR });
  }
});

// Query payment records by receiver address
paymentRouter.get('/receiver/:address', async (req: Request, res: Response) => {
  try {
    const address = req.params.address;
    const limit = Number.parseInt(String(req.query.limit ?? '20'));
    const offset = Number.parseInt(String(req.query.offset ?? '0'));
    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'Invalid address', code: ErrorCode.VALIDATION_ERROR });
    }
    if (!Number.isFinite(limit) || limit <= 0 || limit > 100) {
      return res.status(400).json({ error: 'Invalid limit (1-100)', code: ErrorCode.VALIDATION_ERROR });
    }
    if (!Number.isFinite(offset) || offset < 0) {
      return res.status(400).json({ error: 'Invalid offset (>=0)', code: ErrorCode.VALIDATION_ERROR });
    }
    
    // Get account records paged
    const accounts = await getAccountsByReceiverPaged(address, limit, offset);
    
    // Remove platform_address_indexes field from each account record
    const accountsWithoutIndex = accounts.map(account => {
      const { platform_address_indexes, ...accountWithoutIndex } = account;
      return accountWithoutIndex;
    });
    
    res.json({ items: accountsWithoutIndex, pagination: { limit, offset, count: accountsWithoutIndex.length } });
  } catch (error) {
    console.error('Error in get accounts by receiver endpoint:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message, code: ErrorCode.INTERNAL_ERROR });
  }
});
