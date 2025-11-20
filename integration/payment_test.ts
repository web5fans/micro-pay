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

async function partSignTx(rawTx: string) {
    const txObj = JSON.parse(rawTx);
    const tx = Transaction.from(txObj);
    const txHash = tx.hash();

    console.log("sign tx hash:", txHash);
    const signer = new ccc.SignerCkbPrivateKey(cccClient, senderPrivateKey);
    const signedTx = await signer.signTransaction(tx);
    console.log("signed tx:", ccc.stringify(signedTx));
    return ccc.stringify(signedTx);
}

type SplitReceiver = {
  address: string;
  receiverDid: string | null;
  splitRate: number;
};

type PreparePayload = {
  sender: string;
  senderDid: string | null;
  receiver: string;
  receiverDid: string | null;
  amount: number;
  category: number;
  splitReceivers: SplitReceiver[];
  info: string;
};

async function callPrepare() {
  const url = 'http://localhost:3000/api/payment/prepare';

  const payload: PreparePayload = {
    sender:
      senderAddr,
    senderDid: "did:ckb:sender",
    receiver:
      receiverAddr,
    receiverDid: "did:ckb:receiver",
    amount: 5_000_000_000,
    category: 0,
    splitReceivers: [
      {
        address:
          'ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq0stn7whuvhjc2gm0frkjrg80wqac7xvlqf5qh7w',
        receiverDid: "did:ckb:spliter1",
        splitRate: 10,
      },
      {
        address:
          'ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqfj3fq244fc9r82gt5hcka9ertn46pwkmgtu7ced',
        receiverDid: "did:ckb:spliter2",
        splitRate: 20,
      },
    ],
    info: 'post_id',
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
  return data;
}

async function callTransfer(id: number, signedTx: string) {
    const url = 'http://localhost:3000/api/payment/transfer';

    const payload = {
        paymentId: id,
        signedTx: signedTx,
    };
    console.log("transfer payload:", payload);

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    console.log("transfer res:", res);

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
    }

    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
    return data;
}

async function main() {
  console.log("--------------0. check sender balance");
  const senderBalance = await getAddressBalance(senderAddr);
  console.log("sender balance:", senderBalance);

  console.log("--------------1. call api send prepare payment tx");
  try {
    const oldPrepareData = await callPrepare();
    console.log("oldPrepareData:", oldPrepareData);
    // new prepare payment will cancel old prepare payment
    const prepareData = await callPrepare();
    const id = prepareData.paymentId;
    const rawTx = prepareData.rawTx;
    console.log("prepareData:", prepareData);
    console.log("rawTx:", rawTx);

    console.log("--------------2. call part sign tx");
    const signedTx = await partSignTx(rawTx);
    console.log("signedTx:", signedTx);

    console.log("--------------3. call api send transfer payment tx");
    const transferData = await callTransfer(id, signedTx);
    console.log(JSON.stringify(transferData, null, 2));
    // 4. wait 60s for payment status transfer
    console.log("--------------4. wait 60s for payment status transfer");
    for (let s = 60; s >= 0; s--) {
      process.stdout.write(`\rwait ${s}s for payment status transfer`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    process.stdout.write('\n');

    // 5. check balance diff
    console.log("--------------5. check balance diff");
    const senderBalanceAfter = await getAddressBalance(senderAddr);
    console.log("sender balance after:", senderBalanceAfter);
    const balanceDiff = senderBalance - senderBalanceAfter;
    console.log("balance diff:", balanceDiff);
    if (Number(balanceDiff) !== Number(5000010000)) {
      throw new Error("balance diff not 5000010000");
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
