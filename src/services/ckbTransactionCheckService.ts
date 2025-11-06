import { withTransaction } from '../db';
import { getAccountingAccounts, updateAccountStatusFromAccountingToAccountedByTransactionHashWithTransaction, updateAccountStatusFromAccountingToCompleteByTransactionHashWithTransaction, updateAccountStatusFromPrepareToCancelWithTransaction, updateAccountStatusFromPrepareToCompleteWithTransaction } from '../models/account';
import { getTransferPayments, updatePaymentStatusFromTransferToCancelWithTransaction, updatePaymentStatusFromTransferToCompleteWithTransaction } from '../models/payment';
import { releasePlatformAddressWithTransaction } from '../models/platformAddress';
import { getTransactionStatus } from './ckbService';


async function checkCkbTransactionStatus() {
  try {
    // check transfer payments
    const transferPayments = await getTransferPayments();
    console.log(`[CKB Transaction Check] Found ${transferPayments.length} transfer payments`);
    
    for (const payment of transferPayments) {
      console.log(`[CKB Transaction Check] Processing transfer payment: ${payment.id}`);

      const txHash = payment.tx_hash;
      if (!txHash) {
        console.log(`[CKB Transaction Check] Payment ${payment.id} has no tx_hash, skip`);
        continue;
      }

      // Check transaction status
      const txStatus = await getTransactionStatus(txHash);
      if (txStatus == 'committed') {
        await withTransaction(async (client) => {
          // Update payment status to complete
          const updated = await updatePaymentStatusFromTransferToCompleteWithTransaction(client, payment.id);
          if (!updated) {
            console.log(`[CKB Transaction Check] Payment ${payment.id} not in transfer, skip complete`);
            return;
          }
          // Release platform address
          await releasePlatformAddressWithTransaction(client, payment.platform_address_index);
          // update account status to complete
          await updateAccountStatusFromPrepareToCompleteWithTransaction(client, payment.id);
        });
        console.log(`[CKB Transaction Check] Updated payment ${payment.id} status to complete`);
      } else if (txStatus == 'rejected') {
        await withTransaction(async (client) => {
          // Update payment status to cancel
          const updated = await updatePaymentStatusFromTransferToCancelWithTransaction(client, payment.id);
          if (!updated) {
            console.log(`[CKB Transaction Check] Payment ${payment.id} not in transfer, skip cancel`);
            return;
          }
          // Release platform address
          await releasePlatformAddressWithTransaction(client, payment.platform_address_index);
          // update account status to cancel
          await updateAccountStatusFromPrepareToCancelWithTransaction(client, payment.id);
        });
        console.log(`[CKB Transaction Check] Updated payment ${payment.id} status to cancel`);
      }
    }

    // check accounting account
    const accounts = await getAccountingAccounts();
    console.log(`[CKB Transaction Check] Found ${accounts.length} accounting accounts`);
    for (const account of accounts) {
      console.log(`[CKB Transaction Check] Processing accounting account: ${account.id} tx_hash: ${account.tx_hash}`);
      const txStatus = await getTransactionStatus(account.tx_hash!);
      if (txStatus == 'committed') {
        await withTransaction(async (client) => {
          // update account status to complete
          await updateAccountStatusFromAccountingToAccountedByTransactionHashWithTransaction(client, account.tx_hash!);
          // release platform address
          const platform_address_indexes = account.platform_address_indexes!.split(',');
          for (const index of platform_address_indexes) {
            await releasePlatformAddressWithTransaction(client, Number(index));
          }
        });
        console.log(`[CKB Transaction Check] Updated account ${account.id} status to accounted`);
      } else if (txStatus == 'rejected' || txStatus == 'unknown') {
        await withTransaction(async (client) => {
          await updateAccountStatusFromAccountingToCompleteByTransactionHashWithTransaction(client, account.tx_hash!);
          // release platform address
          const platform_address_indexes = account.platform_address_indexes!.split(',');
          for (const index of platform_address_indexes) {
            await releasePlatformAddressWithTransaction(client, Number(index));
          }
        });
        console.log(`[CKB Transaction Check] Updated account ${account.id} status back to complete`);  
      }
    }
  } catch (error) {
    console.error('[CKB Transaction Check] Error checking timeout payments:', error);
    throw error;
  }
}

/**
 * Start periodic check task
 * @param intervalSeconds Check interval (seconds)
 */
export function startCkbTransactionCheckTask(intervalSeconds: number = 20): NodeJS.Timeout {
  console.log(`[CKB Transaction Check] Starting periodic check task, interval: ${intervalSeconds} seconds`);
  
  // Execute check immediately
  checkCkbTransactionStatus().catch(err => {
    console.error('[CKB Transaction Check] Initial check task execution failed:', err);
  });
  
  // Set periodic execution interval
  const intervalMs = intervalSeconds * 1000;
  
  // Return timer for potential task cancellation
  return setInterval(() => {
    checkCkbTransactionStatus().catch(err => {
      console.error('[CKB Transaction Check] Periodic check task execution failed:', err);
    });
  }, intervalMs);
}