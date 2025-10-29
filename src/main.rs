mod api;
mod ckb;
mod config;
mod db;
mod error;
mod models;
mod types;

use crate::types::{PreparePaymentRequest, TransferRequest};
use anyhow::Result;
use axum::{
    extract::Path,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    str::FromStr,
};
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt::init();

    // Load configuration
    let config = config::load_config()?;
    info!("Config loaded");

    // Initialize database connection
    db::init_db(&config).await?;
    info!("Database initialized");

    // Initialize CKB client
    ckb::init_ckb_client(&config.ckb.url, &config.ckb.network)?;
    info!("CKB client initialized");

    // Create API routes
    let app = Router::new()
        .route(
            "/api/payment/prepare",
            post(|payload| async move {
                match api::payment::prepare_payment(payload).await {
                    Ok(response) => response.into_response(),
                    Err(err) => {
                        (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response()
                    }
                }
            }),
        )
        .route(
            "/api/payment/transfer",
            post(|payload| async move {
                match api::payment::transfer(payload).await {
                    Ok(response) => response.into_response(),
                    Err(err) => {
                        (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response()
                    }
                }
            }),
        )
        .route(
            "/api/payment/{id}",
            get(|id: Path<i64>| async move {
                match api::query::get_payment_by_id(id).await {
                    Ok(response) => response.into_response(),
                    Err(err) => {
                        (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response()
                    }
                }
            }),
        )
        .route(
            "/api/payment/sender/{address}",
            get(|address: Path<String>| async move {
                match api::query::get_payments_by_sender(address).await {
                    Ok(response) => response.into_response(),
                    Err(err) => {
                        (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response()
                    }
                }
            }),
        )
        .route(
            "/api/payment/receiver/{address}",
            get(|address: Path<String>| async move {
                match api::query::get_payments_by_receiver(address).await {
                    Ok(response) => response.into_response(),
                    Err(err) => {
                        (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response()
                    }
                }
            }),
        )
        .route(
            "/api/payment/all",
            get(|| async move {
                match api::query::get_all_payments().await {
                    Ok(response) => response.into_response(),
                    Err(err) => {
                        (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response()
                    }
                }
            }),
        );

    // Start HTTP server
    let host = IpAddr::from_str(&config.server.host).unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST));
    let addr = SocketAddr::from((host, config.server.port));
    info!("Server starting on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await?;
    Ok(())
}
