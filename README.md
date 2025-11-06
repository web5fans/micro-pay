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
    created_at TIMESTAMP,
    updated_at TIMESTAMP
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
    status INTEGER, // 0: prepare, 1: transfer, 2: complete, 3: cancel
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
    platform_address_indexes TEXT,
    amount BIGINT,
    info TEXT,
    status INTEGER, // 0: prepare, 1: (payment) complete, 2: cancel, 3: accounting, 4: accounted
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

### 超时处理

后台定期查询所有未完成的支付记录，检查是否超过指定时间（例如 5 分钟）。

如果发送者在调用转账准备接口之后在指定时间内（例如 5 分钟）没有调用转账接口，平台会将交易视为超时，将对应的支付记录及相关的分账记录删除，并释放对应的平台地址。

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

## API 文档与错误码

详见 `docs/API.md` 获取完整的接口说明、请求校验、错误码与示例响应。

错误码快速参考：

- `DUPLICATE_ACTIVE_PAYMENT` (409) — 发送者存在活跃支付
- `INCOMPLETE_PAYMENT_EXISTS` (409) — 检测到历史未完成支付
- `INSUFFICIENT_BALANCE` (422) — 余额不足
- `NO_PLATFORM_ADDRESS` (503) — 平台地址池枯竭
- `STATE_MISMATCH` (409) — 支付状态不匹配（非 prepare）
- `CHAIN_ERROR` (502) — 链上/外部服务错误
- `VALIDATION_ERROR` (400) — 请求参数校验失败
- `INTERNAL_ERROR` (500) — 内部未知错误

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
    "amount": 5000000000,
    "splitReceivers": [
      {
        "address": "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq0stn7whuvhjc2gm0frkjrg80wqac7xvlqf5qh7w",
        "splitRate": 10
      },
      {
        "address": "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqfj3fq244fc9r82gt5hcka9ertn46pwkmgtu7ced",
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
    "rawTx": "{\"version\":\"0x0\",\"cellDeps\":[{\"outPoint\":{\"txHash\":\"0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37\",\"index\":\"0x0\"},\"depType\":\"depGroup\"}],\"headerDeps\":[],\"inputs\":[{\"previousOutput\":{\"txHash\":\"0x891eecbe4d70c0ded9789989cece2e3ff6caa536c29921ca082ec384f4efe524\",\"index\":\"0x1\"},\"since\":\"0x0\"},{\"previousOutput\":{\"txHash\":\"0x59b600708c1b8eeb1f9f497a5bf282fce4b7c161b02c3c6bef05f3854518e47f\",\"index\":\"0x0\"},\"since\":\"0x0\"}],\"outputs\":[{\"capacity\":\"0x1faa3b500\",\"lock\":{\"codeHash\":\"0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8\",\"hashType\":\"type\",\"args\":\"0xf1e5e5641a3810fefaccaae4076f91a5de444726\"}},{\"capacity\":\"0x34ec1a06e6\",\"lock\":{\"codeHash\":\"0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8\",\"hashType\":\"type\",\"args\":\"0xdc3ff72c77f90a034b69b593f6b339ced1d85de8\"}}],\"outputsData\":[\"0x\",\"0x\"],\"witnesses\":[]}",
    "txHash": "0xd0380b1ec36607030889d4749ae08b01e309e3af24bbc144338588b9a9b489fe"
}
```

3. 转账接口
```
curl -X POST http://localhost:3000/api/payment/transfer \
  -H "Content-Type: application/json" \
  -d '{
    "payment_id": 1,
    "signed_tx": "{\"version\":\"0x0\",\"cellDeps\":[{\"outPoint\":{\"txHash\":\"0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37\",\"index\":\"0x0\"},\"depType\":\"depGroup\"}],\"headerDeps\":[],\"inputs\":[{\"previousOutput\":{\"txHash\":\"0xc07f339210e37c552f88ddb6ee4de20f32783fd18d4828fdfc94321136b688fa\",\"index\":\"0x1\"},\"since\":\"0x0\",\"cellOutput\":{\"capacity\":\"0x2540a0f40\",\"lock\":{\"codeHash\":\"0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8\",\"hashType\":\"type\",\"args\":\"0xdc3ff72c77f90a034b69b593f6b339ced1d85de8\"}},\"outputData\":\"0x\"},{\"previousOutput\":{\"txHash\":\"0x85d2962750b3a05fd1cd02ccd833df6329a0e67621e464e49b2199332b3ca0d9\",\"index\":\"0x1\"},\"since\":\"0x0\",\"cellOutput\":{\"capacity\":\"0x33c213edd6\",\"lock\":{\"codeHash\":\"0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8\",\"hashType\":\"type\",\"args\":\"0xdc3ff72c77f90a034b69b593f6b339ced1d85de8\"}},\"outputData\":\"0x\"},{\"previousOutput\":{\"txHash\":\"0x20141eaab405f4d704d20047196d5915d7044ba86f2420e0162315c27bf1278c\",\"index\":\"0x0\"},\"since\":\"0x0\",\"cellOutput\":{\"capacity\":\"0x2540be400\",\"lock\":{\"codeHash\":\"0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8\",\"hashType\":\"type\",\"args\":\"0xf1e5e5641a3810fefaccaae4076f91a5de444726\"}},\"outputData\":\"0x\"}],\"outputs\":[{\"capacity\":\"0x37e11d600\",\"lock\":{\"codeHash\":\"0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8\",\"hashType\":\"type\",\"args\":\"0xf1e5e5641a3810fefaccaae4076f91a5de444726\"}},{\"capacity\":\"0x34ec17e406\",\"lock\":{\"codeHash\":\"0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8\",\"hashType\":\"type\",\"args\":\"0xdc3ff72c77f90a034b69b593f6b339ced1d85de8\"}}],\"outputsData\":[\"0x\",\"0x\"],\"witnesses\":[\"0x5500000010000000550000005500000041000000d1251dc5ae2c9130efc0b43e79dbdba753f4a390bfb9a0d67d9571a51eb743f718a2184ed83e0631a99be83459c891bd39d410ede6a9110bbcfcf18b12026f2b01\"]}"
  }'
```
响应
```
{
    "paymentId": "1",
    "txHash": "0xd0380b1ec36607030889d4749ae08b01e309e3af24bbc144338588b9a9b489fe",
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
        "sender": "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqwu8lmjcalepgp5k6d4j0mtxwww68v9m6qz0q8ah",
        "receiver": "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqttz30qvq8rlht9r9wc6lqu27x6ykx5eyskhysra",
        "amount": "1000000000",
        "info": "post_id",
        "status": 2,
        "tx_hash": "0xd0380b1ec36607030889d4749ae08b01e309e3af24bbc144338588b9a9b489fe",
        "created_at": "2025-11-03T05:25:50.115Z",
        "updated_at": "2025-11-03T05:27:12.099Z"
    },
    "accounts": [
        {
            "id": 1,
            "payment_id": 1,
            "receiver": "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq0stn7whuvhjc2gm0frkjrg80wqac7xvlqf5qh7w",
            "amount": "100000000",
            "info": "post_id",
            "status": 1,
            "tx_hash": null,
            "created_at": "2025-11-03T05:25:50.115Z",
            "updated_at": "2025-11-03T05:27:12.099Z"
        },
        {
            "id": 2,
            "payment_id": 1,
            "receiver": "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqfj3fq244fc9r82gt5hcka9ertn46pwkmgtu7ced",
            "amount": "200000000",
            "info": "post_id",
            "status": 1,
            "tx_hash": null,
            "created_at": "2025-11-03T05:25:50.115Z",
            "updated_at": "2025-11-03T05:27:12.099Z"
        },
        {
            "id": 3,
            "payment_id": 1,
            "receiver": "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqttz30qvq8rlht9r9wc6lqu27x6ykx5eyskhysra",
            "amount": "700000000",
            "info": "post_id",
            "status": 1,
            "tx_hash": null,
            "created_at": "2025-11-03T05:25:50.115Z",
            "updated_at": "2025-11-03T05:27:12.099Z"
        }
    ]
}
``` 

5. 根据发送者地址查询发送的支付记录
``` 
curl -X GET http://localhost:3000/api/payment/sender/ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqwu8lmjcalepgp5k6d4j0mtxwww68v9m6qz0q8ah
```
响应
```
[
    {
        "id": 1,
        "sender": "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqwu8lmjcalepgp5k6d4j0mtxwww68v9m6qz0q8ah",
        "receiver": "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqttz30qvq8rlht9r9wc6lqu27x6ykx5eyskhysra",
        "amount": "1000000000",
        "info": "post_id",
        "status": 2,
        "tx_hash": "0xd0380b1ec36607030889d4749ae08b01e309e3af24bbc144338588b9a9b489fe",
        "created_at": "2025-11-03T05:25:50.115Z",
        "updated_at": "2025-11-03T05:27:12.099Z"
    }
]
``` 

6. 根据接收者地址查询分账记录
``` 
curl -X GET http://localhost:3000/api/payment/receiver/ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqttz30qvq8rlht9r9wc6lqu27x6ykx5eyskhysra
```
响应
```
[
    {
        "id": 3,
        "payment_id": 1,
        "receiver": "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqttz30qvq8rlht9r9wc6lqu27x6ykx5eyskhysra",
        "amount": "700000000",
        "info": "post_id",
        "status": 1,
        "tx_hash": null,
        "created_at": "2025-11-03T05:25:50.115Z",
        "updated_at": "2025-11-03T05:27:12.099Z"
    }
]
``` 


## TODO
- [X] 事务保障需要完善
  - [X] 数据库记录里的状态要细化，形成一个状态机
  - [X] 清理的时候要改成幂等的方式
- [X] transfer要等tx确认
- [X] 平台账户数量要可增加
- [X] 查询分页
- [X] 后台分账
- [X] 完善交易状态处理
