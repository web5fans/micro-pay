import express, { Request, Response } from 'express';
import { preparePayment, completeTransfer } from '../services/paymentService';
import { getPaymentById, getPaymentsBySenderPaged, countPaymentsBySenderDidFiltered, getPaymentsBySenderDidFiltered, sumCompletedPaymentsByInfo, getCompletedPaymentsByInfoPaged, countCompletedPaymentsByInfo } from '../models/payment';
import { getAccountsByPaymentId, getAccountsByReceiverPaged, countAccountsByReceiverDidFiltered, getAccountsByReceiverDidFiltered } from '../models/account';
import { ErrorCode } from './errorCodes';

export const paymentRouter = express.Router();

// Payment preparation endpoint
paymentRouter.post('/prepare', async (req: Request, res: Response) => {
  try {
    console.log('prepare Request body:', req.body);
    const { sender, receiver, amount, splitReceivers, info, senderDid, receiverDid, category } = req.body;
    
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
    const normalizedCategory = (typeof category === 'number' && Number.isInteger(category) && category >= 0) ? category : 0;
    const result = await preparePayment(sender, receiver, amount, splitReceivers, info, senderDid ?? null, receiverDid ?? null, normalizedCategory);
    
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
    // Platform cell not found
    if (message.includes('Platform cell not found')) {
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

// Query payment record by payment id (only numeric ids)
paymentRouter.get('/id/:id', async (req: Request, res: Response) => {
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
    
    const paymentResponse = {
      id: (payment as any).id,
      sender: (payment as any).sender,
      receiver: (payment as any).receiver,
      senderDid: (payment as any).sender_did ?? undefined,
      receiverDid: (payment as any).receiver_did ?? undefined,
      category: (payment as any).category,
      amount: (payment as any).amount,
      info: (payment as any).info ?? undefined,
      status: (payment as any).status,
      txHash: (payment as any).tx_hash ?? undefined,
      createdAt: (payment as any).created_at,
      updatedAt: (payment as any).updated_at,
    };

    const accountsResponse = accounts.map((a: any) => ({
      id: a.id,
      paymentId: a.payment_id,
      receiver: a.receiver,
      receiverDid: a.receiver_did ?? undefined,
      category: a.category,
      amount: a.amount,
      info: a.info ?? undefined,
      status: a.status,
      txHash: a.tx_hash ?? undefined,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
    }));

    res.json({
      payment: paymentResponse,
      accounts: accountsResponse,
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
    
    // Map to camelCase response and remove platform_address_index
    const items = payments.map((p) => {
      const rest = p as any;
      return {
        id: rest.id,
        sender: rest.sender,
        receiver: rest.receiver,
        senderDid: rest.sender_did ?? undefined,
        receiverDid: rest.receiver_did ?? undefined,
        category: rest.category,
        amount: rest.amount,
        info: rest.info ?? undefined,
        status: rest.status,
        txHash: rest.tx_hash ?? undefined,
        createdAt: rest.created_at,
        updatedAt: rest.updated_at,
      };
    });
    
    res.json({ items, pagination: { limit, offset, count: items.length } });
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
    
    // Map to camelCase response and remove platform_address_indexes
    const items = accounts.map((a) => {
      const rest = a as any;
      return {
        id: rest.id,
        paymentId: rest.payment_id,
        receiver: rest.receiver,
        receiverDid: rest.receiver_did ?? undefined,
        category: rest.category,
        amount: rest.amount,
        info: rest.info ?? undefined,
        status: rest.status,
        txHash: rest.tx_hash ?? undefined,
        createdAt: rest.created_at,
        updatedAt: rest.updated_at,
      };
    });
    
    res.json({ items, pagination: { limit, offset, count: items.length } });
  } catch (error) {
    console.error('Error in get accounts by receiver endpoint:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message, code: ErrorCode.INTERNAL_ERROR });
  }
});

// Query payments by sender DID with filters
paymentRouter.get('/sender-did/:did', async (req: Request, res: Response) => {
  try {
    const { did } = req.params;
    const { start, end, category, limit = '20', offset = '0' } = req.query as Record<string, string>;

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
    const startDate = start ? new Date(start) : undefined;
    const endDate = end ? new Date(end) : undefined;
    if (start && isNaN(startDate!.getTime())) {
      return res.status(400).json({ error: 'Invalid start date', code: ErrorCode.VALIDATION_ERROR });
    }
    if (end && isNaN(endDate!.getTime())) {
      return res.status(400).json({ error: 'Invalid end date', code: ErrorCode.VALIDATION_ERROR });
    }
    const categoryNum = category !== undefined ? Number(category) : undefined;
    if (category !== undefined && (!Number.isInteger(categoryNum!) || categoryNum! < 0)) {
      return res.status(400).json({ error: 'Invalid category (>=0 integer)', code: ErrorCode.VALIDATION_ERROR });
    }

    const [items, count] = await Promise.all([
      getPaymentsBySenderDidFiltered(did, startDate, endDate, categoryNum, limitNum, offsetNum),
      countPaymentsBySenderDidFiltered(did, startDate, endDate, categoryNum)
    ]);

    res.json({
      items: items.map(p => ({
        id: p.id,
        sender: p.sender,
        receiver: p.receiver,
        amount: p.amount,
        info: p.info,
        status: p.status,
        txHash: p.tx_hash,
        category: p.category,
        createdAt: p.created_at
      })),
      pagination: { limit: limitNum, offset: offsetNum, count }
    });
  } catch (error) {
    console.error('Error in sender DID query endpoint:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message, code: ErrorCode.INTERNAL_ERROR });
  }
});

// Query accounts by receiver DID with filters
paymentRouter.get('/receiver-did/:did', async (req: Request, res: Response) => {
  try {
    const { did } = req.params;
    const { start, end, category, limit = '20', offset = '0' } = req.query as Record<string, string>;

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
    const startDate = start ? new Date(start) : undefined;
    const endDate = end ? new Date(end) : undefined;
    if (start && isNaN(startDate!.getTime())) {
      return res.status(400).json({ error: 'Invalid start date', code: ErrorCode.VALIDATION_ERROR });
    }
    if (end && isNaN(endDate!.getTime())) {
      return res.status(400).json({ error: 'Invalid end date', code: ErrorCode.VALIDATION_ERROR });
    }
    const categoryNum = category !== undefined ? Number(category) : undefined;
    if (category !== undefined && (!Number.isInteger(categoryNum!) || categoryNum! < 0)) {
      return res.status(400).json({ error: 'Invalid category (>=0 integer)', code: ErrorCode.VALIDATION_ERROR });
    }

    const [items, count] = await Promise.all([
      getAccountsByReceiverDidFiltered(did, startDate, endDate, categoryNum, limitNum, offsetNum),
      countAccountsByReceiverDidFiltered(did, startDate, endDate, categoryNum)
    ]);

    res.json({
      items: items.map(a => ({
        id: a.id,
        paymentId: a.payment_id,
        receiver: a.receiver,
        amount: a.amount,
        info: a.info,
        status: a.status,
        txHash: a.tx_hash,
        category: a.category,
        createdAt: a.created_at
      })),
      pagination: { limit: limitNum, offset: offsetNum, count }
    });
  } catch (error) {
    console.error('Error in receiver DID query endpoint:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message, code: ErrorCode.INTERNAL_ERROR });
  }
});

// Completed payments total by info (query param)
paymentRouter.get('/completed-total', async (req: Request, res: Response) => {
  try {
    const { info } = req.query as Record<string, string>;
    if (!info || typeof info !== 'string' || info.length > 2000) {
      return res.status(400).json({ error: 'Invalid info', code: ErrorCode.VALIDATION_ERROR });
    }
    const total = await sumCompletedPaymentsByInfo(info);
    res.json({ info, total });
  } catch (error) {
    console.error('Error in completed-total endpoint:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message, code: ErrorCode.INTERNAL_ERROR });
  }
});

// Completed payments by info (paged)
paymentRouter.get('/completed', async (req: Request, res: Response) => {
  try {
    const { info, limit = '20', offset = '0' } = req.query as Record<string, string>;
    if (!info || typeof info !== 'string' || info.length > 2000) {
      return res.status(400).json({ error: 'Invalid info', code: ErrorCode.VALIDATION_ERROR });
    }
    const limitNum = Number(limit);
    const offsetNum = Number(offset);
    if (!Number.isInteger(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({ error: 'Invalid limit (1-100)', code: ErrorCode.VALIDATION_ERROR });
    }
    if (!Number.isInteger(offsetNum) || offsetNum < 0) {
      return res.status(400).json({ error: 'Invalid offset (>=0)', code: ErrorCode.VALIDATION_ERROR });
    }
    const [items, count] = await Promise.all([
      getCompletedPaymentsByInfoPaged(info, limitNum, offsetNum),
      countCompletedPaymentsByInfo(info)
    ]);
    res.json({
      items: items.map(p => ({
        id: p.id,
        sender: p.sender,
        senderDid: p.sender_did ?? undefined,
        receiver: p.receiver,
        receiverDid: p.receiver_did ?? undefined,
        amount: p.amount,
        info: p.info ?? undefined,
        status: p.status,
        txHash: p.tx_hash ?? undefined,
        category: p.category,
        createdAt: p.created_at
      })),
      pagination: { limit: limitNum, offset: offsetNum, count }
    });
  } catch (error) {
    console.error('Error in completed-by-info endpoint:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message, code: ErrorCode.INTERNAL_ERROR });
  }
});


