use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("Database error: {0}")]
    Database(String),

    #[error("Config error: {0}")]
    Config(String),

    #[error("CKB error: {0}")]
    CKB(String),

    #[error("Invalid address: {0}")]
    InvalidAddress(String),

    #[error("Invalid amount: {0}")]
    InvalidAmount(String),

    #[error("Insufficient balance: {0}")]
    InsufficientBalance(String),

    #[error("Payment not found")]
    PaymentNotFound,

    #[error("Live cell not available")]
    LiveCellNotAvailable,

    #[error("Transaction error: {0}")]
    TransactionError(String),

    #[error("Server error: {0}")]
    Server(String),
}

pub type Result<T> = std::result::Result<T, Error>;

impl From<sea_orm::DbErr> for Error {
    fn from(err: sea_orm::DbErr) -> Self {
        Error::Database(err.to_string())
    }
}

impl From<anyhow::Error> for Error {
    fn from(err: anyhow::Error) -> Self {
        Error::Server(err.to_string())
    }
}
