import { createPaymentWithTransaction, getTransferPaymentsBySender, getTransferPaymentsBySenderDid, updatePaymentFromPrepareToCancelBySenderDidWithTransaction, updatePaymentFromPrepareToCancelBySenderWithTransaction, updatePaymentStatusFromPrepareToTransfer, updatePaymentStatusFromTransferToPrepare } from '../models/payment';
import { createAccountWithTransaction, updateAccountStatusFromPrepareToCancelWithTransaction } from '../models/account';
import { getAvailablePlatformAddressWithTransaction, releasePlatformAddressWithTransaction } from '../models/platformAddress';
import { build2to2Transaction, completeTransaction, getAddressBalance, MIN_WITHDRAWAL_AMOUNT } from './ckbService';
import { withTransaction } from '../db';

// Split receiver interface
interface SplitReceiver {
  address: string;
  receiverDid: string | null;
  splitRate: number;
}

// Prepare payment
export async function preparePayment(
  senderAddress: string,
  receiverAddress: string,
  amount: number,
  splitReceivers: SplitReceiver[] = [],
  info: string | null = null,
  senderDid: string | null = null,
  receiverDid: string | null = null,
  category: number = 0
) {
  // Check if sender address has enough balance
  const senderBalance = await getAddressBalance(senderAddress);
  if (senderBalance < BigInt(amount) + MIN_WITHDRAWAL_AMOUNT) {
    throw new Error('Sender does not have enough balance');
  }

  // If sender has transfer payments, return error
  const existingPayment = await getTransferPaymentsBySender(senderAddress);
  if (existingPayment.length > 0) {
    throw new Error('Sender has an incomplete payment');
  }

  // check by sender_did too
  if (senderDid) {
    // If sender has transfer payments, return error
    const existingPayment = await getTransferPaymentsBySenderDid(senderDid);
    if (existingPayment.length > 0) {
      throw new Error('Sender has an incomplete payment');
    }
  }

  try {
    // Use transaction to ensure DB operations atomicity including address allocation
    const result = await withTransaction(async (client) => {
      // clean up existing prepare payments
      const cancelledPayments = await updatePaymentFromPrepareToCancelBySenderWithTransaction(client, senderAddress);
      for (const payment of cancelledPayments) {
        console.log(`Cancelled prepare payment ${payment.id} for sender ${senderAddress}`);
        // Release platform address
        await releasePlatformAddressWithTransaction(client, payment.platform_address_index);
        // update account status to cancel
        await updateAccountStatusFromPrepareToCancelWithTransaction(client, payment.id);
      }

      // clean up existing prepare payments by sender_did too
      if (senderDid) {
        const cancelledPayments = await updatePaymentFromPrepareToCancelBySenderDidWithTransaction(client, senderDid);
        for (const payment of cancelledPayments) {
          console.log(`Cancelled prepare payment ${payment.id} for sender ${senderDid}`);
          // Release platform address
          await releasePlatformAddressWithTransaction(client, payment.platform_address_index);
          // update account status to cancel
          await updateAccountStatusFromPrepareToCancelWithTransaction(client, payment.id);
        }
      }

      // Get available platform address within transaction (will rollback on error)
      const platformAddressRecord = await getAvailablePlatformAddressWithTransaction(client);
      if (!platformAddressRecord) {
        console.error('No available platform address found');
        throw new Error('No available platform address');
      }

      // Build 2-2 transaction
      const platformAddress = platformAddressRecord.address;
      const { rawTx, txHash } = await build2to2Transaction(
        senderAddress,
        platformAddress,
        BigInt(amount)
      );

      // Calculate split ratio
      const totalSplitRate = splitReceivers ? splitReceivers.reduce((sum: number, item: { splitRate: number; }) => sum + item.splitRate, 0) : 0;
      const receiverSplitRate = 100 - totalSplitRate;

      // Create payment record
      const payment = await createPaymentWithTransaction(
        client,
        senderAddress,
        receiverAddress,
        platformAddressRecord.index,
        amount,
        info,
        txHash,
        senderDid,
        receiverDid,
        category
      );

      // Create split receiver account records
      for (const splitReceiver of splitReceivers) {
        const splitAmount = Math.floor(amount * splitReceiver.splitRate / 100);
        await createAccountWithTransaction(client, payment.id, splitReceiver.address, splitAmount, info, '', splitReceiver.receiverDid, category ?? 0);
      }

      // Create receiver account record
      await createAccountWithTransaction(
        client, 
        payment.id, 
        receiverAddress, 
        Math.floor(amount * receiverSplitRate / 100),
        info,
        '',
        receiverDid,
        category ?? 0
      );

      return {
        paymentId: payment.id,
        rawTx,
        txHash
      };
    });

    return result;
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error preparing payment:', error.message);
    }
    throw error;
  }
}

// Complete transfer
export async function completeTransfer(paymentId: number, partSignedTx: string) {
  // Update payment status to transfer
  const payment = await updatePaymentStatusFromPrepareToTransfer(paymentId);
  if (!payment) {
    // Payment exists but not in expected state (prepare)
    throw new Error('Payment not in prepare');
  }

  console.log('completeTransfer payment:', payment);

  let txHash = "";
  try {
    // Complete transaction and send to chain
    txHash = await completeTransaction(payment.platform_address_index, partSignedTx, payment.tx_hash!);
  } catch (error) {
    // Rollback payment status to prepare
    await updatePaymentStatusFromTransferToPrepare(paymentId);
    console.error('Error completing transaction:', error);
    throw error;
  }

  return {
    paymentId,
    txHash,
    status: 'completed'
  };
}