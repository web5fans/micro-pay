use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Account {
    pub address: String,
    pub fee_rate: u32, // percent
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PreparePaymentRequest {
    pub sender: String,
    pub receiver: String,
    pub amount: i64,
    pub accounts: Vec<Account>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PreparePaymentResponse {
    pub payment_id: i64,
    pub tx_hash: String,
    pub raw_tx: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TransferRequest {
    pub payment_id: i64,
    pub signed_tx: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TransferResponse {
    pub payment_id: i64,
    pub tx_hash: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PaymentInfo {
    pub id: i64,
    pub sender: String,
    pub receiver: String,
    pub amount: i64,
    pub created_at: String,
    pub updated_at: String,
    pub is_complete: bool,
    pub tx_hash: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AccountInfo {
    pub id: i64,
    pub payment_id: i64,
    pub receiver: String,
    pub amount: i64,
    pub created_at: String,
    pub updated_at: String,
    pub is_payed: bool,
    pub tx_hash: Option<String>,
}
