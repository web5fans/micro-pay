import { PoolClient } from 'pg';
import { query } from '../db';

export interface PlatformAddress {
  id: number;
  address: string;
  index: number;
  is_used: boolean;
  created_at: Date;
}

export async function createPlatformAddress(
  address: string,
  index: number
): Promise<PlatformAddress> {
  const timeNow = new Date().toISOString();
  const result = await query(
    `INSERT INTO platform_address (address, index, is_used, created_at)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [address, index, false, timeNow]
  );
  
  return result.rows[0];
}

export async function getAllPlatformAddress(): Promise<PlatformAddress[]> {
  const result = await query(
    'SELECT * FROM platform_address ORDER BY index ASC',
    []
  );
  return result.rows || [];
}

// 获取一个可用的平台地址（支持事务）
export async function getAvailablePlatformAddressWithTransaction(client: any) {
  try {
    // 从数据库获取一个未使用的平台地址
    const result = await client.query(
      'UPDATE platform_address SET is_used = true WHERE id = (SELECT id FROM platform_address WHERE is_used = false LIMIT 1) RETURNING index, address',
      []
    );

    console.log('getAvailablePlatformAddressWithTransaction result:', result);
    
    if (result.rows.length > 0) {
      const index = result.rows[0].index;
      const address = result.rows[0].address;
      return { address, index, inUse: true };
    }
    return null;
  } catch (error) {
    console.error('Error getting available platform address:', error);
    throw error; // 在事务中抛出错误以触发回滚
  }
}

// 获取一个可用的平台地址（非事务版本，向后兼容）
export async function getAvailablePlatformAddress() {
  try {
    // 从数据库获取一个未使用的平台地址
    const result = await query(
      'UPDATE platform_address SET is_used = true WHERE id = (SELECT id FROM platform_address WHERE is_used = false LIMIT 1) RETURNING index, address',
      []
    );
    
    if (result.rows.length > 0) {
      const index = result.rows[0].index;
      const address = result.rows[0].address;
      return { address, index, inUse: true };
    }
    return null;
  } catch (error) {
    console.error('Error getting available platform address:', error);
    return null;
  }
}

// 释放平台地址
export async function releasePlatformAddress(index: number) {
  try {
    await query('UPDATE platform_address SET is_used = false WHERE index = $1', [index]);
    console.log(`Released platform address: ${index}`);  
  } catch (error) {
    console.error('Error releasing platform address:', error);
  }
}