import { PoolClient } from 'pg';
import { query } from '../db';

export interface Payment {
  id: number;
  sender: string;
  receiver: string;
  platform_address_index: number;
  amount: number;
  info: string | null;
  is_complete: boolean;
  tx_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function createPayment(
  sender: string,
  receiver: string,
  platform_address_index: number,
  amount: number,
  info: string | null = null, 
  txHash: string | null = null
): Promise<Payment> {
  const result = await query(
    `INSERT INTO payment (sender, receiver, platform_address_index, amount, info, is_complete, tx_hash)
     VALUES ($1, $2, $3, $4, $5, false, $6)
     RETURNING *`,
    [sender, receiver, platform_address_index, amount, info, txHash]
  );
  
  return result.rows[0];
}

// 创建支付记录（事务版本）
export async function createPaymentWithTransaction(
  client: PoolClient,
  sender: string,
  receiver: string,
  platform_address_index: number,
  amount: number,
  info: string | null = null
) {
  const result = await client.query(
    `INSERT INTO payment (sender, receiver, platform_address_index, amount, info, is_complete, tx_hash)
     VALUES ($1, $2, $3, $4, $5, false, $6)
     RETURNING *`,
    [sender, receiver, platform_address_index, amount, info, null]
  );
  
  return result.rows[0];
}


export async function updatePaymentStatus(id: number, tx_hash: string): Promise<Payment> {
  const result = await query(
    `UPDATE payment
     SET is_complete = true, tx_hash = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, tx_hash]
  );
  
  return result.rows[0];
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

export async function getUncompletedPaymentsBySender(sender: string): Promise<Payment[]> {
  const result = await query(
    `SELECT * FROM payment WHERE sender = $1 AND is_complete = false ORDER BY created_at DESC`,
    [sender]
  );
  
  return result.rows;
}

export async function getPaymentsByReceiver(receiver: string): Promise<Payment[]> {
  const result = await query(
    `SELECT * FROM payment WHERE receiver = $1 ORDER BY created_at DESC`,
    [receiver]
  );
  
  return result.rows;
}

export async function getTimeoutPayments(timeoutMinutes: number = 5): Promise<Payment[]> {
  const result = await query(
    `SELECT * FROM payment 
     WHERE is_complete = false 
     AND created_at < NOW() - INTERVAL '${timeoutMinutes} minutes'
     ORDER BY created_at ASC`,
    []
  );
  
  return result.rows;
}

export async function deletePayment(id: number): Promise<void> {
  await query(
    `DELETE FROM payment WHERE id = $1`,
    [id]
  );
}

export async function getAllPayments(): Promise<Payment[]> {
  const result = await query(
    `SELECT * FROM payment ORDER BY created_at DESC`,
    []
  );
  
  return result.rows;
}