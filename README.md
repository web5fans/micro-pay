# micro-pay

小额支付服务

## 小额转账

在ckb中，最基础的转账方式是发送者创建一个新的cell，将其lock script设置为接收者的地址，将其capacity设置为转账金额。

但是因为cell占用费的设计，这种方式最小转账金额为 61ckb，因为单独一个cell存在最少需要61ckb的占用费。

利用cell model的机制，不创建新的cell，而是构造一个2-2交易。同时将发送者和接收者的2个cell作为input，将金额变化之后的2个cell作为output，这样就可以完成小额转账。

但是因为接收者也需要参与构造交易，且需要为input cell提供签名，所以双方必须同时在线。

ACP（https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0026-anyone-can-pay/0026-anyone-can-pay.md）方案在2-2方案的基础上对lock script进行了修改，使得接收者的input cell无需签名，解决了接收者必须在线的问题。

但是 ACP 因为新增加了lock script，所以需要生态支持，以及其他一些问题，目前使用并不多。

还有一些通过type script 实现的方案，但是也都面临着生态支持的问题。

## 当前方案

当前方案依然基于2-2交易，也是要解决接收者必须在线的问题。

但是与ACP方案不同，这里直接采用中心化平台的方式来解决。

即发送者将转账金额发送给平台（2-2交易的方式），平台收到金额后，将其转账给接收者。

这样只需要平台一直在线即可，发送者和接收者无需同时在线。

而且平台需要记账，保证账目不出问题，并且平台会抽取一定比例的手续费。


## 技术方案

### live cell管理

因为2-2交易中，input cell需要被锁定，防止被重复使用。

为了应对并发，平台会准备多个live cell。

所以这里需要一个机制来管理live cell，确保每个cell在交易中只被使用一次。

初期使用随机挑选一个live cell，后续考虑使用更智能的方式来挑选。

提供脚本来初始化创建多个live cell，每个cell的金额为 min_withdrawal_amount 。

### 支付记录存储

因为需要记录每个交易的详细信息，所以需要一个数据库来存储这些信息。

数据库需要包含以下字段：

```
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
    tx_hash BYTEA,
);
```

### 支付

后台定期查询，如果接收者或者分账者在平台留存的金额足够（大于65ckb），就会将金额转账给接收者或者分账者。

并更新数据库中的分账记录。

### API

平台需要提供2个API接口，用于发送者发送转账请求。

- 转账准备接口。发送者调用该接口，将发送者地址，接收者地址，转账金额发送给平台。平台记录支付信息并得到一个支付id，然后组装2-2交易，返回给发送者。发送者对2-2交易进行签名。
- 转账接口。发送者调用该接口，将部分签名的2-2交易发送给平台。平台补全签名之后发送到链上。记录交易hash，更新支付状态，按照既定规则进行分账并更新数据库中的分账记录。

### 查询接口

因为需要查询交易记录，所以需要一个接口来查询交易记录。

接口需要包含以下功能：

- 根据支付id查询支付记录
- 根据发送者地址查询发送的支付记录
- 根据接收者地址查询接收的支付记录
- 查询所有支付记录

## 测试接口

```
$ curl http://localhost:3000/api/payment/all
[]

$ curl -X POST -H "Content-Type: application/json" -d '{"sender":"0x1234567890123456789012345678901234567890","receiver":"0x0987654321098765432109876543210987654321","amount":1000000000000}' http://localhost:3000/api/payment/prepare
{"payment_id":1,"tx_hash":"","raw_tx":""}
```