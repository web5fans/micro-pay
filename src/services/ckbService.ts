import { ccc, hexFrom, Transaction, WitnessArgs } from "@ckb-ccc/core";
import { HDKey } from "@scure/bip32";
import * as bip39 from "@scure/bip39";
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { createPlatformAddress, getAllPlatformAddress, PlatformAddress } from "../models/platformAddress";
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 平台配置
const MIN_WITHDRAWAL_AMOUNT = BigInt(65 * 10**8); // 65 CKB in shannons
// 提供一个默认的测试助记词，仅用于开发环境
const PLATFORM_MNEMONIC = process.env.PLATFORM_MNEMONIC || 'calm gown solid jaguar card web paper loan scale sister rebel syrup';
const CKB_NODE_URL = process.env.CKB_NODE_URL || 'https://testnet.ckb.dev/rpc';
const CKB_NETWORK = process.env.CKB_NETWORK || 'ckb_testnet';

// 生成多个平台地址
const PLATFORM_ADDRESS_COUNT = 10;
const platformAddresses: string[] = [];

// 导入数据库查询函数
import { query } from '../db';

// CKB client
const cccClient = CKB_NETWORK === 'ckb_testnet' ? new ccc.ClientPublicTestnet() : new ccc.ClientPublicMainnet();

// 初始化平台地址
export async function initPlatformAddresses() { 
  // 检查数据库中是否已有平台地址
  const existingAddresses = await getAllPlatformAddress();
  if (existingAddresses.length > 0) {
    console.log(`Found ${existingAddresses.length} platform addresses in database`);
    
    // 加载地址到内存
    const dbAddresses = await query('SELECT address, index FROM platform_address', []);
    for (const row of dbAddresses.rows) {
      platformAddresses.push(row.address);
    }
    return;
  }

  if (!PLATFORM_MNEMONIC) {
    throw new Error('PLATFORM_MNEMONIC is not set');
  }
  if (!bip39.validateMnemonic(PLATFORM_MNEMONIC, wordlist)) {
    throw new Error('PLATFORM_MNEMONIC is invalid');
  }
  const seed = await bip39.mnemonicToSeed(PLATFORM_MNEMONIC);
  const hdKey = HDKey.fromMasterSeed(seed);
  
  // 生成多个平台地址并存入数据库
  for (let i = 0; i < PLATFORM_ADDRESS_COUNT; i++) {
    const path = `m/44'/309'/0'/0/${i}`;
    const derivedKey = hdKey.derive(path);
    const publicKey = derivedKey.publicKey!;
    const privateKey = derivedKey.privateKey!;
    const address = await new ccc.SignerCkbPublicKey(
            cccClient,
            publicKey,
          ).getRecommendedAddress();
    console.log(`Path: ${path}, Address: ${address}`);
    
    // 存入数据库
    await createPlatformAddress(address, i);
    
    platformAddresses.push(address);
  }
  
  console.log(`Initialized ${platformAddresses.length} platform addresses`);
}

export async function getPrivateKey(index: number): Promise<Buffer> {
  if (!PLATFORM_MNEMONIC) {
    throw new Error('PLATFORM_MNEMONIC is not set');
  }
  if (!bip39.validateMnemonic(PLATFORM_MNEMONIC, wordlist)) {
    throw new Error('PLATFORM_MNEMONIC is invalid');
  }
  const seed = await bip39.mnemonicToSeed(PLATFORM_MNEMONIC);
  const hdKey = HDKey.fromMasterSeed(seed);

  const path = `m/44'/309'/0'/0/${index}`;
  const derivedKey = hdKey.derive(path);
  return Buffer.from(derivedKey.privateKey!);
}

// 构建2-2交易
export async function build2to2Transaction(
  senderAddress: string,
  platformAddress: string,
  amount: bigint
) {
  try {
    // Mock实现，返回模拟的交易数据
    console.log(`Mock: 构建2-2交易 - 发送方: ${senderAddress}, 平台地址: ${platformAddress}, 金额: ${amount}`);
    
    // 模拟交易结构
    const rawTx = {
      version: '0x0',
      cellDeps: [
        {
          outPoint: {
            txHash: '0x71a7ba8fc96349fea0ed3a5c47992e3b4084b031a42264a018e0072e8172e46c',
            index: '0x0'
          },
          depType: 'depGroup'
        }
      ],
      headerDeps: [],
      inputs: [
        {
          previousOutput: {
            txHash: '0x29ed7c9b1f0684c3b5789d85e89d8f59c6531bf386d7eb2918eed0d93ceaf7e9',
            index: '0x0'
          },
          since: '0x0'
        }
      ],
      outputs: [
        {
          capacity: `0x${amount.toString(16)}`,
          lock: {
            codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',
            args: '0x8211f1b938a107cd53b6302cc752a6fc3965638d',
            hashType: 'type'
          },
          type: null
        }
      ],
      outputsData: ['0x'],
      witnesses: ['0x']
    };
    
    const txHash = '0x' + Buffer.from(`mock_tx_hash_${Date.now()}`).toString('hex');
    
    return {
      rawTx,
      txHash
    };
  } catch (error) {
    console.error('Error building 2-2 transaction:', error);
    throw error;
  }
}

// 发送交易到链上
export async function sendTransaction(signedTx: any): Promise<string> {
  // Mock实现，模拟发送交易
  console.log('Mock: 发送交易到链上', JSON.stringify(signedTx).substring(0, 100) + '...');
  
  // 模拟交易哈希
  const txHash = '0x' + Buffer.from(`mock_tx_hash_sent_${Date.now()}`).toString('hex');
  
  return txHash;
}

// 检查交易状态
export async function checkTransactionStatus(txHash: string): Promise<boolean> {
  // Mock实现，模拟检查交易状态
  console.log(`Mock: 检查交易状态 - 交易哈希: ${txHash}`);
  
  // 模拟交易已确认
  return true;
}