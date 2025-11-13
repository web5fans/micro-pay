import { PoolClient } from 'pg';
import { query } from '../db';

interface Payment {
  id: number;
  sender: string;
  receiver: string;
  sender_did?: string | null;
  receiver_did?: string | null;
  category: number;
  platform_address_index: number;
  amount: number;
  info: string | null;
  status: number; // 0: prepare, 1: transfer, 2: complete, 3: cancel
  tx_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

// Create payment record (transaction version)
export async function createPaymentWithTransaction(
  client: PoolClient,
  sender: string,
  receiver: string,
  platform_address_index: number,
  amount: number,
  info: string | null = null,
  tx_hash: string | null = null,
  sender_did: string | null = null,
  receiver_did: string | null = null,
  category: number = 0
) {
  const result = await client.query(
    `INSERT INTO payment (sender, receiver, platform_address_index, amount, info, status, tx_hash, sender_did, receiver_did, category)
     VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9)
     RETURNING *`,
    [sender, receiver, platform_address_index, amount, info, tx_hash, sender_did, receiver_did, category]
  );
  
  return result.rows[0];
}

export async function updatePaymentStatusFromPrepareToTransfer(id: number): Promise<Payment> {
  const result = await query(
    `UPDATE payment
     SET status = 1, updated_at = NOW()
     WHERE id = $1 AND status = 0
     RETURNING *`,
    [id] 
  );
  
  return result.rows[0];  
}

export async function updatePaymentStatusFromTransferToPrepare(id: number) {
  const result = await query(
    `UPDATE payment
     SET status = 0, updated_at = NOW()
     WHERE id = $1 AND status = 1
     RETURNING *`,
    [id] 
  );
  return result.rows[0] || null;
}

export async function updatePaymentStatusFromTransferToCompleteWithTransaction(
  client: PoolClient,
  id: number
) {
  const result = await client.query(
    `UPDATE payment
     SET status = 2, updated_at = NOW()
     WHERE id = $1 AND status = 1
     RETURNING *`,
    [id] 
  );
  return result.rows[0] || null;
}

export async function updatePaymentFromPrepareToCancelWithTransaction(
  client: PoolClient,
  id: number
) {
  const result = await client.query(
    `UPDATE payment
     SET status = 3, updated_at = NOW()
     WHERE id = $1 AND status = 0
     RETURNING *`,
    [id] 
  );
  return result.rows[0] || null;
}


export async function updatePaymentFromPrepareToCancelBySenderWithTransaction(
  client: PoolClient,
  sender: string
) : Promise<Payment[]> {
  const result = await client.query(
    `UPDATE payment
     SET status = 3, updated_at = NOW()
     WHERE sender = $1 AND status = 0
     RETURNING *`,
    [sender] 
  );
  return result.rows;
}

export async function updatePaymentFromPrepareToCancelBySenderDidWithTransaction(
  client: PoolClient,
  sender_did: string
) : Promise<Payment[]> {
  const result = await client.query(
    `UPDATE payment
     SET status = 3, updated_at = NOW()
     WHERE sender_did = $1 AND status = 0
     RETURNING *`,
    [sender_did] 
  );
  return result.rows;
}


export async function updatePaymentStatusFromTransferToCancelWithTransaction(
  client: PoolClient,
  id: number
) {
  const result = await client.query(
    `UPDATE payment
     SET status = 3, updated_at = NOW()
     WHERE id = $1 AND status = 1
     RETURNING *`,
    [id] 
  );
  return result.rows[0] || null;
}

export async function getPaymentById(id: number): Promise<Payment | null> {
  const result = await query(
    `SELECT * FROM payment WHERE id = $1`,
    [id]
  );
  
  return result.rows[0] || null;
}

export async function getPaymentsBySenderPaged(sender: string, limit: number, offset: number): Promise<Payment[]> {
  const result = await query(
    `SELECT * FROM payment 
     WHERE sender = $1 
     ORDER BY created_at DESC 
     LIMIT $2 OFFSET $3`,
    [sender, limit, offset]
  );
  return result.rows;
}

export async function getTransferPaymentsBySender(sender: string): Promise<Payment[]> {
  const result = await query(
    `SELECT * FROM payment WHERE sender = $1 AND status = 1 ORDER BY created_at DESC`,
    [sender]
  );
  
  return result.rows;
}

export async function getTransferPaymentsBySenderDid(sender_did: string): Promise<Payment[]> {
  const result = await query(
    `SELECT * FROM payment WHERE sender_did = $1 AND status = 1 ORDER BY created_at DESC`,
    [sender_did]
  );
  
  return result.rows;
}

export async function getTimeoutPayments(timeoutSeconds: number = 60): Promise<Payment[]> {
  const result = await query(
    `SELECT * FROM payment 
     WHERE status = 0
     AND created_at < NOW() - INTERVAL '${timeoutSeconds} seconds'
     ORDER BY created_at ASC`,
    []
  );
  
  return result.rows;
}

export async function getTransferPayments(): Promise<Payment[]> {
  const result = await query(
    `SELECT * FROM payment WHERE status = 1 ORDER BY created_at DESC`,
    []
  );
  
  return result.rows;
}

// Sum of completed payments by info
export async function sumCompletedPaymentsByInfo(info: string): Promise<number> {
  const result = await query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM payment WHERE status = 2 AND info = $1`,
    [info]
  );
  const total = result.rows[0]?.total;
  return typeof total === 'string' ? parseInt(total, 10) : (total ?? 0);
}

// Completed payments by info (paged)
export async function getCompletedPaymentsByInfoPaged(
  info: string,
  limit: number,
  offset: number
): Promise<Payment[]> {
  const result = await query(
    `SELECT * FROM payment 
     WHERE status = 2 AND info = $1 
     ORDER BY created_at DESC 
     LIMIT $2 OFFSET $3`,
    [info, limit, offset]
  );
  return result.rows;
}

// Count completed payments by info
export async function countCompletedPaymentsByInfo(info: string): Promise<number> {
  const result = await query(
    `SELECT COUNT(*) AS total FROM payment WHERE status = 2 AND info = $1`,
    [info]
  );
  return parseInt(result.rows[0]?.total ?? '0', 10);
}

// Filtered queries: by sender_did with optional time range and category, with pagination
// Only include status = 1 (transfer), status = 2 (completed)
export async function countPaymentsBySenderDidFiltered(
  did: string,
  start?: Date,
  end?: Date,
  category?: number
): Promise<number> {
  const where: string[] = ['sender_did = $1 AND (status = 1 OR status = 2)'];
  const params: any[] = [did];
  let idx = 2;
  if (start) { where.push(`created_at >= $${idx++}`); params.push(start); }
  if (end) { where.push(`created_at <= $${idx++}`); params.push(end); }
  if (typeof category === 'number') { where.push(`category = $${idx++}`); params.push(category); }
  const sql = `SELECT COUNT(*) AS total FROM payment WHERE ${where.join(' AND ')}`;
  const result = await query(sql, params);
  return parseInt(result.rows[0]?.total ?? '0', 10);
}

export async function getPaymentsBySenderDidFiltered(
  did: string,
  start: Date | undefined,
  end: Date | undefined,
  category: number | undefined,
  limit: number,
  offset: number
): Promise<Payment[]> {
  const where: string[] = ['sender_did = $1 AND (status = 1 OR status = 2)'];
  const params: any[] = [did];
  let idx = 2;
  if (start) { where.push(`created_at >= $${idx++}`); params.push(start); }
  if (end) { where.push(`created_at <= $${idx++}`); params.push(end); }
  if (typeof category === 'number') { where.push(`category = $${idx++}`); params.push(category); }
  params.push(limit);
  params.push(offset);
  const sql = `SELECT * FROM payment WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
  const result = await query(sql, params);
  return result.rows;
}
