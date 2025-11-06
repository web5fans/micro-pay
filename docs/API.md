# Micro-Pay API 文档

该文档描述支付相关接口的请求校验、错误码与示例响应。错误码常量定义于 `src/api/errorCodes.ts`，所有错误返回均包含 `code` 字段以便前端统一处理与国际化。

## 错误码总览

- `DUPLICATE_ACTIVE_PAYMENT` — 409：同一 `sender` 存在活跃（未完成）支付，拒绝创建重复支付。
- `INCOMPLETE_PAYMENT_EXISTS` — 409：检测到历史未完成支付（状态未关闭），需要先清理或完成。
- `INSUFFICIENT_BALANCE` — 422：余额或额度不足，拒绝创建或执行转账。
- `NO_PLATFORM_ADDRESS` — 503：平台地址池暂时枯竭，无法分配新地址。
- `STATE_MISMATCH` — 409：支付状态不匹配（例如未处于 `prepare` 却尝试 `transfer`）。
- `CHAIN_ERROR` — 502：链上交易处理失败或外部服务错误。
- `VALIDATION_ERROR` — 400：请求参数缺失或格式不合法（类型、范围约束不满足）。
- `INTERNAL_ERROR` — 500：内部未知错误，详见服务端日志。

## 支付接口

### POST `/payment/prepare`

创建支付并分配平台地址（事务内分配与回滚保证地址不泄漏）。

请求示例：

```
curl -s -X POST http://localhost:3000/api/payment/prepare \
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
  }' | jq .
```

请求校验：

- `sender`、`receiver` 必须是字符串，不能为空。
- `amount` 必须为有限正数（> 0）。
- `splitRate` 可选；如提供，数组元素为非负数，且总和必须严格小于 100。

成功响应（示例）：

```json
{
    "paymentId": 1,
    "rawTx": "{\"version\":\"0x0\",\"cellDeps\":[{\"outPoint\":{\"txHash\":\"0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37\",\"index\":\"0x0\"},\"depType\":\"depGroup\"}],\"headerDeps\":[],\"inputs\":[{\"previousOutput\":{\"txHash\":\"0x8904905ee742e3290aea1687a845a43e664b4154c1e90503e73795ee3da056c5\",\"index\":\"0x1\"},\"since\":\"0x0\",\"cellOutput\":{\"capacity\":\"0x33c211caf6\",\"lock\":{\"codeHash\":\"0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8\",\"hashType\":\"type\",\"args\":\"0xdc3ff72c77f90a034b69b593f6b339ced1d85de8\"}},\"outputData\":\"0x\"},{\"previousOutput\":{\"txHash\":\"0x1aa3b137e73e324f3e9e38e1ceb5c60285718fe0c06c8dc00a985fdc48f96f5b\",\"index\":\"0x0\"},\"since\":\"0x0\",\"cellOutput\":{\"capacity\":\"0x37e11d600\",\"lock\":{\"codeHash\":\"0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8\",\"hashType\":\"type\",\"args\":\"0xf1e5e5641a3810fefaccaae4076f91a5de444726\"}},\"outputData\":\"0x\"}],\"outputs\":[{\"capacity\":\"0x4a817c800\",\"lock\":{\"codeHash\":\"0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8\",\"hashType\":\"type\",\"args\":\"0xf1e5e5641a3810fefaccaae4076f91a5de444726\"}},{\"capacity\":\"0x32980bb1e6\",\"lock\":{\"codeHash\":\"0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8\",\"hashType\":\"type\",\"args\":\"0xdc3ff72c77f90a034b69b593f6b339ced1d85de8\"}}],\"outputsData\":[\"0x\",\"0x\"],\"witnesses\":[\"0x690000001000000069000000690000005500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000\",\"0x690000001000000069000000690000005500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000\"]}",
    "txHash": "0xde69658e2e9dc1c9d5708219e8cb1251455a7d52835580946c8ee88877bd9ae2"
}
```

错误响应示例：

- 409 重复活跃支付

```json
{ "error": "Sender has an active payment", "code": "DUPLICATE_ACTIVE_PAYMENT" }
```

- 409 存在未完成支付

```json
{ "error": "Incomplete payment exists for sender", "code": "INCOMPLETE_PAYMENT_EXISTS" }
```

- 422 余额不足

```json
{ "error": "Insufficient balance", "code": "INSUFFICIENT_BALANCE" }
```

- 503 平台地址不足

```json
{ "error": "No available platform address", "code": "NO_PLATFORM_ADDRESS" }
```

- 400 参数校验失败

```json
{ "error": "Invalid amount", "code": "VALIDATION_ERROR" }
```

- 500 未知内部错误

```json
{ "error": "Internal error", "code": "INTERNAL_ERROR" }
```

### POST `/payment/transfer`

对 `prepare` 的支付执行链上签名交易并更新状态。

请求示例：

```
curl -s -X POST http://localhost:3000/api/payment/transfer \
  -H "Content-Type: application/json" \
  -d '{
    "paymentId": 1,
    "signedTx": "{\"version\":\"0x0\",\"cellDeps\":[{\"outPoint\":{\"txHash\":\"0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37\",\"index\":\"0x0\"},\"depType\":\"depGroup\"}],\"headerDeps\":[],\"inputs\":[{\"previousOutput\":{\"txHash\":\"0x8904905ee742e3290aea1687a845a43e664b4154c1e90503e73795ee3da056c5\",\"index\":\"0x1\"},\"since\":\"0x0\",\"cellOutput\":{\"capacity\":\"0x33c211caf6\",\"lock\":{\"codeHash\":\"0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8\",\"hashType\":\"type\",\"args\":\"0xdc3ff72c77f90a034b69b593f6b339ced1d85de8\"}},\"outputData\":\"0x\"},{\"previousOutput\":{\"txHash\":\"0x1aa3b137e73e324f3e9e38e1ceb5c60285718fe0c06c8dc00a985fdc48f96f5b\",\"index\":\"0x0\"},\"since\":\"0x0\",\"cellOutput\":{\"capacity\":\"0x37e11d600\",\"lock\":{\"codeHash\":\"0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8\",\"hashType\":\"type\",\"args\":\"0xf1e5e5641a3810fefaccaae4076f91a5de444726\"}},\"outputData\":\"0x\"}],\"outputs\":[{\"capacity\":\"0x4a817c800\",\"lock\":{\"codeHash\":\"0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8\",\"hashType\":\"type\",\"args\":\"0xf1e5e5641a3810fefaccaae4076f91a5de444726\"}},{\"capacity\":\"0x32980bb1e6\",\"lock\":{\"codeHash\":\"0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8\",\"hashType\":\"type\",\"args\":\"0xdc3ff72c77f90a034b69b593f6b339ced1d85de8\"}}],\"outputsData\":[\"0x\",\"0x\"],\"witnesses\":[\"0x5500000010000000550000005500000041000000e8fc4eab157208950f1d4486fdac53eed25a9d79ada02bbaded6b221f77ed68250a0634b67e161a0461a12a28e113820b0b544cfdc0864b2650ff2c16e6790c100\",\"0x690000001000000069000000690000005500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000\"]}"
  }' | jq .
```

请求校验：

- `paymentId` 必须为数字。
- `signedTx` 必须为字符串，不能为空。

成功响应（示例）：

```json
{
    "paymentId": 1,
    "txHash": "0xde69658e2e9dc1c9d5708219e8cb1251455a7d52835580946c8ee88877bd9ae2",
    "status": "completed"
}
```

错误响应示例：

- 409 状态不匹配

```json
{ "error": "Payment not in prepare", "code": "STATE_MISMATCH" }
```

- 502 链上/外部服务错误

```json
{ "error": "CKB transaction failed", "code": "CHAIN_ERROR" }
```

- 400 参数校验失败

```json
{ "error": "Missing or invalid parameters", "code": "VALIDATION_ERROR" }
```

- 500 未知内部错误

```json
{ "error": "Internal error", "code": "INTERNAL_ERROR" }
```

## 说明

- 错误码与 HTTP 状态码已在 API 层统一映射，前端可依据 `code` 执行差异化提示与重试策略。
- 当出现 409 并发类错误（如 `DUPLICATE_ACTIVE_PAYMENT` 或 `STATE_MISMATCH`），建议前端提示用户稍后重试或刷新数据状态。
- 后续将考虑在响应中引入 `requestId` 以便更好地进行问题定位与链路追踪。

## 查询接口（GET）

### GET `/api/payment/:id`

- 校验：`id` 必须为正整数，否则返回 `400 + VALIDATION_ERROR`。
- 成功响应：

```json
{
    "payment": {
        "id": 1,
        "sender": "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqwu8lmjcalepgp5k6d4j0mtxwww68v9m6qz0q8ah",
        "receiver": "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqttz30qvq8rlht9r9wc6lqu27x6ykx5eyskhysra",
        "amount": "5000000000",
        "info": "post_id",
        "status": 2,
        "tx_hash": "0xde69658e2e9dc1c9d5708219e8cb1251455a7d52835580946c8ee88877bd9ae2",
        "created_at": "2025-11-06T05:53:30.781Z",
        "updated_at": "2025-11-06T05:57:10.937Z"
    },
    "accounts": [
        {
            "id": 1,
            "payment_id": 1,
            "receiver": "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq0stn7whuvhjc2gm0frkjrg80wqac7xvlqf5qh7w",
            "amount": "500000000",
            "info": "post_id",
            "status": 1,
            "tx_hash": null,
            "created_at": "2025-11-06T05:53:30.781Z",
            "updated_at": "2025-11-06T05:57:10.937Z"
        },
        {
            "id": 2,
            "payment_id": 1,
            "receiver": "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqfj3fq244fc9r82gt5hcka9ertn46pwkmgtu7ced",
            "amount": "1000000000",
            "info": "post_id",
            "status": 1,
            "tx_hash": null,
            "created_at": "2025-11-06T05:53:30.781Z",
            "updated_at": "2025-11-06T05:57:10.937Z"
        },
        {
            "id": 3,
            "payment_id": 1,
            "receiver": "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqttz30qvq8rlht9r9wc6lqu27x6ykx5eyskhysra",
            "amount": "3500000000",
            "info": "post_id",
            "status": 1,
            "tx_hash": null,
            "created_at": "2025-11-06T05:53:30.781Z",
            "updated_at": "2025-11-06T05:57:10.937Z"
        }
    ]
}
```

- 404 未找到：

```json
{ "error": "Payment not found", "code": "NOT_FOUND" }
```

### GET `/api/payment/sender/:address?limit=20&offset=0`

- 校验：
  - `address` 必须为字符串；
  - `limit` 范围 1–100；
  - `offset` ≥ 0；
  - 任一不满足返回 `400 + VALIDATION_ERROR`。
- 成功响应：

```json
{
    "items": [
        {
            "id": 1,
            "sender": "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqwu8lmjcalepgp5k6d4j0mtxwww68v9m6qz0q8ah",
            "receiver": "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqttz30qvq8rlht9r9wc6lqu27x6ykx5eyskhysra",
            "amount": "5000000000",
            "info": "post_id",
            "status": 2,
            "tx_hash": "0xde69658e2e9dc1c9d5708219e8cb1251455a7d52835580946c8ee88877bd9ae2",
            "created_at": "2025-11-06T05:53:30.781Z",
            "updated_at": "2025-11-06T05:57:10.937Z"
        }
    ],
    "pagination": {
        "limit": 20,
        "offset": 0,
        "count": 1
    }
}
```

### GET `/api/payment/receiver/:address?limit=20&offset=0`

- 校验同上；成功响应：

```json
{
    "items": [
        {
            "id": 3,
            "payment_id": 1,
            "receiver": "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqttz30qvq8rlht9r9wc6lqu27x6ykx5eyskhysra",
            "amount": "3500000000",
            "info": "post_id",
            "status": 1,
            "tx_hash": null,
            "created_at": "2025-11-06T05:53:30.781Z",
            "updated_at": "2025-11-06T05:57:10.937Z"
        }
    ],
    "pagination": {
        "limit": 20,
        "offset": 0,
        "count": 1
    }
}
```