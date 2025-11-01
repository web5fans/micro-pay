import { getTimeoutPayments, deletePayment } from '../models/payment';
import { deleteAccountsByPaymentId } from '../models/account';
import { releasePlatformAddress } from '../models/platformAddress';

/**
 * 清理超时的支付记录
 * @param timeoutMinutes 超时时间（分钟）
 */
export async function cleanupTimeoutPayments(timeoutMinutes: number = 5): Promise<void> {
  try {
    console.log(`[Payment Cleanup] 开始检查超时支付记录 (${timeoutMinutes}分钟)...`);
    
    // 获取所有超时的未完成支付记录
    const timeoutPayments = await getTimeoutPayments(timeoutMinutes);
    
    if (timeoutPayments.length === 0) {
      console.log('[Payment Cleanup] 没有发现超时支付记录');
      return;
    }
    
    console.log(`[Payment Cleanup] 发现 ${timeoutPayments.length} 条超时支付记录`);
    
    // 处理每一条超时支付记录
    for (const payment of timeoutPayments) {
      try {
        console.log(`[Payment Cleanup] 处理支付记录 ID: ${payment.id}, 发送者: ${payment.sender}`);
        
        // 1. 删除相关的分账记录
        await deleteAccountsByPaymentId(payment.id);
        console.log(`[Payment Cleanup] 已删除支付记录 ${payment.id} 的相关分账记录`);
        
        // 2. 释放平台地址
        await releasePlatformAddress(payment.platform_address_index);
        console.log(`[Payment Cleanup] 已释放平台地址索引: ${payment.platform_address_index}`);
        
        // 3. 删除支付记录
        await deletePayment(payment.id);
        console.log(`[Payment Cleanup] 已删除支付记录 ID: ${payment.id}`);
      } catch (error) {
        console.error(`[Payment Cleanup] 处理支付记录 ${payment.id} 时出错:`, error);
      }
    }
    
    console.log('[Payment Cleanup] 超时支付记录清理完成');
  } catch (error) {
    console.error('[Payment Cleanup] 清理超时支付记录时出错:', error);
  }
}

/**
 * 启动定期清理任务
 * @param intervalMinutes 清理间隔（分钟）
 * @param timeoutMinutes 支付超时时间（分钟）
 */
export function startPaymentCleanupTask(intervalMinutes: number = 1, timeoutMinutes: number = 5): NodeJS.Timeout {
  console.log(`[Payment Cleanup] 启动定期清理任务，间隔: ${intervalMinutes}分钟，超时时间: ${timeoutMinutes}分钟`);
  
  // 立即执行一次清理
  cleanupTimeoutPayments(timeoutMinutes).catch(err => {
    console.error('[Payment Cleanup] 初始清理任务执行失败:', err);
  });
  
  // 设置定期执行的间隔
  const intervalMs = intervalMinutes * 60 * 1000;
  
  // 返回定时器，以便在需要时可以停止任务
  return setInterval(() => {
    cleanupTimeoutPayments(timeoutMinutes).catch(err => {
      console.error('[Payment Cleanup] 定期清理任务执行失败:', err);
    });
  }, intervalMs);
}