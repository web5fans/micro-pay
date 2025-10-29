# micro-pay

Micro Payment Service

## Micro Transfer

In CKB, the most basic transfer method is for the sender to create a new cell, set its lock script to the recipient's address, and set its capacity to the transfer amount.

However, due to the cell occupancy fee design, this method requires a minimum transfer amount of 61 CKB, as a single cell requires at least 61 CKB for occupancy.

Utilizing the cell model mechanism, instead of creating a new cell, a 2-2 transaction is constructed. By using both the sender's and recipient's cells as input and outputting two cells with modified amounts, micro transfers can be achieved.

However, since the recipient needs to participate in constructing the transaction and provide signatures for the input cells, both parties must be online simultaneously.

The ACP (https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0026-anyone-can-pay/0026-anyone-can-pay.md) solution modifies the lock script based on the 2-2 scheme, eliminating the need for the recipient's input cell signature, thus solving the problem of requiring the recipient to be online.

However, ACP requires ecosystem support due to its new lock script, among other issues, and is currently not widely used.

There are also some solutions implemented through type scripts, but they all face ecosystem support challenges.

## Current Solution

The current solution is still based on 2-2 transactions and aims to solve the problem of requiring the recipient to be online.

Unlike the ACP solution, this approach directly adopts a centralized platform method.

The sender transfers the amount to the platform (using 2-2 transaction), and after receiving the amount, the platform transfers it to the recipient.

This only requires the platform to be online continuously, eliminating the need for both sender and recipient to be online simultaneously.

Moreover, the platform needs to maintain accounting records to ensure accuracy and will charge a certain percentage as a handling fee.

## Technical Solution

### Live Cell Management

In 2-2 transactions, input cells need to be locked to prevent reuse.

To handle concurrency, the platform will prepare multiple live cells.

Therefore, a mechanism is needed to manage live cells and ensure each cell is used only once in transactions.

Initially can

### Payment Record Storage

Since detailed information for each transaction needs to be recorded, a database is required to store this information.

The database should include the following fields:

```sql
CREATE TABLE IF NOT EXISTS payment(
    id BIGINT PRIMARY KEY,
    sender TEXT,
    receiver TEXT,
    amount BIGINT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    is_complete BOOLEAN,
    tx_hash BYTEA,
);
```

### Revenue Sharing Record Storage

After the sender completes the payment, the platform will distribute the amount proportionally between the recipient and revenue sharers.

The database should include the following fields:

```sql
CREATE TABLE IF NOT EXISTS account(
    id BIGINT PRIMARY KEY,
    payment_id BIGINT,
    receiver TEXT,
    amount BIGINT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    is_payed BOOLEAN,
    tx_hash BYTEA,
);
```

### Payment

The backend periodically checks if the recipient's or revenue sharer's retained amount on the platform is sufficient (greater than 65 CKB), then transfers the amount to them.

It also updates the revenue sharing records in the database.

### API

The platform needs to provide two API endpoints for senders to submit transfer requests.

- Transfer preparation endpoint: The sender calls this endpoint to send the sender's address, recipient's address, and transfer amount to the platform. The platform records the payment information, generates a payment ID, assembles a 2-2 transaction, and returns it to the sender. The sender then signs the 2-2 transaction.
- Transfer endpoint: The sender calls this endpoint to send the partially signed 2-2 transaction to the platform. The platform completes the signature and submits it to the chain. It records the transaction hash, updates the payment status, performs revenue sharing according to established rules, and updates the revenue sharing records in the database.

### Query Interface

Since transaction records need to be queried, an interface for querying transaction records is required.

The interface should include the following functionality:

- Query payment records by payment ID
- Query sent payment records by sender address
- Query received payment records by recipient address
- Query all payment records