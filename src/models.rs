pub mod payment {
    use sea_orm::entity::prelude::*;
    use time::OffsetDateTime;

    //#[sea_orm::model]
    #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
    #[sea_orm(table_name = "payment")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = true)]
        pub id: i64,
        pub sender: String,
        pub receiver: String,
        pub amount: i64,
        pub created_at: OffsetDateTime,
        pub updated_at: OffsetDateTime,
        pub is_complete: bool,
        pub tx_hash: Option<String>,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {
        #[sea_orm(has_many = "super::account::Entity")]
        Account,
    }

    impl Related<super::account::Entity> for Entity {
        fn to() -> RelationDef {
            Relation::Account.def()
        }
    }

    impl ActiveModelBehavior for ActiveModel {}
}

pub mod account {
    use sea_orm::entity::prelude::*;
    use time::OffsetDateTime;

    //#[sea_orm::model]
    #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
    #[sea_orm(table_name = "account")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = true)]
        pub id: i64,
        pub payment_id: i64,
        pub receiver: String,
        pub amount: i64,
        pub created_at: OffsetDateTime,
        pub updated_at: OffsetDateTime,
        pub is_payed: bool,
        pub tx_hash: Option<String>,
    }

    #[derive(Copy, Clone, Debug, EnumIter)]
    pub enum Relation {
        Payment,
    }

    impl RelationTrait for Relation {
        fn def(&self) -> RelationDef {
            match self {
                Self::Payment => Entity::belongs_to(super::payment::Entity)
                    .from(Column::PaymentId)
                    .to(super::payment::Column::Id)
                    .into(),
            }
        }
    }

    impl Related<super::payment::Entity> for Entity {
        fn to() -> RelationDef {
            Relation::Payment.def()
        }
    }

    impl ActiveModelBehavior for ActiveModel {}
}
