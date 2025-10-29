use axum::extract::Path;
use axum::Json;
use sea_orm::*;
use tracing::error;

use crate::db;
use crate::error::Error;
use crate::models::payment;
use crate::models::payment::Entity as PaymentEntity;
use crate::models::payment::Model as PaymentModel;
use crate::types::PaymentInfo;

pub async fn get_payment_by_id(Path(id): Path<i64>) -> Result<Json<PaymentInfo>, Error> {
    let payment = PaymentEntity::find_by_id(id)
        .one(db::get_db())
        .await
        .map_err(|e| {
            error!("Failed to get payment: {}", e);
            Error::Database(e.to_string())
        })?;

    let payment = payment.ok_or(Error::PaymentNotFound)?;
    Ok(Json(convert_to_payment_info(payment)))
}

pub async fn get_payments_by_sender(
    Path(address): Path<String>,
) -> Result<Json<Vec<PaymentInfo>>, Error> {
    let payments = PaymentEntity::find()
        .filter(payment::Column::Sender.eq(address))
        .all(db::get_db())
        .await
        .map_err(|e| {
            error!("Failed to get payments: {}", e);
            Error::Database(e.to_string())
        })?;

    Ok(Json(
        payments.into_iter().map(convert_to_payment_info).collect(),
    ))
}

pub async fn get_payments_by_receiver(
    Path(address): Path<String>,
) -> Result<Json<Vec<PaymentInfo>>, Error> {
    let payments = PaymentEntity::find()
        .filter(payment::Column::Receiver.eq(address))
        .all(db::get_db())
        .await
        .map_err(|e| {
            error!("Failed to get payments: {}", e);
            Error::Database(e.to_string())
        })?;

    Ok(Json(
        payments.into_iter().map(convert_to_payment_info).collect(),
    ))
}

pub async fn get_all_payments() -> Result<Json<Vec<PaymentInfo>>, Error> {
    let payments = PaymentEntity::find().all(db::get_db()).await.map_err(|e| {
        error!("Failed to get all payments: {}", e);
        Error::Database(e.to_string())
    })?;

    Ok(Json(
        payments.into_iter().map(convert_to_payment_info).collect(),
    ))
}

fn convert_to_payment_info(payment: PaymentModel) -> PaymentInfo {
    PaymentInfo {
        id: payment.id,
        sender: payment.sender,
        receiver: payment.receiver,
        amount: payment.amount,
        created_at: payment.created_at.to_string(),
        updated_at: payment.updated_at.to_string(),
        is_complete: payment.is_complete,
        tx_hash: payment.tx_hash,
    }
}
