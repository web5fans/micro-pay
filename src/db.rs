use crate::config::Settings;
use crate::models::account::Entity as AccountEntity;
use crate::models::payment::Entity as PaymentEntity;
use anyhow::Result;
use once_cell::sync::OnceCell;
use sea_orm::{
    sqlx::Statement, ConnectOptions, ConnectionTrait, Database, DatabaseConnection, DbBackend,
    Schema,
};

static DB: OnceCell<DatabaseConnection> = OnceCell::new();

pub async fn init_db(config: &Settings) -> Result<()> {
    let mut opt = ConnectOptions::new(&config.database.url);
    opt.max_connections(config.database.max_connections)
        .min_connections(10)
        .connect_timeout(std::time::Duration::from_secs(5))
        .acquire_timeout(std::time::Duration::from_secs(5))
        .idle_timeout(std::time::Duration::from_secs(60))
        .max_lifetime(std::time::Duration::from_secs(60));
    let db = Database::connect(opt).await?.clone();

    // create tables if not exist
    let db_postgres = DbBackend::Postgres;
    let schema = Schema::new(db_postgres);

    let payment_table_statement = schema
        .create_table_from_entity(PaymentEntity)
        .if_not_exists()
        .to_owned();
    let create_payment = db_postgres.build(&payment_table_statement);
    let account_table_statement = schema
        .create_table_from_entity(AccountEntity)
        .if_not_exists()
        .to_owned();
    let create_account = db_postgres.build(&account_table_statement);

    db.execute(create_payment).await?;
    db.execute(create_account).await?;

    DB.set(db)
        .map_err(|_| anyhow::anyhow!("Failed to initialize database connection"))
}

pub fn get_db() -> &'static DatabaseConnection {
    DB.get().expect("Database not initialized")
}
