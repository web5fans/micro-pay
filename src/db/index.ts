import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';

// load environment variables
dotenv.config();

// Database connection configuration
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'postgres',
  password: process.env.DB_PASSWORD || '123456',
  port: parseInt(process.env.DB_PORT || '5432'),
});

// Query function
export const query = (text: string, params: any[]) => pool.query(text, params);

// Transaction support
export const withTransaction = async <T>(callback: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

// Initialize database tables
export async function initDb() {
  try {
    // Create payment table
    await query(`
      CREATE TABLE IF NOT EXISTS payment(
        id SERIAL PRIMARY KEY,
        sender TEXT NOT NULL,
        receiver TEXT NOT NULL,
        sender_did TEXT,
        receiver_did TEXT,
        category INTEGER NOT NULL DEFAULT 0,
        platform_address_index INTEGER NOT NULL,
        amount BIGINT NOT NULL,
        info TEXT,
        status INTEGER NOT NULL DEFAULT 0,
        tx_hash TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `, []);
    
    // Create account table
    await query(`
      CREATE TABLE IF NOT EXISTS account(
        id SERIAL PRIMARY KEY,
        payment_id INTEGER NOT NULL REFERENCES payment(id),
        sender TEXT NOT NULL,
        sender_did TEXT,
        receiver TEXT NOT NULL,
        receiver_did TEXT,
        category INTEGER NOT NULL DEFAULT 0,
        platform_address_indexes TEXT DEFAULT '',
        amount BIGINT NOT NULL,
        info TEXT,
        status INTEGER NOT NULL DEFAULT 0,
        tx_hash TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `, []);
    
    // Create platform address table
    await query(`
      CREATE TABLE IF NOT EXISTS platform_address(
        id SERIAL PRIMARY KEY,
        address TEXT NOT NULL UNIQUE,
        index INTEGER,
        is_used BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `, []);

    // Concurrency-safety indexes
    // Ensure at most one active payment per sender (prepare or transfer statuses)
    await query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_active_sender
       ON payment(sender)
       WHERE status IN (0,1)`,
      []
    );

    // Ensure platform address index uniqueness
    await query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_platform_address_index
       ON platform_address(index)`,
      []
    );

    // Indexes for DID lookups
    await query(
      `CREATE INDEX IF NOT EXISTS ix_payment_sender_did ON payment(sender_did)`,
      []
    );
    await query(
      `CREATE INDEX IF NOT EXISTS ix_payment_receiver_did ON payment(receiver_did)`,
      []
    );
    await query(
      `CREATE INDEX IF NOT EXISTS ix_account_receiver_did ON account(receiver_did)`,
      []
    );
    
    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Error initializing database tables:', error);
    throw error;
  }
}