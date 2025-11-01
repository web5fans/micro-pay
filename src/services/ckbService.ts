import { Address, ccc, CellDepLike, hexFrom, Transaction, WitnessArgs } from "@ckb-ccc/core";
import { HDKey } from "@scure/bip32";
import * as bip39 from "@scure/bip39";
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { createPlatformAddress, getAllPlatformAddress, PlatformAddress } from "../models/platformAddress";
import dotenv from 'dotenv';
import { query } from '../db';

// load environment variables
dotenv.config();

// Platform configuration
export const MIN_WITHDRAWAL_AMOUNT = BigInt(65 * 10**8); // 65 CKB in shannons
// Provide a default test mnemonic for development environment
const PLATFORM_MNEMONIC = process.env.PLATFORM_MNEMONIC || 'calm gown solid jaguar card web paper loan scale sister rebel syrup';
const CKB_NODE_URL = process.env.CKB_NODE_URL || 'https://testnet.ckb.dev/rpc';
const CKB_NETWORK = process.env.CKB_NETWORK || 'ckb_testnet';

// Generate multiple platform addresses
const PLATFORM_ADDRESS_COUNT = 2;
const platformAddresses: string[] = [];

// CKB client
const cccClient = CKB_NETWORK === 'ckb_testnet' ? new ccc.ClientPublicTestnet() : new ccc.ClientPublicMainnet();

// Initialize platform addresses
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
  
  // Generate and store platform addresses
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
    
    // Store address in database
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

// build 2-2 transaction
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

    // Select suitable cells as transaction inputs
    let sendSum = BigInt(0);
    const senderCells = [];
    for await (const cell of senderSigner.findCells(
      {
        scriptLenRange: [0, 1],
        outputDataLenRange: [0, 1],
      }, false, "asc", 10
    )) {
      sendSum += BigInt(cell.cellOutput.capacity);
      senderCells.push(cell);
      if (sendSum >= amount + MIN_WITHDRAWAL_AMOUNT) {
        break;
      }
    }

    if (sendSum < amount + MIN_WITHDRAWAL_AMOUNT) {
      throw new Error('Sender not enough balance');
    }

    // Each platform address only has one cell
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
      break;
    }

    if (platformCells.length === 0) {
      throw new Error('Platform cell not found');
    }

    const inputCells = [...senderCells, ...platformCells];
    const inputs = inputCells.map((cell) => ({
      previousOutput: cell.outPoint,
      since: "0x0",
    }));

    // Collect all lock codehashes and remove duplicates
    const lockCodeHashes = new Set(inputCells.map((cell) => cell.cellOutput.lock.codeHash));
    // Collect all cell dependencies
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

    // fixed fee
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

export async function completeTransaction(platformAddressIndex: number, partSignedTx: string) {
  try {
    const txObj = JSON.parse(partSignedTx);

    const tx = Transaction.from(txObj);

    const platformPrivateKey = await getPrivateKey(platformAddressIndex);
    const platformSigner = new ccc.SignerCkbPrivateKey(cccClient, platformPrivateKey);

    const signedTx = await platformSigner.signTransaction(tx);

    const txHash = await platformSigner.sendTransaction(signedTx);
    
    return txHash;
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error completing transfer:', error.message);
    }
    throw error;
  }
}

// check transaction status
export async function checkTransactionStatus(txHash: string): Promise<boolean> {
  return true;
}