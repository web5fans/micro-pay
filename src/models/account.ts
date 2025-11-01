import { PoolClient } from 'pg';
import { query } from '../db';

export interface Account {
  id: number;
  payment_id: number;
  receiver: string;
  amount: number;
  info: string | null;
  is_payed: boolean;
  tx_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function createAccount(
  payment_id: number,
  receiver: string,
  amount: number,
  info: string | null = null
): Promise<Account> {
  const result = await query(
    `INSERT INTO account (payment_id, receiver, amount, info)
     VALUES ($1, $2, $3, $4) 
     RETURNING *`,
    [payment_id, receiver, amount, info]
  );
  
  return result.rows[0];
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
    `INSERT INTO account (payment_id, receiver, amount, info)
     VALUES ($1, $2, $3, $4) 
     RETURNING *`,
    [payment_id, receiver, amount, info]
  );
  
  return result.rows[0];
}

export async function updateAccountStatus(id: number, tx_hash: string): Promise<Account> {
  const result = await query(
    `UPDATE account
     SET is_payed = true, tx_hash = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, tx_hash]
  );
  
  return result.rows[0];
}

export async function deleteAccountsByPaymentId(payment_id: number): Promise<void> {
  await query(
    `DELETE FROM account WHERE payment_id = $1`,
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

export async function getUnpaidAccounts(): Promise<Account[]> {
  const result = await query(
    `SELECT * FROM account WHERE is_payed = false`,
    []
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