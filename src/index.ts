import express from 'express';
import { paymentRouter } from './api/payment';
import { initDb } from './db';
import dotenv from 'dotenv';
import { initPlatformAddresses } from './services/ckbService';
import { startPaymentCleanupTask } from './services/paymentCleanupService';

// 加载环境变量
dotenv.config();

// 创建Express应用
const app = express();
const port = process.env.PORT || 3000;

// 中间件
app.use(express.json());

// 健康检查接口
app.get('/health', (req, res) => {
  res.send('OK');
});

// 路由
app.use('/api/payment', paymentRouter);

// 启动服务器
async function startServer() {
  try {
    // 初始化数据库
    await initDb();
    
    // 初始化平台地址
    await initPlatformAddresses();
    
    // 启动定期检查未完成支付记录的任务
    // 每1分钟检查一次，超过5分钟未完成的支付记录将被视为超时
    startPaymentCleanupTask(1, 5);
    
    app.listen(port, () => {
      console.log(`Server is running at http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
