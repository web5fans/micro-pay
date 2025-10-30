import { createPayment, createPaymentWithTransaction, getPaymentById, updatePaymentStatus } from '../models/payment';
import { createAccount, createAccountWithTransaction } from '../models/account';
import { getAvailablePlatformAddressWithTransaction } from '../models/platformAddress';
import { build2to2Transaction, sendTransaction } from './ckbService';
import { withTransaction } from '../db';
import { PoolClient } from 'pg';

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
  splitReceivers: SplitReceiver[] = []
) {
  try {
    // 使用事务确保数据库操作的原子性
    const result = await withTransaction(async (client) => {
      // 1. 获取可用的平台地址（在事务中）
      const platformAddressRecord = await getAvailablePlatformAddressWithTransaction(client);
      if (!platformAddressRecord) {
        console.error('No available platform address found');
        throw new Error('No available platform address');
      }

      const platformAddress = platformAddressRecord.address;

      // 2. 计算分账比例
      const totalSplitRate = splitReceivers ? splitReceivers.reduce((sum: number, item: { splitRate: number; }) => sum + item.splitRate, 0) : 0;
      const receiverSplitRate = 100 - totalSplitRate;

      // 3. 构建交易（非数据库操作，可以在事务外执行，但为了原子性放在这里）
      const { rawTx, txHash } = await build2to2Transaction(
        senderAddress,
        platformAddress,
        BigInt(amount)
      );

      // 4. 创建支付记录
      const payment = await createPaymentWithTransaction(
        client,
        senderAddress,
        receiverAddress,
        platformAddressRecord.index,
        amount
      );

      // 5. 创建分账记录
      for (const receiver of splitReceivers) {
        const splitAmount = Math.floor(amount * receiver.splitRate / 100);
        await createAccountWithTransaction(client, payment.id, receiver.address, splitAmount);
      }

      await createAccountWithTransaction(
        client, 
        payment.id, 
        receiverAddress, 
        Math.floor(amount * receiverSplitRate / 100)
      );

      return {
        paymentId: payment.id,
        rawTx,
        txHash
      };
    });

    return result;
  } catch (error) {
    // 错误已经在事务中处理，数据库操作会自动回滚
    if (error instanceof Error) {
      console.error('Error preparing payment:', error.message);
    }
    throw error;
  }
}

// 完成转账
export async function completeTransfer(paymentId: number, signedTx: any) {
  try {
    // 检查支付记录是否存在
    const payment = await getPaymentById(paymentId);
    if (!payment || payment.is_complete) {
      console.error(`Payment with ID ${paymentId} not found or already completed`);
      throw new Error('Payment not found or already completed');
    }

    // 发送交易到链上
    const txHash = await sendTransaction(signedTx);
    
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