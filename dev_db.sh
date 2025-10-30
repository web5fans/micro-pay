#!/bin/bash

 docker run -d \
        --name micro-pay-postgres \
        -p 8080:8080 \
        -p 5432:5432 \
        -e POSTGRES_USER=postgres \
        -e POSTGRES_PASSWORD=123456 \
        -e PGDATA=/var/lib/postgresql/data/pgdata \
        -v ./data:/var/lib/postgresql/data \
        postgres:16.10
