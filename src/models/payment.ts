import { PoolClient } from 'pg';
import { query } from '../db';

export interface Payment {
  id: number;
  sender: string;
  receiver: string;
  sender_did?: string | null;
  receiver_did?: string | null;
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
  receiver_did: string | null = null
) {
  const result = await client.query(
    `INSERT INTO payment (sender, receiver, platform_address_index, amount, info, status, tx_hash, sender_did, receiver_did)
     VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8)
     RETURNING *`,
    [sender, receiver, platform_address_index, amount, info, tx_hash, sender_did, receiver_did]
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

// DID helpers: payment side
export async function countPaymentsByDid(did: string): Promise<number> {
  const result = await query(
    `SELECT COUNT(*) AS total FROM payment WHERE sender_did = $1`,
    [did]
  );
  return parseInt(result.rows[0]?.total ?? '0', 10);
}

export async function getPaymentsByDidSorted(did: string, limit: number): Promise<Payment[]> {
  const result = await query(
    `SELECT * FROM payment 
     WHERE sender_did = $1 
     ORDER BY created_at DESC 
     LIMIT $2`,
    [did, limit]
  );
  return result.rows;
}
