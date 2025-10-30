import express, { Request, Response } from 'express';
import { preparePayment, completeTransfer } from '../services/paymentService';
import { getPaymentById, getPaymentsBySender } from '../models/payment';
import { getAccountsByPaymentId, getAccountsByReceiver } from '../models/account';

export const paymentRouter = express.Router();

// 转账准备接口
paymentRouter.post('/prepare', async (req: Request, res: Response) => {
  try {
    console.log('Request body:', req.body);
    const { sender, receiver, amount, splitReceivers, info } = req.body;
    
    // 验证请求参数
    if (!sender || !receiver || !amount) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    // 验证splitReceivers格式
    if (splitReceivers && Array.isArray(splitReceivers)) {
      for (const item of splitReceivers) {
        if (!item.address || typeof item.splitRate !== 'number' || item.splitRate < 0 || item.splitRate > 100) {
          return res.status(400).json({ error: 'Invalid splitReceivers format. Each item must have address and splitRate (0-100)' });
        }
      }
    }

    // 计算splitRate总和
    const totalSplitRate = splitReceivers ? splitReceivers.reduce((sum: number, item: { splitRate: number; }) => sum + item.splitRate, 0) : 0;
    if (totalSplitRate >= 100) {
      return res.status(400).json({ error: 'splitRate sum must be less than 100' });
    }
    
    // 准备支付
    const result = await preparePayment(sender, receiver, amount, splitReceivers, info);
    
    res.json(result);
  } catch (error) {
    console.error('Error in prepare payment endpoint:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// 转账接口
paymentRouter.post('/transfer', async (req: Request, res: Response) => {
  try {
    const { payment_id, signed_tx } = req.body;
    
    // 验证请求参数
    if (!payment_id || !signed_tx) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    // 完成转账
    const result = await completeTransfer(payment_id, signed_tx);
    
    res.json(result);
  } catch (error) {
    console.error('Error in transfer endpoint:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// 根据支付id查询支付记录
paymentRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const paymentId = parseInt(req.params.id);
    
    // 获取支付记录
    const payment = await getPaymentById(paymentId);
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    
    // 获取分账记录
    const accounts = await getAccountsByPaymentId(paymentId);
    
    // 从 payment 对象中移除 platform_address_index 字段
    const { platform_address_index, ...paymentWithoutIndex } = payment;
    
    res.json({
      payment: paymentWithoutIndex,
      accounts
    });
  } catch (error) {
    console.error('Error in get payment by id endpoint:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// 根据发送者地址查询发送的支付记录
paymentRouter.get('/sender/:address', async (req: Request, res: Response) => {
  try {
    const address = req.params.address;
    
    // 获取支付记录
    const payments = await getPaymentsBySender(address);
    
    // 从每个支付记录中移除 platform_address_index 字段
    const paymentsWithoutIndex = payments.map(payment => {
      const { platform_address_index, ...paymentWithoutIndex } = payment;
      return paymentWithoutIndex;
    });
    
    res.json(paymentsWithoutIndex);
  } catch (error) {
    console.error('Error in get payments by sender endpoint:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// 根据接收者地址查询接收的支付记录
paymentRouter.get('/receiver/:address', async (req: Request, res: Response) => {
  try {
    const address = req.params.address;
    
    // 获取支付记录
    const payments = await getAccountsByReceiver(address);
    
    res.json(payments);
  } catch (error) {
    console.error('Error in get accounts by receiver endpoint:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
