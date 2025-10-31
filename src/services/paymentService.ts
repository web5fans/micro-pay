import { createPayment, createPaymentWithTransaction, getPaymentById, getPaymentsBySender, getUncompletedPaymentsBySender, updatePaymentStatus } from '../models/payment';
import { createAccount, createAccountWithTransaction } from '../models/account';
import { getAvailablePlatformAddress, getAvailablePlatformAddressWithTransaction, releasePlatformAddress } from '../models/platformAddress';
import { build2to2Transaction, completeTransaction, getAddressBalance } from './ckbService';
import { withTransaction } from '../db';

// 分账接收者接口
interface SplitReceiver {
  address: string;
  splitRate: number;
}

// 准备支付
export async function preparePayment(
  senderAddress: string,
  receiverAddress: string,
  amount: number,
  splitReceivers: SplitReceiver[] = [],
  info: string | null = null
) {
  // 如果 sender 存在未完成的支付，则返回错误
  const existingPayment = await getUncompletedPaymentsBySender(senderAddress);
  if (existingPayment.length > 0) {
    throw new Error('Sender has an incomplete payment');
  }

  // 检查 sender 地址是否有足够余额
  const senderBalance = await getAddressBalance(senderAddress);
  if (senderBalance < BigInt(amount)) {
    throw new Error('Sender does not have enough balance');
  }

  console.log('amount:', amount);

  // 获取可用的平台地址
  const platformAddressRecord = await getAvailablePlatformAddress();
  if (!platformAddressRecord) {
    console.error('No available platform address found');
    throw new Error('No available platform address');
  }

  try {
    // 构建2-2交易
    const platformAddress = platformAddressRecord.address;
    const { rawTx, txHash } = await build2to2Transaction(
        senderAddress,
        platformAddress,
        BigInt(amount)
      );

    // 使用事务确保数据库操作的原子性
    const result = await withTransaction(async (client) => {
      // 计算分账比例
      const totalSplitRate = splitReceivers ? splitReceivers.reduce((sum: number, item: { splitRate: number; }) => sum + item.splitRate, 0) : 0;
      const receiverSplitRate = 100 - totalSplitRate;

      // 创建支付记录
      const payment = await createPaymentWithTransaction(
        client,
        senderAddress,
        receiverAddress,
        platformAddressRecord.index,
        amount,
        info
      );

      // 创建分账者分账记录
      for (const splitReceiver of splitReceivers) {
        const splitAmount = Math.floor(amount * splitReceiver.splitRate / 100);
        await createAccountWithTransaction(client, payment.id, splitReceiver.address, splitAmount, info);
      }

      // 创建接收者分账记录
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
    // 释放平台地址
    await releasePlatformAddress(platformAddressRecord.index);
    if (error instanceof Error) {
      console.error('Error preparing payment:', error.message);
    }
    throw error;
  }
}

// 完成转账
export async function completeTransfer(paymentId: number, partSignedTx: string) {
  try {
    // 检查支付记录是否存在
    const payment = await getPaymentById(paymentId);
    if (!payment || payment.is_complete) {
      throw new Error('Payment not found or already completed');
    }

    // 完善交易并发送交易到链上
    const txHash = await completeTransaction(payment.platform_address_index, partSignedTx);
    
    // 更新支付状态
    await updatePaymentStatus(paymentId, txHash);
    
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