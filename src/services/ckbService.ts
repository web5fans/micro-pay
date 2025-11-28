import { Address, ccc, CellDepLike, hexFrom, KnownScript, Transaction } from "@ckb-ccc/core";
import { HDKey } from "@scure/bip32";
import * as bip39 from "@scure/bip39";
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { createPlatformAddress, getAllPlatformAddress } from "../models/platformAddress";
import dotenv from 'dotenv';

// load environment variables
dotenv.config();

// Platform configuration
export const MIN_WITHDRAWAL_AMOUNT = BigInt(65 * 10**8); // 65 CKB in shannons
// Transfer fee in shannons
export const TRANSFER_FEE = process.env.TRANSFER_FEE ? BigInt(process.env.TRANSFER_FEE) : BigInt(10000);

const PLATFORM_MNEMONIC = process.env.PLATFORM_MNEMONIC;
const CKB_NETWORK = process.env.CKB_NETWORK || 'ckb_testnet';

// Generate multiple platform addresses
const PLATFORM_ADDRESS_COUNT = Number(process.env.PLATFORM_ADDRESS_COUNT || 2);
const platformAddresses: string[] = [];

// CKB client
const cccClient = CKB_NETWORK === 'ckb_testnet' ? new ccc.ClientPublicTestnet() : new ccc.ClientPublicMainnet();

// Initialize platform addresses
export async function initPlatformAddresses() { 
  if (!PLATFORM_MNEMONIC) {
    throw new Error('PLATFORM_MNEMONIC is not set');
  }
  // get all platform addresses from database
  const existingAddresses = await getAllPlatformAddress();
  
  console.log(`Found ${existingAddresses.length} platform addresses in database`);
  
  // add existing addresses to platformAddresses
  for (const addr of existingAddresses) {
    platformAddresses.push(addr.address);
  }

  if (existingAddresses.length >= PLATFORM_ADDRESS_COUNT) {
    return;
  }

  if (!bip39.validateMnemonic(PLATFORM_MNEMONIC, wordlist)) {
    throw new Error('PLATFORM_MNEMONIC is invalid');
  }
  const seed = await bip39.mnemonicToSeed(PLATFORM_MNEMONIC);
  const hdKey = HDKey.fromMasterSeed(seed);
  
  // Generate and store platform addresses
  for (let i = existingAddresses.length; i < PLATFORM_ADDRESS_COUNT; i++) {
    const path = `m/44'/309'/0'/0/${i}`;
    const derivedKey = hdKey.derive(path);
    const publicKey = derivedKey.publicKey!;
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

async function getPrivateKey(index: number): Promise<string> {
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
    // clean client cache
    await cccClient.cache.clear();

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

    // fixed fee
    const fee = TRANSFER_FEE;

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
      if (sendSum >= amount + MIN_WITHDRAWAL_AMOUNT + fee) {
        break;
      }
    }

    if (sendSum < amount + MIN_WITHDRAWAL_AMOUNT) {
      throw new Error('Sender does not have enough balance');
    }

    // Each platform address only has one cell
    const platformCells = [];
    let platformSum = BigInt(0);
    for await (const cell of platformSigner.findCells(
      {
        scriptLenRange: [0, 1],
        outputDataLenRange: [0, 1],
      },
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
    // Collect Known Script for cell dep
    const knownScripts: KnownScript[] = [];
    for (const codeHash of lockCodeHashes) {
      Object.entries(cccClient.scripts).forEach(([key, value]) => {
        if (!value) {
          return;
        }
        if (value.codeHash === codeHash) {
          // [{"cellDep":{"outPoint":{"txHash":"0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37","index":0},"depType":"depGroup"}}]
          knownScripts.push(key as KnownScript);
        }
      });
    }

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
      cellDeps: [],
      inputs: inputs,
      outputs: outputs,
      outputsData: [],
    });

    // Add cell deps of known scripts
    tx.addCellDepsOfKnownScripts(cccClient, ...knownScripts);

    // prepare witnesses
    await tx.prepareSighashAllWitness(senderAddr.script, 85, cccClient);
    await tx.prepareSighashAllWitness(platformAddr.script, 85, cccClient);

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


// payment transaction check
// 1. no typescript no data
// 2. platform address increment check
export async function isPaymentTx(tx: Transaction, platformAddressIndex: number, amount: number): Promise<boolean> {
  const platformAddress = platformAddresses[platformAddressIndex];
  let platformAddressInputSum = BigInt(0);
  let platformAddressOutputSum = BigInt(0);
  try {
    for (const input of tx.inputs) {
      const cell = await cccClient.getCell(input.previousOutput);
      if (!cell) {
        throw new Error('Cell not found');
      }
      if (cell.cellOutput.type) {
        throw new Error('Type script not supported');
      }
      if (cell.outputData != '0x' ) {
        throw new Error('data not supported');
      }
      const cellLock = cell.cellOutput.lock;
      const cellAddress = await Address.fromScript(cellLock, cccClient);
      if (cellAddress.toString() === platformAddress) {
        platformAddressInputSum += BigInt(cell.cellOutput.capacity);
      }
    }

    for (const data of tx.outputsData) {
      if (data != '0x' ) {
        throw new Error('data not supported');
      }
    }

    for (const output of tx.outputs) {
      if (output.type) {
        throw new Error('Type script not supported');
      }
      const outputAddress = await Address.fromScript(output.lock, cccClient);
      if (outputAddress.toString() === platformAddress) {
        platformAddressOutputSum += BigInt(output.capacity);
      }
    }

    return platformAddressOutputSum >= platformAddressInputSum + BigInt(amount);
  } catch (error) {
    console.error('Error checking payment transaction:', error);
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
    console.log('signedTx:', signedTx);

    const txHash = await cccClient.sendTransaction(signedTx);
    console.log('sendTransaction txHash:', txHash);
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error completing transfer:', error.message);
    }
    throw error;
  }
}

// check transaction status
//export type TransactionStatus =
//  | "sent"
//  | "pending"
//  | "proposed"
//  | "committed"
//  | "unknown"
//  | "rejected";
export async function getTransactionStatus(txHash: string): Promise<string | undefined> {
  try {
    const txStatus = await cccClient.getTransaction(txHash);
    return txStatus?.status;
  } catch (error) {
    console.error('Error checking transaction status:', error);
    throw error;
  }
}

export async function AccountingTransaction(
  receiverAddress: string,
  platformAddressIndexes: number[],
  totalAccountingAmount: bigint,
  platformAmount: bigint
) {
  try {
    const receiverAddr = await Address.fromString(receiverAddress, cccClient);
    const receiverScript = receiverAddr.script;

    // collect inputs and platform outputs
    const inputs = [];
    const outputs = [];
    for (const index of platformAddressIndexes) {
      const platformAddr = await Address.fromString(platformAddresses[index], cccClient);
      const platformScript = platformAddr.script;
      const platformSigner = new ccc.SignerCkbScriptReadonly(
        cccClient,
        platformScript
      );
      for await (const cell of platformSigner.findCells(
        {
          scriptLenRange: [0, 1],
          outputDataLenRange: [0, 1],
        },
        false,
        "asc",
        10,
      )) {
        inputs.push({
          previousOutput: cell.outPoint,
          since: "0x0",
        });
      }
      outputs.push({
        capacity: MIN_WITHDRAWAL_AMOUNT,
        lock: platformScript,
      });
    }

    // append receiver output
    outputs.push({
      capacity: totalAccountingAmount,
      lock: receiverScript,
    });

    // deal change
    const fee = TRANSFER_FEE;
    // platform provide fee
    const change = platformAmount - totalAccountingAmount - fee;
    outputs[0].capacity += change;

    let tx = Transaction.from({
      version: 0,
      cellDeps: [],
      inputs: inputs,
      outputs: outputs,
      outputsData: [],
    });

    // platform addresses are all secp256k1
    tx.addCellDepsOfKnownScripts(cccClient, KnownScript.Secp256k1Blake160);

    // sign accounting transaction
    for (const index of platformAddressIndexes) {
      const platformPrivateKey = await getPrivateKey(index);
      const platformSigner = new ccc.SignerCkbPrivateKey(cccClient, platformPrivateKey);
      tx = await platformSigner.signTransaction(tx);
    }

    const rawTx = ccc.stringify(tx);
    console.log('Accounting transaction:', rawTx);

    const txHash = tx.hash();
    return {
      tx,
      txHash
    };
  } catch (error) {
    console.error('Error building accounting transaction:', error);
    throw error;
  }
}

export async function sendCkbTransaction(tx: Transaction) {
  try {
    const txHash = await cccClient.sendTransaction(tx);
    return txHash;
  } catch (error) {
    console.error('Error sending transaction:', error);
    throw error;
  }
}
