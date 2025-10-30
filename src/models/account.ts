import { PoolClient } from 'pg';
import { query } from '../db';

export interface Account {
  id: number;
  payment_id: number;
  receiver: string;
  amount: number;
  created_at: Date;
  updated_at: Date;
  is_payed: boolean;
  tx_hash: string | null;
}

export async function createAccount(
  payment_id: number,
  receiver: string,
  amount: number
): Promise<Account> {
  const result = await query(
    `INSERT INTO account (payment_id, receiver, amount, created_at, updated_at, is_payed)
     VALUES ($1, $2, $3, NOW(), NOW(), false)
     RETURNING *`,
    [payment_id, receiver, amount]
  );
  
  return result.rows[0];
}

// 创建分账记录（事务版本）
export async function createAccountWithTransaction(
  client: PoolClient,
  payment_id: number,
  receiver: string,
  amount: number
) {
  const result = await client.query(
    `INSERT INTO account (payment_id, receiver, amount, created_at, updated_at, is_payed)
     VALUES ($1, $2, $3, NOW(), NOW(), false)
     RETURNING *`,
    [payment_id, receiver, amount]
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