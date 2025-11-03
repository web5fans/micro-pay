import { withTransaction } from '../db';
import { updateAccountStatusFromPrepareToCompleteWithTransaction } from '../models/account';
import { getTransferPayments, updatePaymentStatusFromTransferToCompleteWithTransaction } from '../models/payment';
import { releasePlatformAddressWithTransaction } from '../models/platformAddress';
import { checkTransactionStatus } from './ckbService';


async function checkPaymentsTransactionStatus() {
  try {
    const transferPayments = await getTransferPayments();
    console.log(`[Payment Check] Found ${transferPayments.length} transfer payments`);
    
    for (const payment of transferPayments) {
      console.log(`[Payment Check] Processing transfer payment: ${payment.id}`);

      const txHash = payment.tx_hash;
      if (!txHash) {
        console.log(`[Payment Check] Payment ${payment.id} has no tx_hash, skip`);
        continue;
      }

      // Check transaction status
      const isConfirmed = await checkTransactionStatus(txHash);
      if (!isConfirmed) {
        console.log(`[Payment Check] Payment ${payment.id} transaction ${txHash} is not confirmed, skip`);
        continue;
      }
      
      await withTransaction(async (client) => {
        // Release platform address
        await releasePlatformAddressWithTransaction(client, payment.platform_address_index);
        // Update payment status to complete
        await updatePaymentStatusFromTransferToCompleteWithTransaction(client, payment.id);
        // update account status to complete
        await updateAccountStatusFromPrepareToCompleteWithTransaction(client, payment.id);
      });
      console.log(`[Payment Check] Updated payment ${payment.id} status to complete`);
    }
  } catch (error) {
    console.error('[Payment Check] Error checking timeout payments:', error);
    throw error;
  }
}

/**
 * Start periodic check task
 * @param intervalSeconds Check interval (seconds)
 */
export function startPaymentCheckTask(intervalSeconds: number = 20): NodeJS.Timeout {
  console.log(`[Payment Check] Starting periodic check task, interval: ${intervalSeconds} seconds`);
  
  // Execute cleanup immediately
  checkPaymentsTransactionStatus().catch(err => {
    console.error('[Payment Check] Initial check task execution failed:', err);
  });
  
  // Set periodic execution interval
  const intervalMs = intervalSeconds * 1000;
  
  // Return timer for potential task cancellation
  return setInterval(() => {
    checkPaymentsTransactionStatus().catch(err => {
      console.error('[Payment Check] Periodic check task execution failed:', err);
    });
  }, intervalMs);
}