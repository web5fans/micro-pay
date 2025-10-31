import { Address, ccc, CellDepLike, hexFrom, Transaction, WitnessArgs } from "@ckb-ccc/core";
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
const PLATFORM_ADDRESS_COUNT = 2;
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

export async function getPrivateKey(index: number): Promise<string> {
  if (!PLATFORM_MNEMONIC) {
    throw new Error('PLATFORM_MNEMONIC is not set');
  }
  if (!bip39.validateMnemonic(PLATFORM_MNEMONIC, wordlist)) {
    throw new Error('PLATFORM_MNEMONIC is invalid');
  }

  if (index < 0 || index >= PLATFORM_ADDRESS_COUNT) {
    throw new Error('Invalid platform address index');
  }

  const seed = await bip39.mnemonicToSeed(PLATFORM_MNEMONIC);
  const hdKey = HDKey.fromMasterSeed(seed);

  const path = `m/44'/309'/0'/0/${index}`;
  const derivedKey = hdKey.derive(path);
  return hexFrom(derivedKey.privateKey!);
}

export async function getAddressBalance(ckbAddress: string): Promise<bigint> {
  const addr = await Address.fromString(ckbAddress, cccClient);
  const balance = await cccClient.getBalance([addr.script]);
  return balance;
}

// 构建2-2交易
export async function build2to2Transaction(
  senderAddress: string,
  platformAddress: string,
  amount: bigint
) {
  try {
    const senderAddr = await Address.fromString(senderAddress, cccClient);
    const platformAddr = await Address.fromString(platformAddress, cccClient);

    const senderSigner = new ccc.SignerCkbScriptReadonly(
      cccClient,
      senderAddr.script
    );

    const platformSigner = new ccc.SignerCkbScriptReadonly(
      cccClient,
      platformAddr.script
    );

    // 挑选合适的cell作为交易的input
    let sendSum = BigInt(0);
    const senderCells = [];
    for await (const cell of senderSigner.findCells(
      {}, false, "asc", 10
    )) {
      sendSum += BigInt(cell.cellOutput.capacity);
      senderCells.push(cell);
      if (sendSum >= amount + MIN_WITHDRAWAL_AMOUNT) {
        break;
      }
    }
  
    console.log('Sender cells:', senderCells);
    console.log('Sender sum:', sendSum);

    if (sendSum < amount + MIN_WITHDRAWAL_AMOUNT) {
      throw new Error('Sender not enough balance');
    }

    // 每个平台地址只有一个cell
    const platformCells = [];
    let platformSum = BigInt(0);
    for await (const cell of platformSigner.findCells(
      {},
      false,
      "asc",
      2,
    )) {
      platformSum = platformSum + BigInt(cell.cellOutput.capacity);
      platformCells.push(cell);
      break; // 只取第一个 cell
    }

    if (platformCells.length === 0) {
      throw new Error('Platform cell not found');
    }

    const inputCells = [...senderCells, ...platformCells];
    const inputs = inputCells.map((cell) => ({
      previousOutput: cell.outPoint,
      since: "0x0",
    }));

    // 收集所有的lock codehash 并去重
    const lockCodeHashes = new Set(inputCells.map((cell) => cell.cellOutput.lock.codeHash));
    const cellDeps: CellDepLike[] = [];
    for (const codeHash of lockCodeHashes) {
      Object.entries(cccClient.scripts).forEach(([key, value]) => {
        if (!value) {
          return;
        }
        if (value.codeHash === codeHash) {
          // [{"cellDep":{"outPoint":{"txHash":"0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37","index":0},"depType":"depGroup"}}]
          value.cellDeps.forEach((cellDepRecord) => {
            cellDeps.push(cellDepRecord["cellDep"]);
          });
        }
      });
    }

    const fee = BigInt(10000);
    const outputs = [
      {
        capacity: `${platformSum + amount}`,
        lock: platformAddr.script,
      },
      {
        capacity: `${sendSum - amount - fee}`,
        lock: senderAddr.script,
      },
    ];

    const tx = Transaction.from({
      version: 0,
      cellDeps: cellDeps,
      inputs: inputs,
      outputs: outputs,
      outputsData: [],
    });

    const rawTx = ccc.stringify(tx);
    console.log('Raw transaction:', rawTx);
    
    const txHash = tx.hash();
    
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