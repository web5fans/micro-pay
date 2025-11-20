import { initDb, withTransaction, query } from '../src/db';
import {
  createAccountWithTransaction,
  updateAccountStatusFromPrepareToCompleteWithTransaction,
  updateAccountStatusFromCompleteToAccountingWithTransaction,
} from '../src/models/account';
import { createPaymentWithTransaction } from '../src/models/payment';

async function seedAccounts() {
  // Clear dependent rows first, then payments
  await query('DELETE FROM account', []);
  await query('DELETE FROM payment', []);
}

async function testConcurrentAccountingTransitionSingleWinner() {
  await seedAccounts();

  const receiver = 'receiver_concurrent';

  // Create two payments to satisfy FK, then accounts for the same receiver
  const p1 = await withTransaction((client) =>
    createPaymentWithTransaction(client, 'sender_acc_1', receiver, 0, 50, null, null)
  );
  const p2 = await withTransaction((client) =>
    createPaymentWithTransaction(client, 'sender_acc_2', receiver, 1, 70, null, null)
  );

  const a1 = await withTransaction((client) =>
    createAccountWithTransaction(client, p1.id, receiver, 50, null, '')
  );
  const a2 = await withTransaction((client) =>
    createAccountWithTransaction(client, p2.id, receiver, 70, null, '')
  );

  // Mark them complete (status = 1)
  await withTransaction((client) =>
    updateAccountStatusFromPrepareToCompleteWithTransaction(client, a1.payment_id)
  );
  await withTransaction((client) =>
    updateAccountStatusFromPrepareToCompleteWithTransaction(client, a2.payment_id)
  );

  // Two concurrent transitions to accounting; one should capture all rows, the other zero
  const t1 = withTransaction((client) =>
    updateAccountStatusFromCompleteToAccountingWithTransaction(client, receiver)
  );
  const t2 = withTransaction((client) =>
    updateAccountStatusFromCompleteToAccountingWithTransaction(client, receiver)
  );

  const [r1, r2] = await Promise.all([t1, t2]);
  const sizes = [r1.length, r2.length].sort((x, y) => y - x);
  // We EXPECT exactly one transition attempt succeeds; if both succeed, it's a concurrency issue
  if (sizes[0] !== 2 || sizes[1] !== 0) {
    throw new Error(`Concurrency issue confirmed: update counts ${sizes[0]} and ${sizes[1]}`);
  }
}

async function main() {
  try {
    await initDb();
  } catch (e) {
    console.log('SKIP: Database not available, skipping account concurrency test.');
    process.exit(0);
  }

  try {
    await testConcurrentAccountingTransitionSingleWinner();
    console.log('PASS: Account concurrency tests executed.');
    process.exit(0);
  } catch (err) {
    console.error('FAIL:', err);
    process.exit(1);
  }
}

main();