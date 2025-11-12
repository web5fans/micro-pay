import { getPaymentCompleteAccounts, updateAccountStatusFromCompleteToAccountingWithTransaction, updateTxHashAndPlatformAddressesIndexesForAccountingAccountWithTransaction } from '../models/account';
import { getAvailablePlatformAddressWithTransaction } from '../models/platformAddress';
import { withTransaction } from '../db';
import { AccountingTransaction, getAddressBalance, MIN_WITHDRAWAL_AMOUNT, sendCkbTransaction, TRANSFER_FEE } from './ckbService';

async function accountCheck(): Promise<void> {
  try {
    console.log(`[Account Check] Starting to check account records...`);
    
    // Get all payment complete account recoreds group by receiver
    const completeAccounts = await getPaymentCompleteAccounts();   
    
    // Process each receiver's complete account record
    for (const account of completeAccounts) {
      try {
        console.log(`[Account Check] Processing account record, Receiver: ${account.receiver}, Total Amount: ${account.total_amount}`);

        if (account.total_amount < MIN_WITHDRAWAL_AMOUNT) {
          continue;
        }

        await withTransaction(async (client) => {
          // update account records from payment complete to accounting by receiver
          const accounts = await updateAccountStatusFromCompleteToAccountingWithTransaction(client, account.receiver);
          if (accounts.length === 0) {
            console.log(`[Account Check] No accounting account record`);
            throw new Error(`No accounting account record`);
          }
          let totalAccountingAmount = BigInt(0);
          for (const account of accounts) {
            totalAccountingAmount += BigInt(account.amount);
          }

          // found available platform address bigger than total amount
          let platformAmount = BigInt(0);
          let platformAddressesIndexes: number[] = [];
          while (true) {
            const platformAddress = await getAvailablePlatformAddressWithTransaction(client);
            if (platformAddress === null) {
              console.log(`[Account Check] No available platform address`);
              throw new Error(`No available platform address`);
            }
            platformAddressesIndexes.push(platformAddress.index);
            const balance = await getAddressBalance(platformAddress.address);
            platformAmount += balance - MIN_WITHDRAWAL_AMOUNT;
            if (platformAmount >= BigInt(account.total_amount) + TRANSFER_FEE) {
              break;
            }
          }

          // build transfer tx
          const {tx, txHash} = await AccountingTransaction(
            account.receiver,
            platformAddressesIndexes,
            totalAccountingAmount,
            platformAmount
          );

          console.log(`[Account Check] accounting tx hash: ${txHash}`);

          // update account records with transaction hash and platform addresses indexes
          const updated = await updateTxHashAndPlatformAddressesIndexesForAccountingAccountWithTransaction(client, account.receiver, txHash, platformAddressesIndexes.join(','));
          if (updated.length === 0) {
            console.log(`[Account Check] Failed to update accounting records with tx_hash`);
            throw new Error(`Failed to update accounting records with tx_hash`);
          }

          // send tx
          await sendCkbTransaction(tx);
        });
      } catch (error) {
        console.error(`[Account Check] Error processing account record ${account.receiver}:`, error); 
      }
    }
    console.log(`[Account Check] check account records completed`);
  } catch (error) {
    console.error(`[Account Check] Error checking account records:`, error);
  }
}

/**
 * Start periodic check task
 * @param intervalSeconds Check interval (seconds)
 */
export function startAccountCheckTask(intervalSeconds: number = 4 * 60 * 60): NodeJS.Timeout {
  console.log(`[Account Check] Starting periodic check task, interval: ${intervalSeconds} seconds`);
  
  // Execute check immediately
  accountCheck().catch(err => {
    console.error('[Account Check] Initial check task execution failed:', err);
  });
  
  // Set periodic execution interval
  const intervalMs = intervalSeconds * 1000;
  
  // Return timer for potential task cancellation
  return setInterval(() => {
    accountCheck().catch(err => {
      console.error('[Account Check] Periodic check task execution failed:', err);
    });
  }, intervalMs);
}