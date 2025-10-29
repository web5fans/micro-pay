use anyhow::Result;
use ckb_sdk::core::TransactionBuilder;
use ckb_sdk::{Address, CkbRpcClient, NetworkType};
use once_cell::sync::OnceCell;
use std::str::FromStr;

static CKB_CLIENT: OnceCell<CkbRpcClient> = OnceCell::new();
static NETWORK_TYPE: OnceCell<NetworkType> = OnceCell::new();

pub fn init_ckb_client(ckb_url: &str, network: &str) -> Result<()> {
    let ckb_client = CkbRpcClient::new(ckb_url);
    CKB_CLIENT
        .set(ckb_client)
        .map_err(|_| anyhow::anyhow!("Failed to initialize CKB RPC client"))?;
    let network_type =
        NetworkType::from_raw_str(network).expect("network must be 'ckb' or 'ckb_testnet'");
    NETWORK_TYPE
        .set(network_type)
        .map_err(|_| anyhow::anyhow!("Failed to initialize network type"))?;
    Ok(())
}

pub fn get_ckb_client() -> &'static CkbRpcClient {
    CKB_CLIENT.get().expect("CKB RPC client not initialized")
}

pub fn get_network_type() -> NetworkType {
    *NETWORK_TYPE.get().expect("Network type not initialized")
}

pub fn build_22_tx(sender: &str, receiver: &str, amount: i64) -> Result<(String, String)> {
    let ckb_client = get_ckb_client();
    let network_type = get_network_type();

    let sender =
        Address::from_str(sender).map_err(|_| anyhow::anyhow!("Failed to parse sender address"))?;
    let receiver = Address::from_str(receiver)
        .map_err(|_| anyhow::anyhow!("Failed to parse receiver address"))?;

    let mut tx_builder = TransactionBuilder::default();

    let tx = tx_builder.build();
    let tx_hash = hex::encode(&tx.hash().raw_data());

    let json_tx = ckb_jsonrpc_types::TransactionView::from(tx.clone());

    let tx_str = serde_json::to_string_pretty(&json_tx).unwrap();

    Ok((tx_str, tx_hash))
}

pub async fn complete_tx(tx: &str) -> Result<String> {
    let ckb_client = get_ckb_client();

    // TODO: complete sign and send tx
    let tx_hash = "0x33f37f9ca3215f0c92bf5a8c49bbf85584b21974b859fb01bd7e8b9ec4576d08".to_string();

    Ok(tx_hash)
}
