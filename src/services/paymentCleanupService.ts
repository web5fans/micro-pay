import { getTimeoutPayments, updatePaymentFromPrepareToCancelWithTransaction } from '../models/payment';
import { updateAccountStatusFromPrepareToCancelWithTransaction } from '../models/account';
import { releasePlatformAddressWithTransaction } from '../models/platformAddress';
import { withTransaction } from '../db';

/**
 * Clean up timeout payment records
 * @param timeoutSeconds Timeout duration (seconds)
 */
export async function cleanupTimeoutPayments(timeoutSeconds: number = 60): Promise<void> {
  try {
    console.log(`[Payment Cleanup] Starting to check timeout payment records (${timeoutSeconds} seconds)...`);
    
    // Get all timeout incomplete payment records
    const timeoutPayments = await getTimeoutPayments(timeoutSeconds);
    
    if (timeoutPayments.length === 0) {
      console.log(`[Payment Cleanup] No timeout payment records found (${timeoutSeconds} seconds)`);
      return;
    }
    
    console.log(`[Payment Cleanup] Found ${timeoutPayments.length} timeout payment records (${timeoutSeconds} seconds)`);
    
    // Process each timeout payment record
    for (const payment of timeoutPayments) {
      try {
        console.log(`[Payment Cleanup] Processing payment record ID: ${payment.id}, Sender: ${payment.sender}, Timeout: ${timeoutSeconds} seconds`);

        await withTransaction(async (client) => {
          // 1. Update payment status to cancel
          const updated = await updatePaymentFromPrepareToCancelWithTransaction(client, payment.id);
          if (!updated) {
            // Payment was no longer in prepare; skip release/cancel
            console.log(`[Payment Cleanup] Payment ${payment.id} not in prepare, skip release/cancel`);
            return;
          }
          // 2. Release platform address
          await releasePlatformAddressWithTransaction(client, payment.platform_address_index);
          // 3. update account status to cancel
          await updateAccountStatusFromPrepareToCancelWithTransaction(client, payment.id);
        });
      } catch (error) {
        console.error(`[Payment Cleanup] Error processing payment record ${payment.id} (${timeoutSeconds} seconds):`, error);
      }
    }
    console.log(`[Payment Cleanup] Timeout payment records cleanup completed (${timeoutSeconds} seconds)`);
  } catch (error) {
    console.error(`[Payment Cleanup] Error cleaning up timeout payment records (${timeoutSeconds} seconds):`, error);
  }
}

/**
 * Start periodic cleanup task
 * @param intervalSeconds Cleanup interval (seconds)
 * @param timeoutSeconds Payment timeout duration (seconds)
 */
export function startPaymentCleanupTask(intervalSeconds: number = 30, timeoutSeconds: number = 60): NodeJS.Timeout {
  console.log(`[Payment Cleanup] Starting periodic cleanup task, interval: ${intervalSeconds} seconds, timeout: ${timeoutSeconds} seconds`);
  
  // Execute cleanup immediately
  cleanupTimeoutPayments(timeoutSeconds).catch(err => {
    console.error('[Payment Cleanup] Initial cleanup task execution failed:', err);
  });
  
  // Set periodic execution interval
  const intervalMs = intervalSeconds * 1000;
  
  // Return timer for potential task cancellation
  return setInterval(() => {
    cleanupTimeoutPayments(timeoutSeconds).catch(err => {
      console.error('[Payment Cleanup] Periodic cleanup task execution failed:', err);
    });
  }, intervalMs);
}