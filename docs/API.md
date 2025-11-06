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

请求体（示例）：

```json
{
  "sender": "0xabc...",
  "receiver": "0xdef...",
  "amount": 100,
  "splitRate": [10, 20]
}
```

请求校验：

- `sender`、`receiver` 必须是字符串，不能为空。
- `amount` 必须为有限正数（> 0）。
- `splitRate` 可选；如提供，数组元素为非负数，且总和必须严格小于 100。

成功响应（示例）：

```json
{
  "payment_id": 123
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

请求体（示例）：

```json
{
  "payment_id": 123,
  "signed_tx": "0xdeadbeef..."
}
```

请求校验：

- `payment_id` 必须为数字。
- `signed_tx` 必须为字符串，不能为空。

成功响应（示例）：

```json
{
  "payment_id": 123,
  "status": "transfer"
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