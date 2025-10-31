# micro-pay

小额支付服务

## 小额转账

在 ckb 中，最基础的转账方式是发送者创建一个新的 cell，将其 lock script 设置为接收者的地址，将其 capacity 设置为转账金额。

但是因为 cell 占用费的设计，这种方式最小转账金额为 61ckb，因为单独一个 cell 存在最少需要 61ckb 的占用费。

利用 cell model 的机制，不创建新的 cell，而是构造一个 2-2 交易。同时将发送者和接收者的 2 个 cell 作为 input，将金额变化之后的 2 个 cell 作为 output，这样就可以完成小额转账。

但是因为接收者也需要参与构造交易，且需要为 input cell 提供签名，所以双方必须同时在线。

(ACP)[https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0026-anyone-can-pay/0026-anyone-can-pay.md] 方案在2-2方案的基础上对lock script 进行了修改，使得接收者的 input cell 无需签名，解决了接收者必须在线的问题。

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

助记词及推导出的地址可以使用 https://app.ckbccc.com/utils/Mnemonic 来生成。

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
    info TEXT,
    is_complete BOOLEAN,
    tx_hash TEXT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
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
    info TEXT,
    is_payed BOOLEAN,
    tx_hash TEXT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
);
```

### 支付

后台定期查询，如果接收者或者分账者在平台留存的金额足够（大于 65ckb），就会将金额转账给接收者或者分账者。

并更新数据库中的分账记录。

### API

平台需要提供 2 个 API 接口，用于发送者发送转账请求。

- 转账准备接口。
  发送者调用该接口，请求包含发送者地址，接收者地址，转账金额和一个包含分账者地址及分账百分比的数组，以及一个可选的 info 字段。
  平台首先根据发送者地址，和从多个平台地址中挑选一个未使用的地址，以及转账金额组装 2-2 支付交易。
  记录支付信息并得到一个支付 id，记录接收者和分账者的分账信息。
  返回包含支付 id，未签名的2-2 交易的 raw tx，以及 2-2 交易的 hash。
- 转账接口。
  发送者调用该接口，将部分签名的 2-2 支付交易发送给平台。
  平台调用对应的平台地址补全签名之后发送到链上。记录交易 hash，更新对应的支付记录状态为已完成。

### 查询接口

查询交易记录接口包括：

- 根据支付 id 查询支付记录，包含支付者地址，接收者地址，转账金额，info, 交易 hash，交易状态等以及分账记录。
- 根据发送者地址查询支付记录，包含支付 id，接收者地址，转账金额, info, 交易 hash，交易状态。
- 根据接收者地址查询分账记录，包含分账id，支付 id，接收者地址，金额, info, 交易 hash，是否支付。

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
    "sender": "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqwu8lmjcalepgp5k6d4j0mtxwww68v9m6qz0q8ah",
    "receiver": "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqttz30qvq8rlht9r9wc6lqu27x6ykx5eyskhysra",
    "amount": 100000000,
    "splitReceivers": [
      {
        "address": "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq0stn7whuvhjc2gm0frkjrg80wqac7xvlqf5qh7w",
        "splitRate": 10
      },
      {
        "address": "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq0stn7whuvhjc2gm0frkjrg80wqac7xvlqf5qh7w",
        "splitRate": 20
      }
    ],
    "info": "post_id"
  }'
```
响应
```
{
    "paymentId": 1,
    "rawTx": "{\"version\":\"0x0\",\"cellDeps\":[{\"outPoint\":{\"txHash\":\"0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37\",\"index\":\"0x0\"},\"depType\":\"depGroup\"}],\"headerDeps\":[],\"inputs\":[{\"previousOutput\":{\"txHash\":\"0x38cccf9dfae31269c01574bd02f8afeef742d4b80ff17e905cd883461336d3a8\",\"index\":\"0x0\"},\"since\":\"0x0\"},{\"previousOutput\":{\"txHash\":\"0xcd76398eaada6994c82cc4772d259a970a45e657352580ada0a25547531ac2a1\",\"index\":\"0x0\"},\"since\":\"0x0\"}],\"outputs\":[{\"capacity\":\"0x189640200\",\"lock\":{\"codeHash\":\"0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8\",\"hashType\":\"type\",\"args\":\"0xf1e5e5641a3810fefaccaae4076f91a5de444726\"}},{\"capacity\":\"0x4ddbc89f0\",\"lock\":{\"codeHash\":\"0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8\",\"hashType\":\"type\",\"args\":\"0xdc3ff72c77f90a034b69b593f6b339ced1d85de8\"}}],\"outputsData\":[\"0x\",\"0x\"],\"witnesses\":[]}",
    "txHash": "0xbf3a147b95f77bea63bc75d0fa845c7a8189b69e503b6222c379bc8c0785b6fc"
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
{
    "paymentId": "1",
    "txHash": "0x6d6f636b5f74785f686173685f73656e745f31373631383039303938353335",
    "status": "completed"
}
```

4. 根据支付id查询支付记录
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
        "amount": "100000000",
        "info": "post_id",
        "is_complete": true,
        "tx_hash": "0x6d6f636b5f74785f686173685f73656e745f31373631383039303938353335",
        "created_at": "2025-10-29T23:22:11.727Z",
        "updated_at": "2025-10-29T23:24:58.535Z"
    },
    "accounts": [
        {
            "id": 1,
            "payment_id": 1,
            "receiver": "ckb_address_split1",
            "amount": "10000000",
            "info": "post_id",
            "is_payed": false,
            "tx_hash": null,
            "created_at": "2025-10-29T23:22:11.727Z",
            "updated_at": "2025-10-29T23:22:11.727Z"
        },
        {
            "id": 2,
            "payment_id": 1,
            "receiver": "ckb_address_split2",
            "amount": "20000000",
            "info": "post_id",
            "is_payed": false,
            "tx_hash": null,
            "created_at": "2025-10-29T23:22:11.727Z",
            "updated_at": "2025-10-29T23:22:11.727Z"
        },
        {
            "id": 3,
            "payment_id": 1,
            "receiver": "ckb_address_receiver",
            "amount": "70000000",
            "info": "post_id",
            "is_payed": false,
            "tx_hash": null,
            "created_at": "2025-10-29T23:22:11.727Z",
            "updated_at": "2025-10-29T23:22:11.727Z"
        }
    ]
}
``` 

5. 根据发送者地址查询发送的支付记录
``` 
curl -X GET http://localhost:3000/api/payment/sender/ckb_address_sender
```
响应
```
[
    {
        "id": 1,
        "sender": "ckb_address_sender",
        "receiver": "ckb_address_receiver",
        "amount": "100000000",
        "info": "post_id",
        "is_complete": true,
        "tx_hash": "0x6d6f636b5f74785f686173685f73656e745f31373631383039303938353335",
        "created_at": "2025-10-29T23:22:11.727Z",
        "updated_at": "2025-10-29T23:24:58.535Z"
    }
]
``` 

6. 根据接收者地址查询分账记录
``` 
curl -X GET http://localhost:3000/api/payment/receiver/ckb_address_receiver
```
响应
```
[
    {
        "id": 3,
        "payment_id": 1,
        "receiver": "ckb_address_receiver",
        "amount": "70000000",
        "info": "post_id",
        "is_payed": false,
        "tx_hash": null,
        "created_at": "2025-10-29T23:22:11.727Z",
        "updated_at": "2025-10-29T23:22:11.727Z"
    }
]
``` 
