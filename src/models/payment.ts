import { PoolClient } from 'pg';
import { query } from '../db';

export interface Payment {
  id: number;
  sender: string;
  receiver: string;
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
  tx_hash: string | null = null
) {
  const result = await client.query(
    `INSERT INTO payment (sender, receiver, platform_address_index, amount, info, status, tx_hash)
     VALUES ($1, $2, $3, $4, $5, 0, $6)
     RETURNING *`,
    [sender, receiver, platform_address_index, amount, info, tx_hash]
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

export async function getPaymentsBySender(sender: string): Promise<Payment[]> {
  const result = await query(
    `SELECT * FROM payment WHERE sender = $1 ORDER BY created_at DESC`,
    [sender]
  );
  
  return result.rows;
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

export async function getUncompletedPaymentsBySender(sender: string): Promise<Payment[]> {
  const result = await query(
    `SELECT * FROM payment WHERE sender = $1 AND (status = 0 OR status = 1) ORDER BY created_at DESC`,
    [sender]
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
