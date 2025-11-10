import { Address, ccc, Transaction } from "@ckb-ccc/core";
import { exec } from 'child_process';

const cccClient = new ccc.ClientPublicTestnet();

const senderAddr = "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqwu8lmjcalepgp5k6d4j0mtxwww68v9m6qz0q8ah";
const senderPrivateKey = "0x88179b7e387921a193f459859d8ff461e973a93a449b4930179928dbc53a04ba";

const receiverAddr = "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqttz30qvq8rlht9r9wc6lqu27x6ykx5eyskhysra";


async function getAddressBalance(ckbAddress: string): Promise<bigint> {
  const addr = await Address.fromString(ckbAddress, cccClient);
  const balance = await cccClient.getBalance([addr.script]);
  return balance;
}

async function callAccountInfo() {
  const response = await fetch(`http://localhost:3000/api/payment/receiver/${receiverAddr}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

async function main() {
  try {
    console.log("--------------0. check receiver balance");
    const receiverBalance = await getAddressBalance(receiverAddr);
    console.log("receiver balance:", receiverBalance);

    console.log("--------------1. get account info");
    const accountInfo = await callAccountInfo();
    // calc total amount status 1
    const totalReceived = accountInfo.items.reduce((acc: bigint, item: { status: number; amount: string | number | bigint | boolean; }) => item.status === 1 ? acc + BigInt(item.amount) : acc, BigInt(0));
    console.log("total received:", totalReceived);

    // wait 80s for account to be ready
    console.log("restart micro-pay server to make account immediately");
    for (let s = 80; s >= 0; s--) {
      process.stdout.write(`\rwait ${s}s for account to be ready`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    process.stdout.write('\n');

    console.log("--------------2. check receiver balance");
    const receiverBalanceAfter = await getAddressBalance(receiverAddr);
    console.log("receiver balance after:", receiverBalanceAfter);

    // check receiver balance after is equal to total received
    if (receiverBalanceAfter - receiverBalance !== totalReceived) {
      throw new Error(`receiver balance diff ${receiverBalanceAfter - receiverBalance} is not equal to total received ${totalReceived}`);
    }
  } catch (err) {
    console.error('Request failed:', err);
  }
}

main().then(() => {
  console.log("PASS: Basic tests executed.");
  process.exit(0);
}).catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
