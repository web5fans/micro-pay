import { PoolClient } from 'pg';
import { query } from '../db';

export interface Account {
  id: number;
  payment_id: number;
  receiver: string;
  platform_address_indexes: string;
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
  info: string | null = null,
  platform_address_indexes: string = ''
) {
  const result = await client.query(
    `INSERT INTO account (payment_id, receiver, platform_address_indexes, amount, info, status)
     VALUES ($1, $2, $3, $4, $5, 0)
     RETURNING *`,
    [payment_id, receiver, platform_address_indexes, amount, info]
  );
  
  return result.rows[0];
}

// Update account status to complete (transaction version)
export async function updateAccountStatusFromPrepareToCompleteWithTransaction(
  client: PoolClient,
  payment_id: number
) {
  const result = await client.query(
    `UPDATE account
     SET status = 1, updated_at = NOW()
     WHERE payment_id = $1 And status = 0
     RETURNING *`,
    [payment_id]
  );
  return result.rows;
}

export async function updateAccountStatusFromPrepareToCancelWithTransaction(
  client: PoolClient,
  payment_id: number
) {
  const result = await client.query(
    `UPDATE account 
     SET status = 2, updated_at = NOW()
     WHERE payment_id = $1 And status = 0
     RETURNING *`,
    [payment_id]
  );
  return result.rows;
}

export async function getAccountsByPaymentId(payment_id: number): Promise<Account[]> {
  const result = await query(
    `SELECT * FROM account WHERE payment_id = $1`,
    [payment_id]
  );
  
  return result.rows;
}

// Get all payment complete account recoreds
export async function getPaymentCompleteAccounts(): Promise<{ receiver: string; total_amount: number }[]> {
  const result = await query(
    `SELECT receiver, SUM(amount) as total_amount FROM account WHERE status = 1 GROUP BY receiver`,
    []
  );
  
  return result.rows;
}


export async function updateAccountStatusFromCompleteToAccountingWithTransaction(
  client: PoolClient,
  receiver: string
): Promise<Account[]> {
  const result = await client.query(
    `UPDATE account
     SET status = 3, updated_at = NOW()
     WHERE receiver = $1 And status = 1
     RETURNING *`,
    [receiver]
  );
  
  return result.rows;
}

// Update account tx_hash with transaction version
export async function updateTxHashAndPlatformAddressesIndexesForAccountingAccountWithTransaction(
  client: PoolClient,
  receiver: string,
  tx_hash: string,
  platform_address_indexes: string
) {
  const result = await client.query(
    `UPDATE account
     SET tx_hash = $1, platform_address_indexes = $2, updated_at = NOW()
     WHERE receiver = $3 And status = 3
     RETURNING *`,
    [tx_hash, platform_address_indexes, receiver]
  );
  return result.rows;
}

// Get all accounting account recoreds
export async function getAccountingAccounts(): Promise<Account[]> {
  const result = await query(
    `SELECT * FROM account WHERE status = 3`,
    []
  );
  
  return result.rows;
}

// Update account status to accounted (transaction version)
export async function updateAccountStatusFromAccountingToAccountedByTransactionHashWithTransaction(
  client: PoolClient,
  tx_hash: string
) {
  await client.query(
    `UPDATE account
     SET status = 4, updated_at = NOW()
     WHERE tx_hash = $1 And status = 3`,
    [tx_hash]
  );
}

// Update account status to complete (transaction version)
export async function updateAccountStatusFromAccountingToCompleteByTransactionHashWithTransaction(
  client: PoolClient,
  tx_hash: string
) {
  const result = await client.query(
    `UPDATE account
     SET status = 1, updated_at = NOW()
     WHERE tx_hash = $1 And status = 3
     RETURNING *`,
    [tx_hash]
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