import { createPayment, createPaymentWithTransaction, getPaymentById, getPaymentsBySender, getUncompletedPaymentsBySender, updatePaymentStatus } from '../models/payment';
import { createAccount, createAccountWithTransaction } from '../models/account';
import { getAvailablePlatformAddress, getAvailablePlatformAddressWithTransaction, releasePlatformAddress } from '../models/platformAddress';
import { build2to2Transaction, completeTransaction, getAddressBalance, MIN_WITHDRAWAL_AMOUNT } from './ckbService';
import { withTransaction } from '../db';

// Split receiver interface
interface SplitReceiver {
  address: string;
  splitRate: number;
}

// Prepare payment
export async function preparePayment(
  senderAddress: string,
  receiverAddress: string,
  amount: number,
  splitReceivers: SplitReceiver[] = [],
  info: string | null = null
) {
  // If sender has incomplete payments, return error
  const existingPayment = await getUncompletedPaymentsBySender(senderAddress);
  if (existingPayment.length > 0) {
    throw new Error('Sender has an incomplete payment');
  }

  // Check if sender address has enough balance
  const senderBalance = await getAddressBalance(senderAddress);
  if (senderBalance < BigInt(amount) + MIN_WITHDRAWAL_AMOUNT) {
    throw new Error('Sender does not have enough balance');
  }

  // Get available platform address
  const platformAddressRecord = await getAvailablePlatformAddress();
  if (!platformAddressRecord) {
    console.error('No available platform address found');
    throw new Error('No available platform address');
  }

  try {
    // Build 2-2 transaction
    const platformAddress = platformAddressRecord.address;
    const { rawTx, txHash } = await build2to2Transaction(
        senderAddress,
        platformAddress,
        BigInt(amount)
      );

    // Use transaction to ensure database operations atomicity
    const result = await withTransaction(async (client) => {
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
        info
      );

      // Create split receiver account records
      for (const splitReceiver of splitReceivers) {
        const splitAmount = Math.floor(amount * splitReceiver.splitRate / 100);
        await createAccountWithTransaction(client, payment.id, splitReceiver.address, splitAmount, info);
      }

      // Create receiver account record
      await createAccountWithTransaction(
        client, 
        payment.id, 
        receiverAddress, 
        Math.floor(amount * receiverSplitRate / 100),
        info
      );

      return {
        paymentId: payment.id,
        rawTx,
        txHash
      };
    });

    return result;
  } catch (error) {
    // Release platform address
    await releasePlatformAddress(platformAddressRecord.index);
    if (error instanceof Error) {
      console.error('Error preparing payment:', error.message);
    }
    throw error;
  }
}

// Complete transfer
export async function completeTransfer(paymentId: number, partSignedTx: string) {
  try {
    // Check if payment record exists
    const payment = await getPaymentById(paymentId);
    if (!payment || payment.is_complete) {
      throw new Error('Payment not found or already completed');
    }

    // Complete transaction and send to chain
    const txHash = await completeTransaction(payment.platform_address_index, partSignedTx);
    
    // Update payment status to completed
    await updatePaymentStatus(paymentId, txHash);

    // Release platform address
    await releasePlatformAddress(payment.platform_address_index);
    
    return {
      paymentId,
      txHash,
      status: 'completed'
    };
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error completing transfer:', error.message);
    }
    throw error;
  }
}