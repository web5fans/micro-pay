use config::{Config, ConfigError};
use once_cell::sync::OnceCell;
use serde::Deserialize;

static CONFIG: OnceCell<Settings> = OnceCell::new();

#[derive(Debug, Deserialize)]
pub struct Database {
    pub url: String,
    pub max_connections: u32,
}

#[derive(Debug, Deserialize)]
pub struct CKB {
    pub url: String,
    pub network: String, // mainnet or testnet
}

#[derive(Debug, Deserialize)]
pub struct Server {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Deserialize)]
pub struct Platform {
    pub platform_address: String,
    pub platform_private_key: String,
    pub min_withdrawal_amount: u64, // min withdrawal amount (CKB)
}

#[derive(Debug, Deserialize)]
pub struct Settings {
    pub database: Database,
    pub ckb: CKB,
    pub server: Server,
    pub platform: Platform,
}

pub fn load_config() -> Result<&'static Settings, ConfigError> {
    let config = Config::builder()
        .add_source(config::File::with_name("config"))
        .add_source(config::Environment::with_prefix("APP"))
        .build()?
        .try_deserialize()?;

    Ok(CONFIG.get_or_init(|| config))
}

pub fn get_config() -> &'static Settings {
    CONFIG.get().expect("Config not initialized")
}

// add some unit test
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_config() {
        let config = load_config().unwrap();
        assert_eq!(config.ckb.network, "ckb_testnet");
    }
}
