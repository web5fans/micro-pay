import { getTimeoutPayments, deletePayment } from '../models/payment';
import { deleteAccountsByPaymentId } from '../models/account';
import { releasePlatformAddress } from '../models/platformAddress';

/**
 * Clean up timeout payment records
 * @param timeoutMinutes Timeout duration (minutes)
 */
export async function cleanupTimeoutPayments(timeoutMinutes: number = 5): Promise<void> {
  try {
    console.log(`[Payment Cleanup] Starting to check timeout payment records (${timeoutMinutes} minutes)...`);
    
    // Get all timeout incomplete payment records
    const timeoutPayments = await getTimeoutPayments(timeoutMinutes);
    
    if (timeoutPayments.length === 0) {
      console.log('[Payment Cleanup] No timeout payment records found');
      return;
    }
    
    console.log(`[Payment Cleanup] Found ${timeoutPayments.length} timeout payment records`);
    
    // Process each timeout payment record
    for (const payment of timeoutPayments) {
      try {
        console.log(`[Payment Cleanup] Processing payment record ID: ${payment.id}, Sender: ${payment.sender}`);
        
        // 1. Delete related account records
        await deleteAccountsByPaymentId(payment.id);
        console.log(`[Payment Cleanup] Deleted account records for payment ${payment.id}`);
        
        // 2. Release platform address
        await releasePlatformAddress(payment.platform_address_index);
        console.log(`[Payment Cleanup] Released platform address index: ${payment.platform_address_index}`);
        
        // 3. Delete payment record
        await deletePayment(payment.id);
        console.log(`[Payment Cleanup] Deleted payment record ID: ${payment.id}`);
      } catch (error) {
        console.error(`[Payment Cleanup] Error processing payment record ${payment.id}:`, error);
      }
    }
    
    console.log('[Payment Cleanup] Timeout payment records cleanup completed');
  } catch (error) {
    console.error('[Payment Cleanup] Error cleaning up timeout payment records:', error);
  }
}

/**
 * Start periodic cleanup task
 * @param intervalMinutes Cleanup interval (minutes)
 * @param timeoutMinutes Payment timeout duration (minutes)
 */
export function startPaymentCleanupTask(intervalMinutes: number = 1, timeoutMinutes: number = 5): NodeJS.Timeout {
  console.log(`[Payment Cleanup] Starting periodic cleanup task, interval: ${intervalMinutes} minutes, timeout: ${timeoutMinutes} minutes`);
  
  // Execute cleanup immediately
  cleanupTimeoutPayments(timeoutMinutes).catch(err => {
    console.error('[Payment Cleanup] Initial cleanup task execution failed:', err);
  });
  
  // Set periodic execution interval
  const intervalMs = intervalMinutes * 60 * 1000;
  
  // Return timer for potential task cancellation
  return setInterval(() => {
    cleanupTimeoutPayments(timeoutMinutes).catch(err => {
      console.error('[Payment Cleanup] Periodic cleanup task execution failed:', err);
    });
  }, intervalMs);
}