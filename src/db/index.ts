import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 数据库连接配置
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'postgres',
  password: process.env.DB_PASSWORD || '123456',
  port: parseInt(process.env.DB_PORT || '5432'),
});

// 查询函数
export const query = (text: string, params: any[]) => pool.query(text, params);

// 事务支持
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

// 初始化数据库表
export async function initDb() {
  try {
    // 创建支付表
    await query(`
      CREATE TABLE IF NOT EXISTS payment(
        id SERIAL PRIMARY KEY,
        sender TEXT NOT NULL,
        receiver TEXT NOT NULL,
        platform_address_index INTEGER NOT NULL,
        amount BIGINT NOT NULL,
        info TEXT,
        is_complete BOOLEAN NOT NULL DEFAULT false,
        tx_hash TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `, []);
    
    // 创建账户表
    await query(`
      CREATE TABLE IF NOT EXISTS account(
        id SERIAL PRIMARY KEY,
        payment_id INTEGER NOT NULL REFERENCES payment(id),
        receiver TEXT NOT NULL,
        amount BIGINT NOT NULL,
        info TEXT,
        is_payed BOOLEAN NOT NULL DEFAULT false,
        tx_hash TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `, []);
    
    // 创建平台地址表
    await query(`
      CREATE TABLE IF NOT EXISTS platform_address(
        id SERIAL PRIMARY KEY,
        address TEXT NOT NULL UNIQUE,
        index INTEGER,
        is_used BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `, []);
    
    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Error initializing database tables:', error);
    throw error;
  }
}