# micro-pay

小额支付服务

## 小额转账

在 ckb 中，最基础的转账方式是发送者创建一个新的 cell，将其 lock script 设置为接收者的地址，将其 capacity 设置为转账金额。

但是因为 cell 占用费的设计，这种方式最小转账金额为 61ckb，因为单独一个 cell 存在最少需要 61ckb 的占用费。

利用 cell model 的机制，不创建新的 cell，而是构造一个 2-2 交易。同时将发送者和接收者的 2 个 cell 作为 input，将金额变化之后的 2 个 cell 作为 output，这样就可以完成小额转账。

但是因为接收者也需要参与构造交易，且需要为 input cell 提供签名，所以双方必须同时在线。

ACP（https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0026-anyone-can-pay/0026-anyone-can-pay.md）方案在2-2方案的基础上对lock script 进行了修改，使得接收者的 input cell 无需签名，解决了接收者必须在线的问题。

但是 ACP 因为新增加了 lock script，所以需要生态支持，以及其他一些问题，目前使用并不多。

还有一些通过 type script 实现的方案，但是也都面临着生态支持的问题。

## 当前方案

当前方案依然基于 2-2 交易，也是要解决接收者必须在线的问题。

但是与 ACP 方案不同，这里直接采用中心化平台的方式来解决。

即发送者将转账金额发送给平台（2-2 交易的方式），平台收到金额后，将其转账给接收者。

这样只需要平台一直在线即可，发送者和接收者无需同时在线。

而且平台需要记账，保证账目不出问题，并且平台会抽取一定比例的手续费。

## 技术方案

### 平台 live cell 管理

因为 2-2 交易中，input cell 需要被锁定，防止被重复使用。

为了应对并发，平台配置一个助记词，通过该助记词派生出多个地址。

例如对于示例配置，平台会派生出 10 个地址。

```
Path: m/44'/309'/0'/0/0, Address: ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq03uhjkgx3czrl04n92usrklyd9mezywfsk8tjwm
Path: m/44'/309'/0'/0/1, Address: ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqve9g9gg3rtsp4gxw2dtdrc43jzvrhttxsp2ev93
Path: m/44'/309'/0'/0/2, Address: ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqdm9qgx0est2qlkdqgpth5f7ju9qpxtcpqagv8w9
Path: m/44'/309'/0'/0/3, Address: ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqfj3fq244fc9r82gt5hcka9ertn46pwkmgtu7ced
Path: m/44'/309'/0'/0/4, Address: ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq2sv5sawcueag00wsqdsq7djl9vmx7xk0g05efqm
Path: m/44'/309'/0'/0/5, Address: ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqd44t5xqmrapwdkky5593ekg0vpaj7mwxqzla4z4
Path: m/44'/309'/0'/0/6, Address: ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqwxpce7d4lqz5504jx7zfer6y3909jw5vccefqtx
Path: m/44'/309'/0'/0/7, Address: ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqteg2963k7sz3f587vzhz9x2u6ew2x924q0l2agv
Path: m/44'/309'/0'/0/8, Address: ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq0ehj0tyljzpvl5tu3r59udjzljgn3kdtcfmn47e
Path: m/44'/309'/0'/0/9, Address: ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqdczyxt5nz6d2s95vel3msrntd8hslxucgx2czac
```

每个地址上只有一个 live cell，初始该 cell 的金额为 min_withdrawal_amount 。

每个请求来了之后，从多个地址中挑选一个使用，并进行标记，防止重复使用。

```
CREATE TABLE IF NOT EXISTS platform_address(
    id INTEGER PRIMARY KEY,
    index INTEGER,
    is_used BOOLEAN,
    created_at TIMESTAMP
);
```

### 支付记录存储

因为需要记录每个交易的详细信息，所以需要一个数据库表来存储这些信息。

包含以下字段：

```
CREATE TABLE IF NOT EXISTS payment(
    id BIGINT PRIMARY KEY,
    sender TEXT,
    receiver TEXT,
    platform_address_index INTEGER,
    amount BIGINT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    is_complete BOOLEAN,
    tx_hash TEXT,
);
```

### 分账记录存储

发送者完成支付之后，平台会将金额按照比例分账给接收者和分账者。

数据库需要包含以下字段：

```
CREATE TABLE IF NOT EXISTS account(
    id BIGINT PRIMARY KEY,
    payment_id BIGINT,
    receiver TEXT,
    amount BIGINT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    is_payed BOOLEAN,
    tx_hash TEXT,
);
```

### 支付

后台定期查询，如果接收者或者分账者在平台留存的金额足够（大于 65ckb），就会将金额转账给接收者或者分账者。

并更新数据库中的分账记录。

### API

平台需要提供 2 个 API 接口，用于发送者发送转账请求。

- 转账准备接口。
  发送者调用该接口，请求包含发送者地址，接收者地址，转账金额和一个包含分账者地址及分账百分比的数组。
  平台首先根据发送者地址，和从多个平台地址中挑选一个未使用的地址，以及转账金额组装 2-2 支付交易。
  记录支付信息并得到一个支付 id，记录接收者和分账者的分账信息。
  返回包含支付 id，2-2 交易的 raw tx，以及 2-2 交易的 hash。
- 转账接口。
  发送者调用该接口，将部分签名的 2-2 支付交易发送给平台。
  平台调用补全签名之后发送到链上。记录交易 hash，更新对应的支付记录状态为已完成。

### 查询接口

查询交易记录接口包括：

- 根据支付 id 查询支付记录，包含支付者地址，接收者地址，转账金额，交易 hash，交易状态等以及分账记录。
- 根据发送者/接收者地址查询发送的支付记录，包含支付 id，接收者地址，转账金额, 交易 hash，交易状态。

## 运行

1. 安装依赖
```
npm install
```

2. 运行服务
```
bash dev_db.sh
npm start
```

## 接口测试

1. 检查健康状态
```
curl -X GET http://localhost:3000/health
```
响应
```
OK
```

2. 转账准备接口
```
curl -X POST http://localhost:3000/api/payment/prepare \
  -H "Content-Type: application/json" \
  -d '{
    "sender": "ckb_address_sender",
    "receiver": "ckb_address_receiver",
    "amount": 100000000,
    "splitReceivers": [
      {
        "address": "ckb_address_split1",
        "splitRate": 10
      },
      {
        "address": "ckb_address_split2",
        "splitRate": 20
      }
    ]
  }'
```
响应
```
{
    "paymentId": 1,
    "rawTx": {
        "version": "0x0",
        "cellDeps": [
            {
                "outPoint": {
                    "txHash": "0x71a7ba8fc96349fea0ed3a5c47992e3b4084b031a42264a018e0072e8172e46c",
                    "index": "0x0"
                },
                "depType": "depGroup"
            }
        ],
        "headerDeps": [],
        "inputs": [
            {
                "previousOutput": {
                    "txHash": "0x29ed7c9b1f0684c3b5789d85e89d8f59c6531bf386d7eb2918eed0d93ceaf7e9",
                    "index": "0x0"
                },
                "since": "0x0"
            }
        ],
        "outputs": [
            {
                "capacity": "0x5f5e100",
                "lock": {
                    "codeHash": "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
                    "args": "0x8211f1b938a107cd53b6302cc752a6fc3965638d",
                    "hashType": "type"
                },
                "type": null
            }
        ],
        "outputsData": [
            "0x"
        ],
        "witnesses": [
            "0x"
        ]
    },
    "txHash": "0x6d6f636b5f74785f686173685f31373631383033303134373732"
}
```

3. 转账接口
```
curl -X POST http://localhost:3000/api/payment/transfer \
  -H "Content-Type: application/json" \
  -d '{
    "payment_id": "1",
    "signed_tx": "signed_transaction_hex_string"
  }'
```
响应
```
{"paymentId":"1","txHash":"0x6d6f636b5f74785f686173685f73656e745f31373631383032343435373038","status":"completed"}
```

4. 根据支付id查询接口
```
curl -X GET http://localhost:3000/api/payment/1
```
响应
```
{
    "payment": {
        "id": 1,
        "sender": "ckb_address_sender",
        "receiver": "ckb_address_receiver",
        "platform_address_index": 0,
        "amount": "100000000",
        "created_at": "2025-10-29T21:43:34.772Z",
        "updated_at": "2025-10-29T21:44:10.005Z",
        "is_complete": true,
        "tx_hash": "0x6d6f636b5f74785f686173685f73656e745f31373631383033303530303035"
    },
    "accounts": [
        {
            "id": 1,
            "payment_id": 1,
            "receiver": "ckb_address_split1",
            "amount": "10000000",
            "created_at": "2025-10-29T21:43:34.770Z",
            "updated_at": "2025-10-29T21:43:34.770Z",
            "is_payed": false,
            "tx_hash": null
        },
        {
            "id": 2,
            "payment_id": 1,
            "receiver": "ckb_address_split2",
            "amount": "20000000",
            "created_at": "2025-10-29T21:43:34.770Z",
            "updated_at": "2025-10-29T21:43:34.770Z",
            "is_payed": false,
            "tx_hash": null
        },
        {
            "id": 3,
            "payment_id": 1,
            "receiver": "ckb_address_receiver",
            "amount": "70000000",
            "created_at": "2025-10-29T21:43:34.770Z",
            "updated_at": "2025-10-29T21:43:34.770Z",
            "is_payed": false,
            "tx_hash": null
        }
    ]
}
``` 

5. 发送者/接收者地址查询发送的支付记录
``` 
curl -X GET http://localhost:3000/api/payment/sender/ckb_address_sender

curl -X GET http://localhost:3000/api/payment/receiver/ckb_address_receiver
```
响应
```
[
    {
        "id": 1,
        "sender": "ckb_address_sender",
        "receiver": "ckb_address_receiver",
        "platform_address_index": 0,
        "amount": "100000000",
        "created_at": "2025-10-29T21:43:34.772Z",
        "updated_at": "2025-10-29T21:44:10.005Z",
        "is_complete": true,
        "tx_hash": "0x6d6f636b5f74785f686173685f73656e745f31373631383033303530303035"
    }
]
``` 
