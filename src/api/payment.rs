use axum::Json;
use sea_orm::*;
use time::OffsetDateTime;
use tracing::error;

use crate::db;
use crate::error::Error;
use crate::types::{
    PreparePaymentRequest, PreparePaymentResponse, TransferRequest, TransferResponse,
};

use crate::models::account;
use crate::models::payment;

use tracing::{debug, info};

pub async fn prepare_payment(
    Json(request): Json<PreparePaymentRequest>,
) -> Result<Json<PreparePaymentResponse>, Error> {
    info!("Prepare payment request: {:?}", request);

    // build 2-2 tx
    // sender to platform
    let config = crate::config::get_config();
    let platform_address = config.platform.platform_address.clone();
    let (raw_tx, tx_hash) =
        crate::ckb::build_22_tx(&request.sender, &platform_address, request.amount)?;
    info!("2-2 tx hash: {}", tx_hash);

    let db = db::get_db();
    let now = OffsetDateTime::now_utc();
    let payment_record = payment::ActiveModel {
        sender: Set(request.sender.clone()),
        receiver: Set(request.receiver.clone()),
        amount: Set(request.amount),
        created_at: Set(now),
        updated_at: Set(now),
        is_complete: Set(false),
        tx_hash: Set(Some(tx_hash.clone())),
        ..Default::default()
    };
    let res = payment::Entity::insert(payment_record).exec(db).await?;
    let payment_id = res.last_insert_id;
    info!("Inserted payment: id = {}", payment_id);

    // Insert accounts
    for account in request.accounts.iter() {
        let account_amount = request.amount * account.fee_rate as i64 / 100;
        let account_record = account::ActiveModel {
            payment_id: Set(payment_id),
            receiver: Set(account.address.clone()),
            amount: Set(account_amount),
            created_at: Set(now),
            updated_at: Set(now),
            is_payed: Set(false),
            ..Default::default()
        };
        let res = account::Entity::insert(account_record).exec(db).await?;
        info!("Inserted account: id = {}", res.last_insert_id);
    }

    // receiver rate is 100 - sum of fee rates
    let receiver_rate = 100 - request.accounts.iter().map(|a| a.fee_rate).sum::<u32>() as i64;
    let receiver_amount = request.amount * receiver_rate as i64 / 100;
    let receiver_record = account::ActiveModel {
        payment_id: Set(payment_id),
        receiver: Set(request.receiver.clone()),
        amount: Set(receiver_amount),
        created_at: Set(now),
        updated_at: Set(now),
        is_payed: Set(false),
        ..Default::default()
    };
    let res = account::Entity::insert(receiver_record).exec(db).await?;
    info!("Inserted account: id = {}", res.last_insert_id);

    Ok(Json(PreparePaymentResponse {
        payment_id: payment_id,
        tx_hash: tx_hash,
        raw_tx: raw_tx,
    }))
}

pub async fn transfer(
    Json(request): Json<TransferRequest>,
) -> Result<Json<TransferResponse>, Error> {
    info!("Transfer request: {:?}", request);
    let db = db::get_db();
    let config = crate::config::get_config();

    let tx = request.signed_tx.clone();
    info!("Transfer request tx: {}", tx);
    match crate::ckb::complete_tx(&tx).await {
        Ok(tx_hash) => {
            // update payment record
            let now = OffsetDateTime::now_utc();
            let payment_record = payment::Entity::find_by_id(request.payment_id)
                .one(db)
                .await?
                .ok_or(Error::PaymentNotFound)?;
            let mut payment_record = payment_record.into_active_model();
            payment_record.is_complete = Set(true);
            payment_record.updated_at = Set(now);
            payment_record.tx_hash = Set(Some(tx_hash.to_string()));
            payment::Entity::update(payment_record).exec(db).await?;

            Ok(Json(TransferResponse {
                payment_id: request.payment_id,
                tx_hash: tx_hash.to_string(),
            }))
        }
        Err(e) => {
            error!("Transfer tx failed: {:?}", e);
            // delete payment record
            payment::Entity::delete_by_id(request.payment_id)
                .exec(db)
                .await?;
            account::Entity::delete_many()
                .filter(account::Column::PaymentId.eq(request.payment_id))
                .exec(db)
                .await?;
            Err(Error::TransactionError(e.to_string()))
        }
    }
}
