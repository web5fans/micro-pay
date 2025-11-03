import { PoolClient } from 'pg';
import { query } from '../db';

export interface Account {
  id: number;
  payment_id: number;
  receiver: string;
  amount: number;
  info: string | null;
  status: number; // 0: prepare, 1: (payment) complete, 2: cancel, 3: accounting, 4: accounted
  tx_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

// Create split account record (transaction version)
export async function createAccountWithTransaction(
  client: PoolClient,
  payment_id: number,
  receiver: string,
  amount: number,
  info: string | null = null
) {
  const result = await client.query(
    `INSERT INTO account (payment_id, receiver, amount, info, status)
     VALUES ($1, $2, $3, $4, 0)
     RETURNING *`,
    [payment_id, receiver, amount, info]
  );
  
  return result.rows[0];
}

// Update account status to complete (transaction version)
export async function updateAccountStatusFromPrepareToCompleteWithTransaction(
  client: PoolClient,
  payment_id: number
) {
  await client.query(
    `UPDATE account
     SET status = 1, updated_at = NOW()
     WHERE payment_id = $1 And status = 0`,
    [payment_id]
  );
}

export async function updateAccountStatusFromPrepareToCancelWithTransaction(
  client: PoolClient,
  payment_id: number
) {
  await client.query(
    `UPDATE account 
     SET status = 2, updated_at = NOW()
     WHERE payment_id = $1 And status = 0`,
    [payment_id]
  );
}

export async function getAccountsByPaymentId(payment_id: number): Promise<Account[]> {
  const result = await query(
    `SELECT * FROM account WHERE payment_id = $1`,
    [payment_id]
  );
  
  return result.rows;
}

export async function getAccountsByReceiver(receiver: string): Promise<Account[]> {
  const result = await query(
    `SELECT * FROM account WHERE receiver = $1`,
    [receiver]
  );
  
  return result.rows;
}